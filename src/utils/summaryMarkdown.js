export function buildAnswerSummaryMarkdown(
    interviewSummaries,
    overallInterviewSummary,
    formatCapturedDate,
) {
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
        sections.push(`- Captured: ${formatCapturedDate(item.capturedAt)}`)
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
