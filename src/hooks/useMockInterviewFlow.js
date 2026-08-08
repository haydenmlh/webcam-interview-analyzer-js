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

export function useMockInterviewFlow() {
    const [state, dispatch] = useReducer(reducer, {
        isMockQuestionOverlayVisible: false,
        isMockInterviewStarted: false,
        hasMockInterviewStartedOnce: false,
        isEndingMockInterview: false,
        answeredQuestionKeys: [],
    })

    const setField = useCallback((field, value) => {
        dispatch({ type: 'set', field, value })
    }, [])

    return {
        isMockQuestionOverlayVisible: state.isMockQuestionOverlayVisible,
        setIsMockQuestionOverlayVisible: (value) => setField('isMockQuestionOverlayVisible', value),
        isMockInterviewStarted: state.isMockInterviewStarted,
        setIsMockInterviewStarted: (value) => setField('isMockInterviewStarted', value),
        hasMockInterviewStartedOnce: state.hasMockInterviewStartedOnce,
        setHasMockInterviewStartedOnce: (value) => setField('hasMockInterviewStartedOnce', value),
        isEndingMockInterview: state.isEndingMockInterview,
        setIsEndingMockInterview: (value) => setField('isEndingMockInterview', value),
        answeredQuestionKeys: state.answeredQuestionKeys,
        setAnsweredQuestionKeys: (value) => setField('answeredQuestionKeys', value),
    }
}
