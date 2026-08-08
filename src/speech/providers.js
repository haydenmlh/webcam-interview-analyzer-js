const DEFAULT_HF_STT_MODEL = 'Xenova/whisper-tiny.en'
const DEFAULT_HF_TTS_MODEL = 'hexgrad/Kokoro-82M'
const HF_MODELS_BASE_URL = 'https://router.huggingface.co/hf-inference/models'
const LOCAL_WHISPER_TARGET_SAMPLE_RATE = 16000

const whisperPipelineCache = new Map()

function parseBooleanEnv(value) {
    return String(value || '').trim().toLowerCase() === 'true'
}

function buildDefaultModelEndpoint(modelId) {
    return `${HF_MODELS_BASE_URL}/${modelId}`
}

function decodeBase64ToUint8Array(value) {
    if (typeof atob === 'function') {
        const binary = atob(value)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index)
        }
        return bytes
    }

    if (typeof globalThis.Buffer !== 'undefined') {
        return new Uint8Array(globalThis.Buffer.from(value, 'base64'))
    }

    throw new Error('Base64 decoding is unavailable in this environment.')
}

function asText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

async function readProviderErrorMessage(response) {
    try {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
            const payload = await response.json()
            return (
                asText(payload?.error) ||
                asText(payload?.message) ||
                asText(payload?.detail) ||
                ''
            )
        }

        const text = await response.text()
        return asText(text)
    } catch {
        return ''
    }
}

function normalizeHuggingFaceTranscript(payload) {
    if (!payload) return ''

    if (Array.isArray(payload)) {
        for (const item of payload) {
            const candidate =
                asText(item?.text) ||
                asText(item?.generated_text) ||
                asText(item?.transcription)
            if (candidate) return candidate
        }
        return ''
    }

    if (typeof payload === 'object') {
        return (
            asText(payload.text) ||
            asText(payload.generated_text) ||
            asText(payload.transcription) ||
            ''
        )
    }

    return ''
}

export class SpeechProviderError extends Error {
    constructor(message, options = {}) {
        super(message)
        this.name = 'SpeechProviderError'
        this.provider = options.provider || 'unknown'
        this.operation = options.operation || 'speech'
        this.statusCode = options.statusCode || null
        this.code = options.code || 'provider-error'
        this.cause = options.cause || null
    }
}

export function getSpeechFallbackConfig(env = {}) {
    const enabled = parseBooleanEnv(env.VITE_SPEECH_FALLBACK_ENABLED)
    const apiKey = asText(env.VITE_HF_API_KEY)

    const sttModel = asText(env.VITE_HF_STT_MODEL) || DEFAULT_HF_STT_MODEL
    const ttsModel = asText(env.VITE_HF_TTS_MODEL) || DEFAULT_HF_TTS_MODEL

    const sttEndpoint =
        asText(env.VITE_HF_STT_URL) || buildDefaultModelEndpoint(sttModel)
    const ttsEndpoint =
        asText(env.VITE_HF_TTS_URL) || buildDefaultModelEndpoint(ttsModel)

    return {
        enabled,
        apiKey,
        sttModel,
        ttsModel,
        sttEndpoint,
        ttsEndpoint,
    }
}

export function validateSpeechFallbackConfig(config) {
    const sttReady = Boolean(config.sttModel)
    const ttsReady = Boolean(config.apiKey && config.ttsEndpoint && config.ttsModel)
    const errors = []
    if (config.enabled) {
        if (!config.apiKey) errors.push('Missing VITE_HF_API_KEY for fallback.')
        if (!config.sttEndpoint) errors.push('Missing STT fallback endpoint.')
        if (!config.ttsEndpoint) errors.push('Missing TTS fallback endpoint.')
        if (!config.sttModel) errors.push('Missing STT fallback model ID.')
        if (!config.ttsModel) errors.push('Missing TTS fallback model ID.')
    }

    return {
        enabled: config.enabled,
        sttReady,
        ttsReady,
        errors,
    }
}

function mergeAudioBufferToMono(audioBuffer) {
    const channelCount = audioBuffer.numberOfChannels
    if (channelCount === 1) {
        return audioBuffer.getChannelData(0)
    }

    const mono = new Float32Array(audioBuffer.length)
    for (let channel = 0; channel < channelCount; channel += 1) {
        const channelData = audioBuffer.getChannelData(channel)
        for (let sampleIndex = 0; sampleIndex < channelData.length; sampleIndex += 1) {
            mono[sampleIndex] += channelData[sampleIndex]
        }
    }

    for (let sampleIndex = 0; sampleIndex < mono.length; sampleIndex += 1) {
        mono[sampleIndex] /= channelCount
    }

    return mono
}

