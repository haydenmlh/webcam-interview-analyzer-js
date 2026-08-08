function fallbackSanitizeDisplayText(value, fallback = '') {
    const normalized = String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
    const trimmed = normalized.trim()
    return trimmed || fallback
}

export function formatSessionTimestamp(dateValue) {
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

export function sanitizeQuestionForFileName(question, sanitizeText = fallbackSanitizeDisplayText) {
    const safeText = sanitizeText(question, 'question')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return (safeText || 'question').slice(0, 30)
}

export function buildSessionFileBaseName(
    capturedAtIso,
    question,
    sanitizeText = fallbackSanitizeDisplayText,
) {
    const stamp = formatSessionTimestamp(capturedAtIso)
    const safeQuestion = sanitizeQuestionForFileName(question, sanitizeText)
    return `${stamp}_${safeQuestion}`
}

export function buildSessionDateFolderName(capturedAtIso) {
    const source = capturedAtIso || new Date().toISOString()
    const parsed = new Date(source)
    const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed
    const year = safeDate.getFullYear()
    const month = String(safeDate.getMonth() + 1).padStart(2, '0')
    const day = String(safeDate.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export function formatReadableCapturedDate(value, sanitizeText = fallbackSanitizeDisplayText) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return sanitizeText(value, 'unknown-date')
    }

    const month = parsed.toLocaleString('en-US', { month: 'short' })
    const day = parsed.getDate()
    const year = parsed.getFullYear()
    return `${month}/${day}/${year}`
}
