import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    FaceLandmarker,
    FilesetResolver,
} from '@mediapipe/tasks-vision'
import { APP_VERSION } from './version'
import {
    getSpeechFallbackConfig,
    transcribeWithFallback,
    validateSpeechFallbackConfig,
} from './speech/providers'
import defaultInterviewerImage from './assets/interviewers/interviewer.jpg'
import meetingOverlayImage from './assets/meeting-overlay.png'
import changelogMarkdown from '../CHANGELOG.md?raw'
import {
    getLlmProviderConfig,
    sendInterviewChatMessage,
    validateLlmProviderApiKey,
} from './llm/providers'
import { jsPDF } from 'jspdf'
import { marked } from 'marked'
import ReactMarkdown from 'react-markdown'
import './App.css'

const STORAGE_KEY = 'mia.deepgram.apiKey'
const STORAGE_VALIDATED_AT = 'mia.deepgram.lastValidatedAt'
const STORAGE_THEME = 'mia.theme'
const STORAGE_INVERT_CAMERA = 'mia.invertCamera'
const STORAGE_SHOW_INTERVIEWER = 'mia.showInterviewer'
const STORAGE_SHOW_PIP = 'mia.showPiP'
const STORAGE_INTERVIEWER_IMAGE_ID = 'mia.interviewer.imageId'
const STORAGE_INTERVIEWER_CUSTOM_IMAGE = 'mia.interviewer.customImageDataUrl'
const STORAGE_SHOW_SELF_VIEW = 'mia.showSelfView'
const STORAGE_ENABLE_CAMERA = 'mia.enableCamera'
const STORAGE_FALLBACK_WITHOUT_KEY = 'mia.speech.fallbackWithoutDeepgramKey'
const STORAGE_AUTO_ADD_SUMMARY = 'mia.autoAddSummary'
const STORAGE_AUTO_SAVE_MEDIA_TO_FOLDER = 'mia.autoSaveMediaToFolder'
const STORAGE_DEEPGRAM_DEBUG = 'mia.deepgram.debug'
const STORAGE_CV_TEXT = 'mia.cvText'
const STORAGE_JD_TEXT = 'mia.jdText'
const STORAGE_COMPANY_NAME = 'mia.companyName'
const STORAGE_CONSULTANT_FULL_NAME = 'mia.consultantFullName'
const STORAGE_JOB_TITLE = 'mia.jobTitle'
const STORAGE_LLM_PROVIDER_MODE = 'mia.llm.providerMode'
const STORAGE_OPENROUTER_API_KEY = 'mia.llm.openrouter.apiKey'
const STORAGE_OPENROUTER_MODEL = 'mia.llm.openrouter.model'
const STORAGE_NIM_API_KEY = 'mia.llm.nim.apiKey'
const STORAGE_NIM_MODEL = 'mia.llm.nim.model'
const STORAGE_NIM_BASE_URL = 'mia.llm.nim.baseUrl'
const STORAGE_PREVIOUS_ANSWERS_SOURCE = 'mia.previousAnswers.source'
const STORAGE_PREVIOUS_ANSWERS_LOCAL = 'mia.previousAnswers.local'
const HANDLE_DB_NAME = 'mia-handle-db'
const HANDLE_STORE_NAME = 'handles'
const RECORDINGS_FOLDER_KEY = 'recordings-folder'
const RECYCLE_BIN_FOLDER_NAME = '_Recycle Bin'

const VALIDATION_RECOMMEND_DAYS = 30
const INITIAL_NOW_MS = Date.now()
const OVERALL_SUMMARY_VIEW_ID = '__overall__'
const LLM_PROVIDER_MODE_AUTO = 'auto'
const LLM_PROVIDER_MODE_OPENROUTER_ONLY = 'openrouter-only'
const LLM_PROVIDER_MODE_NIM_ONLY = 'nim-only'
const PREVIOUS_ANSWERS_SOURCE_FOLDER = 'folder'
const PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE = 'local-storage'
const DEFAULT_GENERATED_QUESTION_COUNT = 10
const DEFAULT_QUESTION_GENERATION_GUIDELINES =
    'Generate concise, role-relevant interview questions. Cover technical depth, behavioral examples, and company alignment. Avoid duplicates. Return one question per line.'
const DEFAULT_AM_REPORT_GENERATION_GUIDELINES =
    'Generate a report for an account-manager at a consulting firm regarding the Answers provided in context, which were answered by a consultant. Provide feedback grounded in the interview answer transcript, answer metrics, JD and CV. Be specific, concise, and evidence-based. Do not generate per question feedback.'
const DEFAULT_DETAILED_REPORT_GENERATION_GUIDELINES =
    'Generate an in-depth report with an executive summary first, then detailed per-question analysis. For each question include strengths, weaknesses, metric interpretation, and a suggested improved answer. Tailor suggested answers to CV/JD/company/job title when relevant, and explicitly state when profile context is not relevant to that specific question.'
const QUESTION_GENERATION_USER_MESSAGE = (questionCount, jdOnlyQuestionCount) =>
    `Generate ${questionCount} concise mock interview questions based on the provided CV, job description, and company. If a job description is provided, include at least ${jdOnlyQuestionCount} questions that are derived only from the job description requirements and are not based on the CV. Return only the questions, one per line, no intro or explanation.`
const AM_REPORT_USER_MESSAGE =
    'You are an Interview Expert for a Consulting Firm. You are writing feedback for the mock interview answers. Using the provided interview Job Title, Q&A transcript, Q&A metrics, JD and CV, return markdown with sections: 1) Initial Feedback, 2) Overall Rating (out of 10), 3) Answer Strengths, 4) Answer Weaknesses, 5) Future Directions For Improvement. Keep it concise and evidence-based.'
const DETAILED_REPORT_USER_MESSAGE =
    'You are an Interview Expert for a Consulting Firm. Using the provided interview context, return markdown with these exact top-level sections in order: 1) Initial Feedback, 2) Overall Rating (out of 10), 3) Answer Strengths, 4) Answer Weaknesses, 5) Future Directions For Improvement, 6) Detailed Per-Question Analysis. In section 6, create one subsection per answer using heading format "### Question N: <question>" and include: Candidate Answer Snapshot, Strengths, Weaknesses, Metric Interpretation, Suggested Improved Answer. The Suggested Improved Answer must describe an ideal answer and tailor it to CV/JD/company/job title context when relevant; if not relevant, explicitly state that no CV/JD tailoring applies. Keep feedback specific, concise, and evidence-based using transcript and metrics.'
const LLM_PROVIDER_ENV_CONFIG = getLlmProviderConfig(import.meta.env)
const OPENROUTER_BASE_URL = LLM_PROVIDER_ENV_CONFIG.openrouter.baseUrl
const DEFAULT_NIM_BASE_URL = LLM_PROVIDER_ENV_CONFIG.nim.baseUrl
const LLM_HTTP_ERROR_TOAST_PREFIX = 'LLM API HTTP error:'
const LLM_HTTP_ERROR_TOAST_TIMEOUT_MS = 10000
const LLM_HTTP_ERROR_MESSAGE_MAX_LENGTH = 180
const UNSAVED_QA_WARNING_MESSAGE =
    'Questions and Answer Summaries will not be saved. Please download the reports as needed.'
const CUSTOM_MODEL_OPTION_VALUE = '__custom__'
const OPENROUTER_MODEL_PRESETS = [
    {
        value: LLM_PROVIDER_ENV_CONFIG.openrouter.model,
        label: `Default Model [${LLM_PROVIDER_ENV_CONFIG.openrouter.model}]`,
    },
    {
        value: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'NVIDIA Nemotron 3 Ultra 550B A55B [nvidia/nemotron-3-ultra-550b-a55b:free]',
    },
    {
        value: 'cohere/north-mini-code:free',
        label: 'Cohere North Mini Code [cohere/north-mini-code:free]',
    },
]
const NIM_MODEL_PRESETS = [
    {
        value: LLM_PROVIDER_ENV_CONFIG.nim.model,
        label: `Default Model [${LLM_PROVIDER_ENV_CONFIG.nim.model}]`,
    },
    {
        value: 'openai/gpt-oss-120b',
        label: 'OpenAI GPT OSS 120B [openai/gpt-oss-120b]',
    },
    {
        value: 'openai/gpt-oss-20b',
        label: 'OpenAI GPT OSS 20B [openai/gpt-oss-20b]',
    },
]

function buildModelOptionsWithCurrent(presets) {
    const uniquePresets = presets.filter(
        (preset, index) =>
            preset?.value && presets.findIndex((entry) => entry.value === preset.value) === index,
    )

    const options = [...uniquePresets]
    options.push({
        value: CUSTOM_MODEL_OPTION_VALUE,
        label: 'Custom model...',
    })
    return options
}

function getModelSelectValue(currentModel, presets) {
    const normalizedCurrent = String(currentModel || '').trim()
    if (!normalizedCurrent) return CUSTOM_MODEL_OPTION_VALUE
    if (presets.some((preset) => preset.value === normalizedCurrent)) {
        return normalizedCurrent
    }
    return CUSTOM_MODEL_OPTION_VALUE
}

function normalizeLlmProviderMode(value) {
    if (
        value === LLM_PROVIDER_MODE_AUTO ||
        value === LLM_PROVIDER_MODE_OPENROUTER_ONLY ||
        value === LLM_PROVIDER_MODE_NIM_ONLY
    ) {
        return value
    }

    return LLM_PROVIDER_MODE_AUTO
}

function normalizePreviousAnswersSource(value) {
    if (value === PREVIOUS_ANSWERS_SOURCE_FOLDER || value === PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE) {
        return value
    }

    return PREVIOUS_ANSWERS_SOURCE_FOLDER
}

function truncateText(value, maxLength) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ')
    if (!normalized) return ''
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

const DEFAULT_WASM_URL =
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
const DEFAULT_FACE_MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
const DEFAULT_DEEPGRAM_LISTEN_URL =
    'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&filler_words=true'
const DEFAULT_DEEPGRAM_SPEAK_URL =
    'https://api.deepgram.com/v1/speak?model=aura-2-thalia-en'

const LEGACY_DEFAULT_INTERVIEWER_IMAGE_ID = 'default'
const CUSTOM_INTERVIEWER_IMAGE_ID = 'custom-upload'
const EASTER_EGG_INTERVIEWER_IMAGE_ID = 'interviewer2'
const interviewerImageModules = import.meta.glob(
    './assets/interviewers/*.{png,jpg,jpeg,webp,avif,gif}',
    { eager: true, import: 'default' },
)

function toInterviewerImageId(filePath) {
    return filePath
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'interviewer'
}

function toInterviewerImageLabel(filePath) {
    const fileName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'interviewer'
    const words = fileName
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())

    if (!words.length) return 'Interviewer'
    return words.join(' ')
}

