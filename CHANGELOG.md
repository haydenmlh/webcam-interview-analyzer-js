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
