# webcam-interview-analyzer-js

Mock Interviewer is a React + Vite web app for practicing interview answers with live camera posture cues, audio/video recording, and Deepgram-powered transcription.

Current app version: 1.8.16

## Highlights

- Deepgram BYOK settings with local key persistence and optional server-side validation endpoint
- Live MediaPipe face analysis with eye-contact and gaze feedback metrics
- Start Video Recording and Start Audio Recording workflows
- Stop and Transcribe flow with transcript and interview metrics
- Add to Summary action for current answer/transcript
- Copy Summary for Gem export in Gemini-friendly markdown format
- Open Gemini topbar action that launches Gemini in a right-side popup panel for quick paste-and-iterate workflow
- CV/JD modal for storing company name, consultant details, CV, and job description
- Generate Questions flow from CV/JD/company/job-title context with streaming output
- Generate AM Report flow with streaming preview, cancel support, and in-app PDF preview modal
- Generate Detailed Report flow with per-question analysis, suggested improved answers, and PDF preview
- Detailed report PDFs now start `Detailed Per-Question Analysis` on a new page and place each question after Question 1 on its own page
- AM feedback PDF preview with download icon action and exit-confirmation discard warning
- PDF metric/unit formatting keeps `%`/`°` attached to numbers in generated reports
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

## Manual build and deploy (no GitHub Actions)

Use this when you want to publish manually to any static host.

1. Build the site locally:

```bash
npm install
npm run build
```

2. Confirm the production output exists in `dist/`.

3. Optional local validation of the built site:

```bash
npm run preview
```

4. Deploy the `dist/` folder using one of these approaches:

- Generic static host (Netlify, Vercel static, Cloudflare Pages, S3+CloudFront): upload `dist/` as the site root/output directory.
- Manual GitHub Pages publish to a `gh-pages` branch:

```bash
git checkout --orphan gh-pages
git rm -rf .
cp -r dist/* .
git add .
git commit -m "Manual deploy"
git push -f origin gh-pages
```

If you use Windows PowerShell for the manual GitHub Pages publish, replace the copy step with:

```powershell
Copy-Item -Recurse -Force dist\* .
```

5. If using a custom domain, make sure your deployed output includes `public/CNAME` content (or configure the domain directly in your host).

## Notes

- Deepgram transcription requests are performed from the browser using the user-provided key.
- LLM generation requests (question generation + AM/detailed report generation) are performed from the browser using user-provided OpenRouter or NVIDIA NIM API keys.
- LLM keys are stored in browser local storage by default; use `Clear keys and reset to defaults` in Settings to remove saved keys and reset provider settings.
- Interview question playback uses OS/system text-to-speech in the browser.
- If no Deepgram key is present and missing-key fallback is enabled, transcription falls back to local Whisper (in-browser) and question playback uses OS/system TTS.
- Folder-based save/history features rely on the browser File System Access API and permission grants.

## LLM generation setup

1. Open Settings.
2. Under "LLM Chat Providers", enter at least one provider API key.
3. Configure model and base URL for the provider you want to use.
4. Save LLM settings.
5. Use `Generate Questions`, `Generate AM Report`, or `Generate Detailed Report` from the left-side tabs.

Behavior:
- If provider settings are missing or invalid, generation returns an actionable error toast.
- Auto provider mode tries OpenRouter first, then retries with NVIDIA NIM if OpenRouter fails.
- Generation context can include current question, transcript, interview metrics summary, and optional CV/JD/company/job-title fields.

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
