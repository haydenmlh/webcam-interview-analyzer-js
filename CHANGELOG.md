# Changelog

All notable changes to this project are documented in this file.

## Release Template

Use this template for future releases:

```md
## [X.Y.Z] - YYYY-MM-DD

### Added
-

### Changed
-

### Fixed
-
```

## [1.8.16] - 2026-08-05

### Changed
- Updated detailed-report PDF pagination so `Detailed Per-Question Analysis` starts on a new page, and each `Question N` section after Question 1 starts on its own new page.
- Updated the summary modal action label from `Copy Summary for Gem` to icon + `Copy All`.
- Removed the AM/Detailed PDF `Original LLM Output` panel and related report-preview artifacts to restore a single-pane PDF preview.

### Fixed
- PDF text normalization now keeps degree symbols (`°`) while still sanitizing unsupported glyphs.
- PDF text normalization now removes spacing between numbers and `%`/`°` so units remain attached (for example, `4%`, `19°`).

## [1.8.15] - 2026-08-05

### Changed
- Updated AM/Detailed report diagnostic panel (`Original LLM Output`) to display the raw unsanitized LLM response for easier problematic-character debugging.
- Extended LLM provider response handling to return both normalized text (used for generation pipelines) and raw text (used for diagnostics).

### Fixed
- Preserved leading/trailing raw response characters in streaming provider output by removing implicit trim from the raw streaming return path.

## [1.8.14] - 2026-08-05

### Added
- Added a `Generate Detailed Report` flow with streaming preview, PDF generation, and in-app PDF preview, including per-question analysis and suggested improved answers grounded in transcript/metrics/CV/JD context.
- Added an `Original LLM Output` section below AM/Detailed PDF previews for side-by-side raw-text inspection.

### Changed
- LLM API key persistence is now always enabled for browser storage; removed the Settings toggle and added `Clear keys and reset to defaults` next to `Save LLM settings`.
- Repositioned the `Previous Answers` side tab to the bottom of the camera panel.
- Updated multi-line recording/navigation controls with +3px top padding, and restored equal horizontal padding specifically for the `Generate Questions` button while keeping uneven `Next Question` horizontal padding.

### Fixed
- Hardened PDF text normalization for additional unsupported Unicode symbols (e.g., approximation/math variants), reducing garbled characters in exported report text.

## [1.8.13] - 2026-08-05

### Changed
- Updated default LLM model fallbacks to use `google/gemma-4-26b-a4b-it:free` for OpenRouter and `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` for NVIDIA NIM when no saved or environment override model is present.

## [1.8.12] - 2026-08-05

### Changed
- Updated question navigation controls to hide `Next Question` and `Previous Question` actions when no imported/generated question list exists.
- Added context-aware empty-state actions: show `Add JD and CV information` (opens CV/JD modal) when CV/JD is missing, otherwise show `Generate Questions`.
- `Generate Questions` from the empty-state action now runs in the background without opening the Questions modal and shows a background-generation notification.

## [1.8.11] - 2026-08-05

### Changed
- Updated repository release prompts so `/patch` and `/minor` skip `npm run lint` and `npm run build` by default, running validation only when explicitly requested.

## [1.8.10] - 2026-08-05

### Changed
- Updated AM feedback PDF output to include only the generated AM feedback section and removed the Source Answer Summary section from exported documents.

## [1.8.9] - 2026-08-05

### Changed
- Hardened AM PDF text normalization by mapping unicode punctuation and whitespace variants to safe plain-text equivalents before jsPDF layout.

### Fixed
- Removed additional hidden C1/control-byte artifacts from AM feedback text rendering, preventing misplaced characters and warped spacing in some copied/generated PDF output lines.

## [1.8.8] - 2026-08-05

### Changed
- Restored standard top padding for the AM PDF preview modal and aligned the History modal to equal padding on all four sides.
- Added bottom padding beneath the shared modal history header to improve spacing between the header row and body content.

### Fixed
- AM feedback PDF rendering now strips hidden ASCII control characters from generated text before layout, resolving warped word spacing in some LLM output lines.

## [1.8.7] - 2026-08-05

### Added
- Added an in-app AM feedback PDF preview modal that opens immediately after report generation, with a top action bar for icon-only download and close controls.
- Added an exit-confirmation popup for the AM PDF preview, including outside-click and close-button flows that require explicit confirmation before dismissing.

