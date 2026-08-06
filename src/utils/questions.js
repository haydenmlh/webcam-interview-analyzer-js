function fallbackSanitizeDisplayText(value, fallback = '') {
    const normalized = String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
    const trimmed = normalized.trim()
    return trimmed || fallback
}

export function normalizeQuestionKey(questionText, sanitizeText = fallbackSanitizeDisplayText) {
    return sanitizeText(questionText, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

export function parseQuestionsFromBulkInput(rawBulkInput) {
    return rawBulkInput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
}

export function parseQuestionsFromUrlSearch(search, sanitizeText = fallbackSanitizeDisplayText) {
    if (!search) return []

    const params = new URLSearchParams(search)
    const candidates = []

    // Preferred format: ?questions=Q1%0AQ2%0AQ3 (newline-separated)
    const packedQuestions = sanitizeText(params.get('questions'), '')
    if (packedQuestions) {
        candidates.push(
            ...packedQuestions
                .split(/\r?\n|\|\|/)
                .map((item) => sanitizeText(item, '').trim())
                .filter(Boolean),
        )
    }

    // Alternate format: ?q=Question%201&q=Question%202
    const repeatedQuestions = params.getAll('q')
    for (const question of repeatedQuestions) {
        const normalized = sanitizeText(question, '').trim()
        if (normalized) candidates.push(normalized)
    }

    const unique = []
    const seen = new Set()
    for (const question of candidates) {
        const key = normalizeQuestionKey(question, sanitizeText)
        if (!key || seen.has(key)) continue
        seen.add(key)
        unique.push(question)
    }

    return unique
}

export function getImportedQuestionsFromCurrentUrl(sanitizeText = fallbackSanitizeDisplayText) {
    if (typeof window === 'undefined') return []
    return parseQuestionsFromUrlSearch(window.location.search, sanitizeText)
}
