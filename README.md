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

## Environment variables

- VITE_DEEPGRAM_VALIDATE_URL (optional): endpoint to validate user-provided Deepgram keys before persisting
- VITE_DEEPGRAM_LISTEN_URL (optional): override the Deepgram listen endpoint
- VITE_DEEPGRAM_SPEAK_URL (optional): override the Deepgram text-to-speech endpoint
- VITE_SPEECH_FALLBACK_ENABLED (optional): set to `true` to enable Hugging Face fallback for STT/TTS
- VITE_HF_API_KEY (required when fallback enabled): Hugging Face API key used for fallback requests
- VITE_HF_STT_MODEL (optional): fallback STT model ID, defaults to `openai/whisper-large-v3-turbo`
- VITE_HF_TTS_MODEL (optional): fallback TTS model ID, defaults to `hexgrad/Kokoro-82M`
- VITE_HF_STT_URL (optional): fallback STT endpoint, defaults to `https://router.huggingface.co/hf-inference/models/<VITE_HF_STT_MODEL>`
- VITE_HF_TTS_URL (optional): fallback TTS endpoint, defaults to `https://router.huggingface.co/hf-inference/models/<VITE_HF_TTS_MODEL>`
- VITE_MEDIAPIPE_WASM_URL (optional): override MediaPipe wasm bundle location
- VITE_FACE_LANDMARKER_MODEL_URL (optional): override face model task URL
- VITE_HAND_LANDMARKER_MODEL_URL (optional): override hand model task URL
- VITE_POSE_LANDMARKER_MODEL_URL (optional): override pose model task URL
- VITE_FFMPEG_CORE_BASE_URL (optional): override FFmpeg core asset base URL

If VITE_DEEPGRAM_VALIDATE_URL is not set, keys are saved after local format validation only.

Note: `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` is not currently deployed by Hugging Face Inference Providers. To use it, point `VITE_HF_TTS_URL` to a custom/local endpoint that serves that model.

In-app fallback settings:
- Open Settings to save Hugging Face fallback key in browser storage.
- You can override fallback TTS model ID at runtime (for example `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`).
- If provider router rejects the model as not deployed, set a custom fallback TTS endpoint URL in Settings.

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
