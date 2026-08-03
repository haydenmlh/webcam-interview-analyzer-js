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
import {
    getSpeechFallbackConfig,
    transcribeWithFallback,
    validateSpeechFallbackConfig,
} from './speech/providers'
import './App.css'

const STORAGE_KEY = 'mia.deepgram.apiKey'
const STORAGE_VALIDATED_AT = 'mia.deepgram.lastValidatedAt'
const STORAGE_THEME = 'mia.theme'
const STORAGE_FALLBACK_WITHOUT_KEY = 'mia.speech.fallbackWithoutDeepgramKey'
const STORAGE_AUTO_ADD_SUMMARY = 'mia.autoAddSummary'
const HANDLE_DB_NAME = 'mia-handle-db'
const HANDLE_STORE_NAME = 'handles'
const RECORDINGS_FOLDER_KEY = 'recordings-folder'

const VALIDATION_RECOMMEND_DAYS = 30
const INITIAL_NOW_MS = Date.now()
const OVERALL_SUMMARY_VIEW_ID = '__overall__'

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
const GAZE_DIRECTION_RETURN_THRESHOLD_PCT = 20
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

function speechProviderLabel(value) {
    if (value === 'system-tts') return 'System TTS'
    if (value === 'local-whisper') return 'Local Whisper'
    if (value === 'huggingface') return 'Hugging Face'
    if (value === 'deepgram') return 'Deepgram'
    return 'Unknown provider'
}

function speechFallbackReasonLabel(value) {
    if (value === 'key-validation') return 'Deepgram key validation issue'
    if (value === 'auth-failure') return 'Deepgram authorization failure'
    if (value === 'endpoint-failure') return 'Deepgram endpoint failure'
    if (value === 'network-failure') return 'network failure'
    if (value === 'provider-throttle-timeout') return 'provider timeout or rate limit'
    if (value === 'provider-unavailable') return 'provider unavailable'
    if (value === 'provider-error') return 'provider error'
    return 'fallback trigger'
}

function describeSpeechMeta(prefix, meta) {
    if (!meta) return ''

    const provider = speechProviderLabel(meta.providerUsed)
    if (!meta.fallbackApplied) return `${prefix}: ${provider}`

    const reason = speechFallbackReasonLabel(meta.fallbackReason)
    return `${prefix}: ${provider} fallback used (${reason})`
}

