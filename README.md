# webcam-interview-analyzer-js

Mock Interviewer is a React + Vite web app for practicing interview answers with live camera posture cues, audio/video recording, and Deepgram-powered transcription.

Current app version: 1.7.3

## Highlights

- Deepgram BYOK settings with local key persistence and optional server-side validation endpoint
- Live MediaPipe analysis (face, hand, and pose) with feedback metrics
- Start Video Recording and Start Audio Recording workflows
- Stop and Transcribe flow with transcript and interview metrics
- Add to Summary action for current answer/transcript
- Copy Summary for Gem export in Gemini-friendly markdown format
- Open Gemini topbar action that launches Gemini in a right-side popup panel for quick paste-and-iterate workflow
- Desktop right-rail interview chat with provider switcher (OpenRouter or NVIDIA NIM)
- Collapsible desktop chat rail (minimize to title-only)
- CV/JD modal for storing company name, CV, and job description with Gemini-ready copy action
- URL-based multi-question import on page load
- Interviewer mock image mode with optional self-view PiP
- Camera controls in Settings: Enable Camera, Show Interviewer, Show Self View
- Allow Camera Access button now hides after first successful permission grant
- Camera/session panel spacing refined to better use available vertical space
- Session action controls are placed above the interview question field for faster access
- Select Save Folder prompt now includes a dismiss (X) control
- Invert camera toggle in Settings with local persistence
- Key-saved status shown as a bottom-right popup notification
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
- LLM chat requests are performed from the browser using user-provided OpenRouter or NVIDIA NIM API keys.
- LLM keys are memory-only unless "Persist LLM API keys in this browser" is enabled in Settings.
- Interview question playback uses OS/system text-to-speech in the browser.
- If no Deepgram key is present and missing-key fallback is enabled, transcription falls back to local Whisper (in-browser) and question playback uses OS/system TTS.
- Folder-based save/history features rely on the browser File System Access API and permission grants.

## LLM chat setup

1. Open Settings.
2. Under "LLM Chat Providers", enter at least one provider API key.
3. Configure model and base URL for the provider you want to use.
4. Save LLM settings.
5. Use the desktop Interview Chat rail and choose OpenRouter or NVIDIA NIM from the provider dropdown.

Behavior:
- If provider settings are missing or invalid, chat returns an actionable error in the chat stream.
- Chat context includes current question, transcript, interview metrics summary, and optional CV/JD/company fields.

## URL question import

You can preload multiple interview questions when opening the app.

- Preferred format (newline separated):

```text
?questions=Tell%20me%20about%20yourself%0AWhat%20is%20your%20biggest%20strength%3F%0ADescribe%20a%20challenging%20project.
```

- Alternate format (repeated parameter):

```text
?q=Tell%20me%20about%20yourself&q=What%20is%20your%20biggest%20strength%3F&q=Describe%20a%20challenging%20project.
```

Behavior:
- Imported questions are loaded into the Questions Import list on first render.
- The first imported question becomes the active Interview question.
- Duplicate questions are automatically de-duplicated.

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