function resampleFloat32Pcm(inputData, inputSampleRate, targetSampleRate) {
    if (inputSampleRate === targetSampleRate) {
        return inputData
    }

    const ratio = inputSampleRate / targetSampleRate
    const outputLength = Math.max(1, Math.round(inputData.length / ratio))
    const output = new Float32Array(outputLength)

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
        const position = outputIndex * ratio
        const left = Math.floor(position)
        const right = Math.min(inputData.length - 1, left + 1)
        const weight = position - left
        output[outputIndex] =
            inputData[left] * (1 - weight) + inputData[right] * weight
    }

    return output
}

async function decodeAudioBlobForWhisper(audioBlob) {
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AudioContextCtor) {
        throw new SpeechProviderError('Audio decoding is unavailable in this browser.', {
            provider: 'local-whisper',
            operation: 'stt',
            code: 'unsupported-browser',
        })
    }

    const audioContext = new AudioContextCtor()
    try {
        const sourceBuffer = await audioBlob.arrayBuffer()
        const decoded = await audioContext.decodeAudioData(sourceBuffer.slice(0))
        const mono = mergeAudioBufferToMono(decoded)
        return resampleFloat32Pcm(
            mono,
            decoded.sampleRate,
            LOCAL_WHISPER_TARGET_SAMPLE_RATE,
        )
    } finally {
        await audioContext.close()
    }
}

async function getWhisperPipeline(modelId) {
    const cacheKey = modelId || DEFAULT_HF_STT_MODEL
    if (!whisperPipelineCache.has(cacheKey)) {
        const pipelinePromise = import('@huggingface/transformers').then(
            async ({ pipeline }) =>
                pipeline('automatic-speech-recognition', cacheKey, {
                    quantized: true,
                }),
        )
        whisperPipelineCache.set(cacheKey, pipelinePromise)
    }

    return whisperPipelineCache.get(cacheKey)
}

async function requestLocalWhisperStt({ audioBlob, fallbackConfig, localWhisperTranscribeImpl }) {
    if (typeof localWhisperTranscribeImpl === 'function') {
        return localWhisperTranscribeImpl({ audioBlob, fallbackConfig })
    }

    const modelId = fallbackConfig?.sttModel || DEFAULT_HF_STT_MODEL
    const audioData = await decodeAudioBlobForWhisper(audioBlob)
    const asrPipeline = await getWhisperPipeline(modelId)

    const result = await asrPipeline(audioData, {
        return_timestamps: false,
        chunk_length_s: 20,
        stride_length_s: 5,
    })

    const transcript = asText(result?.text)
    if (!transcript) {
        throw new SpeechProviderError('Local Whisper did not return transcript text.', {
            provider: 'local-whisper',
            operation: 'stt',
            code: 'empty-result',
        })
    }

    return transcript
}

function shouldUseFallbackOnPrimaryFailure({ fallbackEnabled, fallbackReady, primaryError }) {
    if (!fallbackReady) return false
    if (fallbackEnabled) return true
    return primaryError?.code === 'missing-key'
}

export function classifyDeepgramFailure(error) {
    const statusCode = error?.statusCode ?? error?.status ?? null
    const code = error?.code || ''

    if (code === 'missing-key' || code === 'invalid-key') {
        return {
            shouldFallback: true,
            reason: 'key-validation',
        }
    }

    if (statusCode === 401 || statusCode === 403) {
        return {
            shouldFallback: true,
            reason: 'auth-failure',
        }
    }

    if (statusCode === 404) {
        return {
            shouldFallback: true,
            reason: 'endpoint-failure',
        }
    }

    if (statusCode === 408 || statusCode === 429) {
        return {
            shouldFallback: true,
            reason: 'provider-throttle-timeout',
        }
    }

    if (typeof statusCode === 'number' && statusCode >= 500) {
        return {
            shouldFallback: true,
            reason: 'provider-unavailable',
        }
    }

    if (code === 'network' || error?.name === 'AbortError') {
        return {
            shouldFallback: true,
            reason: 'network-failure',
        }
    }

    return {
        shouldFallback: true,
        reason: 'provider-error',
    }
}

