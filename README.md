# webcam-interview-analyzer-js

JavaScript web app for mock interview practice.

## Current status

Current implementation includes:

- React + Vite project scaffolded
- Settings UI for Deepgram API key (BYOK)
- Client-side key validation rules (minimum length and safe character checks)
- Local key persistence with replace/remove actions
- JavaScript MediaPipe live analysis using face and hand landmark models
- Camera preview with landmark overlay and live counters
- Browser audio recording and Deepgram transcription request flow
- Deepgram text-to-speech for reading an input interview question
- Transcription gating when no key is available

## Local development

```bash
npm install
npm start
```

## Build and lint

```bash
npm run lint
npm run build
```

## Environment variables

- `VITE_DEEPGRAM_VALIDATE_URL` (optional): endpoint to validate user-provided Deepgram keys before persisting.
- `VITE_DEEPGRAM_LISTEN_URL` (optional): override the Deepgram listen endpoint.
- `VITE_DEEPGRAM_SPEAK_URL` (optional): override the Deepgram text-to-speech endpoint.
- `VITE_MEDIAPIPE_WASM_URL` (optional): override MediaPipe wasm bundle location.
- `VITE_FACE_LANDMARKER_MODEL_URL` (optional): override face model `.task` URL.
- `VITE_HAND_LANDMARKER_MODEL_URL` (optional): override hand model `.task` URL.

If `VITE_DEEPGRAM_VALIDATE_URL` is not set, keys are saved after local format validation only.

## Notes

- This app currently sends Deepgram transcription and text-to-speech requests directly from the browser using the user-provided key.

## GitHub Pages + Custom Domain

- Deployment workflow: `.github/workflows/deploy-pages.yml`
- Target repository: `haydenmlh/webcam-interview-analyzer-page`
- Target branch: `gh-pages`
- Custom domain file: `public/CNAME`
- Configured domain: `webcam-analyzer.haydenmlh.com`

### Required secret in source repository

- `PAGES_DEPLOY_TOKEN`: Personal Access Token with write access to `haydenmlh/webcam-interview-analyzer-page`.

After first deploy, enable GitHub Pages on `haydenmlh/webcam-interview-analyzer-page` with source branch `gh-pages`, then set your DNS `CNAME` record for `webcam-analyzer.haydenmlh.com` to `haydenmlh.github.io`.
