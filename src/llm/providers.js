const PROVIDER_LABELS = {
    openrouter: 'OpenRouter',
    nim: 'NVIDIA NIM',
}

const DEFAULT_BASE_URLS = {
    openrouter: 'https://openrouter.ai/api/v1',
    nim: 'https://integrate.api.nvidia.com/v1',
}

const DEFAULT_MODELS = {
    openrouter: '',
    nim: 'meta/llama-3.1-8b-instruct',
}

function providerLabel(providerId) {
    return PROVIDER_LABELS[providerId] || 'Selected provider'
}

function normalizeBaseUrl(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return ''
    return normalized.replace(/\/+$/, '')
}

function normalizeResponseText(content) {
    if (typeof content === 'string') return content.trim()

    if (Array.isArray(content)) {
        const textParts = content
            .map((item) => {
                if (typeof item === 'string') return item
                if (item && typeof item.text === 'string') return item.text
                return ''
            })
            .filter(Boolean)

        return textParts.join('\n').trim()
    }

    return ''
}

function toErrorMessage(providerId, message) {
    return `${providerLabel(providerId)}: ${message}`
}

function buildProviderHeaders(providerId, apiKey) {
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    }

    if (providerId === 'openrouter') {
        if (typeof window !== 'undefined' && window.location?.origin) {
            headers['HTTP-Referer'] = window.location.origin
        }
        headers['X-Title'] = 'Mock Interviewer'
    }

    return headers
}

function mapProviderError(providerId, status, fallbackMessage = '') {
    if (status === 401 || status === 403) {
        return toErrorMessage(providerId, 'Authentication failed. Check your API key.')
    }

    if (status === 429) {
        return toErrorMessage(providerId, 'Rate limit reached. Wait and retry.')
    }

    if (status >= 500) {
        return toErrorMessage(providerId, 'Provider is temporarily unavailable. Try again.')
    }

    if (fallbackMessage) {
        return toErrorMessage(providerId, fallbackMessage)
    }

    return toErrorMessage(providerId, `Request failed with HTTP ${status}.`)
}

function buildContextBlock(context = {}) {
    const question = context.question || '(no question)'
    const answer = context.answer || '(no transcript yet)'
    const metricSummary = context.metricSummary || 'No interview metrics yet'
    const companyName = context.companyName || '(not provided)'
    const cv = context.cv || '(not provided)'
    const jobDescription = context.jobDescription || '(not provided)'

    return [
        'Interview context:',
        `- Question: ${question}`,
        `- Answer transcript: ${answer}`,
        `- Metrics summary: ${metricSummary}`,
        `- Company: ${companyName}`,
        '- CV:',
        cv,
        '- Job Description:',
        jobDescription,
    ].join('\n')
}

export function getLlmProviderConfig(env = {}) {
    return {
        openrouter: {
            baseUrl: normalizeBaseUrl(env.VITE_OPENROUTER_BASE_URL) || DEFAULT_BASE_URLS.openrouter,
            model: String(env.VITE_OPENROUTER_MODEL || DEFAULT_MODELS.openrouter),
        },
        nim: {
            baseUrl: normalizeBaseUrl(env.VITE_NIM_BASE_URL) || DEFAULT_BASE_URLS.nim,
            model: String(env.VITE_NIM_MODEL || DEFAULT_MODELS.nim),
        },
    }
}

export function validateLlmProviderSettings({ providerId, apiKey, model, baseUrl }) {
    if (!providerId) return 'Select a provider.'

    if (!String(apiKey || '').trim()) {
        return toErrorMessage(providerId, 'API key is required in Settings.')
    }

    if (!String(model || '').trim()) {
        return toErrorMessage(providerId, 'Model is required in Settings.')
    }

    const normalizedBase = normalizeBaseUrl(baseUrl)
    if (!normalizedBase) {
        return toErrorMessage(providerId, 'Base URL is required in Settings.')
    }

    try {
        const parsed = new URL(normalizedBase)
        if (!/^https?:$/.test(parsed.protocol)) {
            return toErrorMessage(providerId, 'Base URL must use http or https.')
        }
    } catch {
        return toErrorMessage(providerId, 'Base URL must be a valid URL.')
    }

    return ''
}

export async function sendInterviewChatMessage({
    providerId,
    apiKey,
    model,
    baseUrl,
    userMessage,
    context,
    fetchImpl = fetch,
}) {
    const settingsError = validateLlmProviderSettings({
        providerId,
        apiKey,
        model,
        baseUrl,
    })
    if (settingsError) {
        const error = new Error(settingsError)
        error.code = 'settings-invalid'
        throw error
    }

    const prompt = String(userMessage || '').trim()
    if (!prompt) {
        const error = new Error('Enter a message first.')
        error.code = 'input-empty'
        throw error
    }

    const normalizedBase = normalizeBaseUrl(baseUrl)
    const endpoint = `${normalizedBase}/chat/completions`

    const requestBody = {
        model: String(model || '').trim(),
        temperature: 0.3,
        messages: [
            {
                role: 'system',
                content:
                    'You are an interview coach. Give practical, concise feedback using the supplied interview context. Reference measurable metrics when relevant and suggest actionable improvements.',
            },
            {
                role: 'user',
                content: `${buildContextBlock(context)}\n\nUser request:\n${prompt}`,
            },
        ],
    }

    let response
    try {
        response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: buildProviderHeaders(providerId, apiKey),
            body: JSON.stringify(requestBody),
        })
    } catch {
        const error = new Error(toErrorMessage(providerId, 'Network error. Check your connection and retry.'))
        error.code = 'network-error'
        throw error
    }

    let payload
    try {
        payload = await response.json()
    } catch {
        // Some providers can return non-JSON error bodies.
    }

    if (!response.ok) {
        const details = payload?.error?.message || payload?.error || payload?.message || ''
        const error = new Error(mapProviderError(providerId, response.status, String(details || '')))
        error.code = 'provider-http-error'
        error.status = response.status
        throw error
    }

    const firstChoice = payload?.choices?.[0]
    const text = normalizeResponseText(firstChoice?.message?.content)

    if (!text) {
        const error = new Error(toErrorMessage(providerId, 'Returned an empty response.'))
        error.code = 'provider-empty-response'
        throw error
    }

    return {
        text,
        providerId,
        model: String(model || '').trim(),
    }
}
