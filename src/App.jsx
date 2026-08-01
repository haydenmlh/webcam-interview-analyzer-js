import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    FaceLandmarker,
    FilesetResolver,
    HandLandmarker,
    PoseLandmarker,
} from '@mediapipe/tasks-vision'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import lamejs from 'lamejs'
import { APP_VERSION } from './version'
import './App.css'

const STORAGE_KEY = 'mia.deepgram.apiKey'
const STORAGE_VALIDATED_AT = 'mia.deepgram.lastValidatedAt'
const STORAGE_THEME = 'mia.theme'
const HANDLE_DB_NAME = 'mia-handle-db'
const HANDLE_STORE_NAME = 'handles'
const RECORDINGS_FOLDER_KEY = 'recordings-folder'

const VALIDATION_RECOMMEND_DAYS = 30
const INITIAL_NOW_MS = Date.now()

const DEFAULT_WASM_URL =
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
const DEFAULT_FACE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
const DEFAULT_HAND_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'
const DEFAULT_POSE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
const DEFAULT_DEEPGRAM_LISTEN_URL =
    'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&filler_words=true'
const DEFAULT_DEEPGRAM_SPEAK_URL =
    'https://api.deepgram.com/v1/speak?model=aura-2-thalia-en'
const DEFAULT_FFMPEG_CORE_BASE_URL =
    'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'

const PROLONGED_CLOSURE_MS = 800
const EYE_CLOSED_RATIO = 0.18
const EYE_REOPEN_RATIO = 0.205
const HAND_FACE_TOUCH_RATIO = 0.12
const SHOULDER_SHIFT_ALERT_PCT = 30
const SHOULDER_TILT_ALERT_DEG = 12
const SHOULDER_ROTATION_ALERT_DEG = 18
const GAZE_CENTER_DEVIATION_THRESHOLD_PCT = 25
const GAZE_DIRECTION_EXIT_THRESHOLD_PCT = 24
const GAZE_DIRECTION_RETURN_THRESHOLD_PCT = 15
const GAZE_DIRECTION_DOMINANCE_PCT = 4

function validateKeyFormat(rawValue) {
    const value = rawValue.trim()
    if (!value) return 'Enter your Deepgram API key.'
    if (value.length < 20) return 'Key looks too short. Check and retry.'
    if (!/^[-_A-Za-z0-9]+$/.test(value)) return 'Key contains unsupported characters.'
    return ''
}

async function validateAgainstEndpoint(key) {
    const endpoint = import.meta.env.VITE_DEEPGRAM_VALIDATE_URL
    const controller = new AbortController()
    const timerId = window.setTimeout(() => controller.abort(), 8000)

    try {
        const response = endpoint
            ? await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${key}`,
                },
                body: JSON.stringify({ provider: 'deepgram' }),
                signal: controller.signal,
            })
            : await fetch(DEFAULT_DEEPGRAM_LISTEN_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Token ${key}`,
                    'Content-Type': 'audio/wav',
                },
                // Deepgram returns 4xx for invalid/empty audio, but 401/403 for invalid auth.
                body: new Blob([], { type: 'audio/wav' }),
                signal: controller.signal,
            })

        if (response.status === 401 || response.status === 403) {
            return { ok: false, message: 'Saved key is invalid or revoked.' }
        }
        if (response.status === 429) {
            return {
                ok: false,
                message: 'Transcription provider rate limit reached. Please wait and retry.',
            }
        }
        if (!response.ok) {
            if (!endpoint) {
                // For direct Deepgram probing, non-auth HTTP errors still prove the token was accepted.
                return { ok: true, skipped: false }
            }

            return { ok: false, message: 'Could not validate key. Check the key and try again.' }
        }

        return { ok: true, skipped: false }
    } catch {
        return { ok: false, message: 'Network error while validating key. Try again.' }
    } finally {
        window.clearTimeout(timerId)
    }
}

function getSavedValue(keyName) {
    try {
        return localStorage.getItem(keyName) || ''
    } catch {
        return ''
    }
}

function setSavedValue(keyName, value) {
    try {
        localStorage.setItem(keyName, value)
    } catch {
        // Local storage can fail in private mode or restrictive policies.
    }
}

function clearSavedValue(keyName) {
    try {
        localStorage.removeItem(keyName)
    } catch {
        // Local storage can fail in private mode or restrictive policies.
    }
}

function isFileSystemAccessSupported() {
    return (
        typeof window !== 'undefined' &&
        'showDirectoryPicker' in window &&
        'indexedDB' in window
    )
}

function openHandleDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(HANDLE_DB_NAME, 1)
        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
                db.createObjectStore(HANDLE_STORE_NAME)
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

async function savePersistedFolderHandle(handle) {
    const db = await openHandleDb()
    await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite')
        tx.objectStore(HANDLE_STORE_NAME).put(handle, RECORDINGS_FOLDER_KEY)
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
    })
    db.close()
}

async function loadPersistedFolderHandle() {
    const db = await openHandleDb()
    const handle = await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readonly')
        const request = tx.objectStore(HANDLE_STORE_NAME).get(RECORDINGS_FOLDER_KEY)
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
    db.close()
    return handle
}

async function clearPersistedFolderHandle() {
    const db = await openHandleDb()
    await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite')
        tx.objectStore(HANDLE_STORE_NAME).delete(RECORDINGS_FOLDER_KEY)
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
    })
    db.close()
}

async function ensureDirectoryPermission(handle) {
    if (!handle) return false
    if (handle.queryPermission) {
        const current = await handle.queryPermission({ mode: 'readwrite' })
        if (current === 'granted') return true
    }
    if (!handle.requestPermission) return false
    const result = await handle.requestPermission({ mode: 'readwrite' })
    return result === 'granted'
}

function pickSupportedAudioMimeType() {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    const supported = preferred.find((value) => MediaRecorder.isTypeSupported(value))
    return supported || ''
}

function pickSupportedVideoMimeType() {
    const preferred = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
    ]
    const supported = preferred.find((value) => MediaRecorder.isTypeSupported(value))
    return supported || ''
}

function toFixed1(value) {
    return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

function toFixed2(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function toRoundedInt(value) {
    return Number.isFinite(value) ? Math.round(value) : 0
}

function formatSignedDegrees(value) {
    if (!Number.isFinite(value)) return 'n/a'
    return `${value > 0 ? '+' : ''}${toFixed1(value)}°`
}

function describeTorsoRotation(value, alertThresholdDeg) {
    if (!Number.isFinite(value)) return 'n/a'

    const abs = Math.abs(value)
    if (abs < 1) return 'centered (0°)'

    const direction = value > 0 ? 'right (+)' : 'left (-)'
    return abs >= alertThresholdDeg ? `${direction}, high rotation` : direction
}

function countWords(text) {
    const words = text.trim().match(/\b[\p{L}\p{N}'][\p{L}\p{N}'-]*/gu)
    return words ? words.length : 0
}

function countHesitations(text) {
    const matches = text.match(/\b(um+|uh+|erm+|hmm+|mm+)\b/gi)
    return matches ? matches.length : 0
}

function formatTimestampList(secondsList) {
    if (!secondsList.length) return 'none'
    return secondsList.map((value) => `${toFixed1(value)}s`).join(', ')
}

function buildOutputText({ capturedAt, question, answer, metrics }) {
    return [
        'Transcript Output',
        `Captured At: ${capturedAt}`,
        `Question: ${question || '(none)'}`,
        '',
        'Answer:',
        answer || '(no transcript captured)',
        '',
        'Interview Metrics',
        `- Answer Length: ${toFixed2(metrics.answerLengthSec)}s`,
        `- WPM: ${toRoundedInt(metrics.wpm)}`,
        `- Hesitations Count: ${metrics.hesitationsCount}`,
        `- Number of Gaze Deviations from Center: ${metrics.gazeDeviationCount}`,
        `- Gaze Deviation Direction Counts (L/R/U/D): ${metrics.gazeDeviationDirectionCounts.left}/${metrics.gazeDeviationDirectionCounts.right}/${metrics.gazeDeviationDirectionCounts.up}/${metrics.gazeDeviationDirectionCounts.down}`,
        `- Gaze Center Time: ${toFixed1(metrics.gazeCenterSec)}s / ${toFixed2(metrics.answerLengthSec)}s (${toRoundedInt(metrics.gazeCenterPct)}%)`,
        `- Prolonged Eye-Closure Duration: ${toFixed1(metrics.prolongedClosureSec)}s (${toFixed1(metrics.prolongedClosurePct)}%)`,
        `- Prolonged Eye-Closure Events: ${metrics.prolongedClosureEvents}`,
        `- Prolonged Eye-Closure Timestamps: ${formatTimestampList(metrics.prolongedClosureTimestampsSec)}`,
        `- Hand-to-Face Touch Frequency: ${toFixed1(metrics.handFaceTouchPerMin)}/min`,
        `- Hand-to-Face Touch Duration: ${toFixed1(metrics.handFaceTouchDurationSec)}s`,
        `- Hand-to-Face Regions: ${metrics.handFaceTouchRegions}`,
        `- Shoulder Side Shift Peak: ${toFixed1(metrics.shoulderShiftPeakPct)}%`,
        `- Shoulder Tilt Peak: ${toFixed1(metrics.shoulderTiltPeakDeg)}°`,
        `- Shoulder Rotation Peak: ${toFixed1(metrics.shoulderRotationPeakDeg)}°`,
        `- Shoulder Rotation Last Signed: ${formatSignedDegrees(metrics.shoulderRotationSignedDeg)}`,
        `- Shoulder Rotation Direction: ${metrics.shoulderRotationDirection}`,
        `- Shoulder Rotation Status: ${metrics.shoulderRotationStatus}`,
    ].join('\n')
}

function floatTo16BitPCM(input) {
    const output = new Int16Array(input.length)
    for (let i = 0; i < input.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, input[i]))
        output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }
    return output
}

function encodeAudioBufferToMp3(audioBuffer, kbps = 128) {
    const channels = Math.min(audioBuffer.numberOfChannels, 2)
    const sampleRate = audioBuffer.sampleRate
    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps)
    const blockSize = 1152

    const left = floatTo16BitPCM(audioBuffer.getChannelData(0))
    const right =
        channels > 1
            ? floatTo16BitPCM(audioBuffer.getChannelData(1))
            : null

    const output = []
    for (let i = 0; i < left.length; i += blockSize) {
        const leftChunk = left.subarray(i, i + blockSize)
        const encoded =
            channels > 1 && right
                ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
                : encoder.encodeBuffer(leftChunk)
        if (encoded.length > 0) output.push(new Int8Array(encoded))
    }

    const tail = encoder.flush()
    if (tail.length > 0) output.push(new Int8Array(tail))

    return new Blob(output, { type: 'audio/mpeg' })
}

async function convertAudioBlobToMp3(audioBlob) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) throw new Error('AudioContext is unavailable in this browser.')

    const audioCtx = new AudioCtx()
    try {
        const arrayBuffer = await audioBlob.arrayBuffer()
        const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
        return encodeAudioBufferToMp3(decoded)
    } finally {
        await audioCtx.close()
    }
}

async function ensureFfmpegLoaded(ffmpegRef, ffmpegLoadedRef) {
    if (ffmpegLoadedRef.current && ffmpegRef.current) return ffmpegRef.current

    const ffmpeg = ffmpegRef.current || new FFmpeg()
    ffmpegRef.current = ffmpeg

    const baseUrl =
        import.meta.env.VITE_FFMPEG_CORE_BASE_URL || DEFAULT_FFMPEG_CORE_BASE_URL

    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, 'application/wasm'),
    })

    ffmpegLoadedRef.current = true
    return ffmpeg
}

async function convertVideoBlobToMp4(videoBlob, ffmpegRef, ffmpegLoadedRef) {
    if (videoBlob.type.includes('mp4')) return videoBlob

    const ffmpeg = await ensureFfmpegLoaded(ffmpegRef, ffmpegLoadedRef)
    const inputName = `input-${Date.now()}.webm`
    const outputName = `output-${Date.now()}.mp4`

    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    try {
        // Re-encode into MP4 so audio + video are muxed in a broadly compatible container.
        await ffmpeg.exec([
            '-i',
            inputName,
            '-c:v',
            'mpeg4',
            '-c:a',
            'aac',
            outputName,
        ])

        const data = await ffmpeg.readFile(outputName)
        return new Blob([data.buffer], { type: 'video/mp4' })
    } finally {
        try {
            await ffmpeg.deleteFile(inputName)
        } catch {
            // Ignore cleanup errors.
        }
        try {
            await ffmpeg.deleteFile(outputName)
        } catch {
            // Ignore cleanup errors.
        }
    }
}