### Changed
- Updated AM report modal spacing with 5px top padding for both streaming and PDF preview variants.
- Updated PDF-exit warning copy to clearly state that undownloaded output will be discarded on exit.

### Fixed
- Improved AM feedback PDF text rendering by normalizing/sanitizing invisible Unicode spacing and control characters that caused warped line layout in some LLM-generated sections.
- Restored webcam-toggle persistence on refresh by removing permission-watcher logic that force-enabled camera state when permission was granted.

## [1.8.4] - 2026-08-05

### Added
- Added a left-side `Generate AM Report` tab between `Answer Summary` and `Previous Answers` to generate account-manager feedback from summary data and CV/JD context.
- Added AM report streaming preview modal with real-time LLM output, automatic scroll-to-latest behavior, and non-selectable preview text while generation is in progress.
- Added an explicit `Cancel` action in the AM report streaming modal that aborts the active provider request.

### Changed
- AM report prompt/guideline wording was updated to target consulting-firm account-manager feedback with concise aggregate sections and no per-question feedback.
- `Answer Summary` overview entries now show the question title in the top line and no longer show `Q1`/`Q2` numbering.
- `Invert camera` now defaults to enabled for first-time users, and its Settings popup toggle was moved to the top of Camera Display options.

### Fixed
- Replaced the AM PDF HTML rendering path with a deterministic markdown-token renderer to prevent blank/empty PDF output.
- AM PDF export now renders inline markdown emphasis (`**bold**`, `*italic*`) as styled text instead of literal markdown markers.
- AM PDF export now renders markdown tables as grid tables with wrapped cells, header styling, and repeated headers across page breaks.

## [1.8.2] - 2026-08-05

### Added
- Added an `Invert camera` toggle inside the webcam quick-settings menu using Material icon toggles.
- Added a browser unload warning when questions or answer summaries exist to prevent accidental refresh/close loss.

### Changed
- Answer summaries are now session-only and no longer persist in local storage across page refreshes.
- Added generation guidelines to the LLM question-generation context payload and prompt context block.

### Fixed
- Removed the light/dark mode toggle icon offset so the theme icon aligns without vertical nudge.

## [1.8.1] - 2026-08-05

### Changed
- Moved LLM provider routing control into Settings with `Auto`, `OpenRouter only`, and `NVIDIA NIM only` modes.
- `Auto` provider mode now attempts OpenRouter first and retries with NVIDIA NIM if OpenRouter fails during question generation.
- Restored `Questions List` to the original left-side tab trigger and removed the bottom-left questions dock flow.

### Fixed
- Removed the right-side `AI Feedback` panel/button and all related chat-rail artifacts/logic from the main UI.

## [1.8.0] - 2026-08-05

### Added
- Added a left-side `Generate Questions` tab between `Input CV/JD` and `Questions List` that opens the questions modal and generates interview questions from CV/JD/company context.
- Added streaming AI question generation into the Questions Import modal with in-place progress text while responses are received.

### Changed
- Updated the CV/JD modal actions: renamed the copy action to `Copy` and added `Generate Questions` with a context-generation tooltip.
- AI Feedback assistant responses now render with Markdown formatting for headings, lists, code blocks, and links.

### Fixed
- Generated questions now immediately update the webcam question overlay to the first generated question.
- NVIDIA NIM chat requests now use a dev proxy path to avoid local browser CORS preflight failures.

## [1.7.29] - 2026-08-04

### Added
- Added a left-side recording-row Deepgram key status link that shows `Deepgram Key Missing` or `Deepgram Key Invalid` when applicable.

### Changed
- Clicking the Deepgram key status link now opens Settings and focuses/selects the Deepgram API key input for faster correction.

### Fixed
- When video is disabled, the webcam overlay video toggle icon now renders in red for clearer disabled-state feedback.

## [1.7.28] - 2026-08-04

### Changed
- Reworked camera display controls into three explicit modes: `Show both`, `Show self only`, and `Show interviewer only`, replacing conflicting independent toggle combinations.
- Updated interviewer customization copy in Settings: `Upload Interviewer Image` is now `Choose Custom Interviewer` with matching helper text.
- Reduced quick webcam-settings row density by lowering option text size and per-row height.

### Fixed
- Corrected camera layering so self-view always renders beneath the meeting overlay image.
- Improved caret/menu responsiveness by reducing analysis workload and batching camera metric UI updates.
- Removed hand and shoulder detection pipelines (and related metrics) to reduce runtime overhead and improve interactivity.

