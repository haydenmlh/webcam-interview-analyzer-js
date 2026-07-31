import { useEffect, useMemo, useRef, useState } from 'react'
import {
    FaceLandmarker,
    FilesetResolver,
    HandLandmarker,
    PoseLandmarker,
} from '@mediapipe/tasks-vision'
import lamejs from 'lamejs'
import './App.css'

const STORAGE_KEY = 'mia.deepgram.apiKey'
const STORAGE_VALIDATED_AT = 'mia.deepgram.lastValidatedAt'
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

const BLINK_MIN_MS = 50
const BLINK_MAX_MS = 450
const PROLONGED_CLOSURE_MS = 800
const EYE_CLOSED_RATIO = 0.18
const HAND_FACE_TOUCH_RATIO = 0.12
const SHOULDER_SHIFT_ALERT_PCT = 30
const SHOULDER_TILT_ALERT_DEG = 12
const SHOULDER_ROTATION_ALERT_DEG = 18
const GAZE_CENTER_DEVIATION_THRESHOLD_PCT = 25

function validateKeyFormat(rawValue) {
    const value = rawValue.trim()
    if (!value) return 'Enter your Deepgram API key.'
    if (value.length < 20) return 'Key looks too short. Check and retry.'
    if (!/^[-_A-Za-z0-9]+$/.test(value)) return 'Key contains unsupported characters.'
    return ''
}