function safeTranscriptFromDeepgram(payload) {
    return (
        payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ||
        payload?.transcript?.trim() ||
        ''
    )
}

function drawLandmarkSet(ctx, points, width, height, color, radius = 2.4) {
    ctx.fillStyle = color
    for (const point of points) {
        const x = point.x * width
        const y = point.y * height
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
    }
}

function drawFaceBoundingBox(ctx, points, width, height, color) {
    if (!points?.length) return

    let minX = 1
    let minY = 1
    let maxX = 0
    let maxY = 0

    for (const point of points) {
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
    }

    const boxX = minX * width
    const boxY = minY * height
    const boxW = (maxX - minX) * width
    const boxH = (maxY - minY) * height

    if (boxW <= 0 || boxH <= 0) return

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(boxX, boxY, boxW, boxH)
}

function averageX(landmarks, indexes) {
    const valid = indexes.map((index) => landmarks[index]).filter(Boolean)
    if (!valid.length) return null
    return valid.reduce((sum, point) => sum + point.x, 0) / valid.length
}

function averageY(landmarks, indexes) {
    const valid = indexes.map((index) => landmarks[index]).filter(Boolean)
    if (!valid.length) return null
    return valid.reduce((sum, point) => sum + point.y, 0) / valid.length
}

function distance2d(a, b) {
    if (!a || !b) return 0
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value))
}

function normalizedAngleDiffDegrees(a, b) {
    let diff = Math.abs(a - b) % 360
    if (diff > 180) diff = 360 - diff
    return diff
}

function computeEyeContactScore(faceLandmarks) {
    if (!faceLandmarks?.length) return null

    const leftInner = faceLandmarks[133]
    const leftOuter = faceLandmarks[33]
    const rightInner = faceLandmarks[362]
    const rightOuter = faceLandmarks[263]

    if (!leftInner || !leftOuter || !rightInner || !rightOuter) return null

    const leftIrisX = averageX(faceLandmarks, [468, 469, 470, 471, 472])
    const rightIrisX = averageX(faceLandmarks, [473, 474, 475, 476, 477])
    if (leftIrisX == null || rightIrisX == null) return null

    const leftWidth = Math.abs(leftInner.x - leftOuter.x)
    const rightWidth = Math.abs(rightInner.x - rightOuter.x)
    if (leftWidth <= 0 || rightWidth <= 0) return null

    const leftCenter = (leftInner.x + leftOuter.x) / 2
    const rightCenter = (rightInner.x + rightOuter.x) / 2

    const leftDeviation = Math.abs((leftIrisX - leftCenter) / (leftWidth / 2))
    const rightDeviation = Math.abs((rightIrisX - rightCenter) / (rightWidth / 2))
    const avgDeviation = (leftDeviation + rightDeviation) / 2

    return clamp01(1 - avgDeviation)
}

function computeGazeCenterOffsetsPct(faceLandmarks) {
    if (!faceLandmarks?.length) return null

    const leftInner = faceLandmarks[133]
    const leftOuter = faceLandmarks[33]
    const leftUpper = faceLandmarks[159]
    const leftLower = faceLandmarks[145]

    const rightInner = faceLandmarks[362]
    const rightOuter = faceLandmarks[263]
    const rightUpper = faceLandmarks[386]
    const rightLower = faceLandmarks[374]

    if (
        !leftInner ||
        !leftOuter ||
        !leftUpper ||
        !leftLower ||
        !rightInner ||
        !rightOuter ||
        !rightUpper ||
        !rightLower
    ) {
        return null
    }

    const leftIrisX = averageX(faceLandmarks, [468, 469, 470, 471, 472])
    const leftIrisY = averageY(faceLandmarks, [468, 469, 470, 471, 472])
    const rightIrisX = averageX(faceLandmarks, [473, 474, 475, 476, 477])
    const rightIrisY = averageY(faceLandmarks, [473, 474, 475, 476, 477])

    if (leftIrisX == null || leftIrisY == null || rightIrisX == null || rightIrisY == null) {
        return null
    }

    const leftCenterX = (leftInner.x + leftOuter.x) / 2
    const rightCenterX = (rightInner.x + rightOuter.x) / 2
    const leftCenterY = (leftUpper.y + leftLower.y) / 2
    const rightCenterY = (rightUpper.y + rightLower.y) / 2

    const leftHalfWidth = Math.abs(leftInner.x - leftOuter.x) / 2
    const rightHalfWidth = Math.abs(rightInner.x - rightOuter.x) / 2
    const leftHalfHeight = Math.abs(leftUpper.y - leftLower.y) / 2
    const rightHalfHeight = Math.abs(rightUpper.y - rightLower.y) / 2

    if (leftHalfWidth <= 0 || rightHalfWidth <= 0 || leftHalfHeight <= 0 || rightHalfHeight <= 0) {
        return null
    }

    const leftOffsetXPct = ((leftIrisX - leftCenterX) / leftHalfWidth) * 100
    const rightOffsetXPct = ((rightIrisX - rightCenterX) / rightHalfWidth) * 100
    const leftOffsetYPct = ((leftIrisY - leftCenterY) / leftHalfHeight) * 100
    const rightOffsetYPct = ((rightIrisY - rightCenterY) / rightHalfHeight) * 100

    return {
        xPct: (leftOffsetXPct + rightOffsetXPct) / 2,
        yPct: (leftOffsetYPct + rightOffsetYPct) / 2,
    }
}

function classifyGazeRegionFromOffsets(offsets, previousRegion) {
    if (!offsets) return previousRegion

    const absX = Math.abs(offsets.xPct)
    const absY = Math.abs(offsets.yPct)
    const limit =
        previousRegion === 'center'
            ? GAZE_DIRECTION_EXIT_THRESHOLD_PCT
            : GAZE_DIRECTION_RETURN_THRESHOLD_PCT

    if (absX <= limit && absY <= limit) {
        return 'center'
    }

    if (Math.abs(absX - absY) >= GAZE_DIRECTION_DOMINANCE_PCT) {
        if (absX > absY) return offsets.xPct > 0 ? 'right' : 'left'
        return offsets.yPct > 0 ? 'down' : 'up'
    }

    return previousRegion
}

function computeEyeClosureRatio(faceLandmarks) {
    if (!faceLandmarks?.length) return null

    const leftUp = faceLandmarks[159]
    const leftLow = faceLandmarks[145]
    const leftLeft = faceLandmarks[33]
    const leftRight = faceLandmarks[133]

    const rightUp = faceLandmarks[386]
    const rightLow = faceLandmarks[374]
    const rightLeft = faceLandmarks[362]
    const rightRight = faceLandmarks[263]

    if (
        !leftUp ||
        !leftLow ||
        !leftLeft ||
        !leftRight ||
        !rightUp ||
        !rightLow ||
        !rightLeft ||
        !rightRight
    ) {
        return null
    }

    const leftVertical = distance2d(leftUp, leftLow)
    const leftHorizontal = distance2d(leftLeft, leftRight)
    const rightVertical = distance2d(rightUp, rightLow)
    const rightHorizontal = distance2d(rightLeft, rightRight)

    if (leftHorizontal <= 0 || rightHorizontal <= 0) return null

    return (leftVertical / leftHorizontal + rightVertical / rightHorizontal) / 2
}

function computeHandFaceTouch(faceLandmarks, handLandmarks) {
    if (!faceLandmarks?.length || !handLandmarks?.length) return false

    const faceLeft = faceLandmarks[234]
    const faceRight = faceLandmarks[454]
    if (!faceLeft || !faceRight) return false

    const faceWidth = distance2d(faceLeft, faceRight)
    if (faceWidth <= 0) return false

    const watchPoints = [1, 4, 152, 10, 234, 454]
        .map((idx) => faceLandmarks[idx])
        .filter(Boolean)

    if (!watchPoints.length) return false

    let minDistance = Infinity
    for (const handSet of handLandmarks) {
        for (const handPoint of handSet) {
            for (const facePoint of watchPoints) {
                const current = distance2d(handPoint, facePoint)
                if (current < minDistance) minDistance = current
            }
        }
    }

    return minDistance / faceWidth < HAND_FACE_TOUCH_RATIO
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}

function sanitizeDisplayText(value, fallback = '') {
    const text = String(value ?? '')
        .split('')
        .filter((char) => {
            const code = char.charCodeAt(0)
            return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
        })
        .join('')
    const trimmed = text.trim()
    return trimmed || fallback
}

function formatSessionTimestamp(dateValue) {
    const date = new Date(dateValue)
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
    const year = safeDate.getFullYear()
    const month = String(safeDate.getMonth() + 1).padStart(2, '0')
    const day = String(safeDate.getDate()).padStart(2, '0')
    const hours = String(safeDate.getHours()).padStart(2, '0')
    const minutes = String(safeDate.getMinutes()).padStart(2, '0')
    const seconds = String(safeDate.getSeconds()).padStart(2, '0')
    return `${year}${month}${day}_${hours}${minutes}${seconds}`
}

function sanitizeQuestionForFileName(question) {
    const safeText = sanitizeDisplayText(question, 'question')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return (safeText || 'question').slice(0, 30)
}

function buildSessionFileBaseName(capturedAtIso, question) {
    const stamp = formatSessionTimestamp(capturedAtIso)
    const safeQuestion = sanitizeQuestionForFileName(question)
    return `${stamp}_${safeQuestion}`
}

function splitFileName(fileName) {
    const safeName = sanitizeDisplayText(fileName, 'unknown')
    const lastDot = safeName.lastIndexOf('.')
    if (lastDot <= 0) return { baseName: safeName, extension: '' }
    return {
        baseName: safeName.slice(0, lastDot),
        extension: safeName.slice(lastDot + 1).toLowerCase(),
    }
}

function parseSessionJsonReport(fileName, content, fallbackDateIso, sortTime) {
    try {
        const parsed = JSON.parse(content)
        const { baseName } = splitFileName(fileName)
        const parsedTextFileName = sanitizeDisplayText(parsed?.savedFiles?.textFileName, '')
        return {
            id: `${baseName}-${sortTime}-json`,
            baseName,
            source: sanitizeDisplayText(fileName, 'unknown-file'),
            capturedAt: sanitizeDisplayText(
                parsed?.generatedAt ?? parsed?.capturedAt,
                fallbackDateIso,
            ),
            question: sanitizeDisplayText(parsed?.question, '(none)'),
            transcript: sanitizeDisplayText(
                parsed?.transcript ?? parsed?.answer,
                '(no transcript captured)',
            ),
            metrics:
                parsed?.interviewMetrics && typeof parsed.interviewMetrics === 'object'
                    ? parsed.interviewMetrics
                    : parsed?.metrics && typeof parsed.metrics === 'object'
                        ? parsed.metrics
                        : null,
            metricsText: sanitizeDisplayText(parsed?.outputText, ''),
            audioFileName: sanitizeDisplayText(
                parsed?.audioFileName ?? parsed?.savedFiles?.audioFileName,
                '',
            ),
            videoFileName: sanitizeDisplayText(
                parsed?.videoFileName ?? parsed?.savedFiles?.videoFileName,
                '',
            ),
            textFileName: parsedTextFileName || `${baseName}.txt`,
            audioHandle: null,
            videoHandle: null,
            textHandle: null,
            sortTime,
        }
    } catch {
        return null
    }
}

