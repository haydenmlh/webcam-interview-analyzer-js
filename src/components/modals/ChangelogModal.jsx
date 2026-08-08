export default function ChangelogModal({
    isOpen,
    onClose,
    recentChangelogEntries,
}) {
    if (!isOpen) return null

    return (
        <div
            className="overlay changelog-overlay"
            role="presentation"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose()
                }
            }}
        >
            <div
                id="changelog-modal"
                className="modal question-modal changelog-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="changelog-title"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="history-modal-header changelog-modal-header-row">
                    <h2 id="changelog-title">Changelog (Last 10 Releases)</h2>
                    <div className="summary-header-actions">
                        <button
                            type="button"
                            className="btn ghost history-close-btn"
                            onClick={onClose}
                            aria-label="Close"
                            title="Close"
                        >
                            X
                        </button>
                    </div>
                </div>

                <div className="question-modal-body changelog-modal-body">
                    <div className="question-modal-inner changelog-modal-inner">
                        {recentChangelogEntries.length ? (
                            <div className="changelog-release-list">
                                {recentChangelogEntries.map((release) => (
                                    <article key={`${release.version}-${release.date}`} className="changelog-release-card">
                                        <h3>
                                            {release.version} <span className="muted">{release.date}</span>
                                        </h3>
                                        {release.sections.length ? (
                                            release.sections.map((section) => (
                                                <section key={`${release.version}-${section.title}`} className="changelog-section">
                                                    <p className="label changelog-section-title">{section.title}</p>
                                                    {section.bullets.length ? (
                                                        <ul className="changelog-bullet-list">
                                                            {section.bullets.map((item, index) => (
                                                                <li key={`${release.version}-${section.title}-${index}`}>{item}</li>
                                                            ))}
                                                        </ul>
                                                    ) : null}
                                                </section>
                                            ))
                                        ) : (
                                            <p className="muted">No changes listed.</p>
                                        )}
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <p className="muted">No changelog entries found.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
