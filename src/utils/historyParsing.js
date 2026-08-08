function fallbackSanitizeDisplayText(value, fallback = '') {
    const normalized = String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
    const trimmed = normalized.trim()
    return trimmed || fallback
}

export function splitFileName(fileName, sanitizeText = fallbackSanitizeDisplayText) {
    const safeName = sanitizeText(fileName, 'unknown')
    const lastDot = safeName.lastIndexOf('.')
    if (lastDot <= 0) return { baseName: safeName, extension: '' }
    return {
        baseName: safeName.slice(0, lastDot),
        extension: safeName.slice(lastDot + 1).toLowerCase(),
    }
}

export function parseSessionJsonReport(
    fileName,
    content,
    fallbackDateIso,
    sortTime,
    folderPath = '',
    sanitizeText = fallbackSanitizeDisplayText,
) {
    try {
        const parsed = JSON.parse(content)
        const { baseName } = splitFileName(fileName, sanitizeText)
        const parsedTextFileName = sanitizeText(parsed?.savedFiles?.textFileName, '')
        const sourcePath = folderPath ? `${folderPath}/${fileName}` : fileName
        return {
            id: `${sourcePath}-${sortTime}-json`,
            baseName,
            source: sanitizeText(sourcePath, 'unknown-file'),
            reportFileName: fileName,
            folderPath,
            capturedAt: sanitizeText(
                parsed?.generatedAt ?? parsed?.capturedAt,
                fallbackDateIso,
            ),
            question: sanitizeText(parsed?.question, '(none)'),
            transcript: sanitizeText(
                parsed?.transcript ?? parsed?.answer,
                '(no transcript captured)',
            ),
            metrics:
                parsed?.interviewMetrics && typeof parsed.interviewMetrics === 'object'
                    ? parsed.interviewMetrics
                    : parsed?.metrics && typeof parsed.metrics === 'object'
                        ? parsed.metrics
                        : null,
            metricsText: sanitizeText(parsed?.outputText, ''),
            audioFileName: sanitizeText(
                parsed?.audioFileName ?? parsed?.savedFiles?.audioFileName,
                '',
            ),
            videoFileName: sanitizeText(
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
