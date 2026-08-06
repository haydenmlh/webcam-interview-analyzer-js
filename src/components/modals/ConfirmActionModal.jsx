export default function ConfirmActionModal({
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    confirmClassName = 'btn danger',
    titleId,
}) {
    if (!isOpen) return null

    const resolvedTitleId = titleId || 'confirm-action-title'

    return (
        <div className="overlay" role="presentation">
            <div
                className="modal compact"
                role="dialog"
                aria-modal="true"
                aria-labelledby={resolvedTitleId}
            >
                <h2 id={resolvedTitleId}>{title}</h2>
                <p className="muted">{message}</p>
                <div className="actions">
                    <button
                        type="button"
                        className={confirmClassName}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                    <button
                        type="button"
                        className="btn ghost"
                        onClick={onCancel}
                    >
                        {cancelLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}
