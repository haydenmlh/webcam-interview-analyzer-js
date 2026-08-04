import { describe, expect, it, vi } from 'vitest'
import {
    getLlmProviderConfig,
    sendInterviewChatMessage,
    validateLlmProviderSettings,
} from './providers'

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

describe('llm providers', () => {
    it('returns default base URLs from env config helper', () => {
        const config = getLlmProviderConfig({})
        expect(config.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
        expect(config.nim.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    })

    it('validates missing settings', () => {
        expect(
            validateLlmProviderSettings({
                providerId: 'openrouter',
                apiKey: '',
                model: '',
                baseUrl: '',
            }),
        ).toContain('API key is required')
    })

    it('sends chat completion request and extracts text', async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                choices: [
                    {
                        message: {
                            content: 'Use more concrete impact numbers and reduce filler words.',
                        },
                    },
                ],
            }),
        )

        const result = await sendInterviewChatMessage({
            providerId: 'openrouter',
            apiKey: 'or-key-123',
            model: 'openai/gpt-oss-20b:free',
            baseUrl: 'https://openrouter.ai/api/v1',
            userMessage: 'How can I improve?',
            context: {
                question: 'Tell me about yourself',
                answer: 'I worked on several projects.',
                metricSummary: 'WPM 170, hesitations 8, gaze center 61%',
            },
            fetchImpl,
        })

        expect(result.providerId).toBe('openrouter')
        expect(result.text).toContain('Use more concrete impact numbers')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('maps auth failures to actionable error', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401))

        await expect(
            sendInterviewChatMessage({
                providerId: 'nim',
                apiKey: 'nim-key',
                model: 'meta/llama-3.1-8b-instruct',
                baseUrl: 'https://integrate.api.nvidia.com/v1',
                userMessage: 'check',
                context: {},
                fetchImpl,
            }),
        ).rejects.toMatchObject({
            message: expect.stringContaining('Authentication failed'),
            code: 'provider-http-error',
            status: 401,
        })
    })

    it('throws clear error for empty model response', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' } }] }))

        await expect(
            sendInterviewChatMessage({
                providerId: 'openrouter',
                apiKey: 'or-key-123',
                model: 'openai/gpt-oss-20b:free',
                baseUrl: 'https://openrouter.ai/api/v1',
                userMessage: 'check',
                context: {},
                fetchImpl,
            }),
        ).rejects.toMatchObject({
            message: expect.stringContaining('empty response'),
            code: 'provider-empty-response',
        })
    })
})