function createHeaders(authValue, contentType) {
    const headers = {
        Authorization: authValue,
    }

    if (contentType) {
        headers['Content-Type'] = contentType
    }

    return headers
}

function buildDualFailureMessage(operation, primaryError, fallbackError) {
    const primaryMessage = primaryError?.message || 'Primary provider failed.'
    const fallbackCause = asText(fallbackError?.cause)
    const fallbackMessage = fallbackCause
        ? `${fallbackError?.message || 'Fallback provider failed.'} (${fallbackCause})`
        : fallbackError?.message || 'Fallback provider failed.'

    if (operation === 'stt') {
        return `Transcription failed with both providers. Deepgram: ${primaryMessage} Fallback: ${fallbackMessage}`
    }

    return `Question TTS failed with both providers. Deepgram: ${primaryMessage} Fallback: ${fallbackMessage}`
}

function attachSpeechMeta(error, meta) {
    error.speechMeta = meta
    return error
}

export function safeTranscriptFromDeepgram(payload) {
    return (
        asText(payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript) ||
        asText(payload?.transcript) ||
        ''
    )
}

async function requestDeepgramStt({ audioBlob, apiKey, endpoint, fetchImpl }) {
    if (!asText(apiKey)) {
        throw new SpeechProviderError('Saved key is invalid or missing.', {
            provider: 'deepgram',
            operation: 'stt',
            code: 'missing-key',
        })
    }

    let response
    try {
        response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: createHeaders(`Token ${apiKey}`, audioBlob.type || 'audio/webm'),
            body: audioBlob,
        })
    } catch (error) {
        throw new SpeechProviderError('Deepgram transcription request failed.', {
            provider: 'deepgram',
            operation: 'stt',
            code: 'network',
            cause: error,
        })
    }

    if (response.status === 401 || response.status === 403) {
        throw new SpeechProviderError('Saved key is invalid or revoked.', {
            provider: 'deepgram',
            operation: 'stt',
            statusCode: response.status,
            code: 'invalid-key',
        })
    }

    if (response.status === 429) {
        throw new SpeechProviderError('Transcription provider rate limit reached.', {
            provider: 'deepgram',
            operation: 'stt',
            statusCode: response.status,
            code: 'rate-limit',
        })
    }

    if (!response.ok) {
        throw new SpeechProviderError('Transcription failed on Deepgram.', {
            provider: 'deepgram',
            operation: 'stt',
            statusCode: response.status,
            code: 'provider-error',
        })
    }

    const payload = await response.json()
    const transcript = safeTranscriptFromDeepgram(payload)
    if (!transcript) {
        throw new SpeechProviderError('No transcript was returned by Deepgram.', {
            provider: 'deepgram',
            operation: 'stt',
            code: 'empty-result',
        })
    }

    return transcript
}

async function requestHuggingFaceStt({ audioBlob, fallbackConfig, fetchImpl }) {
    const { apiKey, sttEndpoint, sttModel } = fallbackConfig

    if (!apiKey || !sttEndpoint) {
        throw new SpeechProviderError('Hugging Face STT fallback is not configured.', {
            provider: 'huggingface',
            operation: 'stt',
            code: 'missing-config',
        })
    }

    let response
    try {
        response = await fetchImpl(sttEndpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': audioBlob.type || 'audio/webm',
                Accept: 'application/json',
                'X-Use-Cache': 'false',
            },
            body: audioBlob,
        })
    } catch (error) {
        throw new SpeechProviderError('Hugging Face transcription request failed.', {
            provider: 'huggingface',
            operation: 'stt',
            code: 'network',
            cause: error,
        })
    }

    if (!response.ok) {
        const providerMessage = await readProviderErrorMessage(response)
        throw new SpeechProviderError('Fallback transcription failed.', {
            provider: 'huggingface',
            operation: 'stt',
            statusCode: response.status,
            code: 'provider-error',
            cause: providerMessage || null,
        })
    }

    const payload = await response.json()
    const transcript = normalizeHuggingFaceTranscript(payload)

    if (!transcript) {
        throw new SpeechProviderError(
            `Fallback STT model ${sttModel} did not return transcript text.`,
            {
                provider: 'huggingface',
                operation: 'stt',
                code: 'empty-result',
            },
        )
    }

    return transcript
}