const BUILT_IN_INTERVIEWER_IMAGES = Object.entries(interviewerImageModules)
    .map(([filePath, src]) => ({
        id: toInterviewerImageId(filePath),
        label: toInterviewerImageLabel(filePath),
        src,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

const DEFAULT_VISIBLE_INTERVIEWER_IMAGES = BUILT_IN_INTERVIEWER_IMAGES.filter(
    (option) => option.id !== EASTER_EGG_INTERVIEWER_IMAGE_ID,
)

const DEFAULT_INTERVIEWER_IMAGE_ID =
    DEFAULT_VISIBLE_INTERVIEWER_IMAGES.find((option) => option.id === 'interviewer')?.id ||
    DEFAULT_VISIBLE_INTERVIEWER_IMAGES[0]?.id ||
    BUILT_IN_INTERVIEWER_IMAGES[0]?.id ||
    LEGACY_DEFAULT_INTERVIEWER_IMAGE_ID

const PROLONGED_CLOSURE_MS = 800
const EYE_CLOSED_RATIO = 0.18
const EYE_REOPEN_RATIO = 0.205
const GAZE_CENTER_DEVIATION_THRESHOLD_PCT = 25
const GAZE_DIRECTION_EXIT_THRESHOLD_PCT = 24
const GAZE_DIRECTION_RETURN_THRESHOLD_PCT = 20
const GAZE_DIRECTION_DOMINANCE_PCT = 4
const ANALYSIS_DETECT_INTERVAL_MS = 80
const CAMERA_DISPLAY_MODE_SELF_ONLY = 'self-only'
const CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP = 'interviewer-plus-self-pip'
const CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY = 'interviewer-only'
const EMPTY_GAZE_DIRECTION_COUNTS = {
    left: 0,
    right: 0,
    up: 0,
    down: 0,
}

function createDefaultCameraUiMetrics() {
    return {
        facesDetected: 0,
        eyeContactScore: null,
        gazeDeviationPct: null,
        gazeDeviationCount: 0,
        gazeDirectionCounts: { ...EMPTY_GAZE_DIRECTION_COUNTS },
        prolongedClosureCount: 0,
    }
}

function parseRecentChangelogReleases(markdown, limit = 10) {
    const lines = markdown.split(/\r?\n/)
    const releases = []
    let currentRelease = null
    let currentSection = ''

    for (const line of lines) {
        const releaseMatch = line.match(/^## \[([^\]]+)\] - (.+)$/)
        if (releaseMatch) {
            if (currentRelease) {
                releases.push(currentRelease)
            }

            if (releaseMatch[1] === 'X.Y.Z') {
                currentRelease = null
                currentSection = ''
                continue
            }

            currentRelease = {
                version: releaseMatch[1],
                date: releaseMatch[2],
                sections: [],
            }
            currentSection = ''
            continue
        }

        if (!currentRelease) continue

        const sectionMatch = line.match(/^###\s+(.+)$/)
        if (sectionMatch) {
            currentSection = sectionMatch[1]
            currentRelease.sections.push({
                title: currentSection,
                bullets: [],
            })
            continue
        }

        const bulletMatch = line.match(/^-\s+(.+)$/)
        if (!bulletMatch) continue

        if (!currentSection) {
            currentSection = 'Notes'
            currentRelease.sections.push({
                title: currentSection,
                bullets: [],
            })
        }

        const targetSection = currentRelease.sections[currentRelease.sections.length - 1]
        targetSection.bullets.push(bulletMatch[1])
    }

    if (currentRelease) {
        releases.push(currentRelease)
    }

    return releases.slice(0, limit)
}

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

function getSavedBoolean(keyName) {
    return getSavedValue(keyName) === 'true'
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

function appendRecordingToPreviousAnswersLocalStorage(entry) {
    try {
        const raw = localStorage.getItem(STORAGE_PREVIOUS_ANSWERS_LOCAL) || ''
        const parsed = JSON.parse(raw || '[]')
        const existingEntries = Array.isArray(parsed) ? parsed : []

        const normalizedEntry = {
            id: sanitizeDisplayText(entry?.id, crypto.randomUUID()),
            capturedAt: sanitizeDisplayText(entry?.capturedAt, new Date().toISOString()),
            question: sanitizeDisplayText(entry?.question, '(no question)'),
            transcript: sanitizeDisplayText(entry?.transcript, '(no transcript captured)'),
            metrics:
                entry?.metrics && typeof entry.metrics === 'object'
                    ? entry.metrics
                    : null,
            metricsText: sanitizeDisplayText(entry?.metricsText, ''),
        }

        const nextEntries = [normalizedEntry, ...existingEntries].slice(0, 20)
        localStorage.setItem(STORAGE_PREVIOUS_ANSWERS_LOCAL, JSON.stringify(nextEntries))
    } catch {
        // Ignore local storage persistence issues.
    }
}

function removeRecordingFromPreviousAnswersLocalStorage(answerId) {
    const normalizedId = sanitizeDisplayText(answerId, '')
    if (!normalizedId) return false

    try {
        const raw = localStorage.getItem(STORAGE_PREVIOUS_ANSWERS_LOCAL) || ''
        const parsed = JSON.parse(raw || '[]')
        const existingEntries = Array.isArray(parsed) ? parsed : []

        const nextEntries = existingEntries.filter(
            (entry) => sanitizeDisplayText(entry?.id, '') !== normalizedId,
        )

        if (nextEntries.length === existingEntries.length) {
            return false
        }

        localStorage.setItem(STORAGE_PREVIOUS_ANSWERS_LOCAL, JSON.stringify(nextEntries))
        return true
    } catch {
        return false
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
    ].join('\n')
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

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('Failed to read file.'))
        reader.readAsDataURL(file)
    })
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

function parseQuestionsFromUrlSearch(search) {
    if (!search) return []

    const params = new URLSearchParams(search)
    const candidates = []

    // Preferred format: ?questions=Q1%0AQ2%0AQ3 (newline-separated)
    const packedQuestions = sanitizeDisplayText(params.get('questions'), '')
    if (packedQuestions) {
        candidates.push(
            ...packedQuestions
                .split(/\r?\n|\|\|/)
                .map((item) => sanitizeDisplayText(item, '').trim())
                .filter(Boolean),
        )
    }

    // Alternate format: ?q=Question%201&q=Question%202
    const repeatedQuestions = params.getAll('q')
    for (const question of repeatedQuestions) {
        const normalized = sanitizeDisplayText(question, '').trim()
        if (normalized) candidates.push(normalized)
    }

    const unique = []
    const seen = new Set()
    for (const question of candidates) {
        const key = normalizeQuestionKey(question)
        if (!key || seen.has(key)) continue
        seen.add(key)
        unique.push(question)
    }

    return unique
}

function getImportedQuestionsFromCurrentUrl() {
    if (typeof window === 'undefined') return []
    return parseQuestionsFromUrlSearch(window.location.search)
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

function formatReadableCapturedDate(value) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return sanitizeDisplayText(value, 'unknown-date')
    }

    const month = parsed.toLocaleString('en-US', { month: 'short' })
    const day = parsed.getDate()
    const year = parsed.getFullYear()
    return `${month}/${day}/${year}`
}

function formatMetricDisplayValue(key, value) {
    if (value == null) return 'n/a'

    if (key === 'gazeDeviationDirectionCounts' && typeof value === 'object') {
        const left = Number(value.left) || 0
        const right = Number(value.right) || 0
        const up = Number(value.up) || 0
        const down = Number(value.down) || 0
        return `L ${left} / R ${right} / U ${up} / D ${down}`
    }

    if (Array.isArray(value)) {
        return value.length ? value.join(', ') : 'none'
    }

    if (typeof value === 'object') {
        return JSON.stringify(value)
    }

    return String(value)
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'n/a'
    if (bytes < 1024) return `${bytes} B`

    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }

    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2
    return `${value.toFixed(precision)} ${units[unitIndex]}`
}

async function calculateDirectorySizeBytes(directoryHandle) {
    let totalBytes = 0
    for await (const [, entryHandle] of directoryHandle.entries()) {
        if (entryHandle.kind === 'file') {
            try {
                const file = await entryHandle.getFile()
                totalBytes += file.size
            } catch {
                // Ignore unreadable files when calculating size.
            }
            continue
        }

        if (entryHandle.kind === 'directory') {
            totalBytes += await calculateDirectorySizeBytes(entryHandle)
        }
    }
    return totalBytes
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

function buildAnswerSummaryMarkdown(interviewSummaries, overallInterviewSummary) {
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
        sections.push(`- Captured: ${formatReadableCapturedDate(item.capturedAt)}`)
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

    return sections.join('\n')
}

async function downloadInterviewReportPdf({
    companyName,
    consultantFullName,
    jobTitle,
    feedbackText,
    reportTitle = 'Account Manager Interview Feedback Report',
    feedbackSectionTitle = 'AM Feedback Output',
    fileNamePrefix = 'interview-report',
}) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const margin = 36
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const maxTextWidth = pageWidth - margin * 2
    const defaultLineHeight = 14
    let cursorY = margin

    const PDF_SAFE_REPLACEMENTS = [
        [/\u00A0/g, ' '],
        [/\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200A|\u202F|\u205F|\u3000/g, ' '],
        [/\u2010|\u2011|\u2012|\u2013|\u2014|\u2015|\u2212/g, '-'],
        [/\u2018|\u2019|\u201A|\u201B/g, "'"],
        [/\u201C|\u201D|\u201E|\u201F/g, '"'],
        [/\u2026/g, '...'],
        [/\u2248|\u223C|\u02DC/g, '~'],
        [/\u2264/g, '<='],
        [/\u2265/g, '>='],
        [/\u2260/g, '!='],
        [/\u00B1/g, '+/-'],
        [/\u00D7/g, 'x'],
        [/\u00F7/g, '/'],
        [/\u2022/g, '- '],
    ]

    function normalizePdfTypography(value) {
        let output = String(value || '')
        PDF_SAFE_REPLACEMENTS.forEach(([pattern, replacement]) => {
            output = output.replace(pattern, replacement)
        })

        // jsPDF core Helvetica rendering can garble unsupported Unicode glyphs.
        // Keep printable ASCII plus tabs/newlines to ensure stable output.
        output = output
            .normalize('NFKD')
            .replace(/[\u0300-\u036F]/g, '')
            // Keep degree symbol for angle/temperature metrics while removing other unsupported glyphs.
            .replace(/[^\x09\x0A\x20-\x7E\u00B0]/g, '')
            // Keep unit symbols attached to numeric values (e.g. 4%, 19°).
            .replace(/(\d)\s+([%°])/g, '$1$2')

        return output
    }

    function removeUnsafeControlChars(value) {
        return String(value || '')
            .split('')
            .filter((char) => {
                const code = char.charCodeAt(0)
                // Keep tab/newline; drop other C0 controls and DEL.
                if (code === 9 || code === 10) return true
                if (code <= 31 || code === 127 || (code >= 128 && code <= 159)) return false
                return true
            })
            .join('')
    }

    function sanitizeMarkdownForPdf(value) {
        return removeUnsafeControlChars(normalizePdfTypography(value))
            .normalize('NFKC')
            .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
            .replace(/\r\n?/g, '\n')
    }

    function normalizeRunTextForPdf(value) {
        return removeUnsafeControlChars(normalizePdfTypography(value))
            .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    }

    function ensureRoom(heightNeeded = defaultLineHeight) {
        if (cursorY + heightNeeded <= pageHeight - margin) return
        doc.addPage()
        cursorY = margin
    }

    function writeTextBlock(text, options = {}) {
        const {
            fontSize = 11,
            fontStyle = 'normal',
            indent = 0,
            spacingBefore = 0,
            spacingAfter = 6,
            lineHeight = Math.max(14, Math.round(fontSize * 1.3)),
        } = options

        const normalizedText = String(text || '').trim()
        if (!normalizedText) {
            cursorY += spacingAfter
            return
        }

        cursorY += spacingBefore
        const textWidth = Math.max(40, maxTextWidth - indent)
        const lines = doc.splitTextToSize(normalizedText, textWidth)
        doc.setFont('helvetica', fontStyle)
        doc.setFontSize(fontSize)

        for (const line of lines) {
            ensureRoom(lineHeight)
            doc.text(line, margin + indent, cursorY)
            cursorY += lineHeight
        }

        cursorY += spacingAfter
    }

    function tokenizeInlineRuns(tokens = [], inheritedStyle = {}) {
        const runs = []
        const style = {
            bold: Boolean(inheritedStyle.bold),
            italic: Boolean(inheritedStyle.italic),
            code: Boolean(inheritedStyle.code),
        }

        function appendRun(text, runStyle = style) {
            const value = normalizeRunTextForPdf(text)
            if (!value) return

            const nextRun = {
                text: value,
                style: {
                    bold: Boolean(runStyle.bold),
                    italic: Boolean(runStyle.italic),
                    code: Boolean(runStyle.code),
                },
            }

            const previousRun = runs[runs.length - 1]
            if (
                previousRun &&
                previousRun.style.bold === nextRun.style.bold &&
                previousRun.style.italic === nextRun.style.italic &&
                previousRun.style.code === nextRun.style.code
            ) {
                previousRun.text += nextRun.text
            } else {
                runs.push(nextRun)
            }
        }

        function visit(tokenList, activeStyle = style) {
            tokenList.forEach((token) => {
                if (!token) return

                if (token.type === 'text' || token.type === 'escape') {
                    appendRun(token.text || token.raw || '', activeStyle)
                    return
                }

                if (token.type === 'strong') {
                    visit(token.tokens || [], { ...activeStyle, bold: true })
                    return
                }

                if (token.type === 'em') {
                    visit(token.tokens || [], { ...activeStyle, italic: true })
                    return
                }

                if (token.type === 'codespan') {
                    appendRun(token.text || token.raw || '', { ...activeStyle, code: true })
                    return
                }

                if (token.type === 'link' || token.type === 'del') {
                    visit(token.tokens || [], activeStyle)
                    return
                }

                if (token.type === 'br') {
                    appendRun('\n', activeStyle)
                    return
                }

                if (Array.isArray(token.tokens)) {
                    visit(token.tokens, activeStyle)
                    return
                }

                appendRun(token.text || '', activeStyle)
            })
        }

        visit(tokens, style)
        return runs
    }

    function applyRunFont(runStyle, fontSize) {
        if (runStyle?.code) {
            doc.setFont('courier', 'normal')
            doc.setFontSize(Math.max(10, fontSize - 1))
            return
        }

        let fontStyle = 'normal'
        if (runStyle?.bold && runStyle?.italic) fontStyle = 'bolditalic'
        else if (runStyle?.bold) fontStyle = 'bold'
        else if (runStyle?.italic) fontStyle = 'italic'

        doc.setFont('helvetica', fontStyle)
        doc.setFontSize(fontSize)
    }

    function measureRunText(text, runStyle, fontSize) {
        applyRunFont(runStyle, fontSize)
        return doc.getTextWidth(text)
    }

    function writeRichTextBlock(runs, options = {}) {
        const {
            fontSize = 11,
            indent = 0,
            spacingBefore = 0,
            spacingAfter = 6,
            lineHeight = Math.max(14, Math.round(fontSize * 1.3)),
        } = options

        if (!Array.isArray(runs) || !runs.length) {
            cursorY += spacingAfter
            return
        }

        cursorY += spacingBefore
        const textWidth = Math.max(40, maxTextWidth - indent)

        const explicitLines = []
        let currentExplicitLine = []
        runs.forEach((run) => {
            const parts = String(run.text || '').split('\n')
            parts.forEach((part, index) => {
                if (part) {
                    currentExplicitLine.push({ text: part, style: run.style })
                }
                if (index < parts.length - 1) {
                    explicitLines.push(currentExplicitLine)
                    currentExplicitLine = []
                }
            })
        })
        explicitLines.push(currentExplicitLine)

        function flushStyledLine(styledLine) {
            if (!styledLine.length) return
            ensureRoom(lineHeight)
            let cursorX = margin + indent
            styledLine.forEach((segment) => {
                if (!segment.text) return
                applyRunFont(segment.style, fontSize)
                doc.text(segment.text, cursorX, cursorY)
                cursorX += measureRunText(segment.text, segment.style, fontSize)
            })
            cursorY += lineHeight
        }

        explicitLines.forEach((lineRuns) => {
            const lineSegments = []
            let lineWidth = 0

            function flushLine() {
                flushStyledLine(lineSegments)
                lineSegments.length = 0
                lineWidth = 0
            }

            lineRuns.forEach((run) => {
                const chunks = String(run.text || '').split(/(\s+)/)
                chunks.forEach((chunk) => {
                    if (!chunk) return

                    const isWhitespace = /^\s+$/.test(chunk)
                    if (isWhitespace && !lineSegments.length) return

                    const chunkWidth = measureRunText(chunk, run.style, fontSize)
                    const exceedsLine =
                        !isWhitespace &&
                        lineSegments.length > 0 &&
                        lineWidth + chunkWidth > textWidth

                    if (exceedsLine) {
                        flushLine()
                    }

                    const finalChunk = lineSegments.length === 0 ? chunk.replace(/^\s+/, '') : chunk
                    if (!finalChunk) return

                    const finalWidth = measureRunText(finalChunk, run.style, fontSize)
                    lineSegments.push({ text: finalChunk, style: run.style })
                    lineWidth += finalWidth
                })
            })

            flushLine()
        })

        cursorY += spacingAfter
    }

    function flattenTokenText(token) {
        if (!token) return ''
        if (typeof token.text === 'string') return token.text
        if (typeof token.raw === 'string') return token.raw
        if (Array.isArray(token.tokens)) {
            return token.tokens.map((innerToken) => flattenTokenText(innerToken)).join('')
        }
        return ''
    }

    function extractInlineTextFromCell(cellToken) {
        if (!cellToken) return ''
        const runs = tokenizeInlineRuns(cellToken.tokens || [])
        const fromRuns = runs.map((run) => run.text || '').join('')
        const fallback = fromRuns || cellToken.text || flattenTokenText(cellToken)
        return String(fallback || '').replace(/\s+/g, ' ').trim()
    }

    function drawMarkdownTable(tableToken, indent = 0) {
        const headerCells = Array.isArray(tableToken?.header) ? tableToken.header : []
        const bodyRows = Array.isArray(tableToken?.rows) ? tableToken.rows : []
        const columnCount = Math.max(
            headerCells.length,
            ...bodyRows.map((row) => (Array.isArray(row) ? row.length : 0)),
        )

        if (!columnCount) return

        const tableWidth = Math.max(120, maxTextWidth - indent)
        const colWidth = tableWidth / columnCount
        const cellPaddingX = 5
        const cellPaddingY = 4
        const lineHeight = 12
        const startX = margin + indent

        function toRowTextLines(row, isHeader) {
            const nextRow = []

            for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
                const cellToken = Array.isArray(row) ? row[colIndex] : null
                const rawText = extractInlineTextFromCell(cellToken)
                const safeText = rawText || (isHeader ? `Column ${colIndex + 1}` : '-')

                doc.setFont('helvetica', isHeader ? 'bold' : 'normal')
                doc.setFontSize(10.5)
                const wrapped = doc.splitTextToSize(safeText, Math.max(20, colWidth - cellPaddingX * 2))
                nextRow.push(wrapped.length ? wrapped : [''])
            }

            return nextRow
        }

        function measureRowHeight(rowLines) {
            const tallestCellLines = rowLines.reduce(
                (maxLines, cellLines) => Math.max(maxLines, cellLines.length || 1),
                1,
            )
            return tallestCellLines * lineHeight + cellPaddingY * 2
        }

        function drawRow(rowLines, rowHeight, isHeader) {
            ensureRoom(rowHeight)

            let cellX = startX
            for (let colIndex = 0; colIndex < columnCount; colIndex += 1) {
                const cellLines = rowLines[colIndex] || ['']

                if (isHeader) {
                    doc.setFillColor(241, 245, 249)
                    doc.rect(cellX, cursorY, colWidth, rowHeight, 'F')
                }

                doc.setDrawColor(190)
                doc.rect(cellX, cursorY, colWidth, rowHeight)

                doc.setFont('helvetica', isHeader ? 'bold' : 'normal')
                doc.setFontSize(10.5)
                doc.setTextColor(15, 23, 42)

                let textY = cursorY + cellPaddingY + lineHeight - 2
                cellLines.forEach((line) => {
                    doc.text(String(line), cellX + cellPaddingX, textY)
                    textY += lineHeight
                })

                cellX += colWidth
            }

            cursorY += rowHeight
        }

        const headerLineRows = toRowTextLines(headerCells, true)
        const headerRowHeight = measureRowHeight(headerLineRows)

        ensureRoom(headerRowHeight)
        drawRow(headerLineRows, headerRowHeight, true)

        bodyRows.forEach((row) => {
            const rowLines = toRowTextLines(row, false)
            const rowHeight = measureRowHeight(rowLines)

            // Repeat table header when content continues on a new page.
            if (cursorY + rowHeight > pageHeight - margin) {
                doc.addPage()
                cursorY = margin
                drawRow(headerLineRows, headerRowHeight, true)
            }

            drawRow(rowLines, rowHeight, false)
        })

        cursorY += 8
    }

    const detailedPdfPaginationState = {
        inDetailedSection: false,
        questionHeadingCount: 0,
    }

    function renderTokens(tokens, indent = 0) {
        if (!Array.isArray(tokens)) return

        tokens.forEach((token, index) => {
            if (!token) return

            if (token.type === 'space') {
                cursorY += 4
                return
            }

            if (token.type === 'heading') {
                const headingLevel = Number(token.depth) || 2
                const headingSize = headingLevel <= 1 ? 17 : headingLevel === 2 ? 15 : 13
                const headingText = flattenTokenText(token).replace(/\s+/g, ' ').trim()

                if (headingLevel === 2 && /^Detailed Per-Question Analysis$/i.test(headingText)) {
                    detailedPdfPaginationState.inDetailedSection = true
                    detailedPdfPaginationState.questionHeadingCount = 0
                    if (cursorY > margin) {
                        doc.addPage()
                        cursorY = margin
                    }
                } else if (
                    detailedPdfPaginationState.inDetailedSection &&
                    headingLevel >= 3 &&
                    /^Question\s+\d+\b/i.test(headingText)
                ) {
                    if (detailedPdfPaginationState.questionHeadingCount >= 1) {
                        doc.addPage()
                        cursorY = margin
                    }
                    detailedPdfPaginationState.questionHeadingCount += 1
                }

                const headingRuns = tokenizeInlineRuns(token.tokens || [
                    { type: 'text', text: flattenTokenText(token) },
                ])
                writeRichTextBlock(headingRuns, {
                    fontSize: headingSize,
                    spacingBefore: index === 0 ? 0 : 4,
                    spacingAfter: 6,
                    indent,
                })
                return
            }

            if (token.type === 'paragraph') {
                const paragraphRuns = tokenizeInlineRuns(token.tokens || [
                    { type: 'text', text: flattenTokenText(token) },
                ])
                writeRichTextBlock(paragraphRuns, { indent })
                return
            }

            if (token.type === 'list') {
                token.items?.forEach((item, itemIndex) => {
                    const bulletPrefix = token.ordered ? `${itemIndex + 1}. ` : '• '
                    const itemParagraphToken = Array.isArray(item.tokens)
                        ? item.tokens.find((nestedToken) => nestedToken.type === 'text' || nestedToken.type === 'paragraph')
                        : null
                    const inlineSourceTokens =
                        itemParagraphToken?.tokens ||
                        item.tokens ||
                        [{ type: 'text', text: flattenTokenText(item).trim() }]
                    const itemRuns = tokenizeInlineRuns(inlineSourceTokens)
                    const prefixedRuns = [
                        {
                            text: bulletPrefix,
                            style: { bold: false, italic: false, code: false },
                        },
                        ...itemRuns,
                    ]

                    writeRichTextBlock(prefixedRuns, { indent: indent + 10, spacingAfter: 4 })

                    if (Array.isArray(item.tokens)) {
                        const nestedTokens = item.tokens.filter(
                            (nestedToken) => nestedToken !== itemParagraphToken,
                        )
                        if (nestedTokens.length) {
                            renderTokens(nestedTokens, indent + 20)
                        }
                    }
                })
                cursorY += 2
                return
            }

            if (token.type === 'blockquote') {
                renderTokens(token.tokens || [], indent + 14)
                return
            }

            if (token.type === 'table') {
                drawMarkdownTable(token, indent)
                return
            }

            if (token.type === 'code') {
                writeTextBlock(token.text || '', {
                    fontSize: 10,
                    fontStyle: 'normal',
                    indent: indent + 10,
                    spacingBefore: 2,
                    spacingAfter: 8,
                    lineHeight: 13,
                })
                return
            }

            if (token.type === 'hr') {
                ensureRoom(16)
                doc.setDrawColor(180)
                doc.line(margin + indent, cursorY, pageWidth - margin, cursorY)
                cursorY += 10
                return
            }

            const fallbackText = flattenTokenText(token)
            if (fallbackText.trim()) {
                writeTextBlock(fallbackText, { indent })
            }
        })
    }

    const stamp = new Date().toISOString()
    const safeCompanyName = companyName || 'Unknown company'
    const safeConsultantFullName = consultantFullName || '(not provided)'
    const safeJobTitle = jobTitle || '(not provided)'
    const safeFeedbackMarkdown = sanitizeMarkdownForPdf(
        String(feedbackText || '(no feedback output)').replace(/<[^>]*>/g, ''),
    )

    writeTextBlock(reportTitle, {
        fontSize: 18,
        fontStyle: 'bold',
        spacingAfter: 4,
    })
    writeTextBlock(`Generated: ${stamp}`, {
        fontSize: 10,
        spacingAfter: 2,
    })
    writeTextBlock(`Company: ${safeCompanyName}`, {
        fontSize: 10,
        spacingAfter: 2,
    })
    writeTextBlock(`Consultant Full Name: ${safeConsultantFullName}`, {
        fontSize: 10,
        spacingAfter: 2,
    })
    writeTextBlock(`Job Title: ${safeJobTitle}`, {
        fontSize: 10,
        spacingAfter: 10,
    })

    writeTextBlock(feedbackSectionTitle, {
        fontSize: 14,
        fontStyle: 'bold',
        spacingAfter: 4,
    })
    renderTokens(marked.lexer(safeFeedbackMarkdown), 0)

    const fileDateStamp = stamp.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
    const fileName = `${fileNamePrefix}-${fileDateStamp}.pdf`
    const blob = doc.output('blob')
    return { blob, fileName }
}

function App() {
    const videoRef = useRef(null)
    const overlayRef = useRef(null)
    const cameraStreamRef = useRef(null)
    const audioStreamRef = useRef(null)
    const animationFrameRef = useRef(0)
    const lastVideoTimeRef = useRef(-1)
    const faceLandmarkerRef = useRef(null)
    const uiUpdateAtRef = useRef(0)
    const lastAnalysisAtRef = useRef(0)
    const recorderRef = useRef(null)
    const chunksRef = useRef([])
    const videoRecorderRef = useRef(null)
    const videoChunksRef = useRef([])
    const sessionStartedAtRef = useRef(null)
    const debugEnabledRef = useRef(false)
    const recordingsFolderRef = useRef(null)
    const portraitVideoRef = useRef(false)
    const recordingActiveRef = useRef(false)
    const recordingModeRef = useRef('audio')
    const recordingStartedAtPerfRef = useRef(0)
    const recordingLastFrameAtPerfRef = useRef(0)
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
    const deepgramKeyInputRef = useRef(null)
    const amReportAbortControllerRef = useRef(null)
    const detailedReportAbortControllerRef = useRef(null)

    const blinkTrackerRef = useRef({
        closed: false,
        closedAt: 0,
        prolongedCounted: false,
    })
    const cameraOverlayControlsRef = useRef(null)

    const [settingsOpen, setSettingsOpen] = useState(false)
    const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
    const [confirmFolderSelectOpen, setConfirmFolderSelectOpen] = useState(false)
    const [confirmRegenerateQuestionsOpen, setConfirmRegenerateQuestionsOpen] = useState(false)
    const [confirmCloseSettingsUnsavedLlmOpen, setConfirmCloseSettingsUnsavedLlmOpen] = useState(false)
    const [generateQuestionsCountModalOpen, setGenerateQuestionsCountModalOpen] = useState(false)
    const [generateQuestionsCountInput, setGenerateQuestionsCountInput] = useState(
        String(DEFAULT_GENERATED_QUESTION_COUNT),
    )
    const [pendingGenerateQuestionsOptions, setPendingGenerateQuestionsOptions] = useState(null)
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
    const [isDeepgramKeyInvalid, setIsDeepgramKeyInvalid] = useState(false)
    const [darkMode, setDarkMode] = useState(() => getSavedValue(STORAGE_THEME) === 'dark')
    const [themeTogglePressCount, setThemeTogglePressCount] = useState(0)
    const [fallbackWithoutDeepgramKey, setFallbackWithoutDeepgramKey] = useState(
        () => getSavedValue(STORAGE_FALLBACK_WITHOUT_KEY) !== 'false',
    )
    const [autoAddCompletedAnswersToSummary, setAutoAddCompletedAnswersToSummary] = useState(() => {
        const saved = getSavedValue(STORAGE_AUTO_ADD_SUMMARY)
        return saved ? saved === 'true' : true
    })
    const [autoSaveMediaToFolder, setAutoSaveMediaToFolder] = useState(() => {
        const saved = getSavedValue(STORAGE_AUTO_SAVE_MEDIA_TO_FOLDER)
        return saved ? saved === 'true' : true
    })
    const [deepgramDebugEnabled, setDeepgramDebugEnabled] = useState(() => {
        const saved = getSavedValue(STORAGE_DEEPGRAM_DEBUG)
        return saved === 'true'
    })

    const [cameraStatus, setCameraStatus] = useState('idle')
    const [hasCameraAccess, setHasCameraAccess] = useState(false)
    const [cameraPermissionState, setCameraPermissionState] = useState('unknown')
    const [enableCamera, setEnableCamera] = useState(
        () => getSavedValue(STORAGE_ENABLE_CAMERA) !== 'false',
    )
    const [debugEnabled, setDebugEnabled] = useState(false)
    const [invertCamera, setInvertCamera] = useState(
        () => getSavedValue(STORAGE_INVERT_CAMERA) !== 'false',
    )
    const [showPiP, setShowPiP] = useState(
        () => getSavedValue(STORAGE_SHOW_PIP) !== 'false',
    )
    const [showInterviewer, setShowInterviewer] = useState(() => {
        const savedShowPiP = getSavedValue(STORAGE_SHOW_PIP) !== 'false'
        const savedShowInterviewer = getSavedValue(STORAGE_SHOW_INTERVIEWER) !== 'false'
        return savedShowPiP ? savedShowInterviewer : false
    })
    const [customInterviewerImageDataUrl, setCustomInterviewerImageDataUrl] = useState(
        () => getSavedValue(STORAGE_INTERVIEWER_CUSTOM_IMAGE),
    )
    const [interviewerImageId, setInterviewerImageId] = useState(() => {
        const saved = getSavedValue(STORAGE_INTERVIEWER_IMAGE_ID)
        if (saved === LEGACY_DEFAULT_INTERVIEWER_IMAGE_ID) {
            return DEFAULT_INTERVIEWER_IMAGE_ID
        }
        if (
            saved &&
            saved !== CUSTOM_INTERVIEWER_IMAGE_ID &&
            !DEFAULT_VISIBLE_INTERVIEWER_IMAGES.some((option) => option.id === saved)
        ) {
            return DEFAULT_INTERVIEWER_IMAGE_ID
        }
        if (
            saved === CUSTOM_INTERVIEWER_IMAGE_ID &&
            !getSavedValue(STORAGE_INTERVIEWER_CUSTOM_IMAGE)
        ) {
            return DEFAULT_INTERVIEWER_IMAGE_ID
        }
        return saved || DEFAULT_INTERVIEWER_IMAGE_ID
    })
    const [showSelfView, setShowSelfView] = useState(
        () => getSavedValue(STORAGE_SHOW_SELF_VIEW) !== 'false',
    )
    const [centerCameraLayout] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth > 860 : true,
    )
    const [isPortraitVideo, setIsPortraitVideo] = useState(false)
    const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth > 860 : true,
    )
    const [isSessionPanelMinimized, setIsSessionPanelMinimized] = useState(
        () => getImportedQuestionsFromCurrentUrl().length > 0,
    )
    const [questionsDrawerOpen, setQuestionsDrawerOpen] = useState(false)
    const [summaryModalOpen, setSummaryModalOpen] = useState(false)
    const [cvJdModalOpen, setCvJdModalOpen] = useState(false)
    const [changelogModalOpen, setChangelogModalOpen] = useState(false)
    const [isCameraOverlayMenuOpen, setIsCameraOverlayMenuOpen] = useState(false)
    const [questionsBulkInput, setQuestionsBulkInput] = useState(() =>
        getImportedQuestionsFromCurrentUrl().join('\n'),
    )
    const [activeQuestionListIndex, setActiveQuestionListIndex] = useState(() => {
        const imported = getImportedQuestionsFromCurrentUrl()
        return imported.length ? 0 : null
    })
    const [nextQuestionCursor, setNextQuestionCursor] = useState(0)
    const [answeredQuestionKeys, setAnsweredQuestionKeys] = useState([])
    const [cvText, setCvText] = useState(() => getSavedValue(STORAGE_CV_TEXT))
    const [jdText, setJdText] = useState(() => getSavedValue(STORAGE_JD_TEXT))
    const [companyNameInput, setCompanyNameInput] = useState(() =>
        getSavedValue(STORAGE_COMPANY_NAME),
    )
    const [consultantFullNameInput, setConsultantFullNameInput] = useState(() =>
        getSavedValue(STORAGE_CONSULTANT_FULL_NAME),
    )
    const [jobTitleInput, setJobTitleInput] = useState(() =>
        getSavedValue(STORAGE_JOB_TITLE),
    )

    const [cameraUiMetrics, setCameraUiMetrics] = useState(() => createDefaultCameraUiMetrics())

    const [isRecording, setIsRecording] = useState(false)
    const [isTranscribing, setIsTranscribing] = useState(false)
    const [isSpeakingQuestion, setIsSpeakingQuestion] = useState(false)
    const [isPreparingRecording, setIsPreparingRecording] = useState(false)
    const [readQuestionWithTts, setReadQuestionWithTts] = useState(true)
    const [transcriptionProviderMeta, setTranscriptionProviderMeta] = useState(null)
    const [questionTtsProviderMeta, setQuestionTtsProviderMeta] = useState(null)
    const [questionInput, setQuestionInput] = useState(() => {
        const imported = getImportedQuestionsFromCurrentUrl()
        return imported[0] || ''
    })
    const [transcript, setTranscript] = useState('')
    const [latestInterviewMetrics, setLatestInterviewMetrics] = useState(null)
    const [recordedAudioBlob, setRecordedAudioBlob] = useState(null)
    const [recordedVideoBlob, setRecordedVideoBlob] = useState(null)
    const [recordingsFolderName, setRecordingsFolderName] = useState('')
    const [interviewSummaries, setInterviewSummaries] = useState([])
    const [selectedSummaryId, setSelectedSummaryId] = useState('')
    const {
        facesDetected,
        eyeContactScore,
        gazeDeviationPct,
        gazeDeviationCount,
        gazeDirectionCounts,
        prolongedClosureCount,
    } = cameraUiMetrics

    const [previousAnswers, setPreviousAnswers] = useState([])
    const [isLoadingPreviousAnswers, setIsLoadingPreviousAnswers] = useState(false)
    const [previousAnswersError, setPreviousAnswersError] = useState('')
    const [previousAnswersSource, setPreviousAnswersSource] = useState(() =>
        normalizePreviousAnswersSource(getSavedValue(STORAGE_PREVIOUS_ANSWERS_SOURCE)),
    )
    const [historyModalOpen, setHistoryModalOpen] = useState(false)
    const [selectedPreviousAnswerId, setSelectedPreviousAnswerId] = useState('')
    const [selectedHistoryMedia, setSelectedHistoryMedia] = useState({
        audioUrl: '',
        videoUrl: '',
    })
    const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false)
    const [isGeneratingAmReport, setIsGeneratingAmReport] = useState(false)
    const [isGeneratingDetailedReport, setIsGeneratingDetailedReport] = useState(false)
    const [amReportModalOpen, setAmReportModalOpen] = useState(false)
    const [amReportMarkdownPreview, setAmReportMarkdownPreview] = useState('')
    const [detailedReportModalOpen, setDetailedReportModalOpen] = useState(false)
    const [detailedReportMarkdownPreview, setDetailedReportMarkdownPreview] = useState('')
    const [amReportPdfPreviewOpen, setAmReportPdfPreviewOpen] = useState(false)
    const [amReportPdfPreviewUrl, setAmReportPdfPreviewUrl] = useState('')
    const [amReportPdfBlob, setAmReportPdfBlob] = useState(null)
    const [amReportPdfFileName, setAmReportPdfFileName] = useState('')
    const [detailedReportPdfPreviewOpen, setDetailedReportPdfPreviewOpen] = useState(false)
    const [detailedReportPdfPreviewUrl, setDetailedReportPdfPreviewUrl] = useState('')
    const [detailedReportPdfBlob, setDetailedReportPdfBlob] = useState(null)
    const [detailedReportPdfFileName, setDetailedReportPdfFileName] = useState('')
    const [confirmCloseAmReportPdfOpen, setConfirmCloseAmReportPdfOpen] = useState(false)
    const [confirmCloseDetailedReportPdfOpen, setConfirmCloseDetailedReportPdfOpen] = useState(false)
    const [llmProviderMode, setLlmProviderMode] = useState(() =>
        normalizeLlmProviderMode(getSavedValue(STORAGE_LLM_PROVIDER_MODE)),
    )
    const [openrouterApiKey, setOpenrouterApiKey] = useState(() =>
        getSavedValue(STORAGE_OPENROUTER_API_KEY),
    )
    const [openrouterModel, setOpenrouterModel] = useState(() =>
        getSavedValue(STORAGE_OPENROUTER_MODEL) || LLM_PROVIDER_ENV_CONFIG.openrouter.model,
    )
    const [nimApiKey, setNimApiKey] = useState(() =>
        getSavedValue(STORAGE_NIM_API_KEY),
    )
    const [nimModel, setNimModel] = useState(() =>
        getSavedValue(STORAGE_NIM_MODEL) || LLM_PROVIDER_ENV_CONFIG.nim.model,
    )
    const [nimBaseUrl, setNimBaseUrl] = useState(() =>
        getSavedValue(STORAGE_NIM_BASE_URL) || DEFAULT_NIM_BASE_URL,
    )
    const [openrouterApiKeyInput, setOpenrouterApiKeyInput] = useState(openrouterApiKey)
    const [openrouterModelInput, setOpenrouterModelInput] = useState(openrouterModel)
    const [openrouterCustomModelInput, setOpenrouterCustomModelInput] = useState(() => {
        const normalized = String(openrouterModel || '').trim()
        return OPENROUTER_MODEL_PRESETS.some((preset) => preset.value === normalized)
            ? ''
            : normalized
    })
    const [nimApiKeyInput, setNimApiKeyInput] = useState(nimApiKey)
    const [nimModelInput, setNimModelInput] = useState(nimModel)
    const [nimBaseUrlInput, setNimBaseUrlInput] = useState(nimBaseUrl)
    const [nimCustomModelInput, setNimCustomModelInput] = useState(() => {
        const normalized = String(nimModel || '').trim()
        return NIM_MODEL_PRESETS.some((preset) => preset.value === normalized)
            ? ''
            : normalized
    })
    const [llmProviderModeInput, setLlmProviderModeInput] = useState(llmProviderMode)
    const [llmSettingsError, setLlmSettingsError] = useState('')
    const [isSavingOpenrouterKey, setIsSavingOpenrouterKey] = useState(false)
    const [isSavingNimKey, setIsSavingNimKey] = useState(false)
    const [historyPlaybackRate, setHistoryPlaybackRate] = useState(1)
    const [selectedPreviousAnswerFileSizes, setSelectedPreviousAnswerFileSizes] = useState({
        report: '',
        text: '',
        audio: '',
        video: '',
    })
    const [selectedPreviousAnswerTotalSizeBytes, setSelectedPreviousAnswerTotalSizeBytes] = useState(0)
    const [recycleBinSizeBytes, setRecycleBinSizeBytes] = useState(0)
    const [recordingsFolderSizeBytes, setRecordingsFolderSizeBytes] = useState(0)
    const [isRecycleBinBusy, setIsRecycleBinBusy] = useState(false)
    const historyVideoRef = useRef(null)
    const historyAudioRef = useRef(null)
    const selectedHistoryMediaRef = useRef({ audioUrl: '', videoUrl: '' })
    const interviewerUploadInputRef = useRef(null)

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
    const hasTtsProvider = hasKey || hasSystemTts
    const maskedSummary = hasKey
        ? `Key saved (ends with ${savedKey.slice(-2).padStart(6, '*')})`
        : 'No key saved yet.'
    const hasCustomInterviewerImage = Boolean(customInterviewerImageDataUrl)
    const isInterviewerEasterEggUnlocked = themeTogglePressCount >= 50
    const selectableBuiltInInterviewerImages = useMemo(() => {
        if (isInterviewerEasterEggUnlocked) {
            return BUILT_IN_INTERVIEWER_IMAGES
        }
        return DEFAULT_VISIBLE_INTERVIEWER_IMAGES
    }, [isInterviewerEasterEggUnlocked])
    const activeInterviewerImageSrc = useMemo(() => {
        if (interviewerImageId === CUSTOM_INTERVIEWER_IMAGE_ID && customInterviewerImageDataUrl) {
            return customInterviewerImageDataUrl
        }

        const matchedBuiltIn = BUILT_IN_INTERVIEWER_IMAGES.find(
            (option) => option.id === interviewerImageId,
        )
        return matchedBuiltIn?.src || defaultInterviewerImage
    }, [customInterviewerImageDataUrl, interviewerImageId])

    const openrouterModelOptions = useMemo(
        () => buildModelOptionsWithCurrent(OPENROUTER_MODEL_PRESETS),
        [],
    )

    const nimModelOptions = useMemo(
        () => buildModelOptionsWithCurrent(NIM_MODEL_PRESETS),
        [],
    )

    const openrouterModelSelectValue = useMemo(
        () => getModelSelectValue(openrouterModelInput, OPENROUTER_MODEL_PRESETS),
        [openrouterModelInput],
    )

    const nimModelSelectValue = useMemo(
        () => getModelSelectValue(nimModelInput, NIM_MODEL_PRESETS),
        [nimModelInput],
    )

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
    const recentChangelogEntries = useMemo(
        () => parseRecentChangelogReleases(changelogMarkdown, 10),
        [],
    )
    const shouldWarnOnPageLeave =
        Boolean(questionInput.trim()) ||
        Boolean(questionsBulkInput.trim()) ||
        interviewSummaries.length > 0

    const hasUnsavedLlmSettingsChanges = useMemo(() => {
        const normalizedProviderModeInput = normalizeLlmProviderMode(llmProviderModeInput)
        const normalizedOpenrouterApiKeyInput = openrouterApiKeyInput.trim()
        const normalizedOpenrouterModelInput = openrouterModelInput.trim()
        const normalizedNimApiKeyInput = nimApiKeyInput.trim()
        const normalizedNimModelInput = nimModelInput.trim()
        const normalizedNimBaseUrlInput = nimBaseUrlInput.trim()

        return (
            normalizedProviderModeInput !== llmProviderMode ||
            normalizedOpenrouterApiKeyInput !== openrouterApiKey ||
            normalizedOpenrouterModelInput !== openrouterModel ||
            normalizedNimApiKeyInput !== nimApiKey ||
            normalizedNimModelInput !== nimModel ||
            normalizedNimBaseUrlInput !== nimBaseUrl
        )
    }, [
        llmProviderModeInput,
        openrouterApiKeyInput,
        openrouterModelInput,
        nimApiKeyInput,
        nimModelInput,
        nimBaseUrlInput,
        llmProviderMode,
        openrouterApiKey,
        openrouterModel,
        nimApiKey,
        nimModel,
        nimBaseUrl,
    ])

    useEffect(() => {
        if (!toast) return undefined
        const providerUsageToastPrefixA = 'Generating Questions, LLM API used:'
        const providerUsageToastPrefixB = 'Generating AM Report, LLM API used:'
        const providerUsageToastPrefixC = 'Generating Detailed Report, LLM API used:'
        const timeoutMs =
            toast.startsWith(providerUsageToastPrefixA) ||
                toast.startsWith(providerUsageToastPrefixB) ||
                toast.startsWith(providerUsageToastPrefixC)
                ? 5000
                : toast.startsWith(LLM_HTTP_ERROR_TOAST_PREFIX)
                    ? LLM_HTTP_ERROR_TOAST_TIMEOUT_MS
                    : 3500
        const timerId = window.setTimeout(() => setToast(''), timeoutMs)
        return () => window.clearTimeout(timerId)
    }, [toast])

    useEffect(() => {
        function onBeforeUnload(event) {
            if (!shouldWarnOnPageLeave) return undefined

            event.preventDefault()
            event.returnValue = UNSAVED_QA_WARNING_MESSAGE
            return UNSAVED_QA_WARNING_MESSAGE
        }

        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [shouldWarnOnPageLeave])

    useEffect(() => {
        setSavedValue(
            STORAGE_AUTO_ADD_SUMMARY,
            autoAddCompletedAnswersToSummary ? 'true' : 'false',
        )
    }, [autoAddCompletedAnswersToSummary])

    useEffect(() => {
        setSavedValue(
            STORAGE_AUTO_SAVE_MEDIA_TO_FOLDER,
            autoSaveMediaToFolder ? 'true' : 'false',
        )
    }, [autoSaveMediaToFolder])

    useEffect(() => {
        setSavedValue(
            STORAGE_DEEPGRAM_DEBUG,
            deepgramDebugEnabled ? 'true' : 'false',
        )
    }, [deepgramDebugEnabled])

    useEffect(() => {
        setSavedValue(STORAGE_CV_TEXT, cvText)
    }, [cvText])

    useEffect(() => {
        setSavedValue(STORAGE_JD_TEXT, jdText)
    }, [jdText])

    useEffect(() => {
        setSavedValue(STORAGE_COMPANY_NAME, companyNameInput)
    }, [companyNameInput])

    useEffect(() => {
        setSavedValue(STORAGE_CONSULTANT_FULL_NAME, consultantFullNameInput)
    }, [consultantFullNameInput])

    useEffect(() => {
        setSavedValue(STORAGE_JOB_TITLE, jobTitleInput)
    }, [jobTitleInput])

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
        setSavedValue(STORAGE_INVERT_CAMERA, invertCamera ? 'true' : 'false')
    }, [invertCamera])

    useEffect(() => {
        setSavedValue(STORAGE_SHOW_PIP, showPiP ? 'true' : 'false')
    }, [showPiP])

    useEffect(() => {
        setSavedValue(STORAGE_SHOW_INTERVIEWER, showInterviewer ? 'true' : 'false')
    }, [showInterviewer])

    useEffect(() => {
        setSavedValue(STORAGE_INTERVIEWER_IMAGE_ID, interviewerImageId)
    }, [interviewerImageId])

    useEffect(() => {
        if (customInterviewerImageDataUrl) {
            setSavedValue(STORAGE_INTERVIEWER_CUSTOM_IMAGE, customInterviewerImageDataUrl)
            return
        }
        clearSavedValue(STORAGE_INTERVIEWER_CUSTOM_IMAGE)
    }, [customInterviewerImageDataUrl])

    useEffect(() => {
        setSavedValue(STORAGE_SHOW_SELF_VIEW, showSelfView ? 'true' : 'false')
    }, [showSelfView])

    useEffect(() => {
        setSavedValue(STORAGE_ENABLE_CAMERA, enableCamera ? 'true' : 'false')
    }, [enableCamera])

    useEffect(() => {
        setSavedValue(
            STORAGE_FALLBACK_WITHOUT_KEY,
            fallbackWithoutDeepgramKey ? 'true' : 'false',
        )
    }, [fallbackWithoutDeepgramKey])

    useEffect(() => {
        setSavedValue(STORAGE_PREVIOUS_ANSWERS_SOURCE, previousAnswersSource)
    }, [previousAnswersSource])

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

    const loadPreviousAnswersFromFolder = useCallback(async () => {
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

    const loadPreviousAnswersFromLocalStorage = useCallback(async () => {
        setIsLoadingPreviousAnswers(true)
        setPreviousAnswersError('')

        try {
            const raw = getSavedValue(STORAGE_PREVIOUS_ANSWERS_LOCAL)
            if (!raw.trim()) {
                setPreviousAnswers([])
                return []
            }

            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) {
                setPreviousAnswers([])
                return []
            }

            const normalized = parsed
                .map((entry, index) => {
                    const capturedAt = sanitizeDisplayText(entry?.capturedAt, '')
                    const sortTime = Number.isFinite(new Date(capturedAt).getTime())
                        ? new Date(capturedAt).getTime()
                        : Date.now() - index

                    return {
                        id: sanitizeDisplayText(entry?.id, `local-${sortTime}-${index}`),
                        baseName: '',
                        source: 'local-storage',
                        reportFileName: '',
                        folderPath: '',
                        capturedAt: capturedAt || new Date(sortTime).toISOString(),
                        question: sanitizeDisplayText(entry?.question, '(no question)'),
                        transcript: sanitizeDisplayText(
                            entry?.transcript,
                            '(no transcript captured)',
                        ),
                        metrics:
                            entry?.metrics && typeof entry.metrics === 'object'
                                ? entry.metrics
                                : null,
                        metricsText: sanitizeDisplayText(entry?.metricsText, ''),
                        audioFileName: '',
                        videoFileName: '',
                        textFileName: '',
                        audioHandle: null,
                        videoHandle: null,
                        textHandle: null,
                        reportHandle: null,
                        sortTime,
                    }
                })
                .sort((a, b) => b.sortTime - a.sortTime)
                .slice(0, 100)

            setPreviousAnswers(normalized)
            return normalized
        } catch {
            setPreviousAnswers([])
            setPreviousAnswersError('Could not read previous answers from local storage.')
            return []
        } finally {
            setIsLoadingPreviousAnswers(false)
        }
    }, [])

    const loadPreviousAnswers = useCallback(async () => {
        if (previousAnswersSource === PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE) {
            return loadPreviousAnswersFromLocalStorage()
        }
        return loadPreviousAnswersFromFolder()
    }, [loadPreviousAnswersFromFolder, loadPreviousAnswersFromLocalStorage, previousAnswersSource])

    useEffect(() => {
        if (!isFolderFeatureDisabled) return
        if (previousAnswersSource !== PREVIOUS_ANSWERS_SOURCE_FOLDER) return

        setPreviousAnswersSource(PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE)
        setSelectedPreviousAnswerId('')
        replaceHistoryMediaUrls({ audioUrl: '', videoUrl: '' })
        void loadPreviousAnswersFromLocalStorage()
    }, [
        isFolderFeatureDisabled,
        previousAnswersSource,
        loadPreviousAnswersFromLocalStorage,
        replaceHistoryMediaUrls,
    ])

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

    useEffect(() => {
        let cancelled = false

        async function loadSelectedAnswerFileSizes() {
            if (!selectedPreviousAnswer) {
                if (!cancelled) {
                    setSelectedPreviousAnswerFileSizes({
                        report: '',
                        text: '',
                        audio: '',
                        video: '',
                    })
                    setSelectedPreviousAnswerTotalSizeBytes(0)
                }
                return
            }

            async function getHandleSize(handle) {
                if (!handle) return ''
                try {
                    const file = await handle.getFile()
                    return formatFileSize(file.size)
                } catch {
                    return ''
                }
            }

            const [report, text, audio, video] = await Promise.all([
                getHandleSize(selectedPreviousAnswer.reportHandle),
                getHandleSize(selectedPreviousAnswer.textHandle),
                getHandleSize(selectedPreviousAnswer.audioHandle),
                getHandleSize(selectedPreviousAnswer.videoHandle),
            ])

            if (!cancelled) {
                setSelectedPreviousAnswerFileSizes({ report, text, audio, video })

                // Avoid double-counting when audio and video point to the same file handle.
                const uniqueHandles = []
                for (const handle of [
                    selectedPreviousAnswer.reportHandle,
                    selectedPreviousAnswer.textHandle,
                    selectedPreviousAnswer.audioHandle,
                    selectedPreviousAnswer.videoHandle,
                ]) {
                    if (!handle || uniqueHandles.includes(handle)) continue
                    uniqueHandles.push(handle)
                }

                let totalSizeBytes = 0
                for (const handle of uniqueHandles) {
                    try {
                        const file = await handle.getFile()
                        totalSizeBytes += Number(file.size) || 0
                    } catch {
                        // Ignore unreadable files when calculating size.
                    }
                }
                setSelectedPreviousAnswerTotalSizeBytes(totalSizeBytes)
            }
        }

        void loadSelectedAnswerFileSizes()

        return () => {
            cancelled = true
        }
    }, [selectedPreviousAnswer])

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

    const currentAnswerSummaryFingerprint = useMemo(() => {
        const answerTranscript = transcript?.trim()
        if (!answerTranscript || !latestInterviewMetrics) return ''
        return getSummaryFingerprint({
            question: questionInput.trim() || '(no question)',
            transcript: answerTranscript,
            metrics: latestInterviewMetrics,
        })
    }, [latestInterviewMetrics, questionInput, transcript])

    const isCurrentAnswerAlreadyInSummary = useMemo(() => {
        if (!currentAnswerSummaryFingerprint) return false
        return interviewSummaries.some(
            (item) => getSummaryFingerprint(item) === currentAnswerSummaryFingerprint,
        )
    }, [currentAnswerSummaryFingerprint, interviewSummaries])

    const selectedPreviousAnswerTotalSizeLabel = useMemo(() => {
        if (!selectedPreviousAnswer) return ''
        return selectedPreviousAnswerTotalSizeBytes > 0
            ? formatFileSize(selectedPreviousAnswerTotalSizeBytes)
            : 'n/a'
    }, [selectedPreviousAnswer, selectedPreviousAnswerTotalSizeBytes])
    const amReportPreviewScrollRef = useRef(null)
    const detailedReportPreviewScrollRef = useRef(null)

    const isVideoStartDisabled =
        isTranscribing || isPreparingRecording || cameraStatus !== 'ready'
    const videoStartDisabledReason =
        cameraStatus !== 'ready' ? 'Camera access is not allowed yet' : ''
    const isImportQuestionDisabled =
        isRecording || isTranscribing || isSpeakingQuestion || isPreparingRecording

    const isPreviousAnswersViewDisabled = isLoadingPreviousAnswers
    const previousAnswersViewDisabledReason =
        isLoadingPreviousAnswers
            ? 'Loading previous answers...'
            : ''
    const isSummaryViewDisabled = !interviewSummaries.length
    const summaryViewDisabledReason = isSummaryViewDisabled
        ? 'Record and transcribe at least one answer first.'
        : ''

    function suppressDisabledTooltipPointerDefault(event, isDisabled) {
        if (!isDisabled) return
        event.preventDefault()
    }

    async function handleInterviewerImageUpload(event) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        if (!file.type.startsWith('image/')) {
            setToast('Select a valid image file for the interviewer.')
            return
        }

        try {
            const dataUrl = await fileToDataUrl(file)
            if (!dataUrl) {
                setToast('Could not read this image file.')
                return
            }

            setCustomInterviewerImageDataUrl(dataUrl)
            setInterviewerImageId(CUSTOM_INTERVIEWER_IMAGE_ID)
            setToast('Custom interviewer image uploaded.')
        } catch {
            setToast('Could not read this image file.')
        }
    }

    function clearCustomInterviewerImage() {
        setCustomInterviewerImageDataUrl('')
        setInterviewerImageId(DEFAULT_INTERVIEWER_IMAGE_ID)
        setToast('Custom interviewer image removed.')
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

    const currentQuestionListNumber = useMemo(() => {
        const currentQuestionKey = normalizeQuestionKey(questionInput)
        if (!currentQuestionKey) return 0
        const index = parsedDrawerQuestionKeys.findIndex((key) => key === currentQuestionKey)
        return index >= 0 ? index + 1 : 0
    }, [parsedDrawerQuestionKeys, questionInput])

    const shouldPromptQuestionImport =
        !parsedDrawerQuestions.length

    const hasQuestionsInList = parsedDrawerQuestions.length > 0
    const canPromptGenerateQuestionsFromCvJd = hasCvAndJdContext()

    const showNoNextQuestionTooltip =
        shouldPromptQuestionImport && !isImportQuestionDisabled

    const nextQuestionTitle =
        isImportQuestionDisabled
            ? 'Unavailable while recording/transcribing/question audio/prep is active.'
            : showNoNextQuestionTooltip
                ? undefined
                : `${parsedDrawerQuestions.length} question(s) in question list`

    const shouldShowSessionPanel = false

    const warningPopupMessage = useMemo(() => {
        if (banner) return banner
        if (previousAnswersError) return previousAnswersError
        if (needsRevalidation) {
            return 'Revalidation recommended. Your key was last checked over 30 days ago.'
        }
        if (!hasTtsProvider && readQuestionWithTts) {
            return 'Question TTS uses your system voice and is unavailable in this browser.'
        }
        return ''
    }, [
        banner,
        previousAnswersError,
        needsRevalidation,
        hasTtsProvider,
        readQuestionWithTts,
    ])

    const activePopupMessage = toast || warningPopupMessage

    useEffect(() => {
        if (!amReportModalOpen) return
        const container = amReportPreviewScrollRef.current
        if (!container) return
        container.scrollTop = container.scrollHeight
    }, [amReportMarkdownPreview, amReportModalOpen])

    useEffect(() => {
        if (!detailedReportModalOpen) return
        const container = detailedReportPreviewScrollRef.current
        if (!container) return
        container.scrollTop = container.scrollHeight
    }, [detailedReportMarkdownPreview, detailedReportModalOpen])

    useEffect(() => {
        return () => {
            if (amReportPdfPreviewUrl) {
                URL.revokeObjectURL(amReportPdfPreviewUrl)
            }
        }
    }, [amReportPdfPreviewUrl])

    useEffect(() => {
        return () => {
            if (detailedReportPdfPreviewUrl) {
                URL.revokeObjectURL(detailedReportPdfPreviewUrl)
            }
        }
    }, [detailedReportPdfPreviewUrl])

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

    function openCvJdModal() {
        setCvJdModalOpen(true)
    }

    function closeCvJdModal() {
        setCvJdModalOpen(false)
    }

    function openChangelogModal() {
        setChangelogModalOpen(true)
    }

    function closeChangelogModal() {
        setChangelogModalOpen(false)
    }

    function buildCvJdForGeminiMarkdown() {
        const companyName = companyNameInput.trim()
        const candidateCv = cvText.trim()
        const jobDescription = jdText.trim()

        if (!companyName && !candidateCv && !jobDescription) {
            return null
        }

        const sections = [
            '# CV and JD Context for Gemini',
            '',
            `Generated: ${new Date().toISOString()}`,
            `Company Name: ${companyName || '(not provided)'}`,
            '',
            '## Candidate CV',
            '```text',
            candidateCv || '(not provided)',
            '```',
            '',
            '## Job Description',
            '```text',
            jobDescription || '(not provided)',
            '```',
        ]

        return sections.join('\n')
    }

    async function copyCvJdForGemini() {
        const outputMarkdown = buildCvJdForGeminiMarkdown()
        if (!outputMarkdown) {
            setToast('Add CV, JD, or company name before copying.')
            return
        }

        try {
            await navigator.clipboard.writeText(outputMarkdown)
            setToast('CV, JD, and company name copied for Gemini.')
        } catch {
            setToast('Could not copy CV/JD content.')
        }
    }

    function parseGeneratedQuestions(rawText) {
        const normalizedLines = String(rawText || '')
            .split(/\r?\n/)
            .map((line) =>
                line
                    .trim()
                    .replace(/^[-*•]\s+/, '')
                    .replace(/^\d+\s*[.)-:]\s*/, '')
                    .trim(),
            )
            .filter(Boolean)

        if (normalizedLines.length > 1) {
            return normalizedLines
        }

        const singleLine = normalizedLines[0] || ''
        const splitByQuestionMarks = singleLine
            .split(/\?\s+/)
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => (part.endsWith('?') ? part : `${part}?`))

        return splitByQuestionMarks.length > 1 ? splitByQuestionMarks : normalizedLines
    }

    function getLlmProviderCandidatesForCurrentMode() {
        const providerCandidates = []
        if (llmProviderMode === LLM_PROVIDER_MODE_OPENROUTER_ONLY) {
            if (openrouterApiKey.trim()) {
                providerCandidates.push({
                    providerId: 'openrouter',
                    apiKey: openrouterApiKey,
                    model: openrouterModel,
                    baseUrl: OPENROUTER_BASE_URL,
                })
            }
            return providerCandidates
        }

        if (llmProviderMode === LLM_PROVIDER_MODE_NIM_ONLY) {
            if (nimApiKey.trim()) {
                providerCandidates.push({
                    providerId: 'nim',
                    apiKey: nimApiKey,
                    model: nimModel,
                    baseUrl: nimBaseUrl,
                })
            }
            return providerCandidates
        }

        if (openrouterApiKey.trim()) {
            providerCandidates.push({
                providerId: 'openrouter',
                apiKey: openrouterApiKey,
                model: openrouterModel,
                baseUrl: OPENROUTER_BASE_URL,
            })
        }
        if (nimApiKey.trim()) {
            providerCandidates.push({
                providerId: 'nim',
                apiKey: nimApiKey,
                model: nimModel,
                baseUrl: nimBaseUrl,
            })
        }

        return providerCandidates
    }

    function showLlmProviderMissingKeyToast() {
        if (llmProviderMode === LLM_PROVIDER_MODE_OPENROUTER_ONLY) {
            setToast('OpenRouter API key is required for OpenRouter only mode.')
            return
        }

        if (llmProviderMode === LLM_PROVIDER_MODE_NIM_ONLY) {
            setToast('NVIDIA NIM API key is required for NVIDIA NIM only mode.')
            return
        }

        setToast('Add an OpenRouter or NVIDIA NIM API key in Settings first.')
    }

    function getLlmProviderUsageLabel(providerId) {
        return providerId === 'nim' ? 'NVIDIA NIM' : 'OpenRouter'
    }

    function formatLlmProviderHttpErrorToast(error, providerId) {
        if (error?.code !== 'provider-http-error') return ''

        const statusCode = Number(error?.status)
        if (!Number.isInteger(statusCode) || statusCode <= 0) return ''

        const resolvedProviderId = providerId || error?.providerId
        const providerLabel = getLlmProviderUsageLabel(resolvedProviderId)
        const fallbackMessage = error?.message || 'Request failed.'
        const rawProviderMessage = error?.providerMessage || fallbackMessage
        const message = truncateText(rawProviderMessage, LLM_HTTP_ERROR_MESSAGE_MAX_LENGTH)

        return `${LLM_HTTP_ERROR_TOAST_PREFIX} ${providerLabel} (${statusCode}) ${message}`
    }

    function showLlmProviderHttpErrorToast(error, providerId) {
        const toastMessage = formatLlmProviderHttpErrorToast(error, providerId)
        if (!toastMessage) return false
        setToast(toastMessage)
        return true
    }

    async function generateQuestionsFromCvJd(options = {}) {
        const {
            closeCvJd = false,
            openQuestionsDrawer = true,
            runInBackground = false,
            questionCount = DEFAULT_GENERATED_QUESTION_COUNT,
        } = options
        if (isGeneratingQuestions) return

        const normalizedQuestionCount = Math.max(
            3,
            Math.min(40, Number.parseInt(questionCount, 10) || DEFAULT_GENERATED_QUESTION_COUNT),
        )
        const jdOnlyQuestionCount = Math.floor(0.4 * normalizedQuestionCount)

        const cv = cvText.trim()
        const jobDescription = jdText.trim()
        const companyName = companyNameInput.trim()
        const jobTitle = jobTitleInput.trim()

        if (!cv && !jobDescription && !companyName && !jobTitle) {
            setToast('Add CV, JD, company name, or job title before generating questions.')
            return
        }

        const providerCandidates = getLlmProviderCandidatesForCurrentMode()

        if (!providerCandidates.length) {
            showLlmProviderMissingKeyToast()
            return
        }

        if (!runInBackground) {
            closeSummaryModal()
            closePreviousAnswersModal()
        }
        if (closeCvJd) {
            closeCvJdModal()
        }
        if (openQuestionsDrawer) {
            setQuestionsDrawerOpen(true)
            setQuestionsBulkInput('Generating questions...')
        }
        setActiveQuestionListIndex(null)
        setNextQuestionCursor(0)

        setIsGeneratingQuestions(true)
        try {
            let result = null
            let lastError = null

            for (let index = 0; index < providerCandidates.length; index += 1) {
                const providerConfig = providerCandidates[index]

                if (index > 0 && openQuestionsDrawer) {
                    const retryLabel =
                        providerConfig.providerId === 'nim' ? 'NVIDIA NIM' : 'OpenRouter'
                    setQuestionsBulkInput(`Retrying with ${retryLabel}...`)
                }

                const providerLabel = getLlmProviderUsageLabel(providerConfig.providerId)
                const providerUsageMessage = `Generating Questions, LLM API used: ${providerLabel}`
                console.info(providerUsageMessage)
                setToast(providerUsageMessage)

                try {
                    result = await sendInterviewChatMessage({
                        providerId: providerConfig.providerId,
                        apiKey: providerConfig.apiKey,
                        model: providerConfig.model,
                        baseUrl: providerConfig.baseUrl,
                        userMessage: QUESTION_GENERATION_USER_MESSAGE(
                            normalizedQuestionCount,
                            jdOnlyQuestionCount,
                        ),
                        stream: true,
                        onChunk: (fullText) => {
                            setQuestionsBulkInput(fullText || 'Generating questions...')
                        },
                        context: {
                            question: 'Generate interview questions from profile context.',
                            answer: 'Use the provided CV/JD/company fields only.',
                            generationGuidelines: `${DEFAULT_QUESTION_GENERATION_GUIDELINES} If JD is present, include some JD-only questions that are not CV-derived.`,
                            metricSummary: 'n/a',
                            companyName,
                            jobTitle,
                            cv,
                            jobDescription,
                        },
                    })
                    break
                } catch (error) {
                    showLlmProviderHttpErrorToast(error, providerConfig.providerId)
                    lastError = error
                }
            }

            if (!result) {
                throw lastError || new Error('Could not generate questions.')
            }

            const parsedQuestions = parseGeneratedQuestions(result.text)
            if (!parsedQuestions.length) {
                setToast('No questions were generated. Try again.')
                return
            }

            setQuestionsBulkInput(parsedQuestions.join('\n'))
            setActiveQuestionListIndex(0)
            setNextQuestionCursor(0)
            setQuestionInput(parsedQuestions[0] || '')
            setToast(`Generated ${parsedQuestions.length} question(s).`)
        } catch (error) {
            setQuestionsBulkInput('')
            if (!showLlmProviderHttpErrorToast(error)) {
                setToast(error?.message || 'Could not generate questions.')
            }
        } finally {
            setIsGeneratingQuestions(false)
        }
    }

    async function generateAmFeedbackReport() {
        if (isGeneratingAmReport || isGeneratingDetailedReport) return

        if (!interviewSummaries.length) {
            setToast('Add at least one answer to Answer Summary before generating AM report.')
            return
        }

        const cv = cvText.trim()
        const jobDescription = jdText.trim()
        const companyName = companyNameInput.trim()
        const consultantFullName = consultantFullNameInput.trim()
        const jobTitle = jobTitleInput.trim()
        if (!cv && !jobDescription && !companyName) {
            setToast('Add CV, JD, or company name before generating AM report.')
            return
        }

        const providerCandidates = getLlmProviderCandidatesForCurrentMode()
        if (!providerCandidates.length) {
            showLlmProviderMissingKeyToast()
            return
        }

        const summaryMarkdown = buildAnswerSummaryMarkdown(
            interviewSummaries,
            overallInterviewSummary,
        )

        const metricSummary = [
            `Total answers: ${overallInterviewSummary.totalAnswers}`,
            `Average WPM: ${overallInterviewSummary.averageWpm}`,
            `Average answer length (sec): ${overallInterviewSummary.averageAnswerLengthSec}`,
            `Average hesitations: ${overallInterviewSummary.averageHesitations}`,
            `Average gaze center (%): ${overallInterviewSummary.averageGazeCenterPct}`,
        ].join(', ')

        setIsGeneratingAmReport(true)
        setAmReportModalOpen(true)
        setAmReportMarkdownPreview('Generating AM report...')
        setConfirmCloseAmReportPdfOpen(false)
        setToast('Generating AM feedback report...')

        try {
            let result = null
            let lastError = null
            const controller = new AbortController()
            amReportAbortControllerRef.current = controller

            for (let index = 0; index < providerCandidates.length; index += 1) {
                const providerConfig = providerCandidates[index]
                setAmReportMarkdownPreview('')

                if (controller.signal.aborted) {
                    const abortError = new Error('AM report generation canceled.')
                    abortError.code = 'request-aborted'
                    throw abortError
                }

                const providerLabel = getLlmProviderUsageLabel(providerConfig.providerId)
                const providerUsageMessage = `Generating AM Report, LLM API used: ${providerLabel}`
                console.info(providerUsageMessage)
                setToast(providerUsageMessage)

                try {
                    result = await sendInterviewChatMessage({
                        providerId: providerConfig.providerId,
                        apiKey: providerConfig.apiKey,
                        model: providerConfig.model,
                        baseUrl: providerConfig.baseUrl,
                        userMessage: AM_REPORT_USER_MESSAGE,
                        context: {
                            question: 'Generate concise mock interview feedback and summary for the consultant at consulting firm. Do not include per question feedback.',
                            answer: summaryMarkdown,
                            generationGuidelines: DEFAULT_AM_REPORT_GENERATION_GUIDELINES,
                            metricSummary,
                            companyName,
                            consultantFullName,
                            jobTitle,
                            jobDescription,
                            cv
                        },
                        stream: true,
                        onChunk: (fullText) => {
                            setAmReportMarkdownPreview(fullText || '')
                        },
                        signal: controller.signal,
                    })
                    break
                } catch (error) {
                    if (error?.code === 'request-aborted') {
                        throw error
                    }
                    showLlmProviderHttpErrorToast(error, providerConfig.providerId)
                    lastError = error
                }
            }

            if (!result?.text) {
                throw lastError || new Error('Could not generate AM report.')
            }

            const pdfDocument = await downloadInterviewReportPdf({
                companyName,
                consultantFullName,
                jobTitle,
                feedbackText: result.text,
                reportTitle: 'Account Manager Interview Feedback Report',
                feedbackSectionTitle: 'AM Feedback Output',
                fileNamePrefix: 'am-feedback-report',
            })

            if (!pdfDocument?.blob) {
                throw new Error('Could not prepare AM feedback PDF.')
            }

            const previewUrl = URL.createObjectURL(pdfDocument.blob)
            setAmReportPdfPreviewUrl(previewUrl)
            setAmReportPdfBlob(pdfDocument.blob)
            setAmReportPdfFileName(pdfDocument.fileName || 'am-feedback-report.pdf')
            setAmReportPdfPreviewOpen(true)
            setAmReportModalOpen(false)
            setToast('AM feedback PDF ready. Review or download.')
        } catch (error) {
            setAmReportModalOpen(false)
            if (error?.code === 'request-aborted') {
                setToast('AM report generation canceled.')
            } else {
                if (!showLlmProviderHttpErrorToast(error)) {
                    setToast(error?.message || 'Could not generate AM report.')
                }
            }
        } finally {
            amReportAbortControllerRef.current = null
            setIsGeneratingAmReport(false)
        }
    }

    async function generateDetailedInterviewReport() {
        if (isGeneratingDetailedReport || isGeneratingAmReport) return

        if (!interviewSummaries.length) {
            setToast('Add at least one answer to Answer Summary before generating a detailed report.')
            return
        }

        const cv = cvText.trim()
        const jobDescription = jdText.trim()
        const companyName = companyNameInput.trim()
        const consultantFullName = consultantFullNameInput.trim()
        const jobTitle = jobTitleInput.trim()
        if (!cv && !jobDescription && !companyName) {
            setToast('Add CV, JD, or company name before generating a detailed report.')
            return
        }

        const providerCandidates = getLlmProviderCandidatesForCurrentMode()
        if (!providerCandidates.length) {
            showLlmProviderMissingKeyToast()
            return
        }

        const summaryMarkdown = buildAnswerSummaryMarkdown(
            interviewSummaries,
            overallInterviewSummary,
        )

        const metricSummary = [
            `Total answers: ${overallInterviewSummary.totalAnswers}`,
            `Average WPM: ${overallInterviewSummary.averageWpm}`,
            `Average answer length (sec): ${overallInterviewSummary.averageAnswerLengthSec}`,
            `Average hesitations: ${overallInterviewSummary.averageHesitations}`,
            `Average gaze center (%): ${overallInterviewSummary.averageGazeCenterPct}`,
        ].join(', ')

        setIsGeneratingDetailedReport(true)
        setDetailedReportModalOpen(true)
        setDetailedReportMarkdownPreview('Generating detailed report...')
        setConfirmCloseDetailedReportPdfOpen(false)
        setToast('Generating detailed interview report...')

        try {
            let result = null
            let lastError = null
            const controller = new AbortController()
            detailedReportAbortControllerRef.current = controller

            for (let index = 0; index < providerCandidates.length; index += 1) {
                const providerConfig = providerCandidates[index]
                setDetailedReportMarkdownPreview('')

                if (controller.signal.aborted) {
                    const abortError = new Error('Detailed report generation canceled.')
                    abortError.code = 'request-aborted'
                    throw abortError
                }

                const providerLabel = getLlmProviderUsageLabel(providerConfig.providerId)
                const providerUsageMessage = `Generating Detailed Report, LLM API used: ${providerLabel}`
                console.info(providerUsageMessage)
                setToast(providerUsageMessage)

                try {
                    result = await sendInterviewChatMessage({
                        providerId: providerConfig.providerId,
                        apiKey: providerConfig.apiKey,
                        model: providerConfig.model,
                        baseUrl: providerConfig.baseUrl,
                        userMessage: DETAILED_REPORT_USER_MESSAGE,
                        context: {
                            question: 'Generate a detailed mock interview report with both overall summary and per-question analysis.',
                            answer: summaryMarkdown,
                            generationGuidelines: DEFAULT_DETAILED_REPORT_GENERATION_GUIDELINES,
                            metricSummary,
                            companyName,
                            consultantFullName,
                            jobTitle,
                            jobDescription,
                            cv,
                        },
                        stream: true,
                        onChunk: (fullText) => {
                            setDetailedReportMarkdownPreview(fullText || '')
                        },
                        signal: controller.signal,
                    })
                    break
                } catch (error) {
                    if (error?.code === 'request-aborted') {
                        throw error
                    }
                    showLlmProviderHttpErrorToast(error, providerConfig.providerId)
                    lastError = error
                }
            }

            if (!result?.text) {
                throw lastError || new Error('Could not generate detailed report.')
            }

            const pdfDocument = await downloadInterviewReportPdf({
                companyName,
                consultantFullName,
                jobTitle,
                feedbackText: result.text,
                reportTitle: 'Detailed Interview Report',
                feedbackSectionTitle: 'Detailed Feedback Output',
                fileNamePrefix: 'detailed-interview-report',
            })

            if (!pdfDocument?.blob) {
                throw new Error('Could not prepare detailed report PDF.')
            }

            const previewUrl = URL.createObjectURL(pdfDocument.blob)
            setDetailedReportPdfPreviewUrl(previewUrl)
            setDetailedReportPdfBlob(pdfDocument.blob)
            setDetailedReportPdfFileName(pdfDocument.fileName || 'detailed-interview-report.pdf')
            setDetailedReportPdfPreviewOpen(true)
            setDetailedReportModalOpen(false)
            setToast('Detailed report PDF ready. Review or download.')
        } catch (error) {
            setDetailedReportModalOpen(false)
            if (error?.code === 'request-aborted') {
                setToast('Detailed report generation canceled.')
            } else {
                if (!showLlmProviderHttpErrorToast(error)) {
                    setToast(error?.message || 'Could not generate detailed report.')
                }
            }
        } finally {
            detailedReportAbortControllerRef.current = null
            setIsGeneratingDetailedReport(false)
        }
    }

    function cancelAmReportGeneration() {
        const controller = amReportAbortControllerRef.current
        if (controller) {
            controller.abort()
        }
    }

    function cancelDetailedReportGeneration() {
        const controller = detailedReportAbortControllerRef.current
        if (controller) {
            controller.abort()
        }
    }

    function downloadCurrentAmReportPdf() {
        if (!amReportPdfBlob) {
            setToast('No AM feedback PDF is available to download.')
            return
        }

        downloadBlob(amReportPdfBlob, amReportPdfFileName || 'am-feedback-report.pdf')
        setToast('AM feedback PDF downloaded.')
    }

    function downloadCurrentDetailedReportPdf() {
        if (!detailedReportPdfBlob) {
            setToast('No detailed report PDF is available to download.')
            return
        }

        downloadBlob(detailedReportPdfBlob, detailedReportPdfFileName || 'detailed-interview-report.pdf')
        setToast('Detailed report PDF downloaded.')
    }

    function requestCloseAmReportPdfPreview() {
        setConfirmCloseAmReportPdfOpen(true)
    }

    function requestCloseDetailedReportPdfPreview() {
        setConfirmCloseDetailedReportPdfOpen(true)
    }

    function closeAmReportPdfPreviewConfirmed() {
        setConfirmCloseAmReportPdfOpen(false)
        setAmReportPdfPreviewOpen(false)
        setAmReportPdfBlob(null)
        setAmReportPdfFileName('')
        setAmReportPdfPreviewUrl('')
    }

    function closeDetailedReportPdfPreviewConfirmed() {
        setConfirmCloseDetailedReportPdfOpen(false)
        setDetailedReportPdfPreviewOpen(false)
        setDetailedReportPdfBlob(null)
        setDetailedReportPdfFileName('')
        setDetailedReportPdfPreviewUrl('')
    }

    function importQuestion(questionText, options = {}) {
        const { closePanel = true, questionIndex = null } = options
        const nextQuestion = questionText.trim()
        if (!nextQuestion) return

        setQuestionInput(nextQuestion)
        setActiveQuestionListIndex(Number.isInteger(questionIndex) ? questionIndex : null)
        setBanner('')
        if (closePanel) {
            setQuestionsDrawerOpen(false)
        }
    }

    function parseQuestionsFromBulkInput(rawBulkInput) {
        return rawBulkInput
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
    }

    function hasCvAndJdContext() {
        return Boolean(cvText.trim()) && Boolean(jdText.trim())
    }

    function openGenerateQuestionsCountModal(options = {}) {
        if (isGeneratingQuestions) return
        setPendingGenerateQuestionsOptions(options)
        setGenerateQuestionsCountInput(String(DEFAULT_GENERATED_QUESTION_COUNT))
        setGenerateQuestionsCountModalOpen(true)
    }

    function confirmGenerateQuestionsCountSelection() {
        const parsedCount = Number.parseInt(generateQuestionsCountInput, 10)
        if (!Number.isInteger(parsedCount) || parsedCount < 3 || parsedCount > 40) {
            setToast('Enter a question count between 3 and 40.')
            return
        }

        const options = pendingGenerateQuestionsOptions || {}
        setGenerateQuestionsCountModalOpen(false)
        setPendingGenerateQuestionsOptions(null)
        void generateQuestionsFromCvJd({
            ...options,
            questionCount: parsedCount,
        })
    }

    function closeGenerateQuestionsCountModal() {
        setGenerateQuestionsCountModalOpen(false)
        setPendingGenerateQuestionsOptions(null)
    }

    function generateQuestionsInBackground() {
        if (isGeneratingQuestions) return
        setToast('Generating questions in background...')
        openGenerateQuestionsCountModal({
            openQuestionsDrawer: false,
            runInBackground: true,
        })
    }

    function handleQuestionsBulkInputChange(rawBulkInput) {
        setQuestionsBulkInput(rawBulkInput)

        if (activeQuestionListIndex == null) return

        const parsed = parseQuestionsFromBulkInput(rawBulkInput)
        const updatedCurrentQuestion = parsed[activeQuestionListIndex]

        if (!updatedCurrentQuestion) {
            setActiveQuestionListIndex(null)
            return
        }

        if (questionInput !== updatedCurrentQuestion) {
            setQuestionInput(updatedCurrentQuestion)
        }
    }

    function removeParsedQuestionAt(index) {
        setPendingDeleteAction({ kind: 'parsed-question', index })
    }

    function clearQuestionsList() {
        if (!parsedDrawerQuestions.length) return
        setQuestionsBulkInput('')
        setActiveQuestionListIndex(null)
        setNextQuestionCursor(0)
        setToast('Questions list cleared.')
    }

    function requestGenerateQuestionsFromQuestionsModal() {
        if (isGeneratingQuestions) return

        if (parsedDrawerQuestions.length) {
            setConfirmRegenerateQuestionsOpen(true)
            return
        }

        openGenerateQuestionsCountModal()
    }

    function confirmRegenerateQuestions() {
        setConfirmRegenerateQuestionsOpen(false)
        openGenerateQuestionsCountModal()
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

        setActiveQuestionListIndex((prev) => {
            if (prev == null) return null
            if (prev === index) return null
            if (prev > index) return prev - 1
            return prev
        })

        setNextQuestionCursor(0)

        setToast('Question removed from import list.')
    }

    function handleNextQuestionAction() {
        if (isImportQuestionDisabled) return

        if (!parsedDrawerQuestions.length) {
            closeSummaryModal()
            setQuestionsDrawerOpen(true)
            return
        }

        const currentIndexFromInput = parsedDrawerQuestionKeys.findIndex(
            (questionKey) => questionKey === normalizeQuestionKey(questionInput),
        )
        const currentIndex =
            activeQuestionListIndex != null
                ? activeQuestionListIndex
                : currentIndexFromInput

        const nextIndex =
            currentIndex >= 0
                ? (currentIndex + 1) % parsedDrawerQuestions.length
                : nextQuestionCursor % parsedDrawerQuestions.length
        const nextQuestion = parsedDrawerQuestions[nextIndex]
        if (!nextQuestion) return

        importQuestion(nextQuestion, {
            closePanel: false,
            questionIndex: nextIndex,
        })

        setNextQuestionCursor(() =>
            parsedDrawerQuestions.length
                ? (nextIndex + 1) % parsedDrawerQuestions.length
                : 0,
        )
    }

    function handlePreviousQuestionAction() {
        if (isImportQuestionDisabled) return

        if (!parsedDrawerQuestions.length) {
            closeSummaryModal()
            setQuestionsDrawerOpen(true)
            return
        }

        const currentIndexFromInput = parsedDrawerQuestionKeys.findIndex(
            (questionKey) => questionKey === normalizeQuestionKey(questionInput),
        )
        const currentIndex =
            activeQuestionListIndex != null
                ? activeQuestionListIndex
                : currentIndexFromInput

        const previousIndex =
            currentIndex >= 0
                ? (currentIndex - 1 + parsedDrawerQuestions.length) % parsedDrawerQuestions.length
                : (parsedDrawerQuestions.length - 1 + nextQuestionCursor) % parsedDrawerQuestions.length
        const previousQuestion = parsedDrawerQuestions[previousIndex]
        if (!previousQuestion) return

        importQuestion(previousQuestion, {
            closePanel: false,
            questionIndex: previousIndex,
        })

        setNextQuestionCursor(() =>
            parsedDrawerQuestions.length
                ? (previousIndex + 1) % parsedDrawerQuestions.length
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
            if (cvJdModalOpen) {
                closeCvJdModal()
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
            if (confirmRegenerateQuestionsOpen) {
                setConfirmRegenerateQuestionsOpen(false)
                return
            }
            if (confirmCloseSettingsUnsavedLlmOpen) {
                setConfirmCloseSettingsUnsavedLlmOpen(false)
                return
            }
            if (generateQuestionsCountModalOpen) {
                closeGenerateQuestionsCountModal()
                return
            }
            if (pendingDeleteAction) {
                setPendingDeleteAction(null)
                return
            }
            if (settingsOpen) {
                closeSettings()
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
        confirmRegenerateQuestionsOpen,
        confirmCloseSettingsUnsavedLlmOpen,
        generateQuestionsCountModalOpen,
        closeGenerateQuestionsCountModal,
        pendingDeleteAction,
        settingsOpen,
        closeSettings,
        historyModalOpen,
        closePreviousAnswersModal,
        questionsDrawerOpen,
        summaryModalOpen,
        cvJdModalOpen,
    ])

    useEffect(() => {
        return () => {
            stopAnalysisLoop()
            stopCameraStream()
            stopAudioStream()
            videoRecorderRef.current = null
            videoChunksRef.current = []
            faceLandmarkerRef.current?.close()
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        let permissionStatus = null

        async function watchCameraPermission() {
            try {
                if (typeof navigator === 'undefined') return
                if (!navigator.permissions?.query) return

                permissionStatus = await navigator.permissions.query({ name: 'camera' })
                if (cancelled) return

                setCameraPermissionState(permissionStatus.state)
                if (permissionStatus.state === 'granted') {
                    setHasCameraAccess(true)
                }

                permissionStatus.onchange = () => {
                    const nextState = permissionStatus.state
                    setCameraPermissionState(nextState)
                    if (nextState === 'granted') {
                        setHasCameraAccess(true)
                    }
                }
            } catch {
                // Some browsers do not expose camera permission state.
            }
        }

        void watchCameraPermission()

        return () => {
            cancelled = true
            if (permissionStatus) {
                permissionStatus.onchange = null
            }
        }
    }, [])

    useEffect(() => {
        if (!enableCamera) return
        if (cameraPermissionState !== 'granted') return
        if (cameraStatus !== 'idle') return
        void startCamera()
        // startCamera is a hoisted function; dependencies above gate repeated calls safely.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enableCamera, cameraPermissionState, cameraStatus])

    function stopAnalysisLoop() {
        if (animationFrameRef.current) {
            window.cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = 0
        }
        lastAnalysisAtRef.current = 0
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

    async function attachCameraStreamToPreview() {
        const stream = cameraStreamRef.current
        const video = videoRef.current
        if (!stream || !video) return false

        if (video.srcObject !== stream) {
            video.srcObject = stream
        }

        await video.play()
        return true
    }

    async function ensureLandmarkers() {
        if (faceLandmarkerRef.current) {
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
    }

    function resetBehaviorCounters() {
        blinkTrackerRef.current = {
            closed: false,
            closedAt: 0,
            prolongedCounted: false,
        }

        setCameraUiMetrics((prev) => ({
            ...prev,
            prolongedClosureCount: 0,
        }))
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
        setCameraUiMetrics((prev) => ({
            ...prev,
            gazeDeviationCount: 0,
            gazeDirectionCounts: { ...EMPTY_GAZE_DIRECTION_COUNTS },
        }))
        prolongedClosureTotalMsRef.current = 0
        prolongedClosureTimestampsSecRef.current = []
    }

    function resetStatisticsAndRecalibrate() {
        resetInterviewTracking()
        resetBehaviorCounters()
        setCameraUiMetrics((prev) => ({
            ...prev,
            facesDetected: 0,
            eyeContactScore: null,
            gazeDeviationPct: null,
            gazeDeviationCount: 0,
            gazeDirectionCounts: { ...EMPTY_GAZE_DIRECTION_COUNTS },
        }))
        setToast('Statistics reset.')
    }

    const runAnalysisLoop = useCallback(() => {
        const video = videoRef.current
        const faceLandmarker = faceLandmarkerRef.current

        if (!video || !faceLandmarker) return

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
                const nowMs = performance.now()
                if (nowMs - lastAnalysisAtRef.current < ANALYSIS_DETECT_INTERVAL_MS) {
                    animationFrameRef.current = window.requestAnimationFrame(tick)
                    return
                }

                lastAnalysisAtRef.current = nowMs
                lastVideoTimeRef.current = frameVideo.currentTime

                const faceResult = faceLandmarker.detectForVideo(frameVideo, nowMs)

                if (ctx) {
                    ctx.clearRect(0, 0, width, height)
                }

                const faceLandmarks = faceResult?.faceLandmarks || []

                if (debugEnabledRef.current && ctx) {
                    for (const landmarkSet of faceLandmarks) {
                        drawLandmarkSet(ctx, landmarkSet, width, height, '#22a7a6')
                        drawFaceBoundingBox(ctx, landmarkSet, width, height, '#b9f3f2')
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
                            setCameraUiMetrics((prev) => ({
                                ...prev,
                                prolongedClosureCount: prev.prolongedClosureCount + 1,
                            }))
                        }
                    }
                }

                if (nowMs - uiUpdateAtRef.current > 150) {
                    uiUpdateAtRef.current = nowMs
                    setCameraUiMetrics((prev) => ({
                        ...prev,
                        facesDetected: faceLandmarks.length,
                        eyeContactScore: eyeContact,
                        gazeDeviationPct: gazeDeviation,
                        gazeDeviationCount: gazeDeviationCountRef.current,
                        gazeDirectionCounts: { ...gazeDirectionCountsRef.current },
                    }))
                }
            }

            animationFrameRef.current = window.requestAnimationFrame(tick)
        }

        stopAnalysisLoop()
        animationFrameRef.current = window.requestAnimationFrame(tick)
    }, [])

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

            const hasPreview = await attachCameraStreamToPreview()

            await ensureLandmarkers()
            resetBehaviorCounters()
            if (hasPreview) {
                runAnalysisLoop()
            } else {
                stopAnalysisLoop()
            }
            setHasCameraAccess(true)
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
        setCameraUiMetrics((prev) => ({
            ...prev,
            facesDetected: 0,
            eyeContactScore: null,
            gazeDeviationPct: null,
        }))
        resetBehaviorCounters()

        const canvas = overlayRef.current
        if (canvas) {
            const ctx = canvas.getContext('2d')
            ctx?.clearRect(0, 0, canvas.width, canvas.height)
        }
    }

    useEffect(() => {
        if (!showSelfView) return
        if (!enableCamera) return
        if (cameraStatus !== 'ready') return

        let cancelled = false

        async function reattachPreviewIfNeeded() {
            try {
                const attached = await attachCameraStreamToPreview()
                if (cancelled || !attached) return
                runAnalysisLoop()
            } catch {
                // If preview playback fails, keep current camera state and wait for user interaction.
            }
        }

        void reattachPreviewIfNeeded()

        return () => {
            cancelled = true
        }
    }, [showSelfView, enableCamera, cameraStatus, runAnalysisLoop])

    function openSettings() {
        setSettingsOpen(true)
        setKeyInput(savedKey)
        setFieldError('')
        setLlmProviderModeInput(llmProviderMode)
        setOpenrouterApiKeyInput(openrouterApiKey)
        setOpenrouterModelInput(openrouterModel)
        setOpenrouterCustomModelInput(
            OPENROUTER_MODEL_PRESETS.some((preset) => preset.value === openrouterModel)
                ? ''
                : openrouterModel,
        )
        setNimApiKeyInput(nimApiKey)
        setNimModelInput(nimModel)
        setNimBaseUrlInput(nimBaseUrl)
        setNimCustomModelInput(
            NIM_MODEL_PRESETS.some((preset) => preset.value === nimModel)
                ? ''
                : nimModel,
        )
        setLlmSettingsError('')
    }

    function openSettingsAndFocusDeepgramInput() {
        openSettings()
        window.requestAnimationFrame(() => {
            deepgramKeyInputRef.current?.focus()
            deepgramKeyInputRef.current?.select()
        })
    }

    function closeSettings() {
        if (hasUnsavedLlmSettingsChanges) {
            setConfirmCloseSettingsUnsavedLlmOpen(true)
            return
        }

        setSettingsOpen(false)
        setFieldError('')
        setShowKey(false)
        setLlmSettingsError('')
    }

    function closeSettingsConfirmed() {
        setSettingsOpen(false)
        setConfirmCloseSettingsUnsavedLlmOpen(false)
        setFieldError('')
        setShowKey(false)
        setLlmSettingsError('')
    }

    function saveLlmSettings() {
        const normalizedProviderMode = normalizeLlmProviderMode(llmProviderModeInput)
        const trimmedOpenrouterModel = openrouterModelInput.trim()
        const trimmedNimModel = nimModelInput.trim()
        const trimmedNimBaseUrl = nimBaseUrlInput.trim()
        const trimmedOpenrouterKey = openrouterApiKeyInput.trim()
        const trimmedNimKey = nimApiKeyInput.trim()

        if (!trimmedOpenrouterModel || !trimmedNimModel) {
            setLlmSettingsError('Model is required. Select a model or enter a custom model name.')
            return false
        }

        if (!trimmedNimBaseUrl) {
            setLlmSettingsError('NVIDIA NIM Base URL is required.')
            return false
        }

        const nimBaseUrlValidationError = validateLlmProviderApiBaseUrl(trimmedNimBaseUrl)
        if (nimBaseUrlValidationError) {
            setLlmSettingsError(nimBaseUrlValidationError)
            return false
        }

        setLlmProviderMode(normalizedProviderMode)
        setOpenrouterApiKey(trimmedOpenrouterKey)
        setOpenrouterModel(trimmedOpenrouterModel)
        setNimApiKey(trimmedNimKey)
        setNimModel(trimmedNimModel)
        setNimBaseUrl(trimmedNimBaseUrl)
        setLlmSettingsError('')

        clearSavedValue('mia.llm.persistKeys')
        setSavedValue(STORAGE_LLM_PROVIDER_MODE, normalizedProviderMode)
        setSavedValue(STORAGE_OPENROUTER_MODEL, trimmedOpenrouterModel)
        setSavedValue(STORAGE_NIM_MODEL, trimmedNimModel)
        setSavedValue(STORAGE_NIM_BASE_URL, trimmedNimBaseUrl)

        setSavedValue(STORAGE_OPENROUTER_API_KEY, trimmedOpenrouterKey)
        setSavedValue(STORAGE_NIM_API_KEY, trimmedNimKey)

        setToast('LLM settings saved.')
        return true
    }

    function saveLlmSettingsAndCloseSettings() {
        const didSave = saveLlmSettings()
        if (!didSave) return
        closeSettingsConfirmed()
    }

    function discardUnsavedLlmSettingsAndClose() {
        closeSettingsConfirmed()
    }

    function saveOpenrouterKeyOnly() {
        const trimmedOpenrouterKey = openrouterApiKeyInput.trim()
        if (!trimmedOpenrouterKey) {
            setToast('OpenRouter API key is required.')
            return
        }

        setIsSavingOpenrouterKey(true)
        setOpenrouterApiKey(trimmedOpenrouterKey)
        setSavedValue(STORAGE_OPENROUTER_API_KEY, trimmedOpenrouterKey)

        void validateLlmProviderApiKey({
            providerId: 'openrouter',
            apiKey: trimmedOpenrouterKey,
            baseUrl: OPENROUTER_BASE_URL,
        })
            .then(() => {
                setToast('OpenRouter API key saved and validated.')
            })
            .catch((error) => {
                if (!showLlmProviderHttpErrorToast(error, 'openrouter')) {
                    setToast(`OpenRouter API key saved, but validation failed: ${error?.message || 'Unknown error.'}`)
                }
            })
            .finally(() => {
                setIsSavingOpenrouterKey(false)
            })
    }

    function saveNimKeyOnly() {
        const trimmedNimKey = nimApiKeyInput.trim()
        const trimmedNimBaseUrl = nimBaseUrlInput.trim()
        if (!trimmedNimKey) {
            setToast('NVIDIA NIM API key is required.')
            return
        }

        const nimBaseUrlValidationError = validateLlmProviderApiBaseUrl(trimmedNimBaseUrl)
        if (nimBaseUrlValidationError) {
            setToast(nimBaseUrlValidationError)
            return
        }

        setIsSavingNimKey(true)
        setNimApiKey(trimmedNimKey)
        setSavedValue(STORAGE_NIM_API_KEY, trimmedNimKey)

        void validateLlmProviderApiKey({
            providerId: 'nim',
            apiKey: trimmedNimKey,
            baseUrl: trimmedNimBaseUrl,
        })
            .then(() => {
                setToast('NVIDIA NIM API key saved and validated.')
            })
            .catch((error) => {
                if (!showLlmProviderHttpErrorToast(error, 'nim')) {
                    setToast(`NVIDIA NIM API key saved, but validation failed: ${error?.message || 'Unknown error.'}`)
                }
            })
            .finally(() => {
                setIsSavingNimKey(false)
            })
    }

    function handleOpenrouterModelSelection(nextValue) {
        if (nextValue === CUSTOM_MODEL_OPTION_VALUE) {
            setOpenrouterModelInput(openrouterCustomModelInput.trim())
            return
        }

        setOpenrouterModelInput(nextValue)
    }

    function handleNimModelSelection(nextValue) {
        if (nextValue === CUSTOM_MODEL_OPTION_VALUE) {
            setNimModelInput(nimCustomModelInput.trim())
            return
        }

        setNimModelInput(nextValue)
    }

    function resetLlmSettingsToDefaults() {
        const defaultProviderMode = LLM_PROVIDER_MODE_AUTO
        const defaultOpenrouterModel = LLM_PROVIDER_ENV_CONFIG.openrouter.model
        const defaultNimModel = LLM_PROVIDER_ENV_CONFIG.nim.model
        const defaultNimBaseUrl = DEFAULT_NIM_BASE_URL

        setLlmProviderMode(defaultProviderMode)
        setOpenrouterApiKey('')
        setOpenrouterModel(defaultOpenrouterModel)
        setNimApiKey('')
        setNimModel(defaultNimModel)
        setNimBaseUrl(defaultNimBaseUrl)

        setLlmProviderModeInput(defaultProviderMode)
        setOpenrouterApiKeyInput('')
        setOpenrouterModelInput(defaultOpenrouterModel)
        setNimApiKeyInput('')
        setNimModelInput(defaultNimModel)
        setNimBaseUrlInput(defaultNimBaseUrl)
        setLlmSettingsError('')

        clearSavedValue('mia.llm.persistKeys')
        clearSavedValue(STORAGE_OPENROUTER_API_KEY)
        clearSavedValue(STORAGE_NIM_API_KEY)
        setSavedValue(STORAGE_LLM_PROVIDER_MODE, defaultProviderMode)
        setSavedValue(STORAGE_OPENROUTER_MODEL, defaultOpenrouterModel)
        setSavedValue(STORAGE_NIM_MODEL, defaultNimModel)
        setSavedValue(STORAGE_NIM_BASE_URL, defaultNimBaseUrl)

        setToast('LLM settings reset to defaults.')
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
            if (savedKey && trimmedKey === savedKey) {
                setIsDeepgramKeyInvalid(true)
            }
            return
        }

        const nowIso = new Date().toISOString()

        setSavedKey(trimmedKey)
        setShowKeyStatus(true)
        setLastValidatedAt(nowIso)
        setIsDeepgramKeyInvalid(false)
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
        setIsDeepgramKeyInvalid(false)
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
                eyeContactPercent:
                    eyeContactScore == null ? null : Math.round(eyeContactScore * 100),
                gazeDeviationPercent: gazeDeviationPct,
                prolongedEyeClosureCount: prolongedClosureCount,
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

        const summaryMarkdown = buildAnswerSummaryMarkdown(
            interviewSummaries,
            overallInterviewSummary,
        )

        try {
            await navigator.clipboard.writeText(summaryMarkdown)
            setToast('Summary for Gem copied to clipboard.')
        } catch {
            setToast('Could not copy summary to clipboard.')
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

    function downloadSelectedRecording() {
        const prefersVideo = recordingModeRef.current === 'video'

        if (prefersVideo) {
            if (recordedVideoBlob) {
                downloadVideoRecording()
                return
            }
            if (recordedAudioBlob) {
                downloadAudioRecording()
                return
            }
        } else {
            if (recordedAudioBlob) {
                downloadAudioRecording()
                return
            }
            if (recordedVideoBlob) {
                downloadVideoRecording()
                return
            }
        }

        setToast('No recording available to download yet.')
    }

    async function copySelectedAnswerTextFile() {
        if (!selectedPreviousAnswer) {
            setToast('Select an answer first.')
            return
        }

        try {
            let textContent = ''

            if (selectedPreviousAnswer.textHandle) {
                const file = await selectedPreviousAnswer.textHandle.getFile()
                textContent = await file.text()
            } else if (selectedPreviousAnswer.metricsText?.trim()) {
                textContent = selectedPreviousAnswer.metricsText
            } else if (
                selectedPreviousAnswer.transcript?.trim() &&
                selectedPreviousAnswer.metrics &&
                typeof selectedPreviousAnswer.metrics === 'object'
            ) {
                textContent = buildOutputText({
                    capturedAt: selectedPreviousAnswer.capturedAt || new Date().toISOString(),
                    question: selectedPreviousAnswer.question || '(no question)',
                    answer: selectedPreviousAnswer.transcript,
                    metrics: selectedPreviousAnswer.metrics,
                })
            }

            if (!textContent.trim()) {
                setToast('No transcript/metrics content found for this answer.')
                return
            }

            await navigator.clipboard.writeText(textContent)
            setToast('Transcript and metrics copied to clipboard.')
        } catch {
            setToast('Could not copy transcript and metrics.')
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

        const isLocalStorageAnswer =
            selectedPreviousAnswer.source === PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE

        if (isLocalStorageAnswer) {
            const removed = removeRecordingFromPreviousAnswersLocalStorage(selectedPreviousAnswer.id)
            if (!removed) {
                setToast('Could not delete this local storage answer.')
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

            setToast('Previous answer removed from local storage.')
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
                ? 'Previous answer removed. No linked files were found to move.'
                : `Previous answer removed. Related files moved to ${RECYCLE_BIN_FOLDER_NAME}.`,
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

        const nextSummaries = interviewSummaries.filter(
            (item) => item.id !== selectedSummary.id,
        )
        setInterviewSummaries(nextSummaries)
        setSelectedSummaryId(nextSummaries[0]?.id || OVERALL_SUMMARY_VIEW_ID)
        setToast('Summary answer removed from this session.')
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

    async function ensureDirectoryPath(rootHandle, relativePath) {
        if (!relativePath) return rootHandle

        const segments = relativePath
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean)

        let currentHandle = rootHandle
        for (const segment of segments) {
            currentHandle = await currentHandle.getDirectoryHandle(segment, { create: true })
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
            return { ok: true, movedCount: 0, skipped: true }
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

        const answerFolderPath = answerEntry?.folderPath || answerEntry?.savedFiles?.folder || ''

        let targetFolderHandle
        try {
            targetFolderHandle = await resolveFolderHandleFromRelativePath(
                folderHandle,
                answerFolderPath,
            )
        } catch {
            return {
                ok: false,
                message: 'Could not locate the saved folder for this answer.',
            }
        }

        let recycleFolderHandle
        try {
            const recycleRootHandle = await folderHandle.getDirectoryHandle(RECYCLE_BIN_FOLDER_NAME, {
                create: true,
            })
            recycleFolderHandle = await ensureDirectoryPath(
                recycleRootHandle,
                answerFolderPath || 'root',
            )
        } catch {
            return {
                ok: false,
                message: 'Could not prepare recycle bin folder for this answer.',
            }
        }

        let movedCount = 0
        let failedCount = 0
        for (const fileName of fileNames) {
            try {
                const sourceFileHandle = await targetFolderHandle.getFileHandle(fileName)
                const sourceFile = await sourceFileHandle.getFile()

                const recycleFileHandle = await recycleFolderHandle.getFileHandle(fileName, {
                    create: true,
                })
                const writable = await recycleFileHandle.createWritable()
                await writable.write(sourceFile)
                await writable.close()

                await targetFolderHandle.removeEntry(fileName)
                movedCount += 1
            } catch (error) {
                if (error?.name === 'NotFoundError') continue
                failedCount += 1
            }
        }

        if (failedCount > 0) {
            return {
                ok: false,
                message: 'Could not move one or more files to the recycle bin folder.',
            }
        }

        return { ok: true, movedCount, skipped: false }
    }

    const refreshRecycleBinSize = useCallback(async () => {
        if (isFolderFeatureDisabled || !recordingsFolderRef.current) {
            setRecycleBinSizeBytes(0)
            return
        }

        const folderHandle = recordingsFolderRef.current
        const granted = await ensureDirectoryPermission(folderHandle)
        if (!granted) {
            setRecycleBinSizeBytes(0)
            return
        }

        try {
            const recycleRootHandle = await folderHandle.getDirectoryHandle(RECYCLE_BIN_FOLDER_NAME)
            const bytes = await calculateDirectorySizeBytes(recycleRootHandle)
            setRecycleBinSizeBytes(bytes)
        } catch (error) {
            if (error?.name === 'NotFoundError') {
                setRecycleBinSizeBytes(0)
                return
            }
            setRecycleBinSizeBytes(0)
        }
    }, [isFolderFeatureDisabled])

    const refreshRecordingsFolderSize = useCallback(async () => {
        if (isFolderFeatureDisabled || !recordingsFolderRef.current) {
            setRecordingsFolderSizeBytes(0)
            return
        }

        const folderHandle = recordingsFolderRef.current
        const granted = await ensureDirectoryPermission(folderHandle)
        if (!granted) {
            setRecordingsFolderSizeBytes(0)
            return
        }

        try {
            const bytes = await calculateDirectorySizeBytes(folderHandle)
            setRecordingsFolderSizeBytes(bytes)
        } catch {
            setRecordingsFolderSizeBytes(0)
        }
    }, [isFolderFeatureDisabled])

    async function clearRecycleBin() {
        if (isFolderFeatureDisabled) {
            setToast('Recycle bin is unavailable in this browser.')
            return
        }

        const folderHandle = recordingsFolderRef.current
        if (!folderHandle) {
            setToast('Select a save folder first.')
            return
        }

        const granted = await ensureDirectoryPermission(folderHandle)
        if (!granted) {
            setToast('Folder permission denied. Re-select the folder and retry.')
            return
        }

        setIsRecycleBinBusy(true)
        try {
            const recycleRootHandle = await folderHandle.getDirectoryHandle(RECYCLE_BIN_FOLDER_NAME)
            for await (const [entryName, entryHandle] of recycleRootHandle.entries()) {
                if (entryHandle.kind === 'directory') {
                    await recycleRootHandle.removeEntry(entryName, { recursive: true })
                } else {
                    await recycleRootHandle.removeEntry(entryName)
                }
            }
            setToast('Recycle bin cleared.')
        } catch (error) {
            if (error?.name === 'NotFoundError') {
                setToast('Recycle bin is already empty.')
            } else {
                setToast('Could not clear recycle bin.')
            }
        } finally {
            setIsRecycleBinBusy(false)
            await refreshRecycleBinSize()
        }
    }

    useEffect(() => {
        if (!settingsOpen) return
        void refreshRecycleBinSize()
        void refreshRecordingsFolderSize()
    }, [
        settingsOpen,
        recordingsFolderName,
        refreshRecycleBinSize,
        refreshRecordingsFolderSize,
    ])

    async function saveSessionArtifactsToSelectedFolder({
        capturedAtIso,
        question,
        report,
        outputBlock,
        audioBlob,
        videoBlob,
        shouldAutoSaveMedia,
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
        const videoExt =
            videoBlob?.type?.includes('mp4')
                ? 'mp4'
                : videoBlob?.type?.includes('webm')
                    ? 'webm'
                    : 'mp4'
        const videoFileName = shouldAutoSaveMedia && videoBlob ? `${baseName}.${videoExt}` : ''
        const audioFileName = shouldAutoSaveMedia && audioBlob ? `${baseName}.${audioExt}` : ''

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
        const audioOk = shouldAutoSaveMedia && audioBlob
            ? await writeBlobToSelectedFolder(targetFolderHandle, audioFileName, audioBlob)
            : true
        const videoOk = shouldAutoSaveMedia && videoBlob
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

    function validateLlmProviderApiBaseUrl(baseUrl) {
        const normalizedBaseUrl = String(baseUrl || '').trim()
        if (!normalizedBaseUrl) {
            return 'NVIDIA NIM Base URL is required.'
        }

        if (normalizedBaseUrl.startsWith('/')) {
            return ''
        }

        try {
            const parsed = new URL(normalizedBaseUrl)
            if (!/^https?:$/.test(parsed.protocol)) {
                return 'NVIDIA NIM Base URL must use http or https.'
            }
        } catch {
            return 'NVIDIA NIM Base URL must be a valid URL or a relative path like /api/nim.'
        }

        return ''
    }

    async function speakQuestionIfEnabled(questionText = questionInput) {
        if (!readQuestionWithTts) return

        const text = questionText.trim()
        if (!text) {
            setBanner('Read (TTS) Question is enabled, but the question is empty.')
            return
        }

        try {
            setIsSpeakingQuestion(true)
            if (hasKey) {
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
                    throw new Error('Saved key is invalid or revoked.')
                }
                if (!response.ok) {
                    throw new Error('Question TTS failed on Deepgram.')
                }

                const audioBlob = await response.blob()
                const audioUrl = URL.createObjectURL(audioBlob)

                setQuestionTtsProviderMeta({
                    providerUsed: 'deepgram',
                    fallbackApplied: false,
                    fallbackReason: '',
                })

                await new Promise((resolve, reject) => {
                    const audio = new Audio(audioUrl)
                    audio.onended = () => {
                        URL.revokeObjectURL(audioUrl)
                        resolve()
                    }
                    audio.onerror = () => {
                        URL.revokeObjectURL(audioUrl)
                        reject(new Error('Question TTS playback failed.'))
                    }
                    audio
                        .play()
                        .then(() => undefined)
                        .catch(() => reject(new Error('Question TTS playback failed.')))
                })
            } else {
                if (!hasSystemTts) {
                    setBanner('System text-to-speech is unavailable in this browser.')
                    return
                }

                window.speechSynthesis.cancel()
                setQuestionTtsProviderMeta({
                    providerUsed: 'system-tts',
                    fallbackApplied: true,
                    fallbackReason: 'key-validation',
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
            }
        } catch (error) {
            const providerMeta = error?.speechMeta || null
            setQuestionTtsProviderMeta(providerMeta)
            setBanner(formatSpeechError(error, 'Question TTS failed. Continuing without TTS.'))
        } finally {
            setIsSpeakingQuestion(false)
        }
    }

    async function startRecording(mode = 'audio', importedQuestion = '') {
        if (isRecording || isTranscribing || isPreparingRecording) return

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
            setIsPreparingRecording(true)
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
            setIsPreparingRecording(false)
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
            setIsPreparingRecording(false)
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

        const recordingStoppedAtPerf = performance.now()
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

            const storageAudioBlob = rawAudioBlob
            setRecordedAudioBlob(storageAudioBlob)

            let finalVideoBlob = null
            const shouldSaveVideo = recordingModeRef.current === 'video'

            if (videoChunksRef.current.length > 0) {
                const rawVideoBlob = new Blob(videoChunksRef.current, {
                    type: videoRecorder?.mimeType || 'video/webm',
                })

                finalVideoBlob = rawVideoBlob
                setRecordedVideoBlob(rawVideoBlob)
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
                (recordingStoppedAtPerf - recordingStartedAtPerfRef.current) / 1000,
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
            }

            const outputBlock = buildOutputText({
                capturedAt: capturedAtIso,
                question: trimmedQuestion,
                answer: normalizedTranscript,
                metrics: interviewMetrics,
            })

            appendRecordingToPreviousAnswersLocalStorage({
                id: crypto.randomUUID(),
                capturedAt: capturedAtIso,
                question: trimmedQuestion || '(no question)',
                transcript: normalizedTranscript,
                metrics: interviewMetrics,
                metricsText: outputBlock,
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
                shouldAutoSaveMedia: autoSaveMediaToFolder,
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
                if (
                    hasKey &&
                    (error.speechMeta.fallbackReason === 'auth-failure' ||
                        error.speechMeta.fallbackReason === 'key-validation')
                ) {
                    setIsDeepgramKeyInvalid(true)
                }
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
    const deepgramKeyWarningText = !hasKey
        ? 'Deepgram Key Missing'
        : isDeepgramKeyInvalid
            ? 'Deepgram Key Invalid'
            : ''
    const cameraDisplayMode = showInterviewer
        ? showSelfView
            ? CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP
            : CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY
        : CAMERA_DISPLAY_MODE_SELF_ONLY
    const isCameraAccessAllowed = hasCameraAccess || cameraPermissionState === 'granted'

    function handleThemeModeToggle() {
        setDarkMode((prev) => !prev)
        setThemeTogglePressCount((prev) => {
            const next = prev + 1
            if (next === 50) {
                setInterviewerImageId(EASTER_EGG_INTERVIEWER_IMAGE_ID)
            }
            return next
        })
    }

    function handleCameraOverlayToggle() {
        setIsCameraOverlayMenuOpen(false)

        if (enableCamera) {
            setEnableCamera(false)
            stopCamera()
            return
        }

        setEnableCamera(true)
        void startCamera()
    }

    function applyCameraDisplayMode(nextMode) {
        if (nextMode === CAMERA_DISPLAY_MODE_SELF_ONLY) {
            setShowSelfView(true)
            setShowInterviewer(false)
            setShowPiP(false)
            return
        }

        if (nextMode === CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP) {
            setShowSelfView(true)
            setShowInterviewer(true)
            setShowPiP(true)
            return
        }

        if (nextMode === CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY) {
            setShowSelfView(false)
            setShowInterviewer(true)
            setShowPiP(true)
        }
    }

    function handleToggleCameraOverlayMenu() {
        setIsCameraOverlayMenuOpen((prev) => !prev)
    }

    useEffect(() => {
        if (!isCameraOverlayMenuOpen) return undefined

        function onPointerDown(event) {
            if (!cameraOverlayControlsRef.current) return
            if (cameraOverlayControlsRef.current.contains(event.target)) return
            setIsCameraOverlayMenuOpen(false)
        }

        window.addEventListener('pointerdown', onPointerDown)
        return () => window.removeEventListener('pointerdown', onPointerDown)
    }, [isCameraOverlayMenuOpen])

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="topbar-inner">
                    <div className="topbar-title-row">
                        <h1>Mock Interviewer</h1>
                        <span className="topbar-version-label">v{APP_VERSION}</span>
                    </div>
                    <div className="topbar-actions">
                        <button
                            type="button"
                            className="btn ghost theme-toggle"
                            onClick={handleThemeModeToggle}
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
                    </div>
                </div>
            </header>

            <div className={`desktop-chat-layout${isDesktopViewport ? ' is-desktop' : ''}`}>
                <main
                    className={`layout${centerCameraLayout ? ' center-camera-layout' : ''}`}
                >
                    <section
                        className={`panel camera-panel${centerCameraLayout ? ' centered-camera-panel' : ''}`}
                    >
                        {isDesktopViewport && (
                            <button
                                type="button"
                                className="generate-questions-peek-tab"
                                onClick={() => {
                                    openGenerateQuestionsCountModal()
                                }}
                                disabled={isGeneratingQuestions}
                                title="Generates questions based on CV/JD/Company Name"
                            >
                                {isGeneratingQuestions ? 'Generating...' : 'Generate Questions'}
                            </button>
                        )}
                        {isDesktopViewport && (
                            <button
                                type="button"
                                className="question-peek-tab"
                                onClick={() => {
                                    setQuestionsDrawerOpen((prev) => {
                                        const next = !prev
                                        if (next) closeSummaryModal()
                                        if (next) closeCvJdModal()
                                        if (next) closePreviousAnswersModal()
                                        return next
                                    })
                                }}
                                aria-expanded={questionsDrawerOpen}
                                aria-controls="questions-modal"
                                title={
                                    questionsDrawerOpen
                                        ? parsedDrawerQuestions.length
                                            ? 'Hide questions list modal'
                                            : 'Hide questions import modal'
                                        : parsedDrawerQuestions.length
                                            ? 'Show questions list modal'
                                            : 'Show questions import modal'
                                }
                            >
                                {parsedDrawerQuestions.length ? 'Questions List' : 'Questions Import'}
                            </button>
                        )}
                        {isDesktopViewport && (
                            <span
                                className={`disabled-tooltip-wrap summary-peek-tab-wrap${summaryViewDisabledReason ? ' has-tooltip' : ''}`}
                                data-disabled-reason={summaryViewDisabledReason}
                                onPointerDown={(event) =>
                                    suppressDisabledTooltipPointerDefault(event, isSummaryViewDisabled)
                                }
                            >
                                <button
                                    type="button"
                                    className="summary-peek-tab"
                                    onClick={() => {
                                        if (summaryModalOpen) {
                                            closeSummaryModal()
                                            return
                                        }
                                        closeCvJdModal()
                                        setQuestionsDrawerOpen(false)
                                        openSummaryModal()
                                    }}
                                    aria-expanded={summaryModalOpen}
                                    aria-controls="summary-modal"
                                    title={
                                        isSummaryViewDisabled
                                            ? summaryViewDisabledReason
                                            : summaryModalOpen
                                                ? 'Hide answer summary modal'
                                                : 'Show answer summary modal'
                                    }
                                    disabled={isSummaryViewDisabled}
                                >
                                    Answer Summary
                                </button>
                            </span>
                        )}
                        {isDesktopViewport && (
                            <button
                                type="button"
                                className="am-report-peek-tab"
                                onClick={() => {
                                    void generateAmFeedbackReport()
                                }}
                                disabled={isGeneratingAmReport || isGeneratingDetailedReport || !interviewSummaries.length}
                                title={
                                    interviewSummaries.length
                                        ? 'Generate AM feedback report PDF from summary and CV/JD'
                                        : 'Answer a question first to generate a report.'
                                }
                            >
                                {isGeneratingAmReport ? 'Generating...' : 'Generate AM Report'}
                            </button>
                        )}
                        {isDesktopViewport && (
                            <button
                                type="button"
                                className="detailed-report-peek-tab"
                                onClick={() => {
                                    void generateDetailedInterviewReport()
                                }}
                                disabled={isGeneratingDetailedReport || isGeneratingAmReport || !interviewSummaries.length}
                                title={
                                    interviewSummaries.length
                                        ? 'Generate detailed per-question report with suggested improved answers'
                                        : 'Answer a question first to generate a detailed report.'
                                }
                            >
                                {isGeneratingDetailedReport ? 'Generating...' : 'Generate Detailed Report'}
                            </button>
                        )}
                        {isDesktopViewport && (
                            <span
                                className={`disabled-tooltip-wrap previous-peek-tab-wrap${previousAnswersViewDisabledReason ? ' has-tooltip' : ''}`}
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
                                        closeCvJdModal()
                                        closeSummaryModal()
                                        void openPreviousAnswersModal()
                                    }}
                                    disabled={isPreviousAnswersViewDisabled}
                                >
                                    {isLoadingPreviousAnswers ? 'Loading...' : 'Previous Answers'}
                                </button>
                            </span>
                        )}

                        {isDesktopViewport && (
                            <button
                                type="button"
                                className="cvjd-peek-tab"
                                onClick={() => {
                                    setQuestionsDrawerOpen(false)
                                    closeSummaryModal()
                                    closePreviousAnswersModal()
                                    openCvJdModal()
                                }}
                                aria-expanded={cvJdModalOpen}
                                aria-controls="cvjd-modal"
                                title={cvJdModalOpen ? 'Hide CV and JD modal' : 'Show CV and JD modal'}
                            >
                                Input CV/JD
                            </button>
                        )}

                        <div className={`camera-frame${!showInterviewer && isPortraitVideo ? ' portrait' : ''}${invertCamera ? ' inverted' : ''}`}>
                            {showInterviewer && (
                                <img
                                    src={activeInterviewerImageSrc}
                                    className="interviewer-image"
                                    alt="Mock interviewer"
                                    draggable={false}
                                />
                            )}

                            <img
                                src={meetingOverlayImage}
                                className="interviewer-image meeting-overlay-image"
                                alt="Meeting overlay"
                                draggable={false}
                            />

                            {showSelfView ? (
                                <div className={`self-view-frame${showPiP ? ' pip' : ' full'}${isPortraitVideo ? ' portrait' : ''}`}>
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
                                                    : !isCameraAccessAllowed
                                                        ? 'No Camera Access'
                                                        : 'Camera disabled'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ) : null}

                            <div className="camera-toggle-overlay-wrap" ref={cameraOverlayControlsRef}>
                                <button
                                    type="button"
                                    className={`camera-toggle-overlay-btn${enableCamera && isCameraAccessAllowed ? '' : ' is-disabled'}`}
                                    onClick={handleCameraOverlayToggle}
                                    aria-label={enableCamera ? 'Disable camera' : 'Enable camera'}
                                    title={enableCamera ? 'Disable camera' : 'Enable camera'}
                                >
                                    <span className="material-symbols-outlined" aria-hidden="true">
                                        {enableCamera ? 'videocam' : 'videocam_off'}
                                    </span>
                                    <span className="camera-toggle-overlay-label">Video</span>
                                </button>
                                <button
                                    type="button"
                                    className="camera-toggle-overlay-caret"
                                    onClick={handleToggleCameraOverlayMenu}
                                    aria-label="Open webcam quick settings"
                                    aria-expanded={isCameraOverlayMenuOpen}
                                    aria-haspopup="menu"
                                    title="Webcam quick settings"
                                >
                                    <span className="material-symbols-outlined" aria-hidden="true">
                                        {isCameraOverlayMenuOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
                                    </span>
                                </button>
                                {isCameraOverlayMenuOpen ? (
                                    <div className="camera-overlay-settings-menu" role="menu" aria-label="Webcam settings">
                                        <button
                                            type="button"
                                            className="camera-overlay-settings-item"
                                            role="menuitemcheckbox"
                                            aria-checked={invertCamera}
                                            onClick={() => setInvertCamera((prev) => !prev)}
                                            title="Mirror camera horizontally"
                                        >
                                            <span>Invert camera</span>
                                            <span className="material-symbols-outlined" aria-hidden="true">
                                                {invertCamera ? 'toggle_on' : 'toggle_off'}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="camera-overlay-settings-item"
                                            role="menuitemradio"
                                            aria-checked={
                                                cameraDisplayMode === CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP
                                            }
                                            onClick={() =>
                                                applyCameraDisplayMode(
                                                    CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP,
                                                )
                                            }
                                        >
                                            <span>Show both</span>
                                            <span className="material-symbols-outlined" aria-hidden="true">
                                                {cameraDisplayMode === CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP
                                                    ? 'radio_button_checked'
                                                    : 'radio_button_unchecked'}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="camera-overlay-settings-item"
                                            role="menuitemradio"
                                            aria-checked={cameraDisplayMode === CAMERA_DISPLAY_MODE_SELF_ONLY}
                                            onClick={() => applyCameraDisplayMode(CAMERA_DISPLAY_MODE_SELF_ONLY)}
                                        >
                                            <span>Show self only</span>
                                            <span className="material-symbols-outlined" aria-hidden="true">
                                                {cameraDisplayMode === CAMERA_DISPLAY_MODE_SELF_ONLY
                                                    ? 'radio_button_checked'
                                                    : 'radio_button_unchecked'}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="camera-overlay-settings-item"
                                            role="menuitemradio"
                                            aria-checked={cameraDisplayMode === CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY}
                                            onClick={() => applyCameraDisplayMode(CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY)}
                                        >
                                            <span>Show interviewer only</span>
                                            <span className="material-symbols-outlined" aria-hidden="true">
                                                {cameraDisplayMode === CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY
                                                    ? 'radio_button_checked'
                                                    : 'radio_button_unchecked'}
                                            </span>
                                        </button>
                                    </div>
                                ) : null}
                            </div>

                            {questionInput.trim() ? (
                                <div className="camera-question-overlay" aria-live="polite">
                                    <p>
                                        {currentQuestionListNumber
                                            ? `${currentQuestionListNumber}. `
                                            : ''}
                                        {questionInput.trim()}
                                    </p>
                                </div>
                            ) : null}
                        </div>

                        {debugEnabled && showSelfView && cameraStatus === 'ready' && facesDetected === 0 ? (
                            <p className="face-detected-text">No face detected</p>
                        ) : null}

                        <div className="actions wrap recording-actions camera-recording-actions">
                            {!isRecording ? (
                                <>
                                    {deepgramKeyWarningText ? (
                                        <button
                                            type="button"
                                            className="camera-recording-key-status"
                                            onClick={openSettingsAndFocusDeepgramInput}
                                            title="Open Settings to add or validate your Deepgram API key"
                                        >
                                            {deepgramKeyWarningText}
                                        </button>
                                    ) : null}
                                    <div className="camera-recording-primary">
                                        <button
                                            type="button"
                                            className="btn ghost two-line-btn"
                                            onClick={() => startRecording('audio')}
                                            disabled={isTranscribing}
                                        >
                                            <span>
                                                Start Audio
                                                <br />
                                                Recording
                                            </span>
                                        </button>
                                        <span
                                            className={`disabled-tooltip-wrap start-video-wrap${isVideoStartDisabled && videoStartDisabledReason ? ' has-tooltip' : ''}`}
                                            data-disabled-reason={videoStartDisabledReason}
                                        >
                                            <button
                                                type="button"
                                                className="btn two-line-btn"
                                                onClick={() => startRecording('video')}
                                                disabled={isVideoStartDisabled}
                                            >
                                                <span>
                                                    Start Video
                                                    <br />
                                                    Recording
                                                </span>
                                            </button>
                                        </span>
                                    </div>
                                    <span
                                        className={`disabled-tooltip-wrap question-next-tooltip-wrap camera-recording-next-wrap${showNoNextQuestionTooltip ? ' has-tooltip' : ''}`}
                                    >
                                        {hasQuestionsInList ? (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn ghost question-prev-btn two-line-btn"
                                                    onClick={handlePreviousQuestionAction}
                                                    disabled={isImportQuestionDisabled}
                                                    title="Go to previous question"
                                                >
                                                    <span className="material-symbols-outlined question-nav-icon" aria-hidden="true">
                                                        chevron_left
                                                    </span>
                                                    <span className="question-nav-label">
                                                        Previous
                                                        <br />
                                                        Question
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn question-next-btn two-line-btn"
                                                    onClick={handleNextQuestionAction}
                                                    disabled={isImportQuestionDisabled}
                                                    title={nextQuestionTitle}
                                                >
                                                    <span className="question-nav-label">
                                                        Next
                                                        <br />
                                                        Question
                                                    </span>
                                                    <span className="material-symbols-outlined question-nav-icon" aria-hidden="true">
                                                        chevron_right
                                                    </span>
                                                </button>
                                            </>
                                        ) : isGeneratingQuestions ? null : canPromptGenerateQuestionsFromCvJd ? (
                                            <button
                                                type="button"
                                                className="btn question-next-btn question-generate-btn two-line-btn"
                                                onClick={generateQuestionsInBackground}
                                                disabled={isImportQuestionDisabled}
                                                title="Generate questions in the background"
                                            >
                                                <span className="question-nav-label">
                                                    Generate
                                                    <br />
                                                    Questions
                                                </span>
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className="btn ghost question-next-btn two-line-btn"
                                                onClick={openCvJdModal}
                                                disabled={isImportQuestionDisabled}
                                                title="Add CV and JD details first"
                                            >
                                                <span className="question-nav-label">
                                                    Add JD and CV
                                                    <br />
                                                    information
                                                </span>
                                            </button>
                                        )}
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
                                            onClick={resetStatisticsAndRecalibrate}
                                            disabled={cameraStatus !== 'ready' || isRecording || isTranscribing}
                                        >
                                            Reset Statistics
                                        </button>
                                    </div>
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
                            </div>
                        ) : null}
                    </section>

                    {shouldShowSessionPanel && (
                        <section
                            className={`panel session${centerCameraLayout ? ' centered-session-panel' : ''}${isDesktopViewport ? ' floating-session-panel' : ''}${isDesktopViewport && isSessionPanelMinimized ? ' is-minimized' : ''}`}
                        >
                            {isDesktopViewport && (
                                <div className="floating-session-head">
                                    <h3>Question, Transcript and Metrics</h3>
                                    <button
                                        type="button"
                                        className="btn ghost floating-session-toggle"
                                        onClick={() => setIsSessionPanelMinimized((prev) => !prev)}
                                        aria-expanded={!isSessionPanelMinimized}
                                        aria-label={isSessionPanelMinimized ? 'Expand session panel' : 'Minimize session panel'}
                                        title={isSessionPanelMinimized ? 'Expand session panel' : 'Minimize session panel'}
                                    >
                                        <span className="material-symbols-outlined" aria-hidden="true">
                                            {isSessionPanelMinimized ? 'open_in_full' : 'minimize'}
                                        </span>
                                    </button>
                                </div>
                            )}

                            {(!isDesktopViewport || !isSessionPanelMinimized) && (
                                <div className="floating-session-body">

                                    <div className="actions wrap export-actions">
                                        {(isFolderFeatureDisabled || !autoSaveMediaToFolder) && (
                                            <div className="export-download-actions">
                                                <button
                                                    type="button"
                                                    className="btn ghost"
                                                    onClick={downloadSelectedRecording}
                                                    disabled={!recordedAudioBlob && !recordedVideoBlob}
                                                >
                                                    Download Recording
                                                </button>
                                            </div>
                                        )}
                                        <label className="debug-toggle auto-summary-toggle">
                                            <input
                                                type="checkbox"
                                                checked={autoAddCompletedAnswersToSummary}
                                                onChange={(event) => setAutoAddCompletedAnswersToSummary(event.target.checked)}
                                                disabled={isRecording || isTranscribing}
                                            />
                                            <span>Auto-Add</span>
                                        </label>
                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={addCurrentAnswerToSummary}
                                            disabled={
                                                !transcript ||
                                                !latestInterviewMetrics ||
                                                isRecording ||
                                                isTranscribing ||
                                                isCurrentAnswerAlreadyInSummary
                                            }
                                            title={
                                                isCurrentAnswerAlreadyInSummary
                                                    ? 'This answer is already in summary.'
                                                    : 'Add this answer to summary'
                                            }
                                        >
                                            {isCurrentAnswerAlreadyInSummary ? 'Already in Summary' : 'Add to Summary'}
                                        </button>
                                    </div>

                                    <div className="label question-row">
                                        <p className="question-main-label">
                                            Interview question
                                            {currentQuestionListNumber
                                                ? ` (#${currentQuestionListNumber})`
                                                : ''}
                                        </p>
                                        <div className="question-row-actions">
                                            {hasQuestionsInList ? (
                                                isDesktopViewport ? (
                                                    <button
                                                        type="button"
                                                        className="btn question-next-btn"
                                                        onClick={handleNextQuestionAction}
                                                        disabled={isImportQuestionDisabled}
                                                        title={nextQuestionTitle}
                                                    >
                                                        Next Question
                                                    </button>
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
                                                        <button
                                                            type="button"
                                                            className="btn question-next-btn"
                                                            onClick={handleNextQuestionAction}
                                                            disabled={isImportQuestionDisabled}
                                                            title={nextQuestionTitle}
                                                        >
                                                            Next Question
                                                        </button>
                                                    </div>
                                                )
                                            ) : isGeneratingQuestions ? null : canPromptGenerateQuestionsFromCvJd ? (
                                                <button
                                                    type="button"
                                                    className="btn"
                                                    onClick={generateQuestionsInBackground}
                                                    disabled={isImportQuestionDisabled}
                                                    title="Generate questions in the background"
                                                >
                                                    Generate Questions
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="btn ghost"
                                                    onClick={openCvJdModal}
                                                    disabled={isImportQuestionDisabled}
                                                    title="Add CV and JD details first"
                                                >
                                                    Add JD and CV information
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <textarea
                                        id="interview-question"
                                        className="field question-field"
                                        aria-label="Interview question"
                                        value={questionInput}
                                        onChange={(event) => {
                                            setQuestionInput(event.target.value)
                                            setActiveQuestionListIndex(null)
                                        }}
                                        autoComplete="off"
                                        rows={2}
                                        placeholder="Type your question here, or import from the questions tab"
                                    />
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
                                    {deepgramDebugEnabled && transcriptionProviderStatus && (
                                        <p className="muted">{transcriptionProviderStatus}</p>
                                    )}
                                    {deepgramDebugEnabled && questionTtsProviderStatus && (
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
                                                    <span className="label">Prolonged closures</span>
                                                    <span className="value">{latestInterviewMetrics.prolongedClosureEvents}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="muted transcript-metrics-empty">
                                                Values appear here after you stop and transcribe a recording.
                                            </p>
                                        )}
                                    </div>

                                    {isDesktopViewport && previousAnswersError && <p className="warning">{previousAnswersError}</p>}
                                </div>
                            )}
                        </section>
                    )}
                </main>
            </div>

            {changelogModalOpen && (
                <div
                    className="overlay changelog-overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeChangelogModal()
                        }
                    }}
                >
                    <div
                        id="changelog-modal"
                        className="modal question-modal changelog-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="changelog-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="history-modal-header">
                            <h2 id="changelog-title">Changelog (Last 10 Releases)</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn ghost history-close-btn"
                                    onClick={closeChangelogModal}
                                    aria-label="Close"
                                    title="Close"
                                >
                                    X
                                </button>
                            </div>
                        </div>

                        <div className="question-modal-body changelog-modal-body">
                            <div className="question-modal-inner changelog-modal-inner">
                                {recentChangelogEntries.length ? (
                                    <div className="changelog-release-list">
                                        {recentChangelogEntries.map((release) => (
                                            <article key={`${release.version}-${release.date}`} className="changelog-release-card">
                                                <h3>
                                                    {release.version} <span className="muted">{release.date}</span>
                                                </h3>
                                                {release.sections.length ? (
                                                    release.sections.map((section) => (
                                                        <section key={`${release.version}-${section.title}`} className="changelog-section">
                                                            <p className="label changelog-section-title">{section.title}</p>
                                                            {section.bullets.length ? (
                                                                <ul className="changelog-bullet-list">
                                                                    {section.bullets.map((item, index) => (
                                                                        <li key={`${release.version}-${section.title}-${index}`}>{item}</li>
                                                                    ))}
                                                                </ul>
                                                            ) : null}
                                                        </section>
                                                    ))
                                                ) : (
                                                    <p className="muted">No changes listed.</p>
                                                )}
                                            </article>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="muted">No changelog entries found.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                            <div className="history-title-row">
                                <h2 id="history-title">Previous Answers</h2>
                                <div
                                    className="history-source-toggle"
                                    role="group"
                                    aria-label="Previous answers source"
                                >
                                    <span className="history-source-label">Source:</span>
                                    <button
                                        type="button"
                                        className={`btn ghost history-source-btn${previousAnswersSource === PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE
                                            ? ' active'
                                            : ''
                                            }`}
                                        onClick={() => {
                                            if (
                                                previousAnswersSource ===
                                                PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE
                                            ) {
                                                return
                                            }

                                            setPreviousAnswersSource(
                                                PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE,
                                            )
                                            setSelectedPreviousAnswerId('')
                                            replaceHistoryMediaUrls({
                                                audioUrl: '',
                                                videoUrl: '',
                                            })
                                            void loadPreviousAnswersFromLocalStorage()
                                        }}
                                    >
                                        Local Storage
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn ghost history-source-btn${previousAnswersSource === PREVIOUS_ANSWERS_SOURCE_FOLDER
                                            ? ' active'
                                            : ''
                                            }`}
                                        onClick={() => {
                                            if (
                                                previousAnswersSource === PREVIOUS_ANSWERS_SOURCE_FOLDER
                                            ) {
                                                return
                                            }

                                            setPreviousAnswersSource(
                                                PREVIOUS_ANSWERS_SOURCE_FOLDER,
                                            )
                                            setSelectedPreviousAnswerId('')
                                            replaceHistoryMediaUrls({
                                                audioUrl: '',
                                                videoUrl: '',
                                            })
                                            void loadPreviousAnswersFromFolder()
                                        }}
                                        disabled={isFolderFeatureDisabled}
                                        title={
                                            isFolderFeatureDisabled
                                                ? 'Folder history is unavailable in this browser.'
                                                : ''
                                        }
                                    >
                                        Folder
                                    </button>
                                </div>
                                <label className="debug-toggle history-autosave-toggle">
                                    <input
                                        type="checkbox"
                                        checked={autoSaveMediaToFolder}
                                        onChange={(event) =>
                                            setAutoSaveMediaToFolder(event.target.checked)
                                        }
                                        disabled={isFolderFeatureDisabled}
                                    />
                                    <span>Auto-Save Recordings to Folder</span>
                                </label>
                            </div>
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
                                    <div className="history-overview-actions">
                                        {previousAnswersSource === PREVIOUS_ANSWERS_SOURCE_FOLDER && (
                                            <button
                                                type="button"
                                                className="btn ghost"
                                                onClick={openSelectRecordingsFolderModal}
                                                disabled={isFolderFeatureDisabled}
                                            >
                                                Reselect Folder
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="btn ghost"
                                            onClick={loadPreviousAnswers}
                                            disabled={isLoadingPreviousAnswers}
                                        >
                                            {isLoadingPreviousAnswers ? 'Loading...' : 'Refresh'}
                                        </button>
                                    </div>
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
                                            <span>{formatReadableCapturedDate(item.capturedAt)}</span>
                                            {item.folderPath ? (
                                                <span className="history-folder-chip">{item.folderPath}</span>
                                            ) : (
                                                <span className="history-folder-chip history-folder-chip-root">root</span>
                                            )}
                                        </button>
                                    ))}
                                    {!previousAnswers.length && (
                                        <p className="muted">
                                            {previousAnswersSource === PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE
                                                ? 'No previous answers found in local storage.'
                                                : 'No previous answers found in the selected folder.'}
                                        </p>
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
                                                    {formatReadableCapturedDate(selectedPreviousAnswer.capturedAt)}
                                                </p>
                                                {selectedPreviousAnswer.source !==
                                                    PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE && (
                                                        <p className="metric-label history-detail-meta">
                                                            Total file size: {selectedPreviousAnswerTotalSizeLabel}
                                                        </p>
                                                    )}
                                            </div>
                                            <div className="history-detail-actions">
                                                <button
                                                    type="button"
                                                    className="btn ghost history-copy-btn"
                                                    onClick={copySelectedAnswerTextFile}
                                                    disabled={
                                                        !selectedPreviousAnswer.textHandle &&
                                                        !selectedPreviousAnswer.metricsText?.trim() &&
                                                        !selectedPreviousAnswer.transcript?.trim()
                                                    }
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
                                                    title={
                                                        previousAnswersSource ===
                                                            PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE
                                                            ? 'Delete this answer from local storage history.'
                                                            : ''
                                                    }
                                                >
                                                    Delete Answer
                                                </button>
                                            </div>
                                        </div>

                                        <div className="history-detail-scroll">
                                            {selectedPreviousAnswer.source !==
                                                PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE && (
                                                    <>
                                                        <details className="transcript-box history-files">
                                                            <summary>Files</summary>
                                                            <div className="history-files-body">
                                                                <p className="metric-label history-detail-meta">
                                                                    Report: {selectedPreviousAnswer.reportFileName || 'n/a'}
                                                                    {selectedPreviousAnswerFileSizes.report ? ` (${selectedPreviousAnswerFileSizes.report})` : ''}
                                                                </p>
                                                                <p className="metric-label history-detail-meta">
                                                                    Transcript: {selectedPreviousAnswer.textFileName || 'n/a'}
                                                                    {selectedPreviousAnswerFileSizes.text ? ` (${selectedPreviousAnswerFileSizes.text})` : ''}
                                                                </p>
                                                                {selectedPreviousAnswer.audioFileName &&
                                                                    selectedPreviousAnswer.videoFileName &&
                                                                    selectedPreviousAnswer.audioFileName === selectedPreviousAnswer.videoFileName ? (
                                                                    <p className="metric-label history-detail-meta">
                                                                        Media file: {selectedPreviousAnswer.audioFileName}
                                                                        {(selectedPreviousAnswerFileSizes.audio || selectedPreviousAnswerFileSizes.video)
                                                                            ? ` (${selectedPreviousAnswerFileSizes.audio || selectedPreviousAnswerFileSizes.video})`
                                                                            : ''}
                                                                    </p>
                                                                ) : (
                                                                    <>
                                                                        <p className="metric-label history-detail-meta">
                                                                            Audio: {selectedPreviousAnswer.audioFileName || 'n/a'}
                                                                            {selectedPreviousAnswerFileSizes.audio ? ` (${selectedPreviousAnswerFileSizes.audio})` : ''}
                                                                        </p>
                                                                        <p className="metric-label history-detail-meta">
                                                                            Video: {selectedPreviousAnswer.videoFileName || 'n/a'}
                                                                            {selectedPreviousAnswerFileSizes.video ? ` (${selectedPreviousAnswerFileSizes.video})` : ''}
                                                                        </p>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </details>

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
                                                    </>
                                                )}

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
                                                                    <span>{formatMetricDisplayValue(key, value)}</span>
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
                            <h2 id="summary-title">Interview Answer Summary</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={copySummaryToClipboard}
                                    disabled={!interviewSummaries.length}
                                    aria-label="Copy All"
                                    title="Copy All"
                                >
                                    <span className="material-symbols-outlined topbar-icon" aria-hidden="true">
                                        content_copy
                                    </span>
                                    <span>Copy All</span>
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
                                    {interviewSummaries.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={`history-overview-item${selectedSummary?.id === item.id ? ' active' : ''}`}
                                            onClick={() => setSelectedSummaryId(item.id)}
                                        >
                                            <strong>{item.question}</strong>
                                            <span>{formatReadableCapturedDate(item.capturedAt)}</span>
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
                                                    {formatReadableCapturedDate(selectedSummary.capturedAt)}
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
                                                                <span>{formatMetricDisplayValue(key, value)}</span>
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

            {cvJdModalOpen && (
                <div
                    className="overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeCvJdModal()
                        }
                    }}
                >
                    <div
                        id="cvjd-modal"
                        className="modal question-modal cvjd-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cvjd-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="history-modal-header">
                            <h2 id="cvjd-title">
                                CV and JD {companyNameInput.trim() ? `- ${companyNameInput.trim()}` : ''}
                            </h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={copyCvJdForGemini}
                                >
                                    Copy
                                </button>
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={() => {
                                        openGenerateQuestionsCountModal({ closeCvJd: true })
                                    }}
                                    disabled={isGeneratingQuestions}
                                    title="Generates questions based on CV/JD/Company Name"
                                >
                                    {isGeneratingQuestions ? 'Generating...' : 'Generate Questions'}
                                </button>
                                <button
                                    type="button"
                                    className="btn ghost history-close-btn"
                                    onClick={closeCvJdModal}
                                    aria-label="Close"
                                    title="Close"
                                >
                                    X
                                </button>
                            </div>
                        </div>

                        <div className="question-modal-body cvjd-modal-body">
                            <div className="question-modal-inner cvjd-modal-inner">
                                <p className="muted">
                                    Save your candidate profile and target role details here for quick Gemini prompts.
                                </p>
                                <label htmlFor="cvjd-consultant-full-name" className="label cvjd-label">
                                    Consultant Full Name
                                </label>
                                <input
                                    id="cvjd-consultant-full-name"
                                    type="text"
                                    className="field cvjd-field"
                                    value={consultantFullNameInput}
                                    onChange={(event) => setConsultantFullNameInput(event.target.value)}
                                    placeholder="Example: Alex Morgan"
                                    autoComplete="off"
                                />
                                <label htmlFor="cvjd-company" className="label cvjd-label">
                                    Company Name
                                </label>
                                <input
                                    id="cvjd-company"
                                    type="text"
                                    className="field cvjd-field"
                                    value={companyNameInput}
                                    onChange={(event) => setCompanyNameInput(event.target.value)}
                                    placeholder="Example: Contoso"
                                    autoComplete="off"
                                />

                                <label htmlFor="cvjd-job-title" className="label cvjd-label">
                                    Job Title
                                </label>
                                <input
                                    id="cvjd-job-title"
                                    type="text"
                                    className="field cvjd-field"
                                    value={jobTitleInput}
                                    onChange={(event) => setJobTitleInput(event.target.value)}
                                    placeholder="Example: Senior Consultant"
                                    autoComplete="off"
                                />

                                <label htmlFor="cvjd-jd" className="label cvjd-label">
                                    Job Description (JD)
                                </label>
                                <textarea
                                    id="cvjd-jd"
                                    className="field cvjd-textarea"
                                    value={jdText}
                                    onChange={(event) => setJdText(event.target.value)}
                                    rows={12}
                                    placeholder="Paste the job description here"
                                />

                                <label htmlFor="cvjd-cv" className="label cvjd-label">
                                    CV
                                </label>
                                <textarea
                                    id="cvjd-cv"
                                    className="field cvjd-textarea"
                                    value={cvText}
                                    onChange={(event) => setCvText(event.target.value)}
                                    rows={12}
                                    placeholder="Paste your CV here"
                                />
                            </div>
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
                            <h2 id="questions-modal-title">Questions LIst</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn ghost"
                                    onClick={clearQuestionsList}
                                    disabled={!parsedDrawerQuestions.length}
                                >
                                    Clear Questions List
                                </button>
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={requestGenerateQuestionsFromQuestionsModal}
                                    disabled={isGeneratingQuestions}
                                    title="Generates questions based on CV/JD/Company Name"
                                >
                                    {isGeneratingQuestions
                                        ? 'Generating...'
                                        : parsedDrawerQuestions.length
                                            ? 'Re-generate Questions'
                                            : 'Generate Questions'}
                                </button>
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
                        </div>

                        <div className="question-modal-body">
                            <div className="question-drawer-inner question-modal-inner">
                                <p className="muted">Enter multiple questions, one per line.</p>
                                <textarea
                                    className="field question-list-field"
                                    value={questionsBulkInput}
                                    onChange={(event) =>
                                        handleQuestionsBulkInputChange(event.target.value)
                                    }
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
                                                                    importQuestion(question, {
                                                                        questionIndex: index,
                                                                    })
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
                            <div className="settings-title-row">
                                <h2 id="settings-title">Settings</h2>
                                <span className="settings-version-label">v{APP_VERSION}</span>
                            </div>
                            <div className="settings-header-actions">
                                <button
                                    type="button"
                                    className="settings-changelog-link"
                                    onClick={openChangelogModal}
                                >
                                    Changelog
                                </button>
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
                                    ref={deepgramKeyInputRef}
                                    id="deepgram-key"
                                    type={showKey ? 'text' : 'password'}
                                    value={keyInput}
                                    onChange={(event) => updateInput(event.target.value)}
                                    onBlur={validateOnBlur}
                                    aria-describedby={fieldError ? 'key-error' : undefined}
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
                            <div className="actions wrap key-actions-row">
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
                                <label className="debug-toggle" title="Use local fallback when Deepgram key is missing">
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
                            <label className="debug-toggle">
                                <input
                                    type="checkbox"
                                    checked={deepgramDebugEnabled}
                                    onChange={(event) => setDeepgramDebugEnabled(event.target.checked)}
                                />
                                <span>Deepgram Debug</span>
                            </label>

                            <div className="settings-section">
                                <label className="label">LLM Chat Providers</label>
                                <p className="muted">
                                    Configure OpenRouter or NVIDIA NIM for question generation.
                                </p>

                                <label className="label">Select Provider</label>
                                <select
                                    className="field"
                                    value={llmProviderModeInput}
                                    onChange={(event) =>
                                        setLlmProviderModeInput(
                                            normalizeLlmProviderMode(event.target.value),
                                        )
                                    }
                                >
                                    <option value={LLM_PROVIDER_MODE_AUTO}>Auto</option>
                                    <option value={LLM_PROVIDER_MODE_OPENROUTER_ONLY}>OpenRouter only</option>
                                    <option value={LLM_PROVIDER_MODE_NIM_ONLY}>NVIDIA NIM only</option>
                                </select>
                                <p className="muted">
                                    Auto mode tries OpenRouter first, then retries with NVIDIA NIM if OpenRouter fails.
                                </p>

                                <label className="label">OpenRouter API Key</label>
                                <div className="key-input-row">
                                    <input
                                        className="field"
                                        type="password"
                                        value={openrouterApiKeyInput}
                                        onChange={(event) => setOpenrouterApiKeyInput(event.target.value)}
                                        autoComplete="off"
                                    />
                                    <button
                                        type="button"
                                        className="btn key-save-btn"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={saveOpenrouterKeyOnly}
                                        disabled={isSavingOpenrouterKey}
                                    >
                                        {isSavingOpenrouterKey ? 'Saving...' : 'Save key'}
                                    </button>
                                </div>

                                <label className="label">OpenRouter Model</label>
                                <select
                                    className="field"
                                    value={openrouterModelSelectValue}
                                    onChange={(event) => handleOpenrouterModelSelection(event.target.value)}
                                >
                                    {openrouterModelOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                {openrouterModelSelectValue === CUSTOM_MODEL_OPTION_VALUE && (
                                    <input
                                        className="field"
                                        type="text"
                                        value={openrouterCustomModelInput}
                                        onChange={(event) => {
                                            const nextValue = event.target.value
                                            setOpenrouterCustomModelInput(nextValue)
                                            setOpenrouterModelInput(nextValue)
                                        }}
                                        placeholder="Enter custom OpenRouter model id"
                                    />
                                )}

                                <label className="label">NVIDIA NIM API Key</label>
                                <div className="key-input-row">
                                    <input
                                        className="field"
                                        type="password"
                                        value={nimApiKeyInput}
                                        onChange={(event) => setNimApiKeyInput(event.target.value)}
                                        autoComplete="off"
                                    />
                                    <button
                                        type="button"
                                        className="btn key-save-btn"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={saveNimKeyOnly}
                                        disabled={isSavingNimKey}
                                    >
                                        {isSavingNimKey ? 'Saving...' : 'Save key'}
                                    </button>
                                </div>

                                <label className="label">NVIDIA NIM Model</label>
                                <select
                                    className="field"
                                    value={nimModelSelectValue}
                                    onChange={(event) => handleNimModelSelection(event.target.value)}
                                >
                                    {nimModelOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                {nimModelSelectValue === CUSTOM_MODEL_OPTION_VALUE && (
                                    <input
                                        className="field"
                                        type="text"
                                        value={nimCustomModelInput}
                                        onChange={(event) => {
                                            const nextValue = event.target.value
                                            setNimCustomModelInput(nextValue)
                                            setNimModelInput(nextValue)
                                        }}
                                        placeholder="Enter custom NVIDIA NIM model id"
                                    />
                                )}

                                <label className="label">NVIDIA NIM Base URL</label>
                                <input
                                    className="field"
                                    type="text"
                                    value={nimBaseUrlInput}
                                    onChange={(event) => setNimBaseUrlInput(event.target.value)}
                                    placeholder="/api/nim"
                                />
                                <p className="muted">
                                    Use a same-origin proxy endpoint in deployed environments to avoid browser CORS blocks (example: /api/nim).
                                </p>

                                <div className="actions wrap llm-settings-actions">
                                    <button
                                        type="button"
                                        className="btn"
                                        onClick={saveLlmSettings}
                                    >
                                        Save LLM settings
                                    </button>
                                    <button
                                        type="button"
                                        className="btn ghost"
                                        onClick={resetLlmSettingsToDefaults}
                                        title="Clear keys and reset provider/model defaults"
                                    >
                                        Clear keys and reset to defaults
                                    </button>
                                </div>

                                {llmSettingsError && (
                                    <p className="error-text" aria-live="polite">
                                        {llmSettingsError}
                                    </p>
                                )}
                            </div>

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

                            <div className="settings-section">
                                <label className="label">Camera Display</label>
                                <label className="debug-toggle">
                                    <input
                                        type="checkbox"
                                        checked={invertCamera}
                                        onChange={(event) => setInvertCamera(event.target.checked)}
                                    />
                                    <span>Invert camera</span>
                                </label>
                                <label className="debug-toggle">
                                    <input
                                        type="radio"
                                        name="camera-display-mode"
                                        checked={
                                            cameraDisplayMode === CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP
                                        }
                                        onChange={() =>
                                            applyCameraDisplayMode(
                                                CAMERA_DISPLAY_MODE_INTERVIEWER_PLUS_SELF_PIP,
                                            )
                                        }
                                    />
                                    <span>Show both</span>
                                </label>
                                <label className="debug-toggle">
                                    <input
                                        type="radio"
                                        name="camera-display-mode"
                                        checked={cameraDisplayMode === CAMERA_DISPLAY_MODE_SELF_ONLY}
                                        onChange={() =>
                                            applyCameraDisplayMode(CAMERA_DISPLAY_MODE_SELF_ONLY)
                                        }
                                    />
                                    <span>Show self only</span>
                                </label>
                                <label className="debug-toggle">
                                    <input
                                        type="radio"
                                        name="camera-display-mode"
                                        checked={cameraDisplayMode === CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY}
                                        onChange={() =>
                                            applyCameraDisplayMode(CAMERA_DISPLAY_MODE_INTERVIEWER_ONLY)
                                        }
                                    />
                                    <span>Show interviewer only</span>
                                </label>
                                <label className="debug-toggle">
                                    <input
                                        type="checkbox"
                                        checked={enableCamera}
                                        onChange={(event) => {
                                            const enabled = event.target.checked
                                            setEnableCamera(enabled)
                                            if (!hasCameraAccess) {
                                                setToast('Allow Camera Access first.')
                                                return
                                            }

                                            if (enabled) {
                                                void startCamera()
                                            } else {
                                                stopCamera()
                                            }
                                        }}
                                    />
                                    <span>Enable Camera</span>
                                </label>
                                <div className="interviewer-image-settings">
                                    <label htmlFor="interviewer-image-select" className="label">
                                        Interviewer Image
                                    </label>
                                    <select
                                        id="interviewer-image-select"
                                        className="field"
                                        value={interviewerImageId}
                                        onChange={(event) => setInterviewerImageId(event.target.value)}
                                    >
                                        {selectableBuiltInInterviewerImages.map((option) => (
                                            <option key={option.id} value={option.id}>
                                                {option.label}
                                            </option>
                                        ))}
                                        {hasCustomInterviewerImage && (
                                            <option value={CUSTOM_INTERVIEWER_IMAGE_ID}>Custom Upload</option>
                                        )}
                                    </select>
                                    <div className="actions wrap interviewer-image-actions">
                                        <button
                                            type="button"
                                            className="btn ghost"
                                            onClick={() => interviewerUploadInputRef.current?.click()}
                                        >
                                            Choose Custom Interviewer
                                        </button>
                                        {hasCustomInterviewerImage && (
                                            <button
                                                type="button"
                                                className="btn ghost"
                                                onClick={clearCustomInterviewerImage}
                                            >
                                                Remove Custom Image
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        ref={interviewerUploadInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="sr-only"
                                        onChange={handleInterviewerImageUpload}
                                    />
                                    <p className="muted interviewer-image-help">
                                        Choose a custom interviewer image from your device.
                                    </p>
                                </div>
                            </div>

                            <div className="settings-section">
                                <label className="label">Question Playback</label>
                                <p className="muted">
                                    Read each interview question aloud before recording starts.
                                </p>
                                <label className="debug-toggle">
                                    <input
                                        type="checkbox"
                                        checked={readQuestionWithTts}
                                        onChange={(event) => setReadQuestionWithTts(event.target.checked)}
                                        disabled={isRecording || isTranscribing || isSpeakingQuestion}
                                    />
                                    <span>Read (TTS) Question</span>
                                </label>
                            </div>

                            {isDesktopViewport && (
                                <div className="settings-section">
                                    <label className="label">Recording Save Folder</label>
                                    <p className="muted">
                                        {isIphoneClient
                                            ? 'Recording save folder is unavailable on iPhone browsers.'
                                            : recordingsFolderName
                                                ? `Current folder: ${recordingsFolderName} (Size: ${formatFileSize(recordingsFolderSizeBytes)})`
                                                : fileSystemAccessSupported
                                                    ? 'No folder selected. Recordings can still be downloaded manually.'
                                                    : 'Folder selection is unavailable in this browser.'}
                                    </p>
                                    {recordingsFolderName && (
                                        <p className="muted">
                                            Recycle Bin size: {formatFileSize(recycleBinSizeBytes)}
                                        </p>
                                    )}
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
                                                Disable Folder Functionality
                                            </button>
                                        )}
                                        {recordingsFolderName && (
                                            <button
                                                type="button"
                                                className="btn ghost"
                                                onClick={clearRecycleBin}
                                                disabled={isFolderFeatureDisabled || isRecycleBinBusy || recycleBinSizeBytes <= 0}
                                            >
                                                {isRecycleBinBusy ? 'Clearing Recycle Bin...' : 'Clear Recycle Bin'}
                                            </button>
                                        )}
                                    </div>
                                    <label className="debug-toggle">
                                        <input
                                            type="checkbox"
                                            checked={autoSaveMediaToFolder}
                                            onChange={(event) =>
                                                setAutoSaveMediaToFolder(event.target.checked)
                                            }
                                            disabled={isFolderFeatureDisabled}
                                        />
                                        <span>Auto-save Video/Audio Answer to Folder</span>
                                    </label>
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            )}

            {confirmCloseSettingsUnsavedLlmOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-unsaved-llm-title"
                    >
                        <h2 id="settings-unsaved-llm-title">Save LLM changes?</h2>
                        <p className="muted">
                            You have unsaved LLM settings. Save LLM settings before closing, or discard changes.
                        </p>
                        <div className="actions">
                            <button
                                type="button"
                                className="btn"
                                onClick={saveLlmSettingsAndCloseSettings}
                            >
                                Save LLM Settings
                            </button>
                            <button
                                type="button"
                                className="btn danger"
                                onClick={discardUnsavedLlmSettingsAndClose}
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setConfirmCloseSettingsUnsavedLlmOpen(false)}
                            >
                                Stay
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {amReportModalOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal question-modal am-report-stream-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="am-report-stream-title"
                    >
                        <div className="history-modal-header">
                            <h2 id="am-report-stream-title">Generating AM Report</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn danger"
                                    onClick={cancelAmReportGeneration}
                                    disabled={!isGeneratingAmReport}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                        <div className="question-modal-body am-report-stream-body" ref={amReportPreviewScrollRef}>
                            <div className="question-modal-inner am-report-stream-inner" aria-live="polite">
                                <div className="am-report-stream-content no-select">
                                    <ReactMarkdown>{amReportMarkdownPreview || 'Generating AM report...'}</ReactMarkdown>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {amReportPdfPreviewOpen && (
                <div
                    className="overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            requestCloseAmReportPdfPreview()
                        }
                    }}
                >
                    <div
                        className="modal question-modal am-report-pdf-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="am-report-pdf-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="history-modal-header">
                            <h2 id="am-report-pdf-title">AM Feedback PDF</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn ghost history-close-btn icon-only-btn"
                                    onClick={downloadCurrentAmReportPdf}
                                    aria-label="Download PDF"
                                    title="Download PDF"
                                >
                                    <span className="material-symbols-outlined" aria-hidden="true">
                                        download
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className="btn ghost history-close-btn"
                                    onClick={requestCloseAmReportPdfPreview}
                                    aria-label="Close"
                                    title="Close"
                                >
                                    X
                                </button>
                            </div>
                        </div>
                        <div className="am-report-pdf-body">
                            {amReportPdfPreviewUrl ? (
                                <iframe
                                    title="AM Feedback PDF Preview"
                                    src={amReportPdfPreviewUrl}
                                    className="am-report-pdf-iframe"
                                />
                            ) : (
                                <p className="muted">Could not render PDF preview.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {detailedReportModalOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal question-modal am-report-stream-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="detailed-report-stream-title"
                    >
                        <div className="history-modal-header">
                            <h2 id="detailed-report-stream-title">Generating Detailed Report</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn danger"
                                    onClick={cancelDetailedReportGeneration}
                                    disabled={!isGeneratingDetailedReport}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                        <div className="question-modal-body am-report-stream-body" ref={detailedReportPreviewScrollRef}>
                            <div className="question-modal-inner am-report-stream-inner" aria-live="polite">
                                <div className="am-report-stream-content no-select">
                                    <ReactMarkdown>{detailedReportMarkdownPreview || 'Generating detailed report...'}</ReactMarkdown>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {detailedReportPdfPreviewOpen && (
                <div
                    className="overlay"
                    role="presentation"
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                            requestCloseDetailedReportPdfPreview()
                        }
                    }}
                >
                    <div
                        className="modal question-modal am-report-pdf-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="detailed-report-pdf-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="history-modal-header">
                            <h2 id="detailed-report-pdf-title">Detailed Interview Report PDF</h2>
                            <div className="summary-header-actions">
                                <button
                                    type="button"
                                    className="btn ghost history-close-btn icon-only-btn"
                                    onClick={downloadCurrentDetailedReportPdf}
                                    aria-label="Download PDF"
                                    title="Download PDF"
                                >
                                    <span className="material-symbols-outlined" aria-hidden="true">
                                        download
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className="btn ghost history-close-btn"
                                    onClick={requestCloseDetailedReportPdfPreview}
                                    aria-label="Close"
                                    title="Close"
                                >
                                    X
                                </button>
                            </div>
                        </div>
                        <div className="am-report-pdf-body">
                            {detailedReportPdfPreviewUrl ? (
                                <iframe
                                    title="Detailed Interview Report PDF Preview"
                                    src={detailedReportPdfPreviewUrl}
                                    className="am-report-pdf-iframe"
                                />
                            ) : (
                                <p className="muted">Could not render PDF preview.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {confirmCloseAmReportPdfOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="am-pdf-close-title"
                    >
                        <h2 id="am-pdf-close-title">Exit PDF preview?</h2>
                        <p className="muted">
                            If you exit now, the generated PDF will not be saved and will be discarded.
                        </p>
                        <div className="actions">
                            <button
                                type="button"
                                className="btn danger"
                                onClick={closeAmReportPdfPreviewConfirmed}
                            >
                                Exit
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setConfirmCloseAmReportPdfOpen(false)}
                            >
                                Stay
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmCloseDetailedReportPdfOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="detailed-pdf-close-title"
                    >
                        <h2 id="detailed-pdf-close-title">Exit PDF preview?</h2>
                        <p className="muted">
                            If you exit now, the generated PDF will not be saved and will be discarded.
                        </p>
                        <div className="actions">
                            <button
                                type="button"
                                className="btn danger"
                                onClick={closeDetailedReportPdfPreviewConfirmed}
                            >
                                Exit
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setConfirmCloseDetailedReportPdfOpen(false)}
                            >
                                Stay
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

            {confirmRegenerateQuestionsOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="regenerate-questions-title"
                    >
                        <h2 id="regenerate-questions-title">Re-generate questions?</h2>
                        <p className="muted">
                            Existing questions in this list will be overwritten.
                        </p>
                        <div className="actions">
                            <button
                                type="button"
                                className="btn danger"
                                onClick={confirmRegenerateQuestions}
                            >
                                Re-generate
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setConfirmRegenerateQuestionsOpen(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {generateQuestionsCountModalOpen && (
                <div className="overlay" role="presentation">
                    <div
                        className="modal compact"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="question-count-title"
                    >
                        <h2 id="question-count-title">How many questions?</h2>
                        <p className="muted">
                            Enter how many interview questions to generate.
                        </p>
                        <label htmlFor="question-count-input" className="label">
                            Question count
                        </label>
                        <input
                            id="question-count-input"
                            type="number"
                            className="field"
                            min={3}
                            max={40}
                            step={1}
                            value={generateQuestionsCountInput}
                            onChange={(event) => setGenerateQuestionsCountInput(event.target.value)}
                            autoFocus
                        />
                        <div className="actions">
                            <button
                                type="button"
                                className="btn"
                                onClick={confirmGenerateQuestionsCountSelection}
                            >
                                Generate Questions
                            </button>
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={closeGenerateQuestionsCountModal}
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
                                : pendingDeleteAction.kind === 'previous-answer'
                                    ? selectedPreviousAnswer?.source ===
                                        PREVIOUS_ANSWERS_SOURCE_LOCAL_STORAGE
                                        ? 'This will remove the selected answer from local storage history.'
                                        : `This will remove the selected answer and move linked saved files into ${RECYCLE_BIN_FOLDER_NAME} under the selected folder.`
                                    : 'This will remove the selected answer from Answer Summary only. Saved folder files will not be deleted.'}
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
                {activePopupMessage}
            </div>
            {hasKey && showKeyStatus && <div className="key-status-toast">{maskedSummary}</div>}
            {activePopupMessage && <div className="toast">{activePopupMessage}</div>}
        </div>
    )
}

export default App