## [1.7.27] - 2026-08-04

### Added
- Added webcam quick-settings mode controls and interviewer/overlay composition improvements, including persistent meeting overlay support.

### Changed
- Refined webcam quick-settings menu visuals and interactions (icon colors, hover hierarchy, compact spacing, and menu width/alignment).
- Updated camera display behavior so interviewer imagery remains behind the fixed meeting overlay while preserving easter-egg interviewer selection behavior.
- Improved quick-settings option labeling and ordering for clearer display-state selection.

### Fixed
- Prevented invalid camera-display combinations that could result in unintuitive blank/contradictory states.
- Kept quick-settings popup open while toggling options, closing only on outside click.

## [1.7.26] - 2026-08-04

### Changed
- Removed the footer version display and moved app version text into the Settings modal header next to the title.
- Refined topbar button styling consistency by consolidating button-specific selectors and spacing/padding alignment.

### Fixed
- Restored proper icon/text centering for the `Open Gemini` topbar button after selector cleanup.
- `No face detected` is now shown only when Camera Debug Overlay (`Debug`) is enabled.

## [1.7.25] - 2026-08-04

### Added
- Added manual build and deployment instructions in `README.md` for non-GitHub-Actions workflows.

### Changed
- Removed the notification popup for the easter egg.

### Fixed
- `Next Question` now advances on the first click instead of occasionally re-selecting the current first question.

## [1.7.24] - 2026-08-04

### Changed
- `Auto-Add` is now enforced as always enabled and cannot be turned off in Settings.

### Fixed
- Auto-Add summary behavior now ignores stale local storage values that previously disabled it, ensuring summary auto-add remains active by default.

### Added
- Added a hidden easter egg that appears after pressing a particular button a certain number of times.

## [1.7.23] - 2026-08-04

### Added
- Added selected recording-folder size display in Settings: `Current folder: <name> (Size: xx MB)`.

### Changed
- Renamed `Session Summary` UI labels to `Answer Summary` across topbar, modal title, action labels, and related confirmation messaging.
- Question overlay numbering now uses `1.` style instead of `#1` for improved readability.
- Removed the `Question, Transcript and Metrics` panel from the main layout.
- Moved the `Changelog` text link into the Settings modal header and aligned it directly left of the close (`X`) button.
- Updated the `Changelog` modal overlay stacking so it opens above the Settings modal.
- Refined spacing in Settings around the key actions row and reduced the height of the Deepgram API key input and Save key button.
- Adjusted history modal header spacing to use margin-based side and vertical spacing.

### Fixed
- Excluded the release template placeholder (`X.Y.Z`) from the in-app changelog modal list.
- Warning surfaces that were shown inline in the removed panel are now shown through popup toast notifications.

## [1.7.22] - 2026-08-04

### Changed
- Moved the webcam question text overlay up by 15px for improved readability and framing.
- The interviewer image is now non-draggable to prevent accidental drag behavior in the camera panel.

### Fixed
- `Next Question` now becomes unavailable immediately when recording start begins, eliminating the brief moment it could still be pressed between TTS start and recording.

## [1.7.21] - 2026-08-04

### Added
- Added a custom webcam background workflow for the interviewer view: you can now upload a custom interviewer image and switch between built-in and uploaded backgrounds in Settings.
- Added a changelog modal accessible from the footer (`Last 10 Changes`) that displays the 10 most recent releases.
- Session summary now persists across page refreshes, including saved summary entries and selected summary view state.

### Changed
- Changelog modal content is now populated directly from `CHANGELOG.md`.

## [1.7.20] - 2026-08-04

### Fixed
- Fixed metrics display for `gazeDeviationDirectionCounts` so it renders as readable direction counts (`L / R / U / D`) instead of `[object Object]`.

## [1.7.19] - 2026-08-04

### Changed
- Reduced top bar height for a slimmer header appearance.
- Reduced topbar button sizing and global button vertical padding for a more compact UI.

### Fixed
- Updated camera placeholder copy to show `Camera disabled` when camera is not enabled.

## [1.7.18] - 2026-08-03

### Added
- Added a `Deepgram Debug` checkbox setting under the key privacy warning in Settings.

### Changed
- Transcription provider and TTS provider notification text is now hidden by default and only shown when `Deepgram Debug` is enabled.

## [1.7.17] - 2026-08-03