async function requestDeepgramTts({ text, apiKey, endpoint, fetchImpl }) {
    if (!asText(apiKey)) {
        throw new SpeechProviderError('Saved key is invalid or missing.', {
            provider: 'deepgram',
            operation: 'tts',
            code: 'missing-key',
        })
    }

    let response
    try {
        response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: createHeaders(`Token ${apiKey}`, 'application/json'),
            body: JSON.stringify({ text }),
        })
    } catch (error) {
        throw new SpeechProviderError('Deepgram TTS request failed.', {
            provider: 'deepgram',
            operation: 'tts',
            code: 'network',
            cause: error,
        })
    }

    if (response.status === 401 || response.status === 403) {
        throw new SpeechProviderError('Saved key is invalid or revoked.', {
            provider: 'deepgram',
            operation: 'tts',
            statusCode: response.status,
            code: 'invalid-key',
        })
    }

    if (!response.ok) {
        throw new SpeechProviderError('Question TTS failed on Deepgram.', {
            provider: 'deepgram',
            operation: 'tts',
            statusCode: response.status,
            code: 'provider-error',
        })
    }

    return response.blob()
}

async function requestHuggingFaceTts({ text, fallbackConfig, fetchImpl }) {
    const { apiKey, ttsEndpoint, ttsModel } = fallbackConfig

    if (!apiKey || !ttsEndpoint) {
        throw new SpeechProviderError('Hugging Face TTS fallback is not configured.', {
            provider: 'huggingface',
            operation: 'tts',
            code: 'missing-config',
        })
    }

    const payloadCandidates = [
        { inputs: text },
        { text },
        { inputs: { text } },
    ]

    if (asText(ttsModel).toLowerCase().includes('qwen3-tts')) {
        payloadCandidates.push(
            { text, language: 'English', speaker: 'Ryan' },
            { inputs: text, language: 'English', speaker: 'Ryan' },
            {
                text,
                language: 'English',
                speaker: 'Ryan',
                instruct: 'Speak naturally in a neutral interview tone.',
            },
        )
    }

    let lastProviderError = null

    for (const bodyPayload of payloadCandidates) {
        let response
        try {
            response = await fetchImpl(ttsEndpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'audio/wav, audio/mpeg, application/json',
                    'X-Use-Cache': 'false',
                },
                body: JSON.stringify(bodyPayload),
            })
        } catch (error) {
            throw new SpeechProviderError('Hugging Face TTS request failed.', {
                provider: 'huggingface',
                operation: 'tts',
                code: 'network',
                cause: error,
            })
        }

        if (!response.ok) {
            const providerMessage = await readProviderErrorMessage(response)

            if (providerMessage.includes("isn't deployed by any Inference Provider")) {
                throw new SpeechProviderError(
                    'Fallback question TTS model is not deployed on Hugging Face Inference Providers. Configure a custom TTS endpoint URL for this model.',
                    {
                        provider: 'huggingface',
                        operation: 'tts',
                        statusCode: response.status,
                        code: 'provider-not-deployed',
                        cause: providerMessage,
                    },
                )
            }

            lastProviderError = new SpeechProviderError('Fallback question TTS failed.', {
                provider: 'huggingface',
                operation: 'tts',
                statusCode: response.status,
                code: 'provider-error',
                cause: providerMessage || null,
            })

            // Some TTS models require a different JSON shape; retry on 400.
            if (response.status === 400) {
                continue
            }

            throw lastProviderError
        }

        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
            return response.blob()
        }

        const payload = await response.json()
        const base64Audio =
            asText(payload?.audio) ||
            asText(payload?.audio_base64) ||
            asText(payload?.data?.audio)

        if (!base64Audio) {
            throw new SpeechProviderError('Fallback question TTS did not return audio data.', {
                provider: 'huggingface',
                operation: 'tts',
                code: 'empty-result',
            })
        }

        const bytes = decodeBase64ToUint8Array(base64Audio)
        return new Blob([bytes], { type: 'audio/wav' })
    }

    if (lastProviderError) {
        throw lastProviderError
    }

    throw new SpeechProviderError('Fallback question TTS failed.', {
        provider: 'huggingface',
        operation: 'tts',
        code: 'provider-error',
    })
}