async function validateAgainstEndpoint(key) {
    const endpoint = import.meta.env.VITE_DEEPGRAM_VALIDATE_URL
    if (!endpoint) return { ok: true, skipped: true }

    const controller = new AbortController()
    const timerId = window.setTimeout(() => controller.abort(), 8000)

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({ provider: 'deepgram' }),
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
            return {
                ok: false,
                message: 'Could not validate key. Check the key and try again.',
            }
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

function buildAudioFileName(blobType) {
    const now = new Date()
    const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const extension =
        blobType.includes('mpeg') || blobType.includes('mp3')
            ? 'mp3'
            : blobType.includes('mp4') || blobType.includes('m4a')
                ? 'm4a'
                : blobType.includes('ogg')
                    ? 'ogg'
                    : 'webm'
    return `session-audio-${stamp}.${extension}`
}

function pickSupportedAudioMimeType() {
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    const supported = preferred.find((value) => MediaRecorder.isTypeSupported(value))
    return supported || ''
}

function toFixed1(value) {
    return Number.isFinite(value) ? value.toFixed(1) : '0.0'
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
        `- Answer Length: ${toFixed1(metrics.answerLengthSec)}s`,
        `- WPM: ${toFixed1(metrics.wpm)}`,
        `- Hesitations Count: ${metrics.hesitationsCount}`,
        `- Number of Gaze Deviations from Center: ${metrics.gazeDeviationCount}`,
        `- Gaze Center Time: ${toFixed1(metrics.gazeCenterSec)}s / ${toFixed1(metrics.answerLengthSec)}s (${toFixed1(metrics.gazeCenterPct)}%)`,
        `- Prolonged Eye-Closure Duration: ${toFixed1(metrics.prolongedClosureSec)}s (${toFixed1(metrics.prolongedClosurePct)}%)`,
        `- Prolonged Eye-Closure Events: ${metrics.prolongedClosureEvents}`,
        `- Prolonged Eye-Closure Timestamps: ${formatTimestampList(metrics.prolongedClosureTimestampsSec)}`,
        `- Hand-to-Face Touch Frequency: ${toFixed1(metrics.handFaceTouchPerMin)}/min`,
        `- Hand-to-Face Touch Duration: ${toFixed1(metrics.handFaceTouchDurationSec)}s`,
        `- Hand-to-Face Regions: ${metrics.handFaceTouchRegions}`,
        `- Shoulder Side Shift Peak: ${toFixed1(metrics.shoulderShiftPeakPct)}%`,
        `- Shoulder Tilt Peak: ${toFixed1(metrics.shoulderTiltPeakDeg)}°`,
        `- Shoulder Rotation Peak: ${toFixed1(metrics.shoulderRotationPeakDeg)}°`,
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

function toSessionTextReport(report) {
    const lines = [
        'Mock Interview Analyzer Session Report',
        `Generated: ${report.generatedAt}`,
        '',
        'Metrics',
        `- Faces detected: ${report.metrics.facesDetected}`,
        `- Hands detected: ${report.metrics.handsDetected}`,
        `- Eye contact proxy: ${report.metrics.eyeContactPercent}%`,
        `- Gaze deviation: ${report.metrics.gazeDeviationPercent}%`,
        `- Blink count: ${report.metrics.blinkCount}`,
        `- Prolonged eye closure events: ${report.metrics.prolongedEyeClosureCount}`,
        `- Hand-to-face touches: ${report.metrics.handToFaceTouchCount}`,
        `- Currently touching face: ${report.metrics.isTouchingFace ? 'yes' : 'no'}`,
        `- Shoulder side shift: ${report.metrics.shoulderDriftPercent ?? 'n/a'}%`,
        `- Shoulder side shift status: ${report.metrics.shoulderShiftStatus || 'n/a'}`,
        `- Shoulder tilt delta: ${report.metrics.shoulderTiltDeltaDegrees ?? 'n/a'}°`,
        `- Shoulder tilt status: ${report.metrics.shoulderTiltStatus || 'n/a'}`,
        `- Shoulder rotation (yaw proxy): ${report.metrics.shoulderRotationDegrees ?? 'n/a'}°`,
        `- Shoulder rotation status: ${report.metrics.shoulderRotationStatus || 'n/a'}`,
        '',
        'Transcript',
        report.transcript || '(no transcript captured)',
    ]

    return lines.join('\n')
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
    const questionAudioRef = useRef(null)
    const sessionStartedAtRef = useRef(null)
    const debugEnabledRef = useRef(false)
    const recordingsFolderRef = useRef(null)
    const recordingActiveRef = useRef(false)
    const recordingStartedAtPerfRef = useRef(0)
    const recordingLastFrameAtPerfRef = useRef(0)
    const shoulderBaselineRef = useRef({
        centerX: null,
        tiltDeg: null,
    })
    const gazeDeviationCountRef = useRef(0)
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

    const [settingsOpen, setSettingsOpen] = useState(false)
    const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
    const [savedKey, setSavedKey] = useState(() => getSavedValue(STORAGE_KEY))
    const [lastValidatedAt, setLastValidatedAt] = useState(() =>
        getSavedValue(STORAGE_VALIDATED_AT),
    )

    const [keyInput, setKeyInput] = useState('')
    const [showKey, setShowKey] = useState(false)
    const [fieldError, setFieldError] = useState('')
    const [banner, setBanner] = useState('')
    const [toast, setToast] = useState('')
    const [isSaving, setIsSaving] = useState(false)

    const [cameraStatus, setCameraStatus] = useState('idle')
    const [analysisStatus, setAnalysisStatus] = useState('idle')
    const [debugEnabled, setDebugEnabled] = useState(false)

    const [facesDetected, setFacesDetected] = useState(0)
    const [handsDetected, setHandsDetected] = useState(0)
    const [eyeContactScore, setEyeContactScore] = useState(null)
    const [gazeDeviationPct, setGazeDeviationPct] = useState(null)
    const [blinkCount, setBlinkCount] = useState(0)
    const [prolongedClosureCount, setProlongedClosureCount] = useState(0)
    const [touchCount, setTouchCount] = useState(0)
    const [isTouchingFace, setIsTouchingFace] = useState(false)
    const [shoulderDriftPct, setShoulderDriftPct] = useState(null)
    const [shoulderTiltDeltaDeg, setShoulderTiltDeltaDeg] = useState(null)
    const [shoulderRotationDeg, setShoulderRotationDeg] = useState(null)

    const [isRecording, setIsRecording] = useState(false)
    const [isTranscribing, setIsTranscribing] = useState(false)
    const [isSpeakingQuestion, setIsSpeakingQuestion] = useState(false)
    const [questionInput, setQuestionInput] = useState('')
    const [transcript, setTranscript] = useState('')
    const [recordedAudioBlob, setRecordedAudioBlob] = useState(null)
    const [recordingsFolderName, setRecordingsFolderName] = useState('')
    const [outputText, setOutputText] = useState('')

    const hasKey = savedKey.length > 0
    const maskedSummary = hasKey
        ? `Key saved (ends with ${savedKey.slice(-4).padStart(8, '*')})`
        : 'No key saved yet.'

    const needsRevalidation = useMemo(() => {
        if (!lastValidatedAt) return false

        const lastDate = new Date(lastValidatedAt)
        if (Number.isNaN(lastDate.getTime())) return false

        const ageMs = INITIAL_NOW_MS - lastDate.getTime()
        return ageMs > VALIDATION_RECOMMEND_DAYS * 24 * 60 * 60 * 1000
    }, [lastValidatedAt])

    const fileSystemAccessSupported = useMemo(() => isFileSystemAccessSupported(), [])

    useEffect(() => {
        if (!toast) return undefined
        const timerId = window.setTimeout(() => setToast(''), 3500)
        return () => window.clearTimeout(timerId)
    }, [toast])

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
                }
            } catch {
                // Ignore persistence restore issues and continue without a folder.
            }
        }

        restoreFolderHandle()

        return () => {
            cancelled = true
        }
    }, [fileSystemAccessSupported])

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
            if (settingsOpen) setSettingsOpen(false)
        }

        window.addEventListener('keydown', onEscape)
        return () => window.removeEventListener('keydown', onEscape)
    }, [confirmRemoveOpen, settingsOpen])

    useEffect(() => {
        return () => {
            stopAnalysisLoop()
            stopCameraStream()
            stopAudioStream()
            faceLandmarkerRef.current?.close()
            handLandmarkerRef.current?.close()
            poseLandmarkerRef.current?.close()
        }
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

        setAnalysisStatus('loading')

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

        setAnalysisStatus('ready')
    }

    function resetBehaviorCounters() {
        blinkTrackerRef.current = {
            closed: false,
            closedAt: 0,
            prolongedCounted: false,
        }
        touchTrackerRef.current = { touching: false }

        setBlinkCount(0)
        setProlongedClosureCount(0)
        setTouchCount(0)
        setIsTouchingFace(false)
        setShoulderDriftPct(null)
        setShoulderTiltDeltaDeg(null)
        setShoulderRotationDeg(null)
        shoulderBaselineRef.current = {
            centerX: null,
            tiltDeg: null,
        }
    }

    function resetInterviewTracking() {
        recordingStartedAtPerfRef.current = 0
        recordingLastFrameAtPerfRef.current = 0
        gazeDeviationCountRef.current = 0
        gazeCenteredTimeMsRef.current = 0
        lastGazeCenteredRef.current = null
        prolongedClosureTotalMsRef.current = 0
        prolongedClosureTimestampsSecRef.current = []
        touchCountDuringRecordingRef.current = 0
        touchDurationMsRef.current = 0
        touchStartedAtMsRef.current = 0
        shoulderPeakDriftPctRef.current = 0
        shoulderPeakTiltDegRef.current = 0
        shoulderPeakRotationDegRef.current = 0
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

                if (recordingActiveRef.current) {
                    const lastFrameAt = recordingLastFrameAtPerfRef.current
                    const deltaMs = lastFrameAt > 0 ? Math.max(0, nowMs - lastFrameAt) : 0
                    recordingLastFrameAtPerfRef.current = nowMs

                    if (gazeDeviation != null) {
                        const centered =
                            gazeDeviation <= GAZE_CENTER_DEVIATION_THRESHOLD_PCT
                        if (lastGazeCenteredRef.current === null) {
                            lastGazeCenteredRef.current = centered
                        } else if (lastGazeCenteredRef.current && !centered) {
                            gazeDeviationCountRef.current += 1
                            lastGazeCenteredRef.current = centered
                        } else if (!lastGazeCenteredRef.current && centered) {
                            lastGazeCenteredRef.current = centered
                        }

                        if (centered) {
                            gazeCenteredTimeMsRef.current += deltaMs
                        }
                    }
                }

                const closureRatio = computeEyeClosureRatio(mainFace)
                const closed = closureRatio != null && closureRatio < EYE_CLOSED_RATIO
                const blinkTracker = blinkTrackerRef.current

                if (closed && !blinkTracker.closed) {
                    blinkTracker.closed = true
                    blinkTracker.closedAt = nowMs
                    blinkTracker.prolongedCounted = false
                } else if (!closed && blinkTracker.closed) {
                    const duration = nowMs - blinkTracker.closedAt
                    if (duration >= BLINK_MIN_MS && duration <= BLINK_MAX_MS) {
                        setBlinkCount((prev) => prev + 1)
                    }
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
                } else if (closed && blinkTracker.closed && !blinkTracker.prolongedCounted) {
                    const duration = nowMs - blinkTracker.closedAt
                    if (duration >= PROLONGED_CLOSURE_MS) {
                        blinkTracker.prolongedCounted = true
                        setProlongedClosureCount((prev) => prev + 1)
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

                        // Yaw proxy: larger left/right shoulder depth difference implies body rotation.
                        const shoulderDepthDelta = Math.abs(
                            (rightShoulder.z ?? 0) - (leftShoulder.z ?? 0),
                        )
                        if (shoulderWidth > 0) {
                            frameShoulderRotationDeg = Math.round(
                                (Math.atan2(shoulderDepthDelta, shoulderWidth) * 180) /
                                Math.PI,
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
                                    frameShoulderRotationDeg,
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

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
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
            setAnalysisStatus('error')
            setBanner('Camera setup failed. Check camera permissions and try again.')
        }
    }

    function stopCamera() {
        stopAnalysisLoop()
        stopCameraStream()
        recordingActiveRef.current = false
        setCameraStatus('idle')
        setAnalysisStatus('idle')
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

    function updateInput(value) {
        setKeyInput(value)
        if (fieldError) setFieldError(validateKeyFormat(value))
    }

    function validateOnBlur() {
        setFieldError(validateKeyFormat(keyInput))
    }

    async function saveSettings() {
        const formatError = validateKeyFormat(keyInput)
        if (formatError) {
            setFieldError(formatError)
            return
        }

        setIsSaving(true)
        setBanner('')

        const validationResult = await validateAgainstEndpoint(keyInput.trim())
        setIsSaving(false)

        if (!validationResult.ok) {
            setFieldError(
                validationResult.message ||
                'Could not validate key. Check the key and try again.',
            )
            setToast('Could not validate key. Check the key and try again.')
            return
        }

        const cleanedKey = keyInput.trim()
        const nowIso = new Date().toISOString()

        setSavedKey(cleanedKey)
        setLastValidatedAt(nowIso)
        setSavedValue(STORAGE_KEY, cleanedKey)
        setSavedValue(STORAGE_VALIDATED_AT, nowIso)

        closeSettings()

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
        setLastValidatedAt('')
        setKeyInput('')
        setConfirmRemoveOpen(false)
        setSettingsOpen(false)
        setTranscript('')
        setBanner('Transcription is disabled until a new key is added.')
        setToast('Deepgram key removed.')
    }

    function buildSessionReport() {
        return {
            generatedAt: new Date().toISOString(),
            sessionStartedAt: sessionStartedAtRef.current,
            sessionEndedAt: new Date().toISOString(),
            question: questionInput.trim(),
            metrics: {
                facesDetected,
                handsDetected,
                eyeContactPercent:
                    eyeContactScore == null ? null : Math.round(eyeContactScore * 100),
                gazeDeviationPercent: gazeDeviationPct,
                blinkCount,
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
            transcript,
        }
    }

    function exportJsonReport() {
        const report = buildSessionReport()
        const blob = new Blob([JSON.stringify(report, null, 2)], {
            type: 'application/json',
        })
        downloadBlob(blob, `session-report-${Date.now()}.json`)
    }

    function exportTextReport() {
        const report = buildSessionReport()
        const blob = new Blob([toSessionTextReport(report)], {
            type: 'text/plain;charset=utf-8',
        })
        downloadBlob(blob, `session-report-${Date.now()}.txt`)
    }

    function downloadRecording() {
        if (!recordedAudioBlob) return
        const extension =
            recordedAudioBlob.type.includes('mpeg') ||
                recordedAudioBlob.type.includes('mp3')
                ? 'mp3'
                : recordedAudioBlob.type.includes('mp4') ||
                    recordedAudioBlob.type.includes('m4a')
                    ? 'm4a'
                    : 'webm'
        downloadBlob(recordedAudioBlob, `session-audio-${Date.now()}.${extension}`)
    }

    async function selectRecordingsFolder() {
        if (!fileSystemAccessSupported) {
            setBanner('Folder save is supported in Chromium browsers like Chrome or Edge.')
            return
        }

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
            setToast('Recording folder selected.')
        } catch {
            // User may dismiss the picker.
        }
    }

    async function clearRecordingsFolder() {
        recordingsFolderRef.current = null
        setRecordingsFolderName('')
        try {
            await clearPersistedFolderHandle()
        } catch {
            // Ignore persistence cleanup failures.
        }
        setToast('Recording folder cleared.')
    }

    async function saveAudioToSelectedFolder(audioBlob) {
        const folderHandle = recordingsFolderRef.current
        if (!folderHandle) return false

        try {
            const granted = await ensureDirectoryPermission(folderHandle)
            if (!granted) {
                setBanner('Folder write permission was not granted. Select folder again.')
                return false
            }

            const fileName = buildAudioFileName(audioBlob.type || 'audio/webm')
            const fileHandle = await folderHandle.getFileHandle(fileName, { create: true })
            const writable = await fileHandle.createWritable()
            await writable.write(audioBlob)
            await writable.close()
            setToast(`Saved audio to folder as ${fileName}.`)
            return true
        } catch {
            setBanner('Saving to selected folder failed. Re-select the folder and retry.')
            return false
        }
    }

    async function speakQuestion() {
        const text = questionInput.trim()
        if (!text) {
            setBanner('Enter a question before using text-to-speech.')
            return
        }

        if (!hasKey) {
            openSettings()
            setBanner('Add Deepgram key in Settings to enable text-to-speech.')
            return
        }

        setIsSpeakingQuestion(true)
        setBanner('')

        try {
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

            if (response.status === 401 || response.status === 403) {
                setBanner('Saved key is invalid or revoked. Update it in Settings.')
                throw new Error('Saved key is invalid or revoked.')
            }

            if (response.status === 429) {
                throw new Error('TTS rate limit reached. Please wait and retry.')
            }

            if (!response.ok) {
                throw new Error('Text-to-speech failed. Try again in a moment.')
            }

            const audioBlob = await response.blob()
            const audioUrl = URL.createObjectURL(audioBlob)

            if (questionAudioRef.current) {
                questionAudioRef.current.pause()
                URL.revokeObjectURL(questionAudioRef.current.src)
            }

            const audio = new Audio(audioUrl)
            questionAudioRef.current = audio
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl)
                if (questionAudioRef.current === audio) {
                    questionAudioRef.current = null
                }
            }
            await audio.play()
            setToast('Question audio started.')
        } catch (error) {
            setToast(error.message || 'Text-to-speech failed. Try again.')
            if (!banner) {
                setBanner(error.message || 'Text-to-speech failed. Try again.')
            }
        } finally {
            setIsSpeakingQuestion(false)
        }
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

    async function startRecording() {
        if (isRecording || isTranscribing) return

        if (!hasKey) {
            openSettings()
            setBanner('Add Deepgram key in Settings to enable transcription.')
            return
        }

        try {
            setBanner('')
            setTranscript('Recording answer...')
            setOutputText('')
            sessionStartedAtRef.current = new Date().toISOString()
            resetInterviewTracking()

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            })
            audioStreamRef.current = stream
            recordingActiveRef.current = true
            recordingStartedAtPerfRef.current = performance.now()
            recordingLastFrameAtPerfRef.current = recordingStartedAtPerfRef.current

            const mimeType = pickSupportedAudioMimeType()
            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream)

            chunksRef.current = []
            setRecordedAudioBlob(null)

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
            }

            recorderRef.current = recorder
            recorder.start()
            setIsRecording(true)
            setToast('Recording started.')
        } catch {
            recordingActiveRef.current = false
            setBanner('Microphone access failed. Allow microphone permission and try again.')
            setTranscript('')
            stopAudioStream()
        }
    }

    async function stopRecordingAndTranscribe() {
        if (!recorderRef.current || !isRecording) return

        const recorder = recorderRef.current
        setIsRecording(false)
        setIsTranscribing(true)
        setTranscript('Transcribing your answer...')

        await new Promise((resolve) => {
            recorder.onstop = resolve
            recorder.stop()
        })

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
            await saveAudioToSelectedFolder(storageAudioBlob)

            const text = await transcribeAudioBlob(rawAudioBlob)
            setTranscript(text)

            const answerLengthSec = Math.max(
                0,
                (performance.now() - recordingStartedAtPerfRef.current) / 1000,
            )
            const words = countWords(text)
            const wpm = answerLengthSec > 0 ? words / (answerLengthSec / 60) : 0
            const hesitationsCount = countHesitations(text)
            const gazeCenterSec = gazeCenteredTimeMsRef.current / 1000
            const gazeCenterPct =
                answerLengthSec > 0 ? (gazeCenterSec / answerLengthSec) * 100 : 0
            const prolongedClosureSec = prolongedClosureTotalMsRef.current / 1000
            const prolongedClosurePct =
                answerLengthSec > 0
                    ? (prolongedClosureSec / answerLengthSec) * 100
                    : 0

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

            setOutputText(
                buildOutputText({
                    capturedAt: new Date().toISOString(),
                    question: questionInput.trim(),
                    answer: text,
                    metrics: {
                        answerLengthSec,
                        wpm,
                        hesitationsCount,
                        gazeDeviationCount: gazeDeviationCountRef.current,
                        gazeCenterSec,
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
                        shoulderRotationStatus: shoulderRotationStatusFromPeak,
                    },
                }),
            )
            setToast('Transcription completed.')
        } catch (error) {
            setTranscript('')
            setOutputText('')
            setBanner(error.message || 'Transcription failed. Try again.')
            setToast(error.message || 'Transcription failed. Try again.')
        } finally {
            recorderRef.current = null
            chunksRef.current = []
            setIsTranscribing(false)
        }
    }

    const analysisLabel =
        analysisStatus === 'loading'
            ? 'Loading MediaPipe models...'
            : analysisStatus === 'ready'
                ? 'Live analysis running'
                : analysisStatus === 'error'
                    ? 'Analysis unavailable'
                    : 'Analysis not started'

    const faceDetectedLabel = facesDetected > 0 ? 'Face detected' : 'No face detected'
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
            : shoulderRotationDeg >= SHOULDER_ROTATION_ALERT_DEG
                ? 'rotating too much'
                : 'facing forward'

    return (
        <div className="app-shell">
            <header className="topbar">
                <div>
                    <p className="eyebrow">Mock Interview Analyzer</p>
                    <h1>Interview Session</h1>
                </div>
                <button type="button" className="btn ghost" onClick={openSettings}>
                    Settings
                </button>
            </header>

            <main className="layout">
                <section className="panel camera-panel">
                    <h2>Camera Analysis (JS MediaPipe)</h2>
                    <div className="analysis-status-row">
                        <p className="muted">{analysisLabel}</p>
                        <label className="debug-toggle">
                            <input
                                type="checkbox"
                                checked={debugEnabled}
                                onChange={(event) => setDebugEnabled(event.target.checked)}
                            />
                            <span>Debug</span>
                        </label>
                    </div>

                    <div className="camera-frame">
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

                    <div className="actions wrap">
                        {cameraStatus === 'ready' ? (
                            <button type="button" className="btn ghost" onClick={stopCamera}>
                                Stop Camera
                            </button>
                        ) : (
                            <button type="button" className="btn" onClick={startCamera}>
                                Start Camera
                            </button>
                        )}
                    </div>

                    {debugEnabled ? (
                        <div className="metrics-grid metrics-grid-wide">
                            <article className="metric-card">
                                <p className="metric-label">Faces detected</p>
                                <p className="metric-value">{facesDetected}</p>
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
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Gaze deviation</p>
                                <p className="metric-value">
                                    {gazeDeviationPct == null
                                        ? 'n/a'
                                        : `${gazeDeviationPct}%`}
                                </p>
                            </article>
                            <article className="metric-card">
                                <p className="metric-label">Blink count</p>
                                <p className="metric-value">{blinkCount}</p>
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
                                    {shoulderRotationDeg == null ? 'n/a' : `${shoulderRotationDeg}°`}
                                </p>
                                <p className="metric-label">{shoulderRotationStatus}</p>
                            </article>
                        </div>
                    ) : (
                        <p className="face-detected-text">{faceDetectedLabel}</p>
                    )}
                </section>

                <section className="panel session">
                    <h2>Session Controls</h2>
                    <p className="muted">
                        Add your Deepgram API key in Settings, then record an answer and transcribe it.
                    </p>
                    <p className="muted">
                        {recordingsFolderName
                            ? `Auto-saving recordings to folder: ${recordingsFolderName}`
                            : fileSystemAccessSupported
                                ? 'No save folder selected. You can still download files manually.'
                                : 'Direct folder save is unavailable in this browser; use Download Audio.'}
                    </p>
                    <div className="actions wrap">
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={selectRecordingsFolder}
                            disabled={!fileSystemAccessSupported}
                        >
                            Select Save Folder
                        </button>
                        {recordingsFolderName && (
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={clearRecordingsFolder}
                            >
                                Clear Save Folder
                            </button>
                        )}
                    </div>
                    <label htmlFor="interview-question" className="label">
                        Interview question
                    </label>
                    <input
                        id="interview-question"
                        type="text"
                        className="field"
                        value={questionInput}
                        onChange={(event) => setQuestionInput(event.target.value)}
                        placeholder="Tell me about a challenging project you worked on."
                    />
                    <div className="actions wrap">
                        {!isRecording ? (
                            <button
                                type="button"
                                className="btn"
                                onClick={startRecording}
                                disabled={isTranscribing}
                            >
                                Start Recording
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="btn"
                                onClick={stopRecordingAndTranscribe}
                            >
                                Stop and Transcribe
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={speakQuestion}
                            disabled={isSpeakingQuestion}
                        >
                            {isSpeakingQuestion ? 'Reading Question...' : 'Read Question'}
                        </button>
                        <button type="button" className="btn ghost" onClick={openSettings}>
                            Transcription settings
                        </button>
                    </div>

                    <p className="key-status">{maskedSummary}</p>
                    {needsRevalidation && (
                        <p className="warning">
                            Revalidation recommended. Your key was last checked over 30 days ago.
                        </p>
                    )}
                    {banner && <p className="banner">{banner}</p>}

                    <div className="transcript-box">
                        <h3>Output</h3>
                        <p className="output-text">
                            {outputText ||
                                'No output yet. Start recording to capture a transcript and interview metrics.'}
                        </p>
                    </div>

                    <div className="actions wrap export-actions">
                        <button type="button" className="btn ghost" onClick={exportJsonReport}>
                            Export JSON
                        </button>
                        <button type="button" className="btn ghost" onClick={exportTextReport}>
                            Export TXT
                        </button>
                        <button
                            type="button"
                            className="btn ghost"
                            onClick={downloadRecording}
                            disabled={!recordedAudioBlob}
                        >
                            Download Audio
                        </button>
                    </div>
                </section>
            </main>

            {settingsOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-title"
                    >
                        <h2 id="settings-title">Speech Transcription</h2>
                        <p className="muted">
                            Add your Deepgram API key to enable live transcription. Your key is stored only in this browser.
                        </p>

                        <label htmlFor="deepgram-key" className="label">
                            Deepgram API Key
                        </label>
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

                        <div className="actions wrap">
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setShowKey((prev) => !prev)}
                            >
                                {showKey ? 'Hide key' : 'Show key'}
                            </button>
                            <button
                                type="button"
                                className="btn"
                                onClick={saveSettings}
                                disabled={isSaving}
                            >
                                Save settings
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
                            <button type="button" className="btn ghost" onClick={closeSettings}>
                                Cancel
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

            <div className="sr-only" aria-live="polite">
                {toast}
            </div>
            {toast && <div className="toast">{toast}</div>}
        </div>
    )
}

export default App
