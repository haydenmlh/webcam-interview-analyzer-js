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

## [1.7.24] - 2026-08-04

### Changed
- `Auto-Add` is now enforced as always enabled and cannot be turned off in Settings.

### Fixed
- Auto-Add summary behavior now ignores stale local storage values that previously disabled it, ensuring summary auto-add remains active by default.

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