### Changed
- Renamed the `Previous Answers` overview action from `Select Folder` to `Reselect Folder`.
- Deleting an answer from `Previous Answers` now moves linked files into `_Recycle Bin` under the selected save folder instead of permanently deleting them.

### Fixed
- Updated delete confirmation and toast messaging to reflect recycle-bin move behavior.

## [1.7.16] - 2026-08-03

### Changed
- `Next Question` now cycles through all questions in the imported question list, including questions that were answered previously.
- `Interview question` now shows the matching question-list position (for example, `Interview question (#3)`) when the current question comes from the imported list.

## [1.7.15] - 2026-08-03

### Added
- Added `Auto-save Video/Audio Answer to Folder` under `Recording Save Folder` settings.

### Changed
- Added a single `Download Recording` button on the `Add to Summary` action row (far left) when folder access is unavailable or media auto-save is disabled.
- `Download Recording` now downloads the recording for the selected mode (video/audio), with a fallback to the other available recording when needed.

## [1.7.14] - 2026-08-03

### Changed
- `Delete Answer from Summary` now removes entries from Session Summary only and no longer deletes files from the selected folder.
- Folder-file deletion is now only performed from the `Previous Answers` modal delete flow.

### Fixed
- Updated delete confirmation messaging to clearly distinguish session-only summary deletion from folder-file deletion.

## [1.7.13] - 2026-08-03

### Changed
- Updated camera placeholder copy to: `Camera preview will appear here after Camera is enabled`.

### Fixed
- Increased padding on the camera placeholder message for slightly improved readability.

## [1.7.12] - 2026-08-03

### Fixed
- Updated the `Input CV/JD` modal layout so `CV` and `Job Description` textareas expand to fill available vertical space.
- Removed excess blank space at the bottom of the `Input CV/JD` modal on taller screens.

## [1.7.11] - 2026-08-03

### Fixed
- Removed an unintended drawer-grid layout class from the CV/JD modal content container that was stretching the `CV` label row on taller screens.
- Eliminated the large blank vertical gap between the `CV` label and the CV input area in the `Input CV/JD` modal.

## [1.7.10] - 2026-08-03

### Changed
- Updated `Next Question` button styling to use the same primary color scheme as `Add to Summary`.

## [1.7.9] - 2026-08-03

### Changed
- Removed MP3/MP4 conversion dependencies and conversion paths from the recording flow.
- Recordings are now kept in their original browser-captured formats for better cross-browser reliability.

### Fixed
- Eliminated recurring conversion failures that occurred during MP3/MP4 post-processing.

## [1.7.8] - 2026-08-03

### Added
- Added a `Clear Questions List` button to the Questions Import modal header, next to the close (`X`) button.

### Changed
- Clearing the questions list now resets the modal's parsed question input in one action.

## [1.7.7] - 2026-08-03

### Changed
- Updated CV/JD modal to use the same sizing behavior as the Questions List modal.
- Removed the CV/JD left panel and simplified the modal to a single-column content layout.

## [1.7.6] - 2026-08-03

### Changed
- When camera permission is already granted, the app now starts the camera automatically (when `Enable Camera` is on) instead of showing `Allow Camera Access`.

### Fixed
- `Allow Camera Access` button is no longer shown when browser camera permission is already granted.

## [1.7.5] - 2026-08-03

### Changed
- Moved `Invert camera` into the `Camera Display` settings section, directly under the display toggles.
- Removed the separate `Camera Orientation` settings section.

## [1.7.4] - 2026-08-03

### Fixed
- Re-enabling `Show Self View` now reliably restores the live camera preview without requiring a camera disable/enable cycle.
- Camera preview stream is reattached to the self-view element after it remounts, and analysis loop resumes when preview is visible.

## [1.7.3] - 2026-08-03

### Added
- Dismiss (X) control beside `Select Save Folder` to hide the save-folder prompt row.

### Changed
- Moved session action controls (Add to Summary, auto-add checkbox, download actions) above the Interview question title and below the save-folder row.

## [1.7.2] - 2026-08-03

### Changed
- Moved the session actions row (Add to Summary, auto-add checkbox, and download actions) above the transcript box and below the question input area.
- Refined camera and session panel spacing/alignment behavior for better use of available vertical space.

### Fixed
- Removed extra spacing artifacts around camera controls when the `Allow Camera Access` control visibility changes.

## [1.7.1] - 2026-08-03