export async function transcribeWithFallback(options) {
    const {
        audioBlob,
        deepgramKey,
        deepgramEndpoint,
        fallbackConfig,
        fetchImpl = fetch,
        localWhisperTranscribeImpl,
    } = options

    const validation = validateSpeechFallbackConfig(fallbackConfig)

    try {
        const transcript = await requestDeepgramStt({
            audioBlob,
            apiKey: deepgramKey,
            endpoint: deepgramEndpoint,
            fetchImpl,
        })

        return {
            text: transcript,
            meta: {
                providerUsed: 'deepgram',
                fallbackApplied: false,
                fallbackReason: '',
            },
        }
    } catch (primaryError) {
        const classification = classifyDeepgramFailure(primaryError)

        const canUseFallback = shouldUseFallbackOnPrimaryFailure({
            fallbackEnabled: fallbackConfig.enabled,
            fallbackReady: validation.sttReady,
            primaryError,
        })

        if (!canUseFallback || !classification.shouldFallback) {
            throw attachSpeechMeta(primaryError, {
                providerUsed: 'deepgram',
                fallbackApplied: false,
                fallbackReason: '',
                primaryErrorMessage: primaryError.message,
            })
        }

        try {
            const useLocalWhisper = !asText(fallbackConfig?.apiKey)
            const fallbackTranscript = useLocalWhisper
                ? await requestLocalWhisperStt({
                    audioBlob,
                    fallbackConfig,
                    localWhisperTranscribeImpl,
                })
                : await requestHuggingFaceStt({
                    audioBlob,
                    fallbackConfig,
                    fetchImpl,
                })

            return {
                text: fallbackTranscript,
                meta: {
                    providerUsed: useLocalWhisper ? 'local-whisper' : 'huggingface',
                    fallbackApplied: true,
                    fallbackReason: classification.reason,
                    primaryErrorMessage: primaryError.message,
                },
            }
        } catch (fallbackError) {
            const combinedError = new SpeechProviderError(
                buildDualFailureMessage('stt', primaryError, fallbackError),
                {
                    provider: 'huggingface',
                    operation: 'stt',
                    code: 'dual-failure',
                    cause: fallbackError,
                },
            )

            throw attachSpeechMeta(combinedError, {
                providerUsed: 'huggingface',
                fallbackApplied: true,
                fallbackReason: classification.reason,
                primaryErrorMessage: primaryError.message,
                secondaryErrorMessage: fallbackError.message,
            })
        }
    }
}

export async function synthesizeWithFallback(options) {
    const {
        text,
        deepgramKey,
        deepgramEndpoint,
        fallbackConfig,
        fetchImpl = fetch,
    } = options

    const validation = validateSpeechFallbackConfig(fallbackConfig)

    try {
        const audioBlob = await requestDeepgramTts({
            text,
            apiKey: deepgramKey,
            endpoint: deepgramEndpoint,
            fetchImpl,
        })

        return {
            audioBlob,
            meta: {
                providerUsed: 'deepgram',
                fallbackApplied: false,
                fallbackReason: '',
            },
        }
    } catch (primaryError) {
        const classification = classifyDeepgramFailure(primaryError)

        const canUseFallback = shouldUseFallbackOnPrimaryFailure({
            fallbackEnabled: fallbackConfig.enabled,
            fallbackReady: validation.ttsReady,
            primaryError,
        })

        if (!canUseFallback || !classification.shouldFallback) {
            throw attachSpeechMeta(primaryError, {
                providerUsed: 'deepgram',
                fallbackApplied: false,
                fallbackReason: '',
                primaryErrorMessage: primaryError.message,
            })
        }

        try {
            const fallbackAudio = await requestHuggingFaceTts({
                text,
                fallbackConfig,
                fetchImpl,
            })

            return {
                audioBlob: fallbackAudio,
                meta: {
                    providerUsed: 'huggingface',
                    fallbackApplied: true,
                    fallbackReason: classification.reason,
                    primaryErrorMessage: primaryError.message,
                },
            }
        } catch (fallbackError) {
            if (fallbackError?.code === 'provider-not-deployed') {
                throw attachSpeechMeta(fallbackError, {
                    providerUsed: 'huggingface',
                    fallbackApplied: true,
                    fallbackReason: classification.reason,
                    primaryErrorMessage: primaryError.message,
                    secondaryErrorMessage: fallbackError.message,
                })
            }

            const combinedError = new SpeechProviderError(
                buildDualFailureMessage('tts', primaryError, fallbackError),
                {
                    provider: 'huggingface',
                    operation: 'tts',
                    code: 'dual-failure',
                    cause: fallbackError,
                },
            )

            throw attachSpeechMeta(combinedError, {
                providerUsed: 'huggingface',
                fallbackApplied: true,
                fallbackReason: classification.reason,
                primaryErrorMessage: primaryError.message,
                secondaryErrorMessage: fallbackError.message,
            })
        }
    }
}
