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

export function useReportGeneration() {
    const [state, dispatch] = useReducer(reducer, {
        isGeneratingAmReport: false,
        isGeneratingDetailedReport: false,
        combinedReportModalOpen: false,
        amReportMarkdownPreview: '',
        detailedReportMarkdownPreview: '',
        combinedReportPdfPreviewOpen: false,
        amReportPdfPreviewUrl: '',
        amReportPdfBlob: null,
        amReportPdfFileName: '',
        detailedReportPdfPreviewUrl: '',
        detailedReportPdfBlob: null,
        detailedReportPdfFileName: '',
        confirmCloseCombinedReportPdfOpen: false,
    })

    const setField = useCallback((field, value) => {
        dispatch({ type: 'set', field, value })
    }, [])

    return {
        isGeneratingAmReport: state.isGeneratingAmReport,
        setIsGeneratingAmReport: (value) => setField('isGeneratingAmReport', value),
        isGeneratingDetailedReport: state.isGeneratingDetailedReport,
        setIsGeneratingDetailedReport: (value) => setField('isGeneratingDetailedReport', value),
        combinedReportModalOpen: state.combinedReportModalOpen,
        setCombinedReportModalOpen: (value) => setField('combinedReportModalOpen', value),
        amReportMarkdownPreview: state.amReportMarkdownPreview,
        setAmReportMarkdownPreview: (value) => setField('amReportMarkdownPreview', value),
        detailedReportMarkdownPreview: state.detailedReportMarkdownPreview,
        setDetailedReportMarkdownPreview: (value) => setField('detailedReportMarkdownPreview', value),
        combinedReportPdfPreviewOpen: state.combinedReportPdfPreviewOpen,
        setCombinedReportPdfPreviewOpen: (value) => setField('combinedReportPdfPreviewOpen', value),
        amReportPdfPreviewUrl: state.amReportPdfPreviewUrl,
        setAmReportPdfPreviewUrl: (value) => setField('amReportPdfPreviewUrl', value),
        amReportPdfBlob: state.amReportPdfBlob,
        setAmReportPdfBlob: (value) => setField('amReportPdfBlob', value),
        amReportPdfFileName: state.amReportPdfFileName,
        setAmReportPdfFileName: (value) => setField('amReportPdfFileName', value),
        detailedReportPdfPreviewUrl: state.detailedReportPdfPreviewUrl,
        setDetailedReportPdfPreviewUrl: (value) => setField('detailedReportPdfPreviewUrl', value),
        detailedReportPdfBlob: state.detailedReportPdfBlob,
        setDetailedReportPdfBlob: (value) => setField('detailedReportPdfBlob', value),
        detailedReportPdfFileName: state.detailedReportPdfFileName,
        setDetailedReportPdfFileName: (value) => setField('detailedReportPdfFileName', value),
        confirmCloseCombinedReportPdfOpen: state.confirmCloseCombinedReportPdfOpen,
        setConfirmCloseCombinedReportPdfOpen: (value) => setField('confirmCloseCombinedReportPdfOpen', value),
    }
}