function App() {
    const videoRef = useRef(null)
    const overlayRef = useRef(null)
    const cameraStreamRef = useRef(null)
    const audioStreamRef = useRef(null)
    const animationFrameRef = useRef(0)
    const lastVideoTimeRef = useRef(-1)
    const faceLandmarkerRef = useRef(null)
    const handLandmarkerRef = useRef(null)
    const poseLandmarkerRef = useRef(null)
    const uiUpdateAtRef = useRef(0)
    const recorderRef = useRef(null)
    const chunksRef = useRef([])
    const videoRecorderRef = useRef(null)
    const videoChunksRef = useRef([])
    const questionAudioRef = useRef(null)
    const sessionStartedAtRef = useRef(null)
    const debugEnabledRef = useRef(false)
    const recordingsFolderRef = useRef(null)
    const ffmpegRef = useRef(null)
    const ffmpegLoadedRef = useRef(false)
    const portraitVideoRef = useRef(false)
    const recordingActiveRef = useRef(false)
    const recordingModeRef = useRef('audio')
    const recordingStartedAtPerfRef = useRef(0)
    const recordingLastFrameAtPerfRef = useRef(0)
    const shoulderBaselineRef = useRef({
        centerX: null,
        tiltDeg: null,
        rotationDeg: null,
    })
    const gazeDeviationCountRef = useRef(0)
    const gazeDirectionCountsRef = useRef({
        left: 0,
        right: 0,
        up: 0,
        down: 0,
    })
    const gazeRegionRef = useRef('center')
    const gazeCenteredTimeMsRef = useRef(0)
    const lastGazeCenteredRef = useRef(null)
    const prolongedClosureTotalMsRef = useRef(0)
    const prolongedClosureTimestampsSecRef = useRef([])
    const touchCountDuringRecordingRef = useRef(0)
    const touchDurationMsRef = useRef(0)
    const touchStartedAtMsRef = useRef(0)
    const shoulderPeakDriftPctRef = useRef(0)
    const shoulderPeakTiltDegRef = useRef(0)
    const shoulderPeakRotationDegRef = useRef(0)

    const blinkTrackerRef = useRef({
        closed: false,
        closedAt: 0,
        prolongedCounted: false,
    })

    const touchTrackerRef = useRef({
        touching: false,
    })
    const cameraPermissionCheckedRef = useRef(false)

    const [settingsOpen, setSettingsOpen] = useState(false)
    const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
    const [confirmFolderSelectOpen, setConfirmFolderSelectOpen] = useState(false)
    const [savedKey, setSavedKey] = useState(() => getSavedValue(STORAGE_KEY))
    const [lastValidatedAt, setLastValidatedAt] = useState(() =>
        getSavedValue(STORAGE_VALIDATED_AT),
    )

    const [keyInput, setKeyInput] = useState('')
    const [showKey, setShowKey] = useState(false)
    const [fieldError, setFieldError] = useState('')
    const [banner, setBanner] = useState('')
    const [toast, setToast] = useState('')
    const [showKeyStatus, setShowKeyStatus] = useState(false)
    const [darkMode, setDarkMode] = useState(() => getSavedValue(STORAGE_THEME) === 'dark')

    const [cameraStatus, setCameraStatus] = useState('idle')
    const [debugEnabled, setDebugEnabled] = useState(false)
    const [centerCameraLayout, setCenterCameraLayout] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth > 860 : true,
    )
    const [isPortraitVideo, setIsPortraitVideo] = useState(false)

    const [facesDetected, setFacesDetected] = useState(0)
    const [handsDetected, setHandsDetected] = useState(0)
    const [eyeContactScore, setEyeContactScore] = useState(null)
    const [gazeDeviationPct, setGazeDeviationPct] = useState(null)
    const [gazeDeviationCount, setGazeDeviationCount] = useState(0)
    const [gazeDirectionCounts, setGazeDirectionCounts] = useState({
        left: 0,
        right: 0,
        up: 0,
        down: 0,
    })
    const [prolongedClosureCount, setProlongedClosureCount] = useState(0)
    const [touchCount, setTouchCount] = useState(0)
    const [isTouchingFace, setIsTouchingFace] = useState(false)
    const [shoulderDriftPct, setShoulderDriftPct] = useState(null)
    const [shoulderTiltDeltaDeg, setShoulderTiltDeltaDeg] = useState(null)
    const [shoulderRotationDeg, setShoulderRotationDeg] = useState(null)

    const [isRecording, setIsRecording] = useState(false)
    const [isTranscribing, setIsTranscribing] = useState(false)
    const [isSpeakingQuestion, setIsSpeakingQuestion] = useState(false)
    const [readQuestionWithTts, setReadQuestionWithTts] = useState(true)
    const [questionInput, setQuestionInput] = useState('')
    const [transcript, setTranscript] = useState('')
    const [recordedAudioBlob, setRecordedAudioBlob] = useState(null)
    const [recordedVideoBlob, setRecordedVideoBlob] = useState(null)
    const [recordingsFolderName, setRecordingsFolderName] = useState('')
    const [outputText, setOutputText] = useState('')
    const [previousAnswers, setPreviousAnswers] = useState([])
    const [isLoadingPreviousAnswers, setIsLoadingPreviousAnswers] = useState(false)
    const [previousAnswersError, setPreviousAnswersError] = useState('')
    const [historyModalOpen, setHistoryModalOpen] = useState(false)
    const [selectedPreviousAnswerId, setSelectedPreviousAnswerId] = useState('')
    const [selectedHistoryMedia, setSelectedHistoryMedia] = useState({
        audioUrl: '',
        videoUrl: '',
    })
    const [historyPlaybackRate, setHistoryPlaybackRate] = useState(1)
    const historyVideoRef = useRef(null)
    const historyAudioRef = useRef(null)
    const selectedHistoryMediaRef = useRef({ audioUrl: '', videoUrl: '' })

    const hasKey = savedKey.length > 0
    const maskedSummary = hasKey
        ? `Key saved (ends with ${savedKey.slice(-2).padStart(6, '*')})`
        : 'No key saved yet.'

    const needsRevalidation = useMemo(() => {
        if (!lastValidatedAt) return false

        const lastDate = new Date(lastValidatedAt)
        if (Number.isNaN(lastDate.getTime())) return false

        const ageMs = INITIAL_NOW_MS - lastDate.getTime()
        return ageMs > VALIDATION_RECOMMEND_DAYS * 24 * 60 * 60 * 1000
    }, [lastValidatedAt])

    const isIphoneClient = useMemo(() => {
        if (typeof navigator === 'undefined') return false
        return /iPhone/i.test(navigator.userAgent)
    }, [])

    const fileSystemAccessSupported = useMemo(() => isFileSystemAccessSupported(), [])
    const isFolderFeatureDisabled = !fileSystemAccessSupported || isIphoneClient

    useEffect(() => {
        if (!toast) return undefined
        const timerId = window.setTimeout(() => setToast(''), 3500)
        return () => window.clearTimeout(timerId)
    }, [toast])

    useEffect(() => {
        if (!showKeyStatus) return undefined
        const timerId = window.setTimeout(() => setShowKeyStatus(false), 5000)
        return () => window.clearTimeout(timerId)
    }, [showKeyStatus])

    useEffect(() => {
        if (darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark')
            setSavedValue(STORAGE_THEME, 'dark')
            return
        }

        document.documentElement.removeAttribute('data-theme')
        setSavedValue(STORAGE_THEME, 'light')
    }, [darkMode])

    const revokeHistoryMediaUrls = useCallback((urls) => {
        if (urls.audioUrl) URL.revokeObjectURL(urls.audioUrl)
        if (urls.videoUrl) URL.revokeObjectURL(urls.videoUrl)
    }, [])

    const replaceHistoryMediaUrls = useCallback((nextUrls) => {
        revokeHistoryMediaUrls(selectedHistoryMediaRef.current)
        selectedHistoryMediaRef.current = nextUrls
        setSelectedHistoryMedia(nextUrls)
    }, [revokeHistoryMediaUrls])

    async function loadHistoryMedia(item) {
        if (!item) {
            replaceHistoryMediaUrls({ audioUrl: '', videoUrl: '' })
            return
        }

        let audioUrl = ''
        let videoUrl = ''

        try {
            if (item.audioHandle) {
                const audioFile = await item.audioHandle.getFile()
                audioUrl = URL.createObjectURL(audioFile)
            }
            if (item.videoHandle) {
                const videoFile = await item.videoHandle.getFile()
                videoUrl = URL.createObjectURL(videoFile)
            }
        } catch {
            setBanner('Could not load selected media files from the output folder.')
        }

        replaceHistoryMediaUrls({ audioUrl, videoUrl })
    }

    const loadPreviousAnswers = useCallback(async () => {
        if (isIphoneClient) {
            setPreviousAnswers([])
            setPreviousAnswersError('Previous answers are unavailable on iPhone browsers.')
            return []
        }

        if (!fileSystemAccessSupported) {
            setPreviousAnswers([])
            setPreviousAnswersError('File access is unavailable in this browser.')
            return []
        }

        const folderHandle = recordingsFolderRef.current
        if (!folderHandle) {
            setPreviousAnswers([])
            setPreviousAnswersError('Select a save folder in Settings to load previous answers.')
            return []
        }

        setIsLoadingPreviousAnswers(true)
        setPreviousAnswersError('')

        try {
            const granted = await ensureDirectoryPermission(folderHandle)
            if (!granted) {
                setPreviousAnswers([])
                setPreviousAnswersError('Folder permission denied. Re-select the folder in Settings.')
                return []
            }

            const allFileEntries = []
            const fileHandleByName = new Map()
            const mediaByBaseName = new Map()
            const parsedItems = []
            const mediaExtensions = new Set(['mp3', 'm4a', 'ogg', 'wav', 'webm', 'mp4', 'mov'])

            for await (const [entryName, entryHandle] of folderHandle.entries()) {
                if (entryHandle.kind !== 'file') continue
                const parts = splitFileName(entryName)
                fileHandleByName.set(entryName, entryHandle)

                allFileEntries.push({
                    name: entryName,
                    handle: entryHandle,
                    baseName: parts.baseName,
                    extension: parts.extension,
                })

                if (!mediaExtensions.has(parts.extension)) continue

                const existing = mediaByBaseName.get(parts.baseName) || {
                    audioHandle: null,
                    videoHandle: null,
                    audioFileName: '',
                    videoFileName: '',
                }

                if (parts.extension === 'mp4' || parts.extension === 'mov') {
                    existing.videoHandle = entryHandle
                    existing.videoFileName = entryName
                }

                if (parts.extension === 'mp3' || parts.extension === 'm4a' || parts.extension === 'ogg' || parts.extension === 'wav') {
                    existing.audioHandle = entryHandle
                    existing.audioFileName = entryName
                }

                mediaByBaseName.set(parts.baseName, existing)
            }

            for (const entry of allFileEntries) {
                if (entry.extension !== 'json') continue

                const file = await entry.handle.getFile()
                if (file.size > 1024 * 1024) continue

                const content = await file.text()
                const fallbackDateIso = new Date(file.lastModified || Date.now()).toISOString()
                const parsed = parseSessionJsonReport(
                    entry.name,
                    content,
                    fallbackDateIso,
                    file.lastModified || 0,
                )
                if (!parsed) continue

                const byNameAudio = parsed.audioFileName
                    ? fileHandleByName.get(parsed.audioFileName) || null
                    : null
                const byNameVideo = parsed.videoFileName
                    ? fileHandleByName.get(parsed.videoFileName) || null
                    : null
                const byNameText = parsed.textFileName
                    ? fileHandleByName.get(parsed.textFileName) || null
                    : null
                const byBaseMedia = mediaByBaseName.get(entry.baseName)
                const fallbackTextFileName = `${entry.baseName}.txt`

                parsedItems.push({
                    ...parsed,
                    audioHandle: byNameAudio || byBaseMedia?.audioHandle || null,
                    videoHandle: byNameVideo || byBaseMedia?.videoHandle || null,
                    audioFileName: parsed.audioFileName || byBaseMedia?.audioFileName || '',
                    videoFileName: parsed.videoFileName || byBaseMedia?.videoFileName || '',
                    textHandle: byNameText || fileHandleByName.get(fallbackTextFileName) || null,
                    textFileName: parsed.textFileName || fallbackTextFileName,
                })
            }

            parsedItems.sort((a, b) => b.sortTime - a.sortTime)
            const limited = parsedItems.slice(0, 100)
            setPreviousAnswers(limited)
            return limited
        } catch {
            setPreviousAnswers([])
            setPreviousAnswersError('Could not read report files from the selected folder.')
            return []
        } finally {
            setIsLoadingPreviousAnswers(false)
        }
    }, [fileSystemAccessSupported, isIphoneClient])

    async function openPreviousAnswersModal() {
        const items = await loadPreviousAnswers()
        if (!items.length) {
            setHistoryModalOpen(true)
            setSelectedPreviousAnswerId('')
            replaceHistoryMediaUrls({ audioUrl: '', videoUrl: '' })
            return
        }

        const firstItem = items[0]
        setSelectedPreviousAnswerId(firstItem.id)
        await loadHistoryMedia(firstItem)
        setHistoryModalOpen(true)
    }

    const closePreviousAnswersModal = useCallback(() => {
        setHistoryModalOpen(false)
        setSelectedPreviousAnswerId('')
        replaceHistoryMediaUrls({ audioUrl: '', videoUrl: '' })
    }, [replaceHistoryMediaUrls])

    async function selectPreviousAnswer(item) {
        setSelectedPreviousAnswerId(item.id)
        await loadHistoryMedia(item)
    }

    const selectedPreviousAnswer = useMemo(
        () => previousAnswers.find((item) => item.id === selectedPreviousAnswerId) || null,
        [previousAnswers, selectedPreviousAnswerId],
    )

    const isVideoStartDisabled = isTranscribing || cameraStatus !== 'ready'
    const videoStartDisabledReason =
        cameraStatus !== 'ready' ? 'Camera access is not allowed yet' : ''

    const isPreviousAnswersViewDisabled =
        isFolderFeatureDisabled || !recordingsFolderName || isLoadingPreviousAnswers
    const previousAnswersViewDisabledReason =
        isIphoneClient
            ? 'Previous answers are unavailable on iPhone browsers'
            : !fileSystemAccessSupported || !recordingsFolderName
                ? 'Folder access is not allowed yet'
                : ''

    useEffect(() => {
        let cancelled = false

        if (!fileSystemAccessSupported) return () => { }

        async function restoreFolderHandle() {
            try {
                const handle = await loadPersistedFolderHandle()
                if (!handle) return

                const granted = await ensureDirectoryPermission(handle)
                if (!granted) return

                recordingsFolderRef.current = handle
                if (!cancelled) {
                    setRecordingsFolderName(handle.name || 'Selected folder')
                    await loadPreviousAnswers()
                }
            } catch {
                // Ignore persistence restore issues and continue without a folder.
            }
        }

        restoreFolderHandle()

        return () => {
            cancelled = true
        }
    }, [fileSystemAccessSupported, loadPreviousAnswers])

    useEffect(() => {
        return () => {
            revokeHistoryMediaUrls(selectedHistoryMediaRef.current)
        }
    }, [revokeHistoryMediaUrls])

    useEffect(() => {
        if (selectedHistoryMedia.videoUrl && historyVideoRef.current) {
            historyVideoRef.current.playbackRate = historyPlaybackRate
            return
        }

        if (!selectedHistoryMedia.videoUrl && selectedHistoryMedia.audioUrl && historyAudioRef.current) {
            historyAudioRef.current.playbackRate = historyPlaybackRate
        }
    }, [historyPlaybackRate, selectedHistoryMedia.videoUrl, selectedHistoryMedia.audioUrl])

    useEffect(() => {
        if (!showKey) return undefined
        const timerId = window.setTimeout(() => setShowKey(false), 20000)
        return () => window.clearTimeout(timerId)
    }, [showKey, keyInput])

    useEffect(() => {
        debugEnabledRef.current = debugEnabled
    }, [debugEnabled])

    useEffect(() => {
        function onEscape(event) {
            if (event.key !== 'Escape') return
            if (confirmRemoveOpen) {
                setConfirmRemoveOpen(false)
                return
            }
            if (confirmFolderSelectOpen) {
                setConfirmFolderSelectOpen(false)
                return
            }
            if (settingsOpen) {
                setSettingsOpen(false)
                return
            }
            if (historyModalOpen) {
                closePreviousAnswersModal()
            }
        }

        window.addEventListener('keydown', onEscape)
        return () => window.removeEventListener('keydown', onEscape)
    }, [confirmRemoveOpen, confirmFolderSelectOpen, settingsOpen, historyModalOpen, closePreviousAnswersModal])

    useEffect(() => {
        return () => {
            stopAnalysisLoop()
            stopCameraStream()
            stopAudioStream()
            videoRecorderRef.current = null
            videoChunksRef.current = []
            ffmpegRef.current = null
            ffmpegLoadedRef.current = false
            faceLandmarkerRef.current?.close()
            handLandmarkerRef.current?.close()
            poseLandmarkerRef.current?.close()
        }
    }, [])

    useEffect(() => {
        if (cameraPermissionCheckedRef.current) return
        cameraPermissionCheckedRef.current = true

        let cancelled = false

        async function maybeStartCameraFromGrantedPermission() {
            try {
                if (typeof navigator === 'undefined') return
                if (!navigator.permissions?.query) return

                const permission = await navigator.permissions.query({ name: 'camera' })
                if (cancelled || permission.state !== 'granted') return

                await startCamera()
            } catch {
                // Some browsers do not expose camera permission state; skip auto-start.
            }
        }

        void maybeStartCameraFromGrantedPermission()

        return () => {
            cancelled = true
        }
        // Only check permission state once on initial mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function stopAnalysisLoop() {
        if (animationFrameRef.current) {
            window.cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = 0
        }
    }

    function stopCameraStream() {
        if (cameraStreamRef.current) {
            for (const track of cameraStreamRef.current.getTracks()) track.stop()
            cameraStreamRef.current = null
        }
    }

    function stopAudioStream() {
        if (audioStreamRef.current) {
            for (const track of audioStreamRef.current.getTracks()) track.stop()
            audioStreamRef.current = null
        }
    }

    async function ensureLandmarkers() {
        if (
            faceLandmarkerRef.current &&
            handLandmarkerRef.current &&
            poseLandmarkerRef.current
        ) {
            return
        }


        const wasmFileset = await FilesetResolver.forVisionTasks(
            import.meta.env.VITE_MEDIAPIPE_WASM_URL || DEFAULT_WASM_URL,
        )

        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(
            wasmFileset,
            {
                baseOptions: {
                    modelAssetPath:
                        import.meta.env.VITE_FACE_LANDMARKER_MODEL_URL ||
                        DEFAULT_FACE_MODEL_URL,
                },
                runningMode: 'VIDEO',
                numFaces: 1,
            },
        )

        handLandmarkerRef.current = await HandLandmarker.createFromOptions(
            wasmFileset,
            {
                baseOptions: {
                    modelAssetPath:
                        import.meta.env.VITE_HAND_LANDMARKER_MODEL_URL ||
                        DEFAULT_HAND_MODEL_URL,
                },
                runningMode: 'VIDEO',
                numHands: 2,
            },
        )

        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(
            wasmFileset,
            {
                baseOptions: {
                    modelAssetPath:
                        import.meta.env.VITE_POSE_LANDMARKER_MODEL_URL ||
                        DEFAULT_POSE_MODEL_URL,
                },
                runningMode: 'VIDEO',
                numPoses: 1,
            },
        )

    }

    function resetBehaviorCounters() {
        blinkTrackerRef.current = {
            closed: false,
            closedAt: 0,
            prolongedCounted: false,
        }
        touchTrackerRef.current = { touching: false }

        setProlongedClosureCount(0)
        setTouchCount(0)
        setIsTouchingFace(false)
        setShoulderDriftPct(null)
        setShoulderTiltDeltaDeg(null)
        setShoulderRotationDeg(null)
        shoulderBaselineRef.current = {
            centerX: null,
            tiltDeg: null,
            rotationDeg: null,
        }
    }

    function recalibrateTorsoBaseline() {
        shoulderBaselineRef.current = {
            centerX: null,
            tiltDeg: null,
            rotationDeg: null,
        }
        setShoulderDriftPct(null)
        setShoulderTiltDeltaDeg(null)
        setShoulderRotationDeg(null)
        setToast('Torso baseline recalibrating...')
    }

    function resetInterviewTracking() {
        recordingStartedAtPerfRef.current = 0
        recordingLastFrameAtPerfRef.current = 0
        gazeDeviationCountRef.current = 0
        gazeDirectionCountsRef.current = {
            left: 0,
            right: 0,
            up: 0,
            down: 0,
        }
        gazeRegionRef.current = 'center'
        gazeCenteredTimeMsRef.current = 0
        lastGazeCenteredRef.current = null
        setGazeDeviationCount(0)
        setGazeDirectionCounts({ left: 0, right: 0, up: 0, down: 0 })
        prolongedClosureTotalMsRef.current = 0
        prolongedClosureTimestampsSecRef.current = []
        touchCountDuringRecordingRef.current = 0
        touchDurationMsRef.current = 0
        touchStartedAtMsRef.current = 0
        shoulderPeakDriftPctRef.current = 0
        shoulderPeakTiltDegRef.current = 0
        shoulderPeakRotationDegRef.current = 0
    }

    function resetStatisticsAndRecalibrate() {
        resetInterviewTracking()
        resetBehaviorCounters()
        setFacesDetected(0)
        setHandsDetected(0)
        setEyeContactScore(null)
        setGazeDeviationPct(null)
        setGazeDeviationCount(0)
        setGazeDirectionCounts({ left: 0, right: 0, up: 0, down: 0 })
        recalibrateTorsoBaseline()
        setToast('Statistics reset and torso baseline recalibrating...')
    }

    function runAnalysisLoop() {
        const video = videoRef.current
        const faceLandmarker = faceLandmarkerRef.current
        const handLandmarker = handLandmarkerRef.current
        const poseLandmarker = poseLandmarkerRef.current

        if (!video || !faceLandmarker || !handLandmarker || !poseLandmarker) return

        const tick = () => {
            if (!videoRef.current) return

            const frameVideo = videoRef.current
            const frameCanvas = overlayRef.current
            const ctx = frameCanvas?.getContext('2d') || null

            const width = frameVideo.videoWidth || 960
            const height = frameVideo.videoHeight || 540
            const portraitNow = height > width
            if (portraitNow !== portraitVideoRef.current) {
                portraitVideoRef.current = portraitNow
                setIsPortraitVideo(portraitNow)
            }
            if (frameCanvas) {
                if (frameCanvas.width !== width) {
                    frameCanvas.width = width
                }
                if (frameCanvas.height !== height) {
                    frameCanvas.height = height
                }
            }

            if (
                frameVideo.readyState >= 2 &&
                frameVideo.currentTime !== lastVideoTimeRef.current
            ) {
                lastVideoTimeRef.current = frameVideo.currentTime
                const nowMs = performance.now()

                const faceResult = faceLandmarker.detectForVideo(frameVideo, nowMs)
                const handResult = handLandmarker.detectForVideo(frameVideo, nowMs)
                const poseResult = poseLandmarker.detectForVideo(frameVideo, nowMs)

                if (ctx) {
                    ctx.clearRect(0, 0, width, height)
                }

                const faceLandmarks = faceResult?.faceLandmarks || []
                const handLandmarks = handResult?.landmarks || []
                const poseLandmarks = poseResult?.landmarks || []

                if (debugEnabledRef.current && ctx) {
                    for (const landmarkSet of faceLandmarks) {
                        drawLandmarkSet(ctx, landmarkSet, width, height, '#22a7a6')
                        drawFaceBoundingBox(ctx, landmarkSet, width, height, '#b9f3f2')
                    }
                    for (const landmarkSet of handLandmarks) {
                        drawLandmarkSet(ctx, landmarkSet, width, height, '#e77e23', 2.8)
                    }
                    for (const landmarkSet of poseLandmarks) {
                        const leftShoulder = landmarkSet[11]
                        const rightShoulder = landmarkSet[12]
                        drawLandmarkSet(
                            ctx,
                            [leftShoulder, rightShoulder].filter(Boolean),
                            width,
                            height,
                            '#f5dc6d',
                            4.4,
                        )
                    }
                }

                const mainFace = faceLandmarks[0]
                const eyeContact = computeEyeContactScore(mainFace)
                const gazeDeviation =
                    eyeContact == null
                        ? null
                        : Math.round(clamp01(1 - eyeContact) * 100)
                const gazeOffsets = computeGazeCenterOffsetsPct(mainFace)

                if (recordingActiveRef.current) {
                    const lastFrameAt = recordingLastFrameAtPerfRef.current
                    const deltaMs = lastFrameAt > 0 ? Math.max(0, nowMs - lastFrameAt) : 0
                    recordingLastFrameAtPerfRef.current = nowMs

                    let centered = false
                    if (gazeOffsets) {
                        const previousRegion = gazeRegionRef.current
                        const nextRegion = classifyGazeRegionFromOffsets(
                            gazeOffsets,
                            previousRegion,
                        )

                        if (previousRegion === 'center' && nextRegion !== 'center') {
                            gazeDeviationCountRef.current += 1
                            if (nextRegion in gazeDirectionCountsRef.current) {
                                gazeDirectionCountsRef.current[nextRegion] += 1
                            }
                        }

                        gazeRegionRef.current = nextRegion
                        centered = nextRegion === 'center'
                    } else if (gazeDeviation != null) {
                        centered = gazeDeviation <= GAZE_CENTER_DEVIATION_THRESHOLD_PCT
                        gazeRegionRef.current = centered ? 'center' : gazeRegionRef.current
                    }

                    if (lastGazeCenteredRef.current === null) {
                        lastGazeCenteredRef.current = centered
                    } else {
                        lastGazeCenteredRef.current = centered
                    }

                    if (centered) {
                        gazeCenteredTimeMsRef.current += deltaMs
                    }
                }

                const closureRatio = computeEyeClosureRatio(mainFace)
                const blinkTracker = blinkTrackerRef.current

                // Ignore frames without a reliable eye-closure signal to prevent false transitions.
                if (closureRatio == null) {
                    blinkTracker.closed = false
                    blinkTracker.closedAt = 0
                    blinkTracker.prolongedCounted = false
                } else {
                    // Use hysteresis so tiny per-frame EAR jitter does not create phantom blinks.
                    const isClosedNow = blinkTracker.closed
                        ? closureRatio < EYE_REOPEN_RATIO
                        : closureRatio < EYE_CLOSED_RATIO

                    if (isClosedNow && !blinkTracker.closed) {
                        blinkTracker.closed = true
                        blinkTracker.closedAt = nowMs
                        blinkTracker.prolongedCounted = false
                    } else if (!isClosedNow && blinkTracker.closed) {
                        const duration = nowMs - blinkTracker.closedAt
                        if (duration >= PROLONGED_CLOSURE_MS && recordingActiveRef.current) {
                            prolongedClosureTotalMsRef.current += duration
                            if (recordingStartedAtPerfRef.current > 0) {
                                prolongedClosureTimestampsSecRef.current.push(
                                    (blinkTracker.closedAt - recordingStartedAtPerfRef.current) /
                                    1000,
                                )
                            }
                        }
                        blinkTracker.closed = false
                        blinkTracker.closedAt = 0
                        blinkTracker.prolongedCounted = false
                    } else if (isClosedNow && blinkTracker.closed && !blinkTracker.prolongedCounted) {
                        const duration = nowMs - blinkTracker.closedAt
                        if (duration >= PROLONGED_CLOSURE_MS) {
                            blinkTracker.prolongedCounted = true
                            setProlongedClosureCount((prev) => prev + 1)
                        }
                    }
                }

                const touching = computeHandFaceTouch(mainFace, handLandmarks)
                const touchTracker = touchTrackerRef.current
                if (touching && !touchTracker.touching) {
                    setTouchCount((prev) => prev + 1)
                    if (recordingActiveRef.current) {
                        touchCountDuringRecordingRef.current += 1
                        touchStartedAtMsRef.current = nowMs
                    }
                }
                if (!touching && touchTracker.touching && recordingActiveRef.current) {
                    if (touchStartedAtMsRef.current > 0) {
                        touchDurationMsRef.current += nowMs - touchStartedAtMsRef.current
                        touchStartedAtMsRef.current = 0
                    }
                }
                touchTracker.touching = touching

                const mainPose = poseLandmarks[0]
                let frameShoulderDriftPct = null
                let frameShoulderTiltDeltaDeg = null
                let frameShoulderRotationDeg = null
                if (mainPose) {
                    const leftShoulder = mainPose[11]
                    const rightShoulder = mainPose[12]
                    if (leftShoulder && rightShoulder) {
                        const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x)
                        const centerX = (leftShoulder.x + rightShoulder.x) / 2
                        const tiltDeg =
                            (Math.atan2(
                                rightShoulder.y - leftShoulder.y,
                                rightShoulder.x - leftShoulder.x,
                            ) *
                                180) /
                            Math.PI

                        if (shoulderBaselineRef.current.centerX == null) {
                            shoulderBaselineRef.current.centerX = centerX
                        }
                        if (shoulderBaselineRef.current.tiltDeg == null) {
                            shoulderBaselineRef.current.tiltDeg = tiltDeg
                        }

                        if (shoulderWidth > 0) {
                            frameShoulderDriftPct = Math.round(
                                (Math.abs(
                                    centerX - shoulderBaselineRef.current.centerX,
                                ) /
                                    shoulderWidth) *
                                100,
                            )
                        }

                        frameShoulderTiltDeltaDeg = Math.round(
                            normalizedAngleDiffDegrees(
                                tiltDeg,
                                shoulderBaselineRef.current.tiltDeg,
                            ),
                        )

                        // Signed yaw proxy based on shoulder depth difference.
                        const shoulderDepthDelta =
                            (rightShoulder.z ?? 0) - (leftShoulder.z ?? 0)
                        if (shoulderWidth > 0) {
                            const rawShoulderRotationDeg =
                                (Math.atan2(shoulderDepthDelta, shoulderWidth) * 180) /
                                Math.PI

                            if (shoulderBaselineRef.current.rotationDeg == null) {
                                shoulderBaselineRef.current.rotationDeg =
                                    rawShoulderRotationDeg
                            }

                            frameShoulderRotationDeg = Math.round(
                                rawShoulderRotationDeg -
                                shoulderBaselineRef.current.rotationDeg,
                            )
                        }

                        if (recordingActiveRef.current) {
                            if (frameShoulderDriftPct != null) {
                                shoulderPeakDriftPctRef.current = Math.max(
                                    shoulderPeakDriftPctRef.current,
                                    frameShoulderDriftPct,
                                )
                            }
                            if (frameShoulderTiltDeltaDeg != null) {
                                shoulderPeakTiltDegRef.current = Math.max(
                                    shoulderPeakTiltDegRef.current,
                                    frameShoulderTiltDeltaDeg,
                                )
                            }
                            if (frameShoulderRotationDeg != null) {
                                shoulderPeakRotationDegRef.current = Math.max(
                                    shoulderPeakRotationDegRef.current,
                                    Math.abs(frameShoulderRotationDeg),
                                )
                            }
                        }
                    }
                }

                if (nowMs - uiUpdateAtRef.current > 150) {
                    uiUpdateAtRef.current = nowMs
                    setFacesDetected(faceLandmarks.length)
                    setHandsDetected(handLandmarks.length)
                    setEyeContactScore(eyeContact)
                    setGazeDeviationPct(gazeDeviation)
                    setGazeDeviationCount(gazeDeviationCountRef.current)
                    setGazeDirectionCounts({ ...gazeDirectionCountsRef.current })
                    setIsTouchingFace(touching)
                    setShoulderDriftPct(frameShoulderDriftPct)
                    setShoulderTiltDeltaDeg(frameShoulderTiltDeltaDeg)
                    setShoulderRotationDeg(frameShoulderRotationDeg)
                }
            }

            animationFrameRef.current = window.requestAnimationFrame(tick)
        }

        stopAnalysisLoop()
        animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    async function startCamera() {
        if (cameraStatus === 'loading') return

        try {
            setCameraStatus('loading')
            setBanner('')

            const wantsPortraitCapture =
                typeof window !== 'undefined' && window.innerHeight > window.innerWidth

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: wantsPortraitCapture ? 720 : 1280 },
                    height: { ideal: wantsPortraitCapture ? 1280 : 720 },
                    facingMode: 'user',
                },
                audio: false,
            })

            stopCameraStream()
            cameraStreamRef.current = stream

            const video = videoRef.current
            if (!video) return

            video.srcObject = stream
            await video.play()

            await ensureLandmarkers()
            resetBehaviorCounters()
            runAnalysisLoop()
            setCameraStatus('ready')
        } catch {
            setCameraStatus('error')
            setBanner('Camera setup failed. Check camera permissions and try again.')
        }
    }

    function stopCamera() {
        stopAnalysisLoop()
        stopCameraStream()
        recordingActiveRef.current = false
        portraitVideoRef.current = false
        setIsPortraitVideo(false)
        setCameraStatus('idle')
        setFacesDetected(0)
        setHandsDetected(0)
        setEyeContactScore(null)
        setGazeDeviationPct(null)
        resetBehaviorCounters()

        const canvas = overlayRef.current
        if (canvas) {
            const ctx = canvas.getContext('2d')
            ctx?.clearRect(0, 0, canvas.width, canvas.height)
        }
    }

    function openSettings() {
        setSettingsOpen(true)
        setKeyInput(savedKey)
        setFieldError('')
    }

    function closeSettings() {
        setSettingsOpen(false)
        setFieldError('')
        setShowKey(false)
    }

    function openSelectRecordingsFolderModal() {
        if (isIphoneClient) {
            setBanner('Recording save folder is unavailable on iPhone browsers.')
            return
        }

        if (!fileSystemAccessSupported) {
            setBanner('Folder save is supported in Chromium browsers like Chrome or Edge.')
            return
        }

        setConfirmFolderSelectOpen(true)
    }

    function updateInput(value) {
        setKeyInput(value)
        if (fieldError) setFieldError(validateKeyFormat(value))
    }

    function validateOnBlur() {
        const formatError = validateKeyFormat(keyInput)
        setFieldError(formatError)
    }

    async function saveSettings() {
        const trimmedKey = keyInput.trim()
        const formatError = validateKeyFormat(trimmedKey)
        setFieldError(formatError)

        if (formatError) return

        if (trimmedKey === savedKey && lastValidatedAt) {
            setToast('Key is already saved.')
            return
        }

        setBanner('')
        const validationResult = await validateAgainstEndpoint(trimmedKey)

        if (!validationResult.ok) {
            setFieldError(
                validationResult.message ||
                'Could not validate key. Check the key and try again.',
            )
            setToast('Could not validate key. Check the key and try again.')
            return
        }

        const nowIso = new Date().toISOString()

        setSavedKey(trimmedKey)
        setShowKeyStatus(true)
        setLastValidatedAt(nowIso)
        setSavedValue(STORAGE_KEY, trimmedKey)
        setSavedValue(STORAGE_VALIDATED_AT, nowIso)

        if (validationResult.skipped) {
            setToast('Settings saved. Validation endpoint is not configured yet.')
        } else {
            setToast('Settings saved.')
        }
    }

    function removeKey() {
        clearSavedValue(STORAGE_KEY)
        clearSavedValue(STORAGE_VALIDATED_AT)
        setSavedKey('')
        setShowKeyStatus(false)
        setLastValidatedAt('')
        setKeyInput('')
        setConfirmRemoveOpen(false)
        setTranscript('')
        setBanner('Transcription is disabled until a new key is added.')
        setToast('Deepgram key removed.')
    }

    function buildSessionReport(options = {}) {
        const generatedAt = options.generatedAt || new Date().toISOString()
        const sessionEndedAt = options.sessionEndedAt || new Date().toISOString()
        const question = options.question ?? questionInput.trim()
        const reportTranscript = options.transcript ?? transcript

        return {
            generatedAt,
            sessionStartedAt: sessionStartedAtRef.current,
            sessionEndedAt,
            question,
            metrics: {
                facesDetected,
                handsDetected,
                eyeContactPercent:
                    eyeContactScore == null ? null : Math.round(eyeContactScore * 100),
                gazeDeviationPercent: gazeDeviationPct,
                prolongedEyeClosureCount: prolongedClosureCount,
                handToFaceTouchCount: touchCount,
                isTouchingFace,
                shoulderDriftPercent: shoulderDriftPct,
                shoulderTiltDeltaDegrees: shoulderTiltDeltaDeg,
                shoulderRotationDegrees: shoulderRotationDeg,
                shoulderShiftStatus,
                shoulderTiltStatus,
                shoulderRotationStatus,
            },
            transcript: reportTranscript,
        }
    }

    async function copyJsonReportToClipboard() {
        const report = buildSessionReport()
        try {
            await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
            setToast('JSON copied to clipboard.')
        } catch {
            setToast('Could not copy JSON to clipboard.')
        }
    }

    async function copyOutputToClipboard() {
        if (!outputText) {
            setToast('No output to copy yet.')
            return
        }

        try {
            await navigator.clipboard.writeText(outputText)
            setToast('Output copied to clipboard.')
        } catch {
            setToast('Could not copy output to clipboard.')
        }
    }

    async function copySelectedAnswerTextFile() {
        if (!selectedPreviousAnswer) {
            setToast('Select an answer first.')
            return
        }

        if (!selectedPreviousAnswer.textHandle) {
            setToast('No text file found for this answer.')
            return
        }

        try {
            const file = await selectedPreviousAnswer.textHandle.getFile()
            const textContent = await file.text()
            await navigator.clipboard.writeText(textContent)
            setToast('text output copied to clipboard')
        } catch {
            setToast('Could not copy text file.')
        }
    }

    function downloadVideoRecording() {
        if (!recordedVideoBlob) return
        const extension =
            recordedVideoBlob.type.includes('mp4')
                ? 'mp4'
                : recordedVideoBlob.type.includes('webm')
                    ? 'webm'
                    : 'mp4'
        downloadBlob(recordedVideoBlob, `session-video-${Date.now()}.${extension}`)
    }

    function downloadAudioRecording() {
        if (!recordedAudioBlob) return
        const extension =
            recordedAudioBlob.type.includes('mpeg') || recordedAudioBlob.type.includes('mp3')
                ? 'mp3'
                : recordedAudioBlob.type.includes('ogg')
                    ? 'ogg'
                    : recordedAudioBlob.type.includes('mp4') || recordedAudioBlob.type.includes('m4a')
                        ? 'm4a'
                        : recordedAudioBlob.type.includes('webm')
                            ? 'webm'
                            : 'audio'
        downloadBlob(recordedAudioBlob, `session-audio-${Date.now()}.${extension}`)
    }

    async function selectRecordingsFolder() {
        if (isIphoneClient) {
            setBanner('Recording save folder is unavailable on iPhone browsers.')
            return
        }

        if (!fileSystemAccessSupported) {
            setBanner('Folder save is supported in Chromium browsers like Chrome or Edge.')
            return
        }

        setConfirmFolderSelectOpen(false)

        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
            const granted = await ensureDirectoryPermission(handle)
            if (!granted) {
                setBanner('Folder permission denied. Please allow write access to save files.')
                return
            }

            recordingsFolderRef.current = handle
            setRecordingsFolderName(handle.name || 'Selected folder')
            await savePersistedFolderHandle(handle)
            await loadPreviousAnswers()
            setToast('Recording folder selected.')
        } catch {
            // User may dismiss the picker.
        }
    }

    async function clearRecordingsFolder() {
        recordingsFolderRef.current = null
        setRecordingsFolderName('')
        setPreviousAnswers([])
        setPreviousAnswersError('')
        closePreviousAnswersModal()
        try {
            await clearPersistedFolderHandle()
        } catch {
            // Ignore persistence cleanup failures.
        }
        setToast('Recording folder cleared.')
    }

    async function writeBlobToSelectedFolder(fileName, blob) {
        const folderHandle = recordingsFolderRef.current
        if (!folderHandle) return false

        try {
            const granted = await ensureDirectoryPermission(folderHandle)
            if (!granted) {
                setBanner('Folder write permission was not granted. Select folder again.')
                return false
            }

            const fileHandle = await folderHandle.getFileHandle(fileName, { create: true })
            const writable = await fileHandle.createWritable()
            await writable.write(blob)
            await writable.close()
            return true
        } catch {
            setBanner('Saving to selected folder failed. Re-select the folder and retry.')
            return false
        }
    }

    async function saveSessionArtifactsToSelectedFolder({
        capturedAtIso,
        question,
        report,
        outputBlock,
        audioBlob,
        videoBlob,
    }) {
        const folderHandle = recordingsFolderRef.current
        if (!folderHandle) return null

        const granted = await ensureDirectoryPermission(folderHandle)
        if (!granted) {
            setBanner('Folder write permission was not granted. Select folder again.')
            return null
        }

        const baseName = buildSessionFileBaseName(capturedAtIso, question)
        const jsonFileName = `${baseName}.json`
        const textFileName = `${baseName}.txt`
        const audioExt =
            audioBlob?.type?.includes('mpeg') || audioBlob?.type?.includes('mp3')
                ? 'mp3'
                : audioBlob?.type?.includes('ogg')
                    ? 'ogg'
                    : audioBlob?.type?.includes('mp4') || audioBlob?.type?.includes('m4a')
                        ? 'm4a'
                        : 'webm'
        const audioFileName = `${baseName}.${audioExt}`
        const videoExt =
            videoBlob?.type?.includes('mp4')
                ? 'mp4'
                : videoBlob?.type?.includes('webm')
                    ? 'webm'
                    : 'mp4'
        const videoFileName = videoBlob ? `${baseName}.${videoExt}` : ''

        const reportForSave = {
            ...report,
            outputText: outputBlock,
            audioFileName,
            videoFileName,
            savedFiles: {
                jsonFileName,
                textFileName,
                audioFileName,
                videoFileName,
            },
        }

        const jsonOk = await writeBlobToSelectedFolder(
            jsonFileName,
            new Blob([JSON.stringify(reportForSave, null, 2)], {
                type: 'application/json',
            }),
        )
        const textOk = await writeBlobToSelectedFolder(
            textFileName,
            new Blob([outputBlock], {
                type: 'text/plain;charset=utf-8',
            }),
        )
        const audioOk = audioBlob
            ? await writeBlobToSelectedFolder(audioFileName, audioBlob)
            : false
        const videoOk = videoBlob
            ? await writeBlobToSelectedFolder(videoFileName, videoBlob)
            : true

        if (jsonOk && textOk && audioOk && videoOk) {
            setToast(`Saved session files to ${recordingsFolderName}.`)
            await loadPreviousAnswers()
            return reportForSave
        }

        setBanner('Some session files could not be saved to the selected folder.')
        return reportForSave
    }

    async function transcribeAudioBlob(audioBlob) {
        const endpoint =
            import.meta.env.VITE_DEEPGRAM_LISTEN_URL || DEFAULT_DEEPGRAM_LISTEN_URL
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Token ${savedKey}`,
                'Content-Type': audioBlob.type || 'audio/webm',
            },
            body: audioBlob,
        })

        if (response.status === 401 || response.status === 403) {
            setBanner('Saved key is invalid or revoked. Update it in Settings.')
            throw new Error('Saved key is invalid or revoked.')
        }
        if (response.status === 429) {
            throw new Error('Transcription provider rate limit reached. Please wait and retry.')
        }
        if (!response.ok) {
            throw new Error('Transcription failed. Try again in a moment.')
        }

        const payload = await response.json()
        const text = safeTranscriptFromDeepgram(payload)
        return text || 'No transcript was returned for this recording.'
    }

    async function speakQuestionIfEnabled() {
        if (!readQuestionWithTts) return

        const text = questionInput.trim()
        if (!text) {
            setBanner('Read (TTS) Question is enabled, but the question is empty.')
            return
        }

        try {
            setIsSpeakingQuestion(true)
            const endpoint =
                import.meta.env.VITE_DEEPGRAM_SPEAK_URL || DEFAULT_DEEPGRAM_SPEAK_URL

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Token ${savedKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text }),
            })

            if (!response.ok) {
                throw new Error('Question TTS failed. Continuing without TTS.')
            }

            const audioBlob = await response.blob()
            const audioUrl = URL.createObjectURL(audioBlob)

            if (questionAudioRef.current) {
                questionAudioRef.current.pause()
                URL.revokeObjectURL(questionAudioRef.current.src)
                questionAudioRef.current = null
            }

            await new Promise((resolve, reject) => {
                const audio = new Audio(audioUrl)
                questionAudioRef.current = audio
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl)
                    if (questionAudioRef.current === audio) {
                        questionAudioRef.current = null
                    }
                    resolve()
                }
                audio.onerror = () => {
                    URL.revokeObjectURL(audioUrl)
                    if (questionAudioRef.current === audio) {
                        questionAudioRef.current = null
                    }
                    reject(new Error('Question TTS playback failed.'))
                }
                audio
                    .play()
                    .then(() => undefined)
                    .catch(() => reject(new Error('Question TTS playback failed.')))
            })
        } catch (error) {
            setBanner(error.message || 'Question TTS failed. Continuing without TTS.')
        } finally {
            setIsSpeakingQuestion(false)
        }
    }

    async function startRecording(mode = 'audio') {
        if (isRecording || isTranscribing) return

        if (!hasKey) {
            openSettings()
            setBanner('Add Deepgram key in Settings to enable transcription.')
            return
        }

        if (mode === 'video' && !cameraStreamRef.current) {
            setBanner('Camera access is required to capture video with audio.')
            return
        }

        try {
            recordingModeRef.current = mode
            setBanner('')
            setTranscript('Recording answer...')
            setOutputText('')
            sessionStartedAtRef.current = new Date().toISOString()
            resetInterviewTracking()
            recalibrateTorsoBaseline()

            await speakQuestionIfEnabled()

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            })
            audioStreamRef.current = stream

            let avStream = null
            if (mode === 'video') {
                const cameraTrack = cameraStreamRef.current.getVideoTracks()[0]
                if (!cameraTrack) {
                    throw new Error('Camera track is unavailable.')
                }

                avStream = new MediaStream([
                    cameraTrack,
                    ...stream.getAudioTracks(),
                ])
            }

            recordingActiveRef.current = true
            recordingStartedAtPerfRef.current = performance.now()
            recordingLastFrameAtPerfRef.current = recordingStartedAtPerfRef.current

            const mimeType = pickSupportedAudioMimeType()
            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream)

            let videoRecorder = null
            if (avStream) {
                const videoMimeType = pickSupportedVideoMimeType()
                videoRecorder = videoMimeType
                    ? new MediaRecorder(avStream, { mimeType: videoMimeType })
                    : new MediaRecorder(avStream)
            }

            chunksRef.current = []
            videoChunksRef.current = []
            setRecordedAudioBlob(null)
            setRecordedVideoBlob(null)

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
            }

            if (videoRecorder) {
                videoRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        videoChunksRef.current.push(event.data)
                    }
                }
            }

            recorderRef.current = recorder
            videoRecorderRef.current = videoRecorder
            recorder.start()
            if (videoRecorder) {
                videoRecorder.start()
            }
            setIsRecording(true)
            setToast(mode === 'video' ? 'Video recording started.' : 'Audio recording started.')
        } catch {
            recordingActiveRef.current = false
            recordingModeRef.current = 'audio'
            setBanner('Recording setup failed. Check camera/microphone permissions and try again.')
            setTranscript('')
            stopAudioStream()
            recorderRef.current = null
            videoRecorderRef.current = null
            chunksRef.current = []
            videoChunksRef.current = []
        }
    }

    async function stopRecordingAndTranscribe() {
        if (!recorderRef.current || !isRecording) return

        const recorder = recorderRef.current
        const videoRecorder = videoRecorderRef.current
        setIsRecording(false)
        setIsTranscribing(true)
        setTranscript('Transcribing your answer...')

        await new Promise((resolve) => {
            recorder.onstop = resolve
            recorder.stop()
        })

        if (videoRecorder) {
            await new Promise((resolve) => {
                videoRecorder.onstop = resolve
                videoRecorder.stop()
            })
        }

        recordingActiveRef.current = false

        stopAudioStream()

        try {
            const rawAudioBlob = new Blob(chunksRef.current, {
                type: recorder.mimeType || 'audio/webm',
            })

            let storageAudioBlob = rawAudioBlob
            try {
                storageAudioBlob = await convertAudioBlobToMp3(rawAudioBlob)
            } catch {
                setBanner('MP3 conversion failed in this browser; using original audio format.')
            }
            setRecordedAudioBlob(storageAudioBlob)

            let finalVideoBlob = null
            const shouldSaveVideo = recordingModeRef.current === 'video'

            if (videoChunksRef.current.length > 0) {
                const rawVideoBlob = new Blob(videoChunksRef.current, {
                    type: videoRecorder?.mimeType || 'video/webm',
                })

                try {
                    const mp4Blob = await convertVideoBlobToMp4(
                        rawVideoBlob,
                        ffmpegRef,
                        ffmpegLoadedRef,
                    )
                    finalVideoBlob = mp4Blob
                    setRecordedVideoBlob(mp4Blob)
                } catch {
                    finalVideoBlob = rawVideoBlob
                    setRecordedVideoBlob(rawVideoBlob)
                    setBanner('MP4 conversion failed; video is available in original format.')
                }
            }

            const text = await transcribeAudioBlob(rawAudioBlob)
            setTranscript(text)

            const answerLengthSec = Math.max(
                0,
                (performance.now() - recordingStartedAtPerfRef.current) / 1000,
            )
            const words = countWords(text)
            const wpmRaw = answerLengthSec > 0 ? words / (answerLengthSec / 60) : 0
            const hesitationsCount = countHesitations(text)
            const gazeCenterSecRaw = gazeCenteredTimeMsRef.current / 1000
            const gazeCenterPctRaw =
                answerLengthSec > 0 ? (gazeCenterSecRaw / answerLengthSec) * 100 : 0
            const prolongedClosureSec = prolongedClosureTotalMsRef.current / 1000
            const prolongedClosurePct =
                answerLengthSec > 0
                    ? (prolongedClosureSec / answerLengthSec) * 100
                    : 0

            const answerLengthSecRounded = Math.round(answerLengthSec * 10) / 10
            const gazeCenterSecRounded = Math.round(gazeCenterSecRaw * 10) / 10
            const wpm = Math.round(wpmRaw)
            const gazeCenterPct = Math.round(gazeCenterPctRaw)

            if (touchStartedAtMsRef.current > 0) {
                touchDurationMsRef.current +=
                    performance.now() - touchStartedAtMsRef.current
                touchStartedAtMsRef.current = 0
            }

            const handFaceTouchDurationSec = touchDurationMsRef.current / 1000
            const handFaceTouchPerMin =
                answerLengthSec > 0
                    ? touchCountDuringRecordingRef.current / (answerLengthSec / 60)
                    : 0

            const shoulderRotationStatusFromPeak =
                shoulderPeakRotationDegRef.current >= SHOULDER_ROTATION_ALERT_DEG
                    ? 'rotating too much'
                    : 'facing forward'
            const shoulderRotationDirection = describeTorsoRotation(
                shoulderRotationDeg,
                SHOULDER_ROTATION_ALERT_DEG,
            )

            const capturedAtIso = new Date().toISOString()
            const trimmedQuestion = questionInput.trim()
            const interviewMetrics = {
                answerLengthSec: answerLengthSecRounded,
                wpm,
                hesitationsCount,
                gazeDeviationCount: gazeDeviationCountRef.current,
                gazeDeviationDirectionCounts: { ...gazeDirectionCountsRef.current },
                gazeCenterSec: gazeCenterSecRounded,
                gazeCenterPct,
                prolongedClosureSec,
                prolongedClosurePct,
                prolongedClosureEvents:
                    prolongedClosureTimestampsSecRef.current.length,
                prolongedClosureTimestampsSec:
                    prolongedClosureTimestampsSecRef.current,
                handFaceTouchPerMin,
                handFaceTouchDurationSec,
                handFaceTouchRegions: 'none',
                shoulderShiftPeakPct: shoulderPeakDriftPctRef.current,
                shoulderTiltPeakDeg: shoulderPeakTiltDegRef.current,
                shoulderRotationPeakDeg: shoulderPeakRotationDegRef.current,
                shoulderRotationSignedDeg: shoulderRotationDeg,
                shoulderRotationDirection,
                shoulderRotationStatus: shoulderRotationStatusFromPeak,
            }

            const outputBlock = buildOutputText({
                capturedAt: capturedAtIso,
                question: trimmedQuestion,
                answer: text,
                metrics: interviewMetrics,
            })

            setOutputText(outputBlock)

            const sessionReport = {
                ...buildSessionReport({
                    generatedAt: capturedAtIso,
                    sessionEndedAt: capturedAtIso,
                    question: trimmedQuestion,
                    transcript: text,
                }),
                interviewMetrics,
            }

            await saveSessionArtifactsToSelectedFolder({
                capturedAtIso,
                question: trimmedQuestion,
                report: sessionReport,
                outputBlock,
                audioBlob: storageAudioBlob,
                videoBlob: shouldSaveVideo ? finalVideoBlob : null,
            })

            setToast('Transcription completed.')
        } catch (error) {
            setTranscript('')
            setOutputText('')
            setBanner(error.message || 'Transcription failed. Try again.')
            setToast(error.message || 'Transcription failed. Try again.')
        } finally {
            recorderRef.current = null
            videoRecorderRef.current = null
            chunksRef.current = []
            videoChunksRef.current = []
            recordingModeRef.current = 'audio'
            setIsTranscribing(false)
        }
    }

    const shoulderShiftStatus =
        shoulderDriftPct == null
            ? 'n/a'
            : shoulderDriftPct >= SHOULDER_SHIFT_ALERT_PCT
                ? 'too much movement'
                : 'steady'
    const shoulderTiltStatus =
        shoulderTiltDeltaDeg == null
            ? 'n/a'
            : shoulderTiltDeltaDeg >= SHOULDER_TILT_ALERT_DEG
                ? 'tilting too much'
                : 'level'
    const shoulderRotationStatus =
        shoulderRotationDeg == null
            ? 'n/a'
            : describeTorsoRotation(shoulderRotationDeg, SHOULDER_ROTATION_ALERT_DEG)
    const outputDisplayText =
        outputText ||
        'No output yet. Start recording to capture a transcript and interview metrics.'
    const cameraActionButton =
        cameraStatus === 'ready' ? (
            <button type="button" className="btn ghost" onClick={stopCamera}>
                Disable Camera
            </button>
        ) : (
            <button
                type="button"
                className="btn"
                onClick={startCamera}
                disabled={cameraStatus === 'loading'}
            >
                {cameraStatus === 'loading' ? 'Starting Camera...' : 'Allow Camera Access'}
            </button>
        )

    return (
        <div className="app-shell">
            <header className="topbar">
                <h1>Mock Interviewer</h1>
                <div className="topbar-actions">
                    <button
                        type="button"
                        className="btn ghost theme-toggle"
                        onClick={() => setDarkMode((prev) => !prev)}
                        aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        aria-pressed={darkMode}
                        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        <span aria-hidden="true">{darkMode ? '\u263D' : '\u2600'}</span>
                    </button>
                    <button
                        type="button"
                        className="btn ghost settings-cog"
                        onClick={openSettings}
                        aria-label="Open settings"
                        title="Settings"
                    >
                        &#9881;
                    </button>
                </div>
            </header>

            <main className={`layout${centerCameraLayout ? ' center-camera-layout' : ''}`}>
                <section
                    className={`panel camera-panel${centerCameraLayout ? ' centered-camera-panel' : ''}`}
                >
                    <div className="camera-heading-row">
                        <h2>{debugEnabled ? 'Camera View (JS MediaPipe)' : 'Camera View'}</h2>
                        <div className="camera-heading-controls">
                            {cameraActionButton}
                            <label className="debug-toggle">
                                <input
                                    type="checkbox"
                                    checked={debugEnabled}
                                    onChange={(event) => setDebugEnabled(event.target.checked)}
                                />
                                <span>Debug</span>
                            </label>
                        </div>
                    </div>

                    <div className={`camera-frame${isPortraitVideo ? ' portrait' : ''}`}>
                        <video ref={videoRef} className="camera-video" muted playsInline />
                        <canvas
                            ref={overlayRef}
                            className={`camera-overlay${debugEnabled ? '' : ' hidden'}`}
                        />
                        {cameraStatus !== 'ready' && (
                            <div className="camera-empty">
                                <p>
                                    {cameraStatus === 'loading'
                                        ? 'Starting camera...'
                                        : 'Camera preview will appear here.'}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="actions wrap camera-controls-row">
                        {debugEnabled ? (
                            <div className="baseline-controls">
                                <div className="baseline-button-row">
                                    <button
                                        type="button"
                                        className="btn ghost"
                                        onClick={recalibrateTorsoBaseline}
                                        disabled={cameraStatus !== 'ready' || isRecording || isTranscribing}
                                        title={
                                            cameraStatus === 'ready'
                                                ? 'Set current torso orientation as neutral baseline'
                                                : 'Start camera to recalibrate torso baseline'
                                        }
                                    >
                                        Recalibrate Torso Baseline
                                    </button>
                                    <button
                                        type="button"
                                        className="btn ghost"
                                        onClick={resetStatisticsAndRecalibrate}
                                        disabled={cameraStatus !== 'ready' || isRecording || isTranscribing}
                                    >
                                        Reset Statistics
                                    </button>
                                </div>
                                <p className="muted baseline-note">
                                    Torso baseline auto-recalibrates when you start video or audio
                                    recording.
                                </p>
                            </div>
                        ) : (
                            <>
                                {cameraStatus === 'ready' && facesDetected === 0 ? (
                                    <p className="face-detected-text">No face detected</p>
                                ) : null}
                            </>
                        )}
                    </div>

                    {debugEnabled ? (
                        <div className="metrics-grid metrics-grid-wide">
                            <article className="metric-card">
                                <p className="metric-label">Face detected</p>
                                <p className="metric-value">{facesDetected > 0 ? 'true' : 'false'}</p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Hands detected</p>
                                <p className="metric-value">{handsDetected}</p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Eye contact proxy</p>
                                <p className="metric-value">
                                    {eyeContactScore == null
                                        ? 'n/a'
                                        : `${Math.round(eyeContactScore * 100)}%`}
                                </p>
                                <p className="metric-help">
                                    Higher is better. It estimates how consistently your gaze stays
                                    near the camera.
                                </p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Gaze deviation</p>
                                <p className="metric-value">
                                    {gazeDeviationPct == null
                                        ? 'n/a'
                                        : `${gazeDeviationPct}%`}
                                </p>
                                <p className="metric-help">
                                    Lower is better. It is the share of time your gaze was away
                                    from center.
                                </p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Gaze deviations from center</p>
                                <p className="metric-value">{gazeDeviationCount}</p>
                                <p className="metric-help">
                                    Leaves center: L {gazeDirectionCounts.left} / R {gazeDirectionCounts.right} / U {gazeDirectionCounts.up} / D {gazeDirectionCounts.down}
                                </p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Prolonged closure</p>
                                <p className="metric-value">{prolongedClosureCount}</p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Hand-to-face touches</p>
                                <p className="metric-value">{touchCount}</p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Touching face now</p>
                                <p className="metric-value">{isTouchingFace ? 'yes' : 'no'}</p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Shoulder side shift</p>
                                <p className="metric-value">
                                    {shoulderDriftPct == null ? 'n/a' : `${shoulderDriftPct}%`}
                                </p>
                                <p className="metric-label">{shoulderShiftStatus}</p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Shoulder tilt delta</p>
                                <p className="metric-value">
                                    {shoulderTiltDeltaDeg == null ? 'n/a' : `${shoulderTiltDeltaDeg}°`}
                                </p>
                                <p className="metric-label">{shoulderTiltStatus}</p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Shoulder rotation</p>
                                <p className="metric-value">
                                    {shoulderRotationDeg == null
                                        ? 'n/a'
                                        : formatSignedDegrees(shoulderRotationDeg)}
                                </p>
                                <p className="metric-label">{shoulderRotationStatus}</p>
                            </article>
                        </div>
                    ) : null}
                </section>

                <section className={`panel session${centerCameraLayout ? ' centered-session-panel' : ''}`}>
                    {!isFolderFeatureDisabled && !recordingsFolderName && (
                        <div className="actions wrap">
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={openSelectRecordingsFolderModal}
                            >
                                Select Save Folder
                            </button>
                        </div>
                    )}
                    <div className="actions wrap recording-actions">
                        {!isRecording ? (
                            <>
                                <span
                                    className={`disabled-tooltip-wrap start-video-wrap${isVideoStartDisabled && videoStartDisabledReason ? ' has-tooltip' : ''}`}
                                    data-disabled-reason={videoStartDisabledReason}
                                >
                                    <button
                                        type="button"
                                        className="btn"
                                        onClick={() => startRecording('video')}
                                        disabled={isVideoStartDisabled}
                                    >
                                        Start Video Recording
                                    </button>
                                </span>
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={() => startRecording('audio')}
                                    disabled={isTranscribing}
                                >
                                    Start Audio Recording
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                className="btn"
                                onClick={stopRecordingAndTranscribe}
                            >
                                Stop and Transcribe
                            </button>
                        )}
                    </div>
                    <div className="label question-row">
                        <label htmlFor="interview-question" className="question-main-label">
                            Interview question
                        </label>
                        <label className="debug-toggle question-tts-toggle">
                            <input
                                type="checkbox"
                                checked={readQuestionWithTts}
                                onChange={(event) => setReadQuestionWithTts(event.target.checked)}
                                disabled={isRecording || isTranscribing || isSpeakingQuestion}
                            />
                            <span>Read (TTS) Question</span>
                        </label>
                    </div>
                    <textarea
                        id="interview-question"
                        className="field question-field"
                        value={questionInput}
                        onChange={(event) => setQuestionInput(event.target.value)}
                        autoComplete="off"
                        rows={2}
                        placeholder="Tell me about a challenging project you worked on."
                    />
                    {hasKey && showKeyStatus && <p className="key-status">{maskedSummary}</p>}
                    {needsRevalidation && (
                        <p className="warning">
                            Revalidation recommended. Your key was last checked over 30 days ago.
                        </p>
                    )}
                    {banner && <p className="banner">{banner}</p>}

                    <div
                        className="transcript-box copyable-output session-output-box"
                        role="button"
                        tabIndex={0}
                        onClick={copyOutputToClipboard}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                void copyOutputToClipboard()
                            }
                        }}
                        aria-label="Copy output to clipboard"
                        title="Copy output to clipboard"
                    >
                        <h3>Output</h3>
                        <p className="output-text">{outputDisplayText}</p>
                    </div>

                    <div className="actions wrap export-actions">
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={() => {
                                void copyOutputToClipboard()
                            }}
                        >
                            Copy Text
                        </button>
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={() => {
                                void copyJsonReportToClipboard()
                            }}
                        >
                            Copy JSON
                        </button>
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={downloadVideoRecording}
                            disabled={!recordedVideoBlob}
                        >
                            Download Video
                        </button>
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={downloadAudioRecording}
                            disabled={!recordedAudioBlob}
                        >
                            Download Audio
                        </button>
                    </div>

                    <div className="session-history-summary">
                        <div className={`session-history-box${isFolderFeatureDisabled ? ' disabled-box' : ''}`}>
                            <div className="session-history-text">
                                <p className="session-history-title">Previous Answers</p>
                                <p className="muted session-history-count">
                                    {isIphoneClient
                                        ? 'Previous answers are unavailable on iPhone browsers.'
                                        : recordingsFolderName
                                            ? `Questions found: ${previousAnswers.length}`
                                            : 'Select an output folder in Settings to load previous answers.'}
                                </p>
                            </div>
                            <span
                                className={`disabled-tooltip-wrap${isPreviousAnswersViewDisabled && previousAnswersViewDisabledReason ? ' has-tooltip' : ''}`}
                                data-disabled-reason={previousAnswersViewDisabledReason}
                            >
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={openPreviousAnswersModal}
                                    disabled={isPreviousAnswersViewDisabled}
                                >
                                    {isLoadingPreviousAnswers ? 'Loading...' : 'View'}
                                </button>
                            </span>
                        </div>
                        {previousAnswersError && <p className="warning">{previousAnswersError}</p>}
                    </div>
                </section>
            </main>

            <footer className="app-footer">
                <p>Version {APP_VERSION}</p>
            </footer>

            {historyModalOpen && (
                <div
                    className="overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closePreviousAnswersModal()
                        }
                    }}
                >
                    <div
                        className="modal history-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="history-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="history-modal-header">
                            <h2 id="history-title">Previous Answers</h2>
                            <button
                                type="button"
                                className="btn ghost history-close-btn"
                                onClick={closePreviousAnswersModal}
                                aria-label="Close"
                                title="Close"
                            >
                                X
                            </button>
                        </div>

                        <div className="history-modal-grid">
                            <aside className="history-overview">
                                <div className="history-overview-head">
                                    <h3>Overview</h3>
                                    <button
                                        type="button"
                                        className="btn ghost"
                                        onClick={loadPreviousAnswers}
                                        disabled={isLoadingPreviousAnswers}
                                    >
                                        {isLoadingPreviousAnswers ? 'Loading...' : 'Refresh'}
                                    </button>
                                </div>

                                <p className="muted">{previousAnswers.length} question(s)</p>

                                <div className="history-overview-list">
                                    {previousAnswers.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={`history-overview-item${selectedPreviousAnswerId === item.id ? ' active' : ''
                                                }`}
                                            onClick={() => selectPreviousAnswer(item)}
                                        >
                                            <strong>{item.question}</strong>
                                            <span>{new Date(item.capturedAt).toLocaleString()}</span>
                                        </button>
                                    ))}
                                    {!previousAnswers.length && (
                                        <p className="muted">No previous answers found in the selected folder.</p>
                                    )}
                                </div>
                            </aside>

                            <section className="history-detail">
                                {selectedPreviousAnswer ? (
                                    <div className="history-detail-layout">
                                        <div className="history-detail-top">
                                            <div className="history-detail-title-block">
                                                <h3>{selectedPreviousAnswer.question}</h3>
                                                <p className="metric-label history-detail-meta">
                                                    {selectedPreviousAnswer.source} ·{' '}
                                                    {new Date(selectedPreviousAnswer.capturedAt).toLocaleString()}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn ghost history-copy-btn"
                                                onClick={copySelectedAnswerTextFile}
                                                disabled={!selectedPreviousAnswer.textHandle}
                                            >
                                                Copy Text
                                            </button>
                                        </div>

                                        <div className="history-detail-scroll">
                                            <div className="transcript-box history-media">
                                                <div className="history-media-head">
                                                    <h3>Recording</h3>
                                                    <div
                                                        className="history-speed-controls"
                                                        role="group"
                                                        aria-label="Video playback speed"
                                                    >
                                                        {[1, 1.5, 2, 3].map((rate) => (
                                                            <button
                                                                key={rate}
                                                                type="button"
                                                                className={`btn ghost history-speed-btn${historyPlaybackRate === rate ? ' active' : ''}`}
                                                                onClick={() => setHistoryPlaybackRate(rate)}
                                                                disabled={
                                                                    !selectedHistoryMedia.videoUrl &&
                                                                    !selectedHistoryMedia.audioUrl
                                                                }
                                                            >
                                                                {rate}x
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {selectedHistoryMedia.videoUrl ? (
                                                    <video
                                                        ref={historyVideoRef}
                                                        className="history-video"
                                                        src={selectedHistoryMedia.videoUrl}
                                                        controls
                                                        preload="metadata"
                                                        onLoadedMetadata={() => {
                                                            if (historyVideoRef.current) {
                                                                historyVideoRef.current.playbackRate =
                                                                    historyPlaybackRate
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <p className="muted">No video recording found for this answer.</p>
                                                )}

                                                {!selectedHistoryMedia.videoUrl && selectedHistoryMedia.audioUrl ? (
                                                    <audio
                                                        ref={historyAudioRef}
                                                        className="history-audio"
                                                        src={selectedHistoryMedia.audioUrl}
                                                        controls
                                                        preload="metadata"
                                                        onLoadedMetadata={() => {
                                                            if (historyAudioRef.current) {
                                                                historyAudioRef.current.playbackRate =
                                                                    historyPlaybackRate
                                                            }
                                                        }}
                                                    />
                                                ) : !selectedHistoryMedia.videoUrl ? (
                                                    <p className="muted">No audio recording found for this answer.</p>
                                                ) : null}
                                            </div>

                                            <div className="transcript-box history-transcript">
                                                <h3>Full Transcript</h3>
                                                <p className="output-text">{selectedPreviousAnswer.transcript}</p>
                                            </div>

                                            <div className="transcript-box history-metrics">
                                                <h3>Metrics</h3>
                                                {selectedPreviousAnswer.metrics && (
                                                    <div className="history-metrics-grid">
                                                        {Object.entries(selectedPreviousAnswer.metrics).map(
                                                            ([key, value]) => (
                                                                <div key={key} className="history-metric-row">
                                                                    <span className="metric-label">{key}</span>
                                                                    <span>{String(value ?? 'n/a')}</span>
                                                                </div>
                                                            ),
                                                        )}
                                                    </div>
                                                )}
                                                {!selectedPreviousAnswer.metrics &&
                                                    selectedPreviousAnswer.metricsText && (
                                                        <p className="output-text">{selectedPreviousAnswer.metricsText}</p>
                                                    )}
                                                {!selectedPreviousAnswer.metrics &&
                                                    !selectedPreviousAnswer.metricsText && (
                                                        <p className="muted">No metrics available in this report.</p>
                                                    )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="muted">Select an answer from the overview to inspect details.</p>
                                )}
                            </section>
                        </div>
                    </div>
                </div>
            )}

            {settingsOpen && (
                <div
                    className="overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeSettings()
                        }
                    }}
                >
                    <div
                        className="modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h2 id="settings-title">Speech Transcription</h2>
                        <p className="muted">
                            Add your Deepgram API key to enable live transcription. Your key is stored only in this browser.
                        </p>

                        <div className="actions wrap">
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setShowKey((prev) => !prev)}
                            >
                                {showKey ? 'Hide key' : 'Show key'}
                            </button>
                            {hasKey && (
                                <button
                                    type="button"
                                    className="btn danger"
                                    onClick={() => setConfirmRemoveOpen(true)}
                                >
                                    Remove key
                                </button>
                            )}
                        </div>

                        <label htmlFor="deepgram-key" className="label">
                            Deepgram API Key
                        </label>
                        <div className="key-input-row">
                            <input
                                id="deepgram-key"
                                type={showKey ? 'text' : 'password'}
                                value={keyInput}
                                onChange={(event) => updateInput(event.target.value)}
                                onBlur={validateOnBlur}
                                aria-describedby="key-help key-error"
                                className={fieldError ? 'field field-error' : 'field'}
                                autoComplete="off"
                            />
                            <button
                                type="button"
                                className="btn key-save-btn"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={saveSettings}
                            >
                                Save key
                            </button>
                        </div>
                        <p id="key-help" className="help-text">Use a valid Deepgram API key from your Deepgram account.</p>
                        {fieldError && (
                            <p id="key-error" className="error-text" aria-live="polite">
                                {fieldError}
                            </p>
                        )}

                        <p className="privacy-note">
                            Anyone with access to this browser profile can use this key until you remove it.
                        </p>
                        <p className="privacy-note">
                            Do not share screenshots of this page while key is visible.
                        </p>

                        <div className="settings-section">
                            <label className="label">Desktop Layout</label>
                            <p className="muted">
                                Choose how panels are arranged on desktop screens.
                            </p>
                            <div className="actions wrap">
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={() => setCenterCameraLayout(true)}
                                    aria-pressed={centerCameraLayout}
                                    title="Use one-column layout on desktop"
                                >
                                    One Column
                                </button>
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={() => setCenterCameraLayout(false)}
                                    aria-pressed={!centerCameraLayout}
                                    title="Use two-column layout on desktop"
                                >
                                    Two Columns
                                </button>
                            </div>
                        </div>

                        <div className="settings-section">
                            <label className="label">Recording Save Folder</label>
                            <p className="muted">
                                {isIphoneClient
                                    ? 'Recording save folder is unavailable on iPhone browsers.'
                                    : recordingsFolderName
                                        ? `Current folder: ${recordingsFolderName}`
                                        : fileSystemAccessSupported
                                            ? 'No folder selected. Recordings can still be downloaded manually.'
                                            : 'Folder selection is unavailable in this browser.'}
                            </p>
                            <div className="actions wrap">
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={openSelectRecordingsFolderModal}
                                    disabled={isFolderFeatureDisabled}
                                >
                                    {recordingsFolderName ? 'Change Save Folder' : 'Select Save Folder'}
                                </button>
                                {recordingsFolderName && (
                                    <button
                                        type="button"
                                        className="btn ghost"
                                        onClick={clearRecordingsFolder}
                                        disabled={isFolderFeatureDisabled}
                                    >
                                        Clear Save Folder
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="actions wrap">
                            <button type="button" className="btn ghost" onClick={closeSettings}>
                                Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmRemoveOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="remove-title"
                    >
                        <h2 id="remove-title">Remove Deepgram key?</h2>
                        <p className="muted">Transcription will be disabled until a new key is added.</p>
                        <div className="actions">
                            <button type="button" className="btn danger" onClick={removeKey}>
                                Remove key
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setConfirmRemoveOpen(false)}
                            >
                                Keep key
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmFolderSelectOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="folder-select-title"
                    >
                        <h2 id="folder-select-title">Select Save Folder</h2>
                        <p className="muted">
                            Select a local empty folder to automatically save the output and camera/audio recordings. This folder can be changed in settings screen.
                        </p>
                        <div className="actions">
                            <button type="button" className="btn" onClick={selectRecordingsFolder}>
                                Select Folder
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setConfirmFolderSelectOpen(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="sr-only" aria-live="polite">
                {toast}
            </div>
            {toast && <div className="toast">{toast}</div>}
        </div>
    )
}

export default App
