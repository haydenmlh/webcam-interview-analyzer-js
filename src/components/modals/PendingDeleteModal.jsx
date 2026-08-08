function getPendingDeleteTitle(kind) {
    if (kind === 'parsed-question') return 'Delete question?'
    if (kind === 'previous-answer') return 'Delete previous answer?'
    if (kind === 'summary-answer') return 'Delete answer from summary?'
    return 'Clear all answers from summary?'
}

function getPendingDeleteMessage({
    kind,
    selectedPreviousAnswerSource,
    localStorageSourceValue,
    recycleBinFolderName,
}) {
    if (kind === 'parsed-question') {
        return 'This question will be removed from the Questions Import list.'
    }

    if (kind === 'previous-answer') {
        if (selectedPreviousAnswerSource === localStorageSourceValue) {
            return 'This will remove the selected answer from local storage history.'
        }

        return `This will remove the selected answer and move linked saved files into ${recycleBinFolderName} under the selected folder.`
    }

    if (kind === 'summary-answer') {
        return 'This will remove the selected answer from Answer Summary only. Saved folder files will not be deleted.'
    }

    return 'This will remove all answers from Answer Summary for this session only.'
}

export default function PendingDeleteModal({
    pendingDeleteAction,
    selectedPreviousAnswerSource,
    localStorageSourceValue,
    recycleBinFolderName,
    onConfirm,
    onCancel,
}) {
    if (!pendingDeleteAction) return null

    const { kind } = pendingDeleteAction

    return (
        <div className="overlay" role="presentation">
            <div
                className="modal compact"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-confirm-title"
            >
                <h2 id="delete-confirm-title">{getPendingDeleteTitle(kind)}</h2>
                <p className="muted">
                    {getPendingDeleteMessage({
                        kind,
                        selectedPreviousAnswerSource,
                        localStorageSourceValue,
                        recycleBinFolderName,
                    })}
                </p>
                <div className="actions">
                    <button
                        type="button"
                        className="btn danger"
                        onClick={onConfirm}
                    >
                        {kind === 'summary-all' ? 'Clear All' : 'Delete'}
                    </button>
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    )
}
