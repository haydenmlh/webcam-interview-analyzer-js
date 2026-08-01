# Changelog

All notable changes to this project are documented in this file.

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
