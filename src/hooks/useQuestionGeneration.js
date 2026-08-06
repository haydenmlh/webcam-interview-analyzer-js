import { useCallback, useState } from 'react'

export function useQuestionGeneration({
    isGeneratingQuestions,
    hasQuestionsInList,
    hasSummaryEntries,
    defaultQuestionCount,
    minQuestionCount,
    maxQuestionCount,
    onGenerateQuestions,
    onClearSummaryBeforeGenerate,
    onToast,
}) {
    const [confirmRegenerateQuestionsOpen, setConfirmRegenerateQuestionsOpen] = useState(false)
    const [confirmGenerateQuestionsClearSummaryOpen, setConfirmGenerateQuestionsClearSummaryOpen] = useState(false)
    const [generateQuestionsCountModalOpen, setGenerateQuestionsCountModalOpen] = useState(false)
    const [generateQuestionsCountInput, setGenerateQuestionsCountInput] = useState(
        String(defaultQuestionCount),
    )
    const [pendingGenerateQuestionsOptions, setPendingGenerateQuestionsOptions] = useState(null)
    const [pendingRegenerateQuestionsOptions, setPendingRegenerateQuestionsOptions] = useState(null)
    const [pendingGenerateQuestionsClearSummaryOptions, setPendingGenerateQuestionsClearSummaryOptions] = useState(null)

    const openGenerateQuestionsCountModal = useCallback((options = {}) => {
        if (isGeneratingQuestions) return
        setPendingGenerateQuestionsOptions(options)
        setGenerateQuestionsCountInput(String(defaultQuestionCount))
        setGenerateQuestionsCountModalOpen(true)
    }, [isGeneratingQuestions, defaultQuestionCount])

    const requestGenerateQuestionsFlow = useCallback((options = {}) => {
        if (isGeneratingQuestions) return

        if (hasSummaryEntries) {
            setPendingGenerateQuestionsClearSummaryOptions(options)
            setConfirmGenerateQuestionsClearSummaryOpen(true)
            return
        }

        openGenerateQuestionsCountModal(options)
    }, [isGeneratingQuestions, hasSummaryEntries, openGenerateQuestionsCountModal])

    const confirmGenerateQuestionsClearSummary = useCallback(() => {
        const options = pendingGenerateQuestionsClearSummaryOptions || {}
        setConfirmGenerateQuestionsClearSummaryOpen(false)
        setPendingGenerateQuestionsClearSummaryOptions(null)
        openGenerateQuestionsCountModal({
            ...options,
            clearSummaryOnGenerate: true,
        })
    }, [openGenerateQuestionsCountModal, pendingGenerateQuestionsClearSummaryOptions])

    const cancelGenerateQuestionsClearSummary = useCallback(() => {
        setConfirmGenerateQuestionsClearSummaryOpen(false)
        setPendingGenerateQuestionsClearSummaryOptions(null)
    }, [])

    const confirmGenerateQuestionsCountSelection = useCallback(() => {
        const parsedCount = Number.parseInt(generateQuestionsCountInput, 10)
        if (!Number.isInteger(parsedCount) || parsedCount < minQuestionCount || parsedCount > maxQuestionCount) {
            onToast(`Enter a question count between ${minQuestionCount} and ${maxQuestionCount}.`)
            return
        }

        const options = pendingGenerateQuestionsOptions || {}
        const { clearSummaryOnGenerate = false, ...generateOptions } = options

        if (clearSummaryOnGenerate) {
            onClearSummaryBeforeGenerate()
        }

        setGenerateQuestionsCountModalOpen(false)
        setPendingGenerateQuestionsOptions(null)
        onGenerateQuestions({
            ...generateOptions,
            questionCount: parsedCount,
        })
    }, [
        generateQuestionsCountInput,
        maxQuestionCount,
        minQuestionCount,
        onClearSummaryBeforeGenerate,
        onGenerateQuestions,
        onToast,
        pendingGenerateQuestionsOptions,
    ])

    const closeGenerateQuestionsCountModal = useCallback(() => {
        setGenerateQuestionsCountModalOpen(false)
        setPendingGenerateQuestionsOptions(null)
    }, [])

    const generateQuestionsInBackground = useCallback(() => {
        if (isGeneratingQuestions) return
        onToast('Generating questions in background...')
        requestGenerateQuestionsFlow({
            openQuestionsDrawer: false,
            runInBackground: true,
        })
    }, [isGeneratingQuestions, onToast, requestGenerateQuestionsFlow])

    const requestGenerateQuestionsFromQuestionsModal = useCallback((options = {}) => {
        if (isGeneratingQuestions) return

        if (hasQuestionsInList) {
            setPendingRegenerateQuestionsOptions(options)
            setConfirmRegenerateQuestionsOpen(true)
            return
        }

        requestGenerateQuestionsFlow(options)
    }, [hasQuestionsInList, isGeneratingQuestions, requestGenerateQuestionsFlow])

    const confirmRegenerateQuestions = useCallback(() => {
        const options = pendingRegenerateQuestionsOptions || {}
        setConfirmRegenerateQuestionsOpen(false)
        setPendingRegenerateQuestionsOptions(null)
        requestGenerateQuestionsFlow(options)
    }, [pendingRegenerateQuestionsOptions, requestGenerateQuestionsFlow])

    const cancelRegenerateQuestions = useCallback(() => {
        setConfirmRegenerateQuestionsOpen(false)
        setPendingRegenerateQuestionsOptions(null)
    }, [])

    const handleQuestionGenerationEscape = useCallback(() => {
        if (confirmRegenerateQuestionsOpen) {
            cancelRegenerateQuestions()
            return true
        }

        if (confirmGenerateQuestionsClearSummaryOpen) {
            cancelGenerateQuestionsClearSummary()
            return true
        }

        if (generateQuestionsCountModalOpen) {
            closeGenerateQuestionsCountModal()
            return true
        }

        return false
    }, [
        cancelGenerateQuestionsClearSummary,
        cancelRegenerateQuestions,
        closeGenerateQuestionsCountModal,
        confirmGenerateQuestionsClearSummaryOpen,
        confirmRegenerateQuestionsOpen,
        generateQuestionsCountModalOpen,
    ])

    return {
        confirmRegenerateQuestionsOpen,
        confirmGenerateQuestionsClearSummaryOpen,
        generateQuestionsCountModalOpen,
        generateQuestionsCountInput,
        setGenerateQuestionsCountInput,
        openGenerateQuestionsCountModal,
        confirmGenerateQuestionsClearSummary,
        cancelGenerateQuestionsClearSummary,
        confirmGenerateQuestionsCountSelection,
        closeGenerateQuestionsCountModal,
        generateQuestionsInBackground,
        requestGenerateQuestionsFromQuestionsModal,
        confirmRegenerateQuestions,
        cancelRegenerateQuestions,
        handleQuestionGenerationEscape,
    }
}