function formatSpeechError(error, fallbackMessage) {
    const base = error?.message || fallbackMessage
    if (typeof error?.cause === 'string' && error.cause.trim()) {
        return `${base} (${error.cause.trim()})`
    }
    return base
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

function normalizeQuestionKey(questionText) {
    return sanitizeDisplayText(questionText, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

function buildSessionFileBaseName(capturedAtIso, question) {
    const stamp = formatSessionTimestamp(capturedAtIso)
    const safeQuestion = sanitizeQuestionForFileName(question)
    return `${stamp}_${safeQuestion}`
}

function buildSessionDateFolderName(capturedAtIso) {
    const source = capturedAtIso || new Date().toISOString()
    const parsed = new Date(source)
    const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed
    const year = safeDate.getFullYear()
    const month = String(safeDate.getMonth() + 1).padStart(2, '0')
    const day = String(safeDate.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function getSummaryFingerprint(entry) {
    return JSON.stringify({
        question: sanitizeDisplayText(entry?.question, '(no question)'),
        transcript: sanitizeDisplayText(entry?.transcript, '(no transcript captured)'),
        metrics:
            entry?.metrics && typeof entry.metrics === 'object'
                ? entry.metrics
                : null,
    })
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

function parseSessionJsonReport(fileName, content, fallbackDateIso, sortTime, folderPath = '') {
    try {
        const parsed = JSON.parse(content)
        const { baseName } = splitFileName(fileName)
        const parsedTextFileName = sanitizeDisplayText(parsed?.savedFiles?.textFileName, '')
        const sourcePath = folderPath ? `${folderPath}/${fileName}` : fileName
        return {
            id: `${sourcePath}-${sortTime}-json`,
            baseName,
            source: sanitizeDisplayText(sourcePath, 'unknown-file'),
            reportFileName: fileName,
            folderPath,
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
    const [pendingDeleteAction, setPendingDeleteAction] = useState(null)
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
    const [fallbackWithoutDeepgramKey, setFallbackWithoutDeepgramKey] = useState(
        () => getSavedValue(STORAGE_FALLBACK_WITHOUT_KEY) !== 'false',
    )
    const [autoAddCompletedAnswersToSummary, setAutoAddCompletedAnswersToSummary] = useState(() => {
        const saved = getSavedValue(STORAGE_AUTO_ADD_SUMMARY)
        return saved ? saved === 'true' : true
    })

    const [cameraStatus, setCameraStatus] = useState('idle')
    const [debugEnabled, setDebugEnabled] = useState(false)
    const [centerCameraLayout] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth > 860 : true,
    )
    const [isPortraitVideo, setIsPortraitVideo] = useState(false)
    const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth > 860 : true,
    )
    const [questionsDrawerOpen, setQuestionsDrawerOpen] = useState(false)
    const [summaryModalOpen, setSummaryModalOpen] = useState(false)
    const [questionsBulkInput, setQuestionsBulkInput] = useState('')
    const [nextQuestionCursor, setNextQuestionCursor] = useState(0)
    const [answeredQuestionKeys, setAnsweredQuestionKeys] = useState([])

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
    const [transcriptionProviderMeta, setTranscriptionProviderMeta] = useState(null)
    const [questionTtsProviderMeta, setQuestionTtsProviderMeta] = useState(null)
    const [questionInput, setQuestionInput] = useState('')
    const [transcript, setTranscript] = useState('')
    const [latestInterviewMetrics, setLatestInterviewMetrics] = useState(null)
    const [recordedAudioBlob, setRecordedAudioBlob] = useState(null)
    const [recordedVideoBlob, setRecordedVideoBlob] = useState(null)
    const [recordingsFolderName, setRecordingsFolderName] = useState('')
    const [interviewSummaries, setInterviewSummaries] = useState([])
    const [selectedSummaryId, setSelectedSummaryId] = useState('')
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
    const speechFallbackConfig = useMemo(
        () => getSpeechFallbackConfig(import.meta.env),
        [],
    )
    const speechFallbackValidation = useMemo(
        () => validateSpeechFallbackConfig(speechFallbackConfig),
        [speechFallbackConfig],
    )
    const canUseSttFallbackWithoutKey =
        fallbackWithoutDeepgramKey && speechFallbackValidation.sttReady
    const hasSttProvider = hasKey || fallbackWithoutDeepgramKey
    const hasSystemTts =
        typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        typeof SpeechSynthesisUtterance !== 'undefined'
    const hasTtsProvider = hasSystemTts
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
        setSavedValue(
            STORAGE_AUTO_ADD_SUMMARY,
            autoAddCompletedAnswersToSummary ? 'true' : 'false',
        )
    }, [autoAddCompletedAnswersToSummary])

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

    useEffect(() => {
        setSavedValue(
            STORAGE_FALLBACK_WITHOUT_KEY,
            fallbackWithoutDeepgramKey ? 'true' : 'false',
        )
    }, [fallbackWithoutDeepgramKey])

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
            setPreviousAnswersError('')
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
            const fileHandleByFolderAndName = new Map()
            const mediaByFolderAndBaseName = new Map()
            const parsedItems = []
            const mediaExtensions = new Set(['mp3', 'm4a', 'ogg', 'wav', 'webm', 'mp4', 'mov'])

            async function collectFileEntriesFromDirectory(directoryHandle, folderPath = '') {
                for await (const [entryName, entryHandle] of directoryHandle.entries()) {
                    if (entryHandle.kind === 'directory') {
                        const childPath = folderPath ? `${folderPath}/${entryName}` : entryName
                        await collectFileEntriesFromDirectory(entryHandle, childPath)
                        continue
                    }

                    if (entryHandle.kind !== 'file') continue
                    const parts = splitFileName(entryName)
                    const scopedNameKey = `${folderPath}/${entryName}`
                    const scopedBaseKey = `${folderPath}/${parts.baseName}`

                    fileHandleByFolderAndName.set(scopedNameKey, entryHandle)

                    allFileEntries.push({
                        name: entryName,
                        folderPath,
                        handle: entryHandle,
                        baseName: parts.baseName,
                        extension: parts.extension,
                    })

                    if (!mediaExtensions.has(parts.extension)) continue

                    const existing = mediaByFolderAndBaseName.get(scopedBaseKey) || {
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

                    mediaByFolderAndBaseName.set(scopedBaseKey, existing)
                }
            }

            await collectFileEntriesFromDirectory(folderHandle)

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
                    entry.folderPath,
                )
                if (!parsed) continue

                const scopedName = (name) => `${entry.folderPath}/${name}`
                const scopedBaseKey = `${entry.folderPath}/${entry.baseName}`
                const byNameAudio = parsed.audioFileName
                    ? fileHandleByFolderAndName.get(scopedName(parsed.audioFileName)) || null
                    : null
                const byNameVideo = parsed.videoFileName
                    ? fileHandleByFolderAndName.get(scopedName(parsed.videoFileName)) || null
                    : null
                const byNameText = parsed.textFileName
                    ? fileHandleByFolderAndName.get(scopedName(parsed.textFileName)) || null
                    : null
                const byBaseMedia = mediaByFolderAndBaseName.get(scopedBaseKey)
                const fallbackTextFileName = `${entry.baseName}.txt`

                parsedItems.push({
                    ...parsed,
                    reportHandle: entry.handle,
                    audioHandle: byNameAudio || byBaseMedia?.audioHandle || null,
                    videoHandle: byNameVideo || byBaseMedia?.videoHandle || null,
                    audioFileName: parsed.audioFileName || byBaseMedia?.audioFileName || '',
                    videoFileName: parsed.videoFileName || byBaseMedia?.videoFileName || '',
                    textHandle:
                        byNameText ||
                        fileHandleByFolderAndName.get(scopedName(fallbackTextFileName)) ||
                        null,
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

    const selectedPreviousAnswerSummaryFingerprint = useMemo(() => {
        if (!selectedPreviousAnswer) return ''
        return getSummaryFingerprint({
            question: selectedPreviousAnswer.question || '(no question)',
            transcript: selectedPreviousAnswer.transcript || '',
            metrics:
                selectedPreviousAnswer.metrics &&
                    typeof selectedPreviousAnswer.metrics === 'object'
                    ? selectedPreviousAnswer.metrics
                    : null,
        })
    }, [selectedPreviousAnswer])

    const isSelectedPreviousAnswerAlreadyInSummary = useMemo(() => {
        if (!selectedPreviousAnswerSummaryFingerprint) return false
        return interviewSummaries.some(
            (item) => getSummaryFingerprint(item) === selectedPreviousAnswerSummaryFingerprint,
        )
    }, [interviewSummaries, selectedPreviousAnswerSummaryFingerprint])

    const isVideoStartDisabled = isTranscribing || cameraStatus !== 'ready'
    const videoStartDisabledReason =
        cameraStatus !== 'ready' ? 'Camera access is not allowed yet' : ''
    const isImportQuestionDisabled = isRecording || isTranscribing || isSpeakingQuestion

    const isPreviousAnswersViewDisabled =
        isFolderFeatureDisabled || !recordingsFolderName || isLoadingPreviousAnswers
    const previousAnswersViewDisabledReason =
        isIphoneClient
            ? 'Previous answers are unavailable because folder access is not allowed on iPhone browsers.'
            : !fileSystemAccessSupported
                ? 'Previous answers are unavailable because folder access is not allowed in this browser.'
                : !recordingsFolderName
                    ? 'Select a save folder in Settings to enable previous answers.'
                    : ''

    function suppressDisabledTooltipPointerDefault(event, isDisabled) {
        if (!isDisabled) return
        event.preventDefault()
    }

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
        function onResize() {
            setIsDesktopViewport(window.innerWidth > 860)
        }

        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    const parsedDrawerQuestions = useMemo(
        () =>
            questionsBulkInput
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
        [questionsBulkInput],
    )

    const parsedDrawerQuestionKeys = useMemo(
        () => parsedDrawerQuestions.map((question) => normalizeQuestionKey(question)),
        [parsedDrawerQuestions],
    )

    const answeredQuestionKeySet = useMemo(
        () => new Set(answeredQuestionKeys.filter(Boolean)),
        [answeredQuestionKeys],
    )

    const unansweredDrawerQuestions = useMemo(
        () =>
            parsedDrawerQuestions.filter((_, index) => {
                const key = parsedDrawerQuestionKeys[index]
                return key && !answeredQuestionKeySet.has(key)
            }),
        [answeredQuestionKeySet, parsedDrawerQuestionKeys, parsedDrawerQuestions],
    )

    const remainingBankQuestionCount = unansweredDrawerQuestions.length

    const shouldPromptQuestionImport =
        !parsedDrawerQuestions.length || !unansweredDrawerQuestions.length

    const showNoNextQuestionTooltip =
        shouldPromptQuestionImport && !isImportQuestionDisabled

    const noNextQuestionTooltipText =
        'No next question, click to add new questions.'

    const nextQuestionTitle =
        isImportQuestionDisabled
            ? 'Unavailable while recording/transcribing/question audio is active.'
            : showNoNextQuestionTooltip
                ? undefined
                : `${remainingBankQuestionCount} question(s) remaining in bank`

    const overallInterviewSummary = useMemo(() => {
        if (!interviewSummaries.length) {
            return {
                totalAnswers: 0,
                averageWpm: 0,
                averageAnswerLengthSec: 0,
                averageHesitations: 0,
                averageGazeCenterPct: 0,
            }
        }

        const totals = interviewSummaries.reduce(
            (acc, item) => {
                acc.wpm += Number(item.metrics?.wpm) || 0
                acc.answerLengthSec += Number(item.metrics?.answerLengthSec) || 0
                acc.hesitationsCount += Number(item.metrics?.hesitationsCount) || 0
                acc.gazeCenterPct += Number(item.metrics?.gazeCenterPct) || 0
                return acc
            },
            { wpm: 0, answerLengthSec: 0, hesitationsCount: 0, gazeCenterPct: 0 },
        )

        const count = interviewSummaries.length
        return {
            totalAnswers: count,
            averageWpm: Math.round(totals.wpm / count),
            averageAnswerLengthSec: Number((totals.answerLengthSec / count).toFixed(1)),
            averageHesitations: Number((totals.hesitationsCount / count).toFixed(1)),
            averageGazeCenterPct: Math.round(totals.gazeCenterPct / count),
        }
    }, [interviewSummaries])

    const selectedSummary = useMemo(() => {
        if (!interviewSummaries.length) return null
        if (selectedSummaryId === OVERALL_SUMMARY_VIEW_ID) return null
        return (
            interviewSummaries.find((item) => item.id === selectedSummaryId) ||
            interviewSummaries[0]
        )
    }, [interviewSummaries, selectedSummaryId])

    const overallSummarySelected = selectedSummaryId === OVERALL_SUMMARY_VIEW_ID

    function openSummaryModal() {
        if (interviewSummaries.length && !selectedSummaryId) {
            setSelectedSummaryId(interviewSummaries[0].id)
        }
        setSummaryModalOpen(true)
    }

    function closeSummaryModal() {
        setSummaryModalOpen(false)
    }

    function importQuestion(questionText, options = {}) {
        const { closePanel = true } = options
        const nextQuestion = questionText.trim()
        if (!nextQuestion) return

        setQuestionInput(nextQuestion)
        setBanner('')
        if (closePanel) {
            setQuestionsDrawerOpen(false)
        }
    }

    function removeParsedQuestionAt(index) {
        setPendingDeleteAction({ kind: 'parsed-question', index })
    }

    function performRemoveParsedQuestionAt(index) {
        const parsed = questionsBulkInput
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)

        const questionToRemove = parsed[index]
        if (!questionToRemove) return

        const nextParsed = parsed.filter((_, parsedIndex) => parsedIndex !== index)
        setQuestionsBulkInput(nextParsed.join('\n'))

        setNextQuestionCursor(0)

        setToast('Question removed from import list.')
    }

    function handleNextQuestionAction() {
        if (isImportQuestionDisabled) return

        if (!parsedDrawerQuestions.length || !unansweredDrawerQuestions.length) {
            closeSummaryModal()
            setQuestionsDrawerOpen(true)
            return
        }

        const nextIndex = nextQuestionCursor % unansweredDrawerQuestions.length
        const nextQuestion = unansweredDrawerQuestions[nextIndex]
        if (!nextQuestion) return

        importQuestion(nextQuestion, {
            closePanel: false,
        })

        setNextQuestionCursor((prev) =>
            unansweredDrawerQuestions.length
                ? (prev + 1) % unansweredDrawerQuestions.length
                : 0,
        )
    }

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
            if (summaryModalOpen) {
                closeSummaryModal()
                return
            }
            if (questionsDrawerOpen) {
                setQuestionsDrawerOpen(false)
                return
            }
            if (confirmRemoveOpen) {
                setConfirmRemoveOpen(false)
                return
            }
            if (confirmFolderSelectOpen) {
                setConfirmFolderSelectOpen(false)
                return
            }
            if (pendingDeleteAction) {
                setPendingDeleteAction(null)
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
    }, [
        confirmRemoveOpen,
        confirmFolderSelectOpen,
        pendingDeleteAction,
        settingsOpen,
        historyModalOpen,
        closePreviousAnswersModal,
        questionsDrawerOpen,
        summaryModalOpen,
    ])

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
        setTranscriptionProviderMeta(null)
        setQuestionTtsProviderMeta(null)
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

    function addCurrentAnswerToSummary() {
        const question = questionInput.trim()
        const answerTranscript = transcript?.trim()
        const metricsForSummary = latestInterviewMetrics || null

        if (!answerTranscript || !metricsForSummary) {
            setToast('No transcript with metrics available to add yet.')
            return
        }

        const summaryEntry = {
            id: crypto.randomUUID(),
            capturedAt: new Date().toISOString(),
            question: question || '(no question)',
            transcript: answerTranscript,
            metrics: metricsForSummary,
        }

        const candidateFingerprint = getSummaryFingerprint(summaryEntry)
        const existingEntry = interviewSummaries.find(
            (item) => getSummaryFingerprint(item) === candidateFingerprint,
        )
        if (existingEntry) {
            setSelectedSummaryId(existingEntry.id)
            setToast('This answer is already in summary.')
            return
        }

        setInterviewSummaries((prev) => [summaryEntry, ...prev])
        setSelectedSummaryId(summaryEntry.id)
        setToast('Added current answer to summary.')
    }

    async function copySummaryToClipboard() {
        if (!interviewSummaries.length) {
            setToast('No summary data to copy yet.')
            return
        }

        const totals = overallInterviewSummary
        const sections = [
            '# Interview Summary for Gemini',
            '',
            `Generated: ${new Date().toISOString()}`,
            '',
            '## Total Metrics',
            `- Total answers: ${totals.totalAnswers}`,
            `- Average WPM: ${totals.averageWpm}`,
            `- Average answer length (sec): ${totals.averageAnswerLengthSec}`,
            `- Average hesitations: ${totals.averageHesitations}`,
            `- Average gaze center (%): ${totals.averageGazeCenterPct}`,
            '',
            '## Answers',
        ]

        interviewSummaries.forEach((item, index) => {
            const answerNumber = interviewSummaries.length - index
            sections.push(`### Answer ${answerNumber}`)
            sections.push(`- Captured: ${new Date(item.capturedAt).toLocaleString()}`)
            sections.push(`- Question: ${item.question}`)
            sections.push('')
            sections.push('Transcript:')
            sections.push('```text')
            sections.push(item.transcript || '(no transcript captured)')
            sections.push('```')
            sections.push('')
            sections.push('Metrics:')

            const metricEntries = Object.entries(item.metrics || {})
            if (!metricEntries.length) {
                sections.push('- n/a')
            } else {
                metricEntries.forEach(([key, value]) => {
                    sections.push(`- ${key}: ${String(value ?? 'n/a')}`)
                })
            }
            sections.push('')
        })

        const summaryMarkdown = sections.join('\n')

        try {
            await navigator.clipboard.writeText(summaryMarkdown)
            setToast('Summary for Gem copied to clipboard.')
        } catch {
            setToast('Could not copy summary to clipboard.')
        }
    }

    function buildCurrentOutputForGeminiMarkdown() {
        const answerTranscript = transcript.trim()
        if (!answerTranscript || !latestInterviewMetrics || isRecording || isTranscribing) {
            return null
        }

        const sections = [
            '# Current Interview Output for Gemini',
            '',
            `Generated: ${new Date().toISOString()}`,
            `Question: ${questionInput.trim() || '(no question)'}`,
            '',
            'Transcript:',
            '```text',
            answerTranscript,
            '```',
            '',
            'Metrics:',
        ]

        const metricEntries = Object.entries(latestInterviewMetrics || {})
        if (!metricEntries.length) {
            sections.push('- n/a')
        } else {
            metricEntries.forEach(([key, value]) => {
                sections.push(`- ${key}: ${String(value ?? 'n/a')}`)
            })
        }

        return sections.join('\n')
    }

    async function openGeminiSidePanel() {
        const width = 400
        const height = Math.max(700, Math.floor(window.screen.availHeight * 0.9))
        const left = Math.max(0, window.screenX + window.outerWidth - width)
        const top = Math.max(0, window.screenY + Math.floor((window.outerHeight - height) / 2))

        const geminiWindow = window.open(
            'https://gemini.google.com',
            'geminiRightPanel',
            `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
        )

        if (!geminiWindow) {
            setToast('Popup blocked. Allow popups to open Gemini side panel.')
            return
        }

        // Some browsers return null when noopener/noreferrer are set in features.
        // Nulling opener here preserves safety without breaking popup detection.
        try {
            geminiWindow.opener = null
        } catch {
            // Ignore cross-origin restrictions.
        }

        const outputMarkdown = buildCurrentOutputForGeminiMarkdown()
        if (!outputMarkdown) {
            setToast('Gemini opened. Record and transcribe to copy current output.')
            return
        }

        try {
            await navigator.clipboard.writeText(outputMarkdown)
            setToast('Gemini opened. Current output copied to clipboard.')
        } catch {
            setToast('Gemini opened, but copy failed.')
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

    function addSelectedPreviousAnswerToSummary() {
        if (!selectedPreviousAnswer) {
            setToast('Select an answer first.')
            return
        }

        const answerTranscript = selectedPreviousAnswer.transcript?.trim()
        if (!answerTranscript) {
            setToast('No transcript available to add for this answer.')
            return
        }

        const summaryEntry = {
            id: crypto.randomUUID(),
            capturedAt: selectedPreviousAnswer.capturedAt || new Date().toISOString(),
            question: selectedPreviousAnswer.question || '(no question)',
            transcript: answerTranscript,
            metrics:
                selectedPreviousAnswer.metrics &&
                    typeof selectedPreviousAnswer.metrics === 'object'
                    ? selectedPreviousAnswer.metrics
                    : null,
            metricsText: selectedPreviousAnswer.metricsText || '',
            folderPath: selectedPreviousAnswer.folderPath || '',
            reportFileName: selectedPreviousAnswer.reportFileName || '',
            textFileName: selectedPreviousAnswer.textFileName || '',
            audioFileName: selectedPreviousAnswer.audioFileName || '',
            videoFileName: selectedPreviousAnswer.videoFileName || '',
        }

        const candidateFingerprint = getSummaryFingerprint(summaryEntry)
        const existingEntry = interviewSummaries.find(
            (item) => getSummaryFingerprint(item) === candidateFingerprint,
        )
        if (existingEntry) {
            setSelectedSummaryId(existingEntry.id)
            setToast('This previous answer is already in summary.')
            return
        }

        setInterviewSummaries((prev) => [summaryEntry, ...prev])
        setSelectedSummaryId(summaryEntry.id)
        setToast('Added previous answer to summary.')
    }

    async function deleteSelectedPreviousAnswer() {
        if (!selectedPreviousAnswer) {
            setToast('Select an answer first.')
            return
        }

        setPendingDeleteAction({ kind: 'previous-answer' })
    }

    async function performDeleteSelectedPreviousAnswer() {
        if (!selectedPreviousAnswer) {
            setToast('Select an answer first.')
            return
        }

        const deleteResult = await deleteAnswerFilesFromSelectedFolder(selectedPreviousAnswer)
        if (!deleteResult.ok) {
            setToast(deleteResult.message || 'Could not delete this answer.')
            return
        }

        const fingerprintToRemove = getSummaryFingerprint(selectedPreviousAnswer)
        setInterviewSummaries((prev) =>
            prev.filter((item) => getSummaryFingerprint(item) !== fingerprintToRemove),
        )

        const refreshedItems = await loadPreviousAnswers()
        if (refreshedItems.length) {
            const nextItem = refreshedItems[0]
            setSelectedPreviousAnswerId(nextItem.id)
            await loadHistoryMedia(nextItem)
        } else {
            setSelectedPreviousAnswerId('')
            replaceHistoryMediaUrls({ audioUrl: '', videoUrl: '' })
        }

        setToast(
            deleteResult.skipped
                ? 'Previous answer removed. No linked files were found to delete.'
                : 'Previous answer and related files deleted.',
        )
    }

    async function deleteSelectedSummaryAnswer() {
        if (!selectedSummary) {
            setToast('Select a summary answer first.')
            return
        }

        setPendingDeleteAction({ kind: 'summary-answer' })
    }

    async function performDeleteSelectedSummaryAnswer() {
        if (!selectedSummary) {
            setToast('Select a summary answer first.')
            return
        }

        const deleteResult = await deleteAnswerFilesFromSelectedFolder(selectedSummary)
        if (!deleteResult.ok) {
            setToast(deleteResult.message || 'Could not delete this summary answer.')
            return
        }

        const nextSummaries = interviewSummaries.filter(
            (item) => item.id !== selectedSummary.id,
        )
        setInterviewSummaries(nextSummaries)
        setSelectedSummaryId(nextSummaries[0]?.id || OVERALL_SUMMARY_VIEW_ID)

        await loadPreviousAnswers()
        setToast(
            deleteResult.skipped
                ? 'Summary answer removed. No linked files were found to delete.'
                : 'Summary answer and related files deleted.',
        )
    }

    async function confirmPendingDeleteAction() {
        if (!pendingDeleteAction) return

        const action = pendingDeleteAction
        setPendingDeleteAction(null)

        if (action.kind === 'parsed-question') {
            performRemoveParsedQuestionAt(action.index)
            return
        }

        if (action.kind === 'previous-answer') {
            await performDeleteSelectedPreviousAnswer()
            return
        }

        if (action.kind === 'summary-answer') {
            await performDeleteSelectedSummaryAnswer()
        }
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

    async function writeBlobToSelectedFolder(folderHandle, fileName, blob) {
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

    async function resolveFolderHandleFromRelativePath(rootHandle, relativePath) {
        if (!relativePath) return rootHandle

        const segments = relativePath
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean)

        let currentHandle = rootHandle
        for (const segment of segments) {
            currentHandle = await currentHandle.getDirectoryHandle(segment)
        }

        return currentHandle
    }

    function listAnswerFileNames(answerEntry) {
        const names = new Set()
        const rawNames = [
            answerEntry?.reportFileName,
            answerEntry?.savedFiles?.jsonFileName,
            answerEntry?.textFileName,
            answerEntry?.savedFiles?.textFileName,
            answerEntry?.audioFileName,
            answerEntry?.savedFiles?.audioFileName,
            answerEntry?.videoFileName,
            answerEntry?.savedFiles?.videoFileName,
        ]

        rawNames.forEach((name) => {
            const safeName = sanitizeDisplayText(name, '')
            if (safeName) names.add(safeName)
        })

        return Array.from(names)
    }

    async function deleteAnswerFilesFromSelectedFolder(answerEntry) {
        const fileNames = listAnswerFileNames(answerEntry)
        if (!fileNames.length) {
            return { ok: true, deletedCount: 0, skipped: true }
        }

        const folderHandle = recordingsFolderRef.current
        if (!folderHandle) {
            return {
                ok: false,
                message: 'Select a save folder in Settings before deleting stored files.',
            }
        }

        const granted = await ensureDirectoryPermission(folderHandle)
        if (!granted) {
            return {
                ok: false,
                message: 'Folder permission denied. Re-select the folder in Settings.',
            }
        }

        let targetFolderHandle
        try {
            targetFolderHandle = await resolveFolderHandleFromRelativePath(
                folderHandle,
                answerEntry?.folderPath || answerEntry?.savedFiles?.folder || '',
            )
        } catch {
            return {
                ok: false,
                message: 'Could not locate the saved folder for this answer.',
            }
        }

        let deletedCount = 0
        let failedCount = 0
        for (const fileName of fileNames) {
            try {
                await targetFolderHandle.removeEntry(fileName)
                deletedCount += 1
            } catch (error) {
                if (error?.name === 'NotFoundError') continue
                failedCount += 1
            }
        }

        if (failedCount > 0) {
            return {
                ok: false,
                message: 'Could not delete one or more files for this answer.',
            }
        }

        return { ok: true, deletedCount, skipped: false }
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

        const dateFolderName = buildSessionDateFolderName(capturedAtIso)
        let targetFolderHandle
        try {
            targetFolderHandle = await folderHandle.getDirectoryHandle(dateFolderName, {
                create: true,
            })
        } catch {
            setBanner('Could not create a date folder in the selected output folder.')
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
            savedFiles: {
                folder: dateFolderName,
                jsonFileName,
                textFileName,
                audioFileName,
                videoFileName,
            },
        }

        const jsonOk = await writeBlobToSelectedFolder(
            targetFolderHandle,
            jsonFileName,
            new Blob([JSON.stringify(reportForSave, null, 2)], {
                type: 'application/json',
            }),
        )
        const textOk = await writeBlobToSelectedFolder(
            targetFolderHandle,
            textFileName,
            new Blob([outputBlock], {
                type: 'text/plain;charset=utf-8',
            }),
        )
        const audioOk = audioBlob
            ? await writeBlobToSelectedFolder(targetFolderHandle, audioFileName, audioBlob)
            : false
        const videoOk = videoBlob
            ? await writeBlobToSelectedFolder(targetFolderHandle, videoFileName, videoBlob)
            : true

        if (jsonOk && textOk && audioOk && videoOk) {
            setToast(`Saved session files to ${recordingsFolderName}/${dateFolderName}.`)
            await loadPreviousAnswers()
            return reportForSave
        }

        setBanner('Some session files could not be saved to the selected folder.')
        return reportForSave
    }

    async function transcribeAudioBlob(audioBlob) {
        const endpoint =
            import.meta.env.VITE_DEEPGRAM_LISTEN_URL || DEFAULT_DEEPGRAM_LISTEN_URL
        const result = await transcribeWithFallback({
            audioBlob,
            deepgramKey: savedKey,
            deepgramEndpoint: endpoint,
            fallbackConfig: speechFallbackConfig,
        })
        return result
    }

    async function speakQuestionIfEnabled(questionText = questionInput) {
        if (!readQuestionWithTts) return

        const text = questionText.trim()
        if (!text) {
            setBanner('Read (TTS) Question is enabled, but the question is empty.')
            return
        }

        if (!hasSystemTts) {
            setBanner('System text-to-speech is unavailable in this browser.')
            return
        }

        try {
            setIsSpeakingQuestion(true)
            window.speechSynthesis.cancel()
            setQuestionTtsProviderMeta({
                providerUsed: 'system-tts',
                fallbackApplied: !hasKey,
                fallbackReason: !hasKey ? 'key-validation' : '',
            })
            await new Promise((resolve, reject) => {
                const utterance = new SpeechSynthesisUtterance(text)
                utterance.rate = 1
                utterance.pitch = 1
                utterance.onend = () => {
                    resolve()
                }
                utterance.onerror = () => {
                    reject(new Error('System question TTS playback failed.'))
                }
                window.speechSynthesis.speak(utterance)
            })
        } catch (error) {
            const providerMeta = error?.speechMeta || null
            setQuestionTtsProviderMeta(providerMeta)
            setBanner(formatSpeechError(error, 'Question TTS failed. Continuing without TTS.'))
        } finally {
            setIsSpeakingQuestion(false)
        }
    }

    async function startRecording(mode = 'audio', importedQuestion = '') {
        if (isRecording || isTranscribing) return

        if (!hasSttProvider) {
            openSettings()
            setBanner('Add Deepgram key, or enable "Use fallback when Deepgram key is missing" in Settings.')
            return
        }

        if (mode === 'video' && !cameraStreamRef.current) {
            setBanner('Camera access is required to capture video with audio.')
            return
        }

        try {
            recordingModeRef.current = mode
            setBanner('')
            if (!hasKey && canUseSttFallbackWithoutKey) {
                setBanner('Deepgram key not found. Using configured fallback provider.')
            } else if (!hasKey && fallbackWithoutDeepgramKey) {
                setBanner('Deepgram key not found. Recording will continue; configure fallback for transcription.')
            }
            setTranscript('Recording answer...')
            setTranscriptionProviderMeta(null)
            setQuestionTtsProviderMeta(null)
            setLatestInterviewMetrics(null)
            sessionStartedAtRef.current = new Date().toISOString()
            resetInterviewTracking()
            recalibrateTorsoBaseline()

            const ttsQuestion = importedQuestion.trim() || questionInput.trim()
            await speakQuestionIfEnabled(ttsQuestion)

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

            const startedQuestionKey = normalizeQuestionKey(questionInput)
            if (startedQuestionKey) {
                setAnsweredQuestionKeys((prev) =>
                    prev.includes(startedQuestionKey)
                        ? prev
                        : [...prev, startedQuestionKey],
                )
            }

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

            const transcriptionResult = await transcribeAudioBlob(rawAudioBlob)
            const text = transcriptionResult.text
            setTranscriptionProviderMeta(transcriptionResult.meta)

            if (transcriptionResult.meta?.fallbackApplied) {
                const reasonLabel = speechFallbackReasonLabel(
                    transcriptionResult.meta.fallbackReason,
                )
                setBanner(`Transcription fallback used (${reasonLabel}).`)
            }

            const normalizedTranscript = text.trim()
            if (!normalizedTranscript) {
                setTranscript('')
                setLatestInterviewMetrics(null)
                setBanner('No transcript was returned; summary and session files were not saved.')
                setToast('No transcript returned.')
                return
            }

            setTranscript(normalizedTranscript)

            const answerLengthSec = Math.max(
                0,
                (performance.now() - recordingStartedAtPerfRef.current) / 1000,
            )
            const words = countWords(normalizedTranscript)
            const wpmRaw = answerLengthSec > 0 ? words / (answerLengthSec / 60) : 0
            const hesitationsCount = countHesitations(normalizedTranscript)
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
                answer: normalizedTranscript,
                metrics: interviewMetrics,
            })

            setLatestInterviewMetrics(interviewMetrics)

            const sessionReport = {
                ...buildSessionReport({
                    generatedAt: capturedAtIso,
                    sessionEndedAt: capturedAtIso,
                    question: trimmedQuestion,
                    transcript: normalizedTranscript,
                }),
                interviewMetrics,
            }

            let autoSummaryEntryId = ''
            if (autoAddCompletedAnswersToSummary) {
                const summaryEntry = {
                    id: crypto.randomUUID(),
                    capturedAt: capturedAtIso,
                    question: trimmedQuestion || '(no question)',
                    transcript: normalizedTranscript,
                    metrics: interviewMetrics,
                }

                const candidateFingerprint = getSummaryFingerprint(summaryEntry)
                const existingEntry = interviewSummaries.find(
                    (item) => getSummaryFingerprint(item) === candidateFingerprint,
                )
                if (existingEntry) {
                    autoSummaryEntryId = existingEntry.id
                    setSelectedSummaryId(existingEntry.id)
                } else {
                    autoSummaryEntryId = summaryEntry.id
                    setInterviewSummaries((prev) => [summaryEntry, ...prev])
                    setSelectedSummaryId(summaryEntry.id)
                }
            }

            const savedReport = await saveSessionArtifactsToSelectedFolder({
                capturedAtIso,
                question: trimmedQuestion,
                report: sessionReport,
                outputBlock,
                audioBlob: storageAudioBlob,
                videoBlob: shouldSaveVideo ? finalVideoBlob : null,
            })

            if (savedReport?.savedFiles && autoAddCompletedAnswersToSummary && autoSummaryEntryId) {
                setInterviewSummaries((prev) =>
                    prev.map((item) =>
                        item.id === autoSummaryEntryId
                            ? {
                                ...item,
                                folderPath: savedReport.savedFiles.folder || '',
                                reportFileName: savedReport.savedFiles.jsonFileName || '',
                                textFileName: savedReport.savedFiles.textFileName || '',
                                audioFileName: savedReport.savedFiles.audioFileName || '',
                                videoFileName: savedReport.savedFiles.videoFileName || '',
                                savedFiles: savedReport.savedFiles,
                            }
                            : item,
                    ),
                )
            }

            setToast('Transcription completed.')
        } catch (error) {
            if (error?.speechMeta) {
                setTranscriptionProviderMeta(error.speechMeta)
            }
            setTranscript('')
            setLatestInterviewMetrics(null)
            const errorMessage = formatSpeechError(error, 'Transcription failed. Try again.')
            setBanner(errorMessage)
            setToast(errorMessage)
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
    const transcriptDisplayText =
        transcript || 'No transcript yet. Start recording to capture your answer transcript.'
    const transcriptionProviderStatus = describeSpeechMeta(
        'Latest transcription provider',
        transcriptionProviderMeta,
    )
    const questionTtsProviderStatus = describeSpeechMeta(
        'Latest question TTS provider',
        questionTtsProviderMeta,
    )
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
                <div className="topbar-inner">
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
                            <span className="material-symbols-outlined topbar-icon" aria-hidden="true">
                                {darkMode ? 'dark_mode' : 'light_mode'}
                            </span>
                        </button>
                        <button
                            type="button"
                            className="btn ghost settings-cog"
                            onClick={openSettings}
                            aria-label="Open settings"
                            title="Settings"
                        >
                            <span className="material-symbols-outlined topbar-icon" aria-hidden="true">
                                settings
                            </span>
                        </button>
                        <button
                            type="button"
                            className="btn ghost gemini-launch-btn"
                            onClick={openGeminiSidePanel}
                            aria-label="Open Gemini in side panel"
                            title="Open Gemini in side panel"
                        >
                            <span className="material-symbols-outlined topbar-icon" aria-hidden="true">
                                auto_awesome
                            </span>
                            <span className="gemini-launch-label">Open Gemini</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className={`layout${centerCameraLayout ? ' center-camera-layout' : ''}`}>
                <section
                    className={`panel camera-panel${centerCameraLayout ? ' centered-camera-panel' : ''}`}
                >
                    {isDesktopViewport && (
                        <button
                            type="button"
                            className="question-peek-tab"
                            onClick={() => {
                                setQuestionsDrawerOpen((prev) => {
                                    const next = !prev
                                    if (next) closeSummaryModal()
                                    return next
                                })
                            }}
                            aria-expanded={questionsDrawerOpen}
                            aria-controls="questions-modal"
                            title={questionsDrawerOpen ? 'Hide questions import modal' : 'Show questions import modal'}
                        >
                            Questions Import
                        </button>
                    )}
                    {isDesktopViewport && (
                        <button
                            type="button"
                            className="summary-peek-tab"
                            onClick={() => {
                                if (summaryModalOpen) {
                                    closeSummaryModal()
                                    return
                                }
                                setQuestionsDrawerOpen(false)
                                openSummaryModal()
                            }}
                            aria-expanded={summaryModalOpen}
                            aria-controls="summary-modal"
                            title={summaryModalOpen ? 'Hide session summary modal' : 'Show session summary modal'}
                        >
                            Session Summary
                        </button>
                    )}
                    {isDesktopViewport && (
                        <span
                            className={`disabled-tooltip-wrap previous-peek-tab-wrap${isPreviousAnswersViewDisabled && previousAnswersViewDisabledReason ? ' has-tooltip' : ''}`}
                            data-disabled-reason={previousAnswersViewDisabledReason}
                            onPointerDown={(event) =>
                                suppressDisabledTooltipPointerDefault(event, isPreviousAnswersViewDisabled)
                            }
                        >
                            <button
                                type="button"
                                className="previous-peek-tab"
                                onClick={() => {
                                    setQuestionsDrawerOpen(false)
                                    closeSummaryModal()
                                    void openPreviousAnswersModal()
                                }}
                                disabled={isPreviousAnswersViewDisabled}
                            >
                                {isLoadingPreviousAnswers ? 'Loading...' : 'Previous Answers'}
                            </button>
                        </span>
                    )}

                    <div className="camera-heading-row">
                        <h2>{debugEnabled ? 'Camera View (JS MediaPipe)' : 'Camera View'}</h2>
                        <div className="camera-heading-controls">
                            {cameraActionButton}
                        </div>
                    </div>

                    <div className={`camera-frame${isPortraitVideo ? ' portrait' : ''}`}>
                        <video
                            ref={videoRef}
                            className="camera-video"
                            muted
                            playsInline
                        />
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

                    {!debugEnabled && cameraStatus === 'ready' && facesDetected === 0 ? (
                        <p className="face-detected-text">No face detected</p>
                    ) : null}

                    <div className="actions wrap recording-actions camera-recording-actions">
                        {!isRecording ? (
                            <>
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={() => startRecording('audio')}
                                    disabled={isTranscribing}
                                >
                                    Start Audio Recording
                                </button>
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

                    {debugEnabled && (
                        <div className="actions wrap camera-controls-row">
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
                        </div>
                    )}

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
                    <div className="label question-row">
                        <p className="question-main-label">
                            Interview question
                        </p>
                        <div className="question-row-actions">
                            {isDesktopViewport ? (
                                <div
                                    className={`disabled-tooltip-wrap question-next-tooltip-wrap${showNoNextQuestionTooltip ? ' has-tooltip' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className={`btn ghost question-next-btn${showNoNextQuestionTooltip ? ' btn-disabled-look' : ''}`}
                                        onClick={handleNextQuestionAction}
                                        disabled={isImportQuestionDisabled}
                                        title={nextQuestionTitle}
                                    >
                                        Next Question
                                    </button>
                                    {showNoNextQuestionTooltip ? (
                                        <span className="question-next-hover-tooltip" role="tooltip">
                                            {noNextQuestionTooltipText}
                                        </span>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="question-bank-actions">
                                    <button
                                        type="button"
                                        className="btn ghost question-bank-btn"
                                        onClick={() => {
                                            closeSummaryModal()
                                            setQuestionsDrawerOpen(true)
                                        }}
                                    >
                                        Questions List
                                    </button>
                                    <div
                                        className={`disabled-tooltip-wrap question-next-tooltip-wrap${showNoNextQuestionTooltip ? ' has-tooltip' : ''}`}
                                    >
                                        <button
                                            type="button"
                                            className={`btn ghost question-next-btn${showNoNextQuestionTooltip ? ' btn-disabled-look' : ''}`}
                                            onClick={handleNextQuestionAction}
                                            disabled={isImportQuestionDisabled}
                                            title={nextQuestionTitle}
                                        >
                                            Next Question
                                        </button>
                                        {showNoNextQuestionTooltip ? (
                                            <span className="question-next-hover-tooltip" role="tooltip">
                                                {noNextQuestionTooltipText}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            )}
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
                    </div>
                    <textarea
                        id="interview-question"
                        className="field question-field"
                        aria-label="Interview question"
                        value={questionInput}
                        onChange={(event) => setQuestionInput(event.target.value)}
                        autoComplete="off"
                        rows={2}
                        placeholder="Type your question here, or import from the questions tab"
                    />
                    {hasKey && showKeyStatus && <p className="key-status">{maskedSummary}</p>}
                    {needsRevalidation && (
                        <p className="warning">
                            Revalidation recommended. Your key was last checked over 30 days ago.
                        </p>
                    )}
                    {!hasTtsProvider && readQuestionWithTts && (
                        <p className="muted">
                            Question TTS uses your system voice and is unavailable in this browser.
                        </p>
                    )}
                    {banner && <p className="banner">{banner}</p>}
                    {transcriptionProviderStatus && (
                        <p className="muted">{transcriptionProviderStatus}</p>
                    )}
                    {questionTtsProviderStatus && (
                        <p className="muted">{questionTtsProviderStatus}</p>
                    )}

                    <div
                        className="transcript-box session-output-box"
                    >
                        <h3>Transcript</h3>
                        <p className="output-text">{transcriptDisplayText}</p>
                    </div>

                    <div className="transcript-metrics-compact" aria-live="polite">
                        <p className="transcript-metrics-title">Interview Metrics</p>
                        {!isRecording && latestInterviewMetrics ? (
                            <div className="transcript-metrics-grid">
                                <div className="transcript-metric-chip">
                                    <span className="label">Length</span>
                                    <span className="value">{latestInterviewMetrics.answerLengthSec}s</span>
                                </div>
                                <div className="transcript-metric-chip">
                                    <span className="label">WPM</span>
                                    <span className="value">{latestInterviewMetrics.wpm}</span>
                                </div>
                                <div className="transcript-metric-chip">
                                    <span className="label">Hesitations</span>
                                    <span className="value">{latestInterviewMetrics.hesitationsCount}</span>
                                </div>
                                <div className="transcript-metric-chip">
                                    <span className="label">Gaze center</span>
                                    <span className="value">{latestInterviewMetrics.gazeCenterPct}%</span>
                                </div>
                                <div className="transcript-metric-chip">
                                    <span className="label">Gaze deviations</span>
                                    <span className="value">{latestInterviewMetrics.gazeDeviationCount}</span>
                                </div>
                                <div className="transcript-metric-chip">
                                    <span className="label">Shoulder shift</span>
                                    <span className="value">{latestInterviewMetrics.shoulderShiftPeakPct}%</span>
                                </div>
                            </div>
                        ) : (
                            <p className="muted transcript-metrics-empty">
                                Values appear here after you stop and transcribe a recording.
                            </p>
                        )}
                    </div>

                    <div className="actions wrap export-actions">
                        <button
                            type="button"
                            className="btn"
                            onClick={addCurrentAnswerToSummary}
                            disabled={!transcript || !latestInterviewMetrics || isRecording || isTranscribing}
                        >
                            Add to Summary
                        </button>
                        <label className="debug-toggle auto-summary-toggle">
                            <input
                                type="checkbox"
                                checked={autoAddCompletedAnswersToSummary}
                                onChange={(event) => setAutoAddCompletedAnswersToSummary(event.target.checked)}
                                disabled={isRecording || isTranscribing}
                            />
                            <span>Auto add completed answers to summary</span>
                        </label>
                        {(isFolderFeatureDisabled || !recordingsFolderName) && (
                            <>
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
                            </>
                        )}
                    </div>

                    {isDesktopViewport && previousAnswersError && <p className="warning">{previousAnswersError}</p>}
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
                                            {item.folderPath ? (
                                                <span className="history-folder-chip">{item.folderPath}</span>
                                            ) : (
                                                <span className="history-folder-chip history-folder-chip-root">root</span>
                                            )}
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
                                                    {selectedPreviousAnswer.folderPath ? `${selectedPreviousAnswer.folderPath} · ` : ''}
                                                    {selectedPreviousAnswer.source} ·{' '}
                                                    {new Date(selectedPreviousAnswer.capturedAt).toLocaleString()}
                                                </p>
                                            </div>
                                            <div className="history-detail-actions">
                                                <button
                                                    type="button"
                                                    className="btn ghost history-copy-btn"
                                                    onClick={copySelectedAnswerTextFile}
                                                    disabled={!selectedPreviousAnswer.textHandle}
                                                >
                                                    Copy Transcript and Metrics
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn"
                                                    onClick={addSelectedPreviousAnswerToSummary}
                                                    disabled={isSelectedPreviousAnswerAlreadyInSummary}
                                                    title={
                                                        isSelectedPreviousAnswerAlreadyInSummary
                                                            ? 'This answer is already in summary.'
                                                            : 'Add this answer to summary'
                                                    }
                                                >
                                                    {isSelectedPreviousAnswerAlreadyInSummary
                                                        ? 'Already in Summary'
                                                        : 'Add to Summary'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn danger"
                                                    onClick={deleteSelectedPreviousAnswer}
                                                >
                                                    Delete Answer
                                                </button>
                                            </div>
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

            {summaryModalOpen && (
                <div
                    className="overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeSummaryModal()
                        }
                    }}
                >
                    <div
                        id="summary-modal"
                        className="modal summary-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="summary-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="history-modal-header">
                            <h2 id="summary-title">Interview Session Summary</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={copySummaryToClipboard}
                                    disabled={!interviewSummaries.length}
                                >
                                    Copy Session Summary for Gem
                                </button>
                                <button
                                    type="button"
                                    className="btn ghost history-close-btn"
                                    onClick={closeSummaryModal}
                                    aria-label="Close"
                                    title="Close"
                                >
                                    X
                                </button>
                            </div>
                        </div>

                        <div className="history-modal-grid summary-modal-grid">
                            <aside className="history-overview summary-overview">
                                <button
                                    type="button"
                                    className={`summary-overall-header-btn${overallSummarySelected ? ' active' : ''}`}
                                    onClick={() => setSelectedSummaryId(OVERALL_SUMMARY_VIEW_ID)}
                                >
                                    <h3>Overall Metrics</h3>
                                    <p className="muted">{overallInterviewSummary.totalAnswers} answer(s)</p>
                                </button>

                                <h3 className="summary-question-list-title">Answers</h3>
                                <div className="history-overview-list">
                                    {interviewSummaries.map((item, index) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={`history-overview-item${selectedSummary?.id === item.id ? ' active' : ''}`}
                                            onClick={() => setSelectedSummaryId(item.id)}
                                        >
                                            <strong>Q{interviewSummaries.length - index}</strong>
                                            <span>{new Date(item.capturedAt).toLocaleString()}</span>
                                            <span>{item.question}</span>
                                        </button>
                                    ))}
                                    {!interviewSummaries.length && (
                                        <p className="muted">No completed answers yet. Record and transcribe to populate summary data.</p>
                                    )}
                                </div>
                            </aside>

                            <section className="history-detail">
                                {overallSummarySelected ? (
                                    <div className="history-detail-layout">
                                        <div className="history-detail-top">
                                            <div className="history-detail-title-block">
                                                <h3>Overall Interview Metrics</h3>
                                                <p className="metric-label history-detail-meta">
                                                    Aggregated across {overallInterviewSummary.totalAnswers} answer(s)
                                                </p>
                                            </div>
                                        </div>

                                        <div className="history-detail-scroll">
                                            <div className="transcript-box history-metrics">
                                                <h3>Aggregate Metrics</h3>
                                                <div className="history-metrics-grid">
                                                    <div className="history-metric-row">
                                                        <span className="metric-label">Total answers</span>
                                                        <span>{overallInterviewSummary.totalAnswers}</span>
                                                    </div>
                                                    <div className="history-metric-row">
                                                        <span className="metric-label">Average WPM</span>
                                                        <span>{overallInterviewSummary.averageWpm}</span>
                                                    </div>
                                                    <div className="history-metric-row">
                                                        <span className="metric-label">Average answer length</span>
                                                        <span>{overallInterviewSummary.averageAnswerLengthSec}s</span>
                                                    </div>
                                                    <div className="history-metric-row">
                                                        <span className="metric-label">Average hesitations</span>
                                                        <span>{overallInterviewSummary.averageHesitations}</span>
                                                    </div>
                                                    <div className="history-metric-row">
                                                        <span className="metric-label">Average gaze center</span>
                                                        <span>{overallInterviewSummary.averageGazeCenterPct}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : selectedSummary ? (
                                    <div className="history-detail-layout">
                                        <div className="history-detail-top">
                                            <div className="history-detail-title-block">
                                                <h3>{selectedSummary.question}</h3>
                                                <p className="metric-label history-detail-meta">
                                                    {new Date(selectedSummary.capturedAt).toLocaleString()}
                                                </p>
                                            </div>
                                            <div className="history-detail-actions">
                                                <button
                                                    type="button"
                                                    className="btn danger"
                                                    onClick={deleteSelectedSummaryAnswer}
                                                >
                                                    Delete Answer from Summary
                                                </button>
                                            </div>
                                        </div>

                                        <div className="history-detail-scroll">
                                            <div className="transcript-box history-transcript">
                                                <h3>Full Transcript</h3>
                                                <p className="output-text">{selectedSummary.transcript}</p>
                                            </div>

                                            <div className="transcript-box history-metrics">
                                                <h3>Per-Answer Metrics</h3>
                                                {selectedSummary.metrics && (
                                                    <div className="history-metrics-grid">
                                                        {Object.entries(selectedSummary.metrics || {}).map(([key, value]) => (
                                                            <div key={key} className="history-metric-row">
                                                                <span className="metric-label">{key}</span>
                                                                <span>{String(value ?? 'n/a')}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {!selectedSummary.metrics && selectedSummary.metricsText && (
                                                    <p className="output-text">{selectedSummary.metricsText}</p>
                                                )}
                                                {!selectedSummary.metrics && !selectedSummary.metricsText && (
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

            {questionsDrawerOpen && (
                <div
                    className="overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            setQuestionsDrawerOpen(false)
                        }
                    }}
                >
                    <div
                        id="questions-modal"
                        className="modal question-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="questions-modal-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="history-modal-header">
                            <h2 id="questions-modal-title">Questions Import</h2>
                            <button
                                type="button"
                                className="btn ghost history-close-btn"
                                onClick={() => setQuestionsDrawerOpen(false)}
                                aria-label="Close"
                                title="Close"
                            >
                                X
                            </button>
                        </div>

                        <div className="question-modal-body">
                            <div className="question-drawer-inner question-modal-inner">
                                <p className="muted">Enter multiple questions, one per line.</p>
                                <textarea
                                    className="field question-list-field"
                                    value={questionsBulkInput}
                                    onChange={(event) => setQuestionsBulkInput(event.target.value)}
                                    rows={6}
                                    placeholder={[
                                        'Tell me about a challenging project you worked on.',
                                        'Describe a time you handled conflicting priorities.',
                                        'What is one technical decision you would revisit?',
                                    ].join('\n')}
                                />

                                <div className="question-list-parsed">
                                    <h3>Parsed Questions</h3>
                                    {parsedDrawerQuestions.length ? (
                                        <div className="question-list-items">
                                            {parsedDrawerQuestions.map((question, index) => {
                                                const questionKey = parsedDrawerQuestionKeys[index]
                                                const answeredBefore =
                                                    Boolean(questionKey) &&
                                                    answeredQuestionKeySet.has(questionKey)

                                                return (
                                                    <div key={`${question}-${index}`} className="question-list-item">
                                                        <div className="question-list-item-text">
                                                            <p className="muted">
                                                                {index + 1}. {question}
                                                            </p>
                                                            {answeredBefore && (
                                                                <span className="question-answered-indicator">
                                                                    Answered before
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="question-list-item-actions">
                                                            <button
                                                                type="button"
                                                                className="btn"
                                                                onClick={() => {
                                                                    importQuestion(question)
                                                                }}
                                                                disabled={isImportQuestionDisabled}
                                                            >
                                                                Answer
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn danger question-delete-btn"
                                                                onClick={() => {
                                                                    removeParsedQuestionAt(index)
                                                                }}
                                                                aria-label={`Delete question ${index + 1}`}
                                                                title="Delete question"
                                                            >
                                                                <span className="material-symbols-outlined" aria-hidden="true">
                                                                    delete
                                                                </span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <p className="muted">Add at least one line to create importable questions.</p>
                                    )}
                                </div>
                            </div>
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
                        className="modal settings-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="settings-modal-header">
                            <h2 id="settings-title">Settings</h2>
                            <button
                                type="button"
                                className="btn ghost history-close-btn"
                                onClick={closeSettings}
                                aria-label="Close"
                                title="Close"
                            >
                                X
                            </button>
                        </div>
                        <div className="settings-modal-body">
                            <p className="muted">
                                Add your Deepgram API key to enable live transcription. Your key is stored only in this browser.
                            </p>

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
                            <p id="key-help" className="help-text">Use a valid Deepgram API key from your Deepgram account.</p>
                            {fieldError && (
                                <p id="key-error" className="error-text" aria-live="polite">
                                    {fieldError}
                                </p>
                            )}

                            <div className="settings-section">
                                <label className="label">Missing-Key Fallback</label>
                                <p className="muted">
                                    If Deepgram key is missing, start recording with local Whisper fallback.
                                </p>
                                <label className="debug-toggle">
                                    <input
                                        type="checkbox"
                                        checked={fallbackWithoutDeepgramKey}
                                        onChange={(event) =>
                                            setFallbackWithoutDeepgramKey(event.target.checked)
                                        }
                                    />
                                    <span>Use fallback when Deepgram key is missing</span>
                                </label>
                            </div>

                            <p className="privacy-note">
                                Anyone with access to this browser profile can use this key until you remove it.
                            </p>
                            <p className="privacy-note">
                                Do not share screenshots of this page while key is visible.
                            </p>

                            <div className="settings-section">
                                <label className="label">Camera Debug Overlay</label>
                                <p className="muted">
                                    Enable landmark and posture debugging overlays in Camera View.
                                </p>
                                <label className="debug-toggle">
                                    <input
                                        type="checkbox"
                                        checked={debugEnabled}
                                        onChange={(event) => setDebugEnabled(event.target.checked)}
                                    />
                                    <span>Debug</span>
                                </label>
                            </div>

                            {isDesktopViewport && (
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
                            )}

                            <div className="actions wrap">
                                <button type="button" className="btn ghost" onClick={closeSettings}>
                                    Exit
                                </button>
                            </div>
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
                            Choose a local folder to automatically save transcripts and video/audio recordings. You can change this folder anytime in Settings.
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

            {pendingDeleteAction && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-confirm-title"
                    >
                        <h2 id="delete-confirm-title">
                            {pendingDeleteAction.kind === 'parsed-question'
                                ? 'Delete question?'
                                : pendingDeleteAction.kind === 'previous-answer'
                                    ? 'Delete previous answer?'
                                    : 'Delete answer from summary?'}
                        </h2>
                        <p className="muted">
                            {pendingDeleteAction.kind === 'parsed-question'
                                ? 'This question will be removed from the Questions Import list.'
                                : 'This will delete the selected answer and linked saved files. This cannot be undone.'}
                        </p>
                        <div className="actions">
                            <button
                                type="button"
                                className="btn danger"
                                onClick={confirmPendingDeleteAction}
                            >
                                Delete
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setPendingDeleteAction(null)}
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