### Changed
- Session question/transcript/metrics panel now expands to fill available vertical space.
- Removed extra top spacing above the camera frame for tighter panel alignment.

### Fixed
- Eliminated extra empty space under the Start Audio/Start Video actions after `Allow Camera Access` is hidden.

## [1.7.0] - 2026-08-03

### Added
- Interviewer mock image view in the camera panel using `src/assets/interviewer.jpg`.
- New Settings toggles for `Enable Camera`, `Show Interviewer`, and `Show Self View`, each with local persistence.

### Changed
- Camera panel now supports interviewer-first composition with optional self-view PiP near the lower-right corner.
- `Allow Camera Access` now disappears after the first successful permission grant; ongoing camera control is handled in Settings.
- Removed the explicit Camera View section title for a cleaner camera panel.

## [1.6.1] - 2026-08-03

### Added
- CV/JD modal for managing company name, CV, and job description, including Gemini-ready copy output.
- Invert camera toggle in Settings with local persistence.

### Changed
- Key-saved confirmation now appears as a bottom-right popup notification instead of inline beneath the interview question field.
- Gemini launcher now uses a best-effort blank-window-then-navigate popup flow to improve behavior on stricter browsers (including macOS browsers).

### Fixed
- Recording action row alignment refined to reduce extra spacing beneath Start Audio/Start Video actions.

## [1.6.0] - 2026-08-03

### Added
- Page-load URL parameter support for importing multiple interview questions.
- Accepted URL formats:
  - `?questions=` with newline-separated items
  - repeated `?q=` parameters

### Changed
- Imported URL questions now prefill the Questions Import list automatically.
- The first imported URL question is set as the active Interview question on initial load.

## [1.5.0] - 2026-08-03

### Added
- Topbar Open Gemini action that launches Gemini in a right-side popup panel.
- Open Gemini button label and icon treatment in the topbar for clearer discoverability.

### Changed
- Gemini popup now uses a fixed debug width for consistent testing behavior.

### Fixed
- Corrected popup-blocked false-positive toast behavior in browsers where popup windows open successfully.

## [1.4.4] - 2026-08-03

### Added
- Compact interview metrics panel under the transcript box for the current answered question.
- Copy Output for Gemini action to copy current question output (transcript + metrics) to clipboard.

### Changed
- Transcript metrics values are now shown only after a recording is stopped and transcribed.

### Fixed
- Removed Download Video and Download Audio buttons from the session output area to streamline the export workflow.

## [1.4.3] - 2026-08-01

### Changed
- Mobile camera header controls were refined so Allow Camera Access uses a narrower width and is positioned above the secondary camera control.
- Start Audio Recording and Start Video Recording actions are now centered in the camera panel.

### Fixed
- Removed Mock Interview Mode completely, including its button, rendering logic, and styles, restoring the standard camera preview behavior.

## [1.4.2] - 2026-08-01

### Changed
- Next Question no-next state now uses a recording-style disabled appearance with `#5399a5` and white text.
- Next Question guidance now appears as an in-app tooltip above the button on hover/focus (instead of the native title tooltip) while preserving click-to-open Questions Import behavior.

### Fixed
- Removed the Previous Answers box from the question/transcript panel on desktop.
- Removed the remaining Previous Answers panel warning surface from mobile in the same question/transcript area.

## [1.4.1] - 2026-08-01

### Changed
- Next Question no-next state now uses a desaturated disabled-look style aligned with recording controls (`#5399a5` with white text).
- Next Question was simplified back to a single desktop button after style comparison testing.

### Fixed
- Replaced the native title hover on Next Question (no-next state) with an in-app popup tooltip shown above the button on hover/focus, while preserving click-to-open Questions Import behavior.

## [1.4.0] - 2026-08-01

### Added
- Next Question now opens the Questions Import modal when there are no available unanswered questions.
- Next Question hover guidance for empty bank/exhausted state: "No next question, click to add new questions."

### Changed
- Desktop side-tab labels updated for clarity:
  - Questions -> Questions Import
  - Summary -> Session Summary
- Side-tab sizing/spacing adjusted so all three desktop tabs support two-line labels with consistent vertical spacing.

### Fixed
- Summary and Previous Answers side-tab spacing regressions after two-line tab updates.

## [1.3.0] - 2026-08-01

### Added
- Delete Answer actions in both Interview Session Summary and Previous Answers detail views.
- Folder-backed file deletion flow that removes linked JSON/TXT/audio/video files when deleting an answer.

