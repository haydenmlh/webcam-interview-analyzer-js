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

export function useHistoryAnswers(createInitialState) {
    const [state, dispatch] = useReducer(reducer, createInitialState, initState)

    const setField = useCallback((field, value) => {
        dispatch({ type: 'set', field, value })
    }, [])

    return {
        previousAnswers: state.previousAnswers,
        setPreviousAnswers: (value) => setField('previousAnswers', value),
        isLoadingPreviousAnswers: state.isLoadingPreviousAnswers,
        setIsLoadingPreviousAnswers: (value) => setField('isLoadingPreviousAnswers', value),
        previousAnswersError: state.previousAnswersError,
        setPreviousAnswersError: (value) => setField('previousAnswersError', value),
        previousAnswersSource: state.previousAnswersSource,
        setPreviousAnswersSource: (value) => setField('previousAnswersSource', value),
        historyModalOpen: state.historyModalOpen,
        setHistoryModalOpen: (value) => setField('historyModalOpen', value),
        selectedPreviousAnswerId: state.selectedPreviousAnswerId,
        setSelectedPreviousAnswerId: (value) => setField('selectedPreviousAnswerId', value),
        selectedHistoryMedia: state.selectedHistoryMedia,
        setSelectedHistoryMedia: (value) => setField('selectedHistoryMedia', value),
        historyPlaybackRate: state.historyPlaybackRate,
        setHistoryPlaybackRate: (value) => setField('historyPlaybackRate', value),
        selectedPreviousAnswerFileSizes: state.selectedPreviousAnswerFileSizes,
        setSelectedPreviousAnswerFileSizes: (value) => setField('selectedPreviousAnswerFileSizes', value),
        selectedPreviousAnswerTotalSizeBytes: state.selectedPreviousAnswerTotalSizeBytes,
        setSelectedPreviousAnswerTotalSizeBytes: (value) => setField('selectedPreviousAnswerTotalSizeBytes', value),
        recycleBinSizeBytes: state.recycleBinSizeBytes,
        setRecycleBinSizeBytes: (value) => setField('recycleBinSizeBytes', value),
        recordingsFolderSizeBytes: state.recordingsFolderSizeBytes,
        setRecordingsFolderSizeBytes: (value) => setField('recordingsFolderSizeBytes', value),
        isRecycleBinBusy: state.isRecycleBinBusy,
        setIsRecycleBinBusy: (value) => setField('isRecycleBinBusy', value),
    }
}
