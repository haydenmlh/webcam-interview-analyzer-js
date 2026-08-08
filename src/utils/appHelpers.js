export function buildModelOptionsWithCurrent(presets, customModelOptionValue) {
    const uniquePresets = presets.filter(
        (preset, index) =>
            preset?.value && presets.findIndex((entry) => entry.value === preset.value) === index,
    )

    const options = [...uniquePresets]
    options.push({
        value: customModelOptionValue,
        label: 'Custom model...',
    })
    return options
}

export function getModelSelectValue(currentModel, presets, customModelOptionValue) {
    const normalizedCurrent = String(currentModel || '').trim()
    if (!normalizedCurrent) return customModelOptionValue
    if (presets.some((preset) => preset.value === normalizedCurrent)) {
        return normalizedCurrent
    }
    return customModelOptionValue
}

export function normalizeEnumValue(value, allowedValues, fallbackValue) {
    return allowedValues.includes(value) ? value : fallbackValue
}

export function truncateText(value, maxLength) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ')
    if (!normalized) return ''
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}
