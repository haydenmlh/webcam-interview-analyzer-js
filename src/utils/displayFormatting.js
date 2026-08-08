export function formatMetricDisplayValue(key, value) {
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

export function formatFileSize(bytes) {
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
