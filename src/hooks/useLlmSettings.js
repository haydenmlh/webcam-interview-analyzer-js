import { useCallback, useReducer } from 'react'

function reducer(state, action) {
    if (action.type === 'set') {
        const previousValue = state[action.field]
        const nextValue =
            typeof action.value === 'function'
                ? action.value(previousValue)
                : action.value

        if (Object.is(previousValue, nextValue)) {
            return state
        }

        return {
            ...state,
            [action.field]: nextValue,
        }
    }

    return state
}

function initState(createInitialState) {
    return createInitialState()
}

export function useLlmSettings(createInitialState) {
    const [state, dispatch] = useReducer(reducer, createInitialState, initState)

    const setField = useCallback((field, value) => {
        dispatch({ type: 'set', field, value })
    }, [])

    return {
        llmProviderMode: state.llmProviderMode,
        setLlmProviderMode: (value) => setField('llmProviderMode', value),
        openrouterApiKey: state.openrouterApiKey,
        setOpenrouterApiKey: (value) => setField('openrouterApiKey', value),
        openrouterModel: state.openrouterModel,
        setOpenrouterModel: (value) => setField('openrouterModel', value),
        nimApiKey: state.nimApiKey,
        setNimApiKey: (value) => setField('nimApiKey', value),
        nimModel: state.nimModel,
        setNimModel: (value) => setField('nimModel', value),
        nimBaseUrl: state.nimBaseUrl,
        setNimBaseUrl: (value) => setField('nimBaseUrl', value),
        openrouterApiKeyInput: state.openrouterApiKeyInput,
        setOpenrouterApiKeyInput: (value) => setField('openrouterApiKeyInput', value),
        openrouterModelInput: state.openrouterModelInput,
        setOpenrouterModelInput: (value) => setField('openrouterModelInput', value),
        openrouterCustomModelInput: state.openrouterCustomModelInput,
        setOpenrouterCustomModelInput: (value) => setField('openrouterCustomModelInput', value),
        nimApiKeyInput: state.nimApiKeyInput,
        setNimApiKeyInput: (value) => setField('nimApiKeyInput', value),
        nimModelInput: state.nimModelInput,
        setNimModelInput: (value) => setField('nimModelInput', value),
        nimBaseUrlInput: state.nimBaseUrlInput,
        setNimBaseUrlInput: (value) => setField('nimBaseUrlInput', value),
        nimCustomModelInput: state.nimCustomModelInput,
        setNimCustomModelInput: (value) => setField('nimCustomModelInput', value),
        llmProviderModeInput: state.llmProviderModeInput,
        setLlmProviderModeInput: (value) => setField('llmProviderModeInput', value),
        llmSettingsError: state.llmSettingsError,
        setLlmSettingsError: (value) => setField('llmSettingsError', value),
        isSavingOpenrouterKey: state.isSavingOpenrouterKey,
        setIsSavingOpenrouterKey: (value) => setField('isSavingOpenrouterKey', value),
        isSavingNimKey: state.isSavingNimKey,
        setIsSavingNimKey: (value) => setField('isSavingNimKey', value),
    }
}
