# webcam-interview-analyzer-js

Mock Interviewer is a React + Vite web app for practicing interview answers with live camera posture cues, audio/video recording, and Deepgram-powered transcription.

Current app version: 1.5.0

## Highlights

- Deepgram BYOK settings with local key persistence and optional server-side validation endpoint
- Live MediaPipe analysis (face, hand, and pose) with feedback metrics
- Start Video Recording and Start Audio Recording workflows
- Stop and Transcribe flow with transcript and interview metrics
- Add to Summary action for current answer/transcript
- Copy Summary for Gem export in Gemini-friendly markdown format
- Copy Output for Gemini action for the current answered question (transcript + metrics)
- Open Gemini topbar action that launches Gemini in a right-side popup panel for quick paste-and-iterate workflow
- Save session files to a selected folder when File System Access is supported
- Previous Answers modal with recorded media and metrics history
- Interview question text-to-speech option
- Theme toggle and responsive mobile layout improvements

## Platform behavior

- Start Video Recording is disabled until camera access is available
- Disabled actions show a hover reason where applicable
- On iPhone browsers:
	- Previous Answers is disabled
	- Save folder selection and folder-backed saving features are disabled

## Local development

```bash
npm install
npm start
```

Alternative dev server command:

```bash
npm run dev
```

## Build and lint

```bash
npm run lint
npm run test
npm run build
```

## Notes

- Deepgram transcription requests are performed from the browser using the user-provided key.
- Interview question playback uses OS/system text-to-speech in the browser.
- If no Deepgram key is present and missing-key fallback is enabled, transcription falls back to local Whisper (in-browser) and question playback uses OS/system TTS.
- Folder-based save/history features rely on the browser File System Access API and permission grants.

## Changelog

- See [CHANGELOG.md](CHANGELOG.md) for release history, recent feature additions, and general bug-fix categories.

## GitHub Pages and custom domain

- Deployment workflow: .github/workflows/deploy-pages.yml
- Target repository: haydenmlh/webcam-interview-analyzer-page
- Target branch: gh-pages
- Custom domain file: public/CNAME
- Configured domain: interview.haydenmlh.com

### Required secret in source repository

- PAGES_DEPLOY_TOKEN: Personal Access Token with write access to haydenmlh/webcam-interview-analyzer-page

After first deploy, enable GitHub Pages on haydenmlh/webcam-interview-analyzer-page with source branch gh-pages, then set your DNS CNAME record for interview.haydenmlh.com to haydenmlh.github.io.
