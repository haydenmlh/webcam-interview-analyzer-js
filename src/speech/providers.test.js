import { describe, expect, it, vi } from 'vitest'
import {
    getSpeechFallbackConfig,
    synthesizeWithFallback,
    transcribeWithFallback,
    validateSpeechFallbackConfig,
} from './providers'

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

describe('speech providers fallback', () => {
    it('uses Deepgram transcript when primary succeeds', async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                results: {
                    channels: [
                        {
                            alternatives: [{ transcript: 'hello from deepgram' }],
                        },
                    ],
                },
            }),
        )

        const result = await transcribeWithFallback({
            audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
            deepgramKey: 'deepgram-valid-key-0123456789',
            deepgramEndpoint: 'https://example.deepgram/listen',
            fallbackConfig: { enabled: false },
            fetchImpl,
        })

        expect(result.text).toBe('hello from deepgram')
        expect(result.meta.providerUsed).toBe('deepgram')
        expect(result.meta.fallbackApplied).toBe(false)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('falls back to Hugging Face STT when Deepgram key is missing', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ text: 'hello from fallback' }, 200))

        const result = await transcribeWithFallback({
            audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
            deepgramKey: '',
            deepgramEndpoint: 'https://example.deepgram/listen',
            fallbackConfig: {
                enabled: false,
                apiKey: 'hf_key_1234567890',
                sttModel: 'openai/whisper-large-v3-turbo',
                ttsModel: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                sttEndpoint: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo',
                ttsEndpoint: 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
            },
            fetchImpl,
        })

        expect(result.text).toBe('hello from fallback')
        expect(result.meta.providerUsed).toBe('huggingface')
        expect(result.meta.fallbackApplied).toBe(true)
        expect(result.meta.fallbackReason).toBe('key-validation')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('falls back to local Whisper STT when Deepgram key is missing and no HF key is configured', async () => {
        const localWhisperTranscribeImpl = vi.fn(async () => 'hello from local whisper')

        const result = await transcribeWithFallback({
            audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
            deepgramKey: '',
            deepgramEndpoint: 'https://example.deepgram/listen',
            fallbackConfig: {
                enabled: false,
                apiKey: '',
                sttModel: 'Xenova/whisper-tiny.en',
                ttsModel: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                sttEndpoint: 'https://router.huggingface.co/hf-inference/models/Xenova/whisper-tiny.en',
                ttsEndpoint: 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
            },
            localWhisperTranscribeImpl,
        })

        expect(result.text).toBe('hello from local whisper')
        expect(result.meta.providerUsed).toBe('local-whisper')
        expect(result.meta.fallbackApplied).toBe(true)
        expect(localWhisperTranscribeImpl).toHaveBeenCalledTimes(1)
    })

    it('falls back to Hugging Face TTS when Deepgram key is missing', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify({ audio: 'dGVzdA==' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        )

        const result = await synthesizeWithFallback({
            text: 'Fallback TTS check',
            deepgramKey: '',
            deepgramEndpoint: 'https://example.deepgram/speak',
            fallbackConfig: {
                enabled: false,
                apiKey: 'hf_key_1234567890',
                sttModel: 'openai/whisper-large-v3-turbo',
                ttsModel: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                sttEndpoint: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo',
                ttsEndpoint: 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
            },
            fetchImpl,
        })

        expect(result.meta.providerUsed).toBe('huggingface')
        expect(result.meta.fallbackApplied).toBe(true)
        expect(result.meta.fallbackReason).toBe('key-validation')
        expect(result.audioBlob.size).toBeGreaterThan(0)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('throws actionable metadata when both STT providers fail', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ error: 'down' }, 503))

        await expect(
            transcribeWithFallback({
                audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
                deepgramKey: 'deepgram-valid-key-0123456789',
                deepgramEndpoint: 'https://example.deepgram/listen',
                fallbackConfig: {
                    enabled: true,
                    apiKey: 'hf_key_1234567890',
                    sttModel: 'openai/whisper-large-v3-turbo',
                    ttsModel: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                    sttEndpoint: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo',
                    ttsEndpoint: 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                },
                fetchImpl,
            }),
        ).rejects.toMatchObject({
            message: expect.stringContaining('Transcription failed with both providers.'),
            speechMeta: {
                providerUsed: 'huggingface',
                fallbackApplied: true,
            },
        })

        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('falls back to Hugging Face TTS and returns playable audio', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ error: 'invalid key' }, 401))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ audio: 'dGVzdA==' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            )

        const result = await synthesizeWithFallback({
            text: 'Tell me about yourself',
            deepgramKey: 'deepgram-valid-key-0123456789',
            deepgramEndpoint: 'https://example.deepgram/speak',
            fallbackConfig: {
                enabled: true,
                apiKey: 'hf_key_1234567890',
                sttModel: 'openai/whisper-large-v3-turbo',
                ttsModel: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                sttEndpoint: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo',
                ttsEndpoint: 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
            },
            fetchImpl,
        })

        expect(result.meta.providerUsed).toBe('huggingface')
        expect(result.meta.fallbackApplied).toBe(true)
        expect(result.audioBlob.size).toBeGreaterThan(0)
    })

    it('retries Hugging Face TTS with alternate payload after 400', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse({ error: 'invalid input shape' }, 400),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ audio: 'dGVzdA==' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            )

        const result = await synthesizeWithFallback({
            text: 'Retry TTS payload',
            deepgramKey: '',
            deepgramEndpoint: 'https://example.deepgram/speak',
            fallbackConfig: {
                enabled: false,
                apiKey: 'hf_key_1234567890',
                sttModel: 'openai/whisper-large-v3-turbo',
                ttsModel: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                sttEndpoint: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo',
                ttsEndpoint: 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
            },
            fetchImpl,
        })

        expect(result.meta.providerUsed).toBe('huggingface')
        expect(result.audioBlob.size).toBeGreaterThan(0)
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('shows clear error when TTS model is not deployed on inference providers', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(
            jsonResponse(
                { error: "This model isn't deployed by any Inference Provider." },
                400,
            ),
        )

        await expect(
            synthesizeWithFallback({
                text: 'Qwen deploy check',
                deepgramKey: '',
                deepgramEndpoint: 'https://example.deepgram/speak',
                fallbackConfig: {
                    enabled: false,
                    apiKey: 'hf_key_1234567890',
                    sttModel: 'openai/whisper-large-v3-turbo',
                    ttsModel: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                    sttEndpoint: 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo',
                    ttsEndpoint: 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
                },
                fetchImpl,
            }),
        ).rejects.toMatchObject({
            message: expect.stringContaining('not deployed on Hugging Face Inference Providers'),
            code: 'provider-not-deployed',
        })
    })

    it('validates fallback config readiness', () => {
        const config = getSpeechFallbackConfig({
            VITE_SPEECH_FALLBACK_ENABLED: 'true',
            VITE_HF_API_KEY: 'hf_key_123',
        })
        const validation = validateSpeechFallbackConfig(config)

        expect(validation.enabled).toBe(true)
        expect(validation.sttReady).toBe(true)
        expect(validation.ttsReady).toBe(true)
        expect(validation.errors).toHaveLength(0)
    })
})