### Changed
- Previous Answers action layout updates:
  - Add to Summary now stays disabled when the selected answer already exists in summary.
  - Copy action renamed to "Copy Transcript and Metrics".
  - Delete actions now use red danger styling.
- Summary and history naming refresh:
  - "Interview Session Summary" title
  - "Copy Session Summary for Gem" action label

### Fixed
- Summary modal sizing and column split alignment with Previous Answers.
- Summary overall-metrics selection now correctly opens aggregate details in the right pane.

## [1.2.1] - 2026-08-01

### Changed
- Settings modal title updated to "Settings" with a sticky top header and dedicated close (X) button.
- Deepgram key action buttons (Show key / Remove key) repositioned below the API key input for improved form flow.
- Mobile question controls refined: Questions List and Next Question now share equal-width row actions.

### Fixed
- Mobile settings header spacing/anchoring issues that caused content to leak during scroll.
- Mobile settings close button width/stretch behavior.
- Mobile view cleanup: hid Previous Answers panel section and Recording Save Folder settings section.

## [1.2.0] - 2026-08-01

### Added
- Next Question action beside Interview question to pull the next unimported question from the Questions bank.
- Material Symbols icons for theme toggle and settings controls.
- Mobile Questions modal access from the Interview question area, including a Questions List button.
- Date-folder organization for saved sessions (for example `YYYY-MM-DD`) with recursive Previous Answers loading.
- Folder/date badges in Previous Answers to show where each report is stored.

### Changed
- Questions desktop experience moved from slide-in drawer to modal while retaining the existing question bank/import UI.
- Recording controls moved to the bottom of the camera panel for both desktop and mobile.
- Camera preview/frame now uses full camera panel width.
- Camera and interview/transcript panels were rebalanced and aligned to matched centered widths.
- Header/topbar sizing and spacing refined for a more compact layout.
- Header controls now use Material Symbols with reduced icon button sizing.
- Mobile Interview question controls now place the title above actions, with Questions List and Next Question as equal-width row actions.
- Mobile camera header keeps Camera View and Allow Camera Access on the same row.

### Fixed
- Prevent duplicate additions for the same summary entry.
- Skip summary/metrics/file saves when transcript is empty.
- Side-tab positioning and camera-panel spacing refinements.
- No-face status and recording action spacing cleanup in camera panel.
- Mobile tooltip dismissal no longer shifts focus into the interview question field.
- Disabled Previous Answers tooltip interactions no longer trigger mobile scroll jumps.
- Interview question input placeholder text corrected to "Type your question here".

## [1.1.0] - 2026-08-01

### Added
- Desktop side tabs for Questions, Summary, and Previous Answers.
- Questions panel with multi-line import list and per-question import action.
- Summary experience upgraded to a full modal with:
  - Overall metrics
  - Per-answer transcript and metrics detail
  - Copy Summary for Gem export
- Add to Summary button in the session action area.

### Changed
- Previous Answers entry moved to side-tab behavior on desktop.
- Download Video and Download Audio actions now display only when folder access is unavailable or no folder is selected.
- Updated UX copy in folder-selection messaging for better clarity.

### Fixed
- CSS layout/stability fixes around panel layering and tab positioning.
- Responsive spacing and alignment refinements for desktop/mobile controls.
- Button sizing and spacing consistency for question parsing controls.

## [1.0.3] - 2026-08-01

### Added
- iPhone-specific feature gating for folder-based save/history workflows.
- Split media download actions for video and audio.
- Tooltip-based disabled-state explanations.

### Changed
- App branding updated to Mock Interviewer.
- Deploy domain updated to interview.haydenmlh.com.
- Version constant centralized in src/version.js.

### Fixed
- Modal sizing/stretch behavior issues.
- Mobile button width/wrapping inconsistencies.

## [1.0.2] - 2026-08-01

### Added
- Initial stable feature baseline for camera interview analysis workflow.

## Bug Fix Directions

General bug-fix areas to prioritize:
- Browser compatibility and permissions (camera/mic/folder access edge cases).
- Session save/load resilience (folder permission changes, missing files).
- UI layering and responsiveness (drawer/modal overlap, mobile wrapping).
- Media conversion and export fallbacks (audio/video codec/path differences).
- Copy/export ergonomics for AI workflows (Gemini-ready formatting).
