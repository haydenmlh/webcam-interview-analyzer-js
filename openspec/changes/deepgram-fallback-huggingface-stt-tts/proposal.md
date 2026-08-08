## Why

The app currently depends on Deepgram for both speech-to-text and text-to-speech, which can block key workflows when Deepgram keys are invalid, service calls fail, or Deepgram is unavailable. A fallback path is needed so core interview practice remains functional and resilient.

## What Changes

- Add a speech provider fallback flow that detects when Deepgram cannot be used and routes requests to Hugging Face-backed alternatives.
- Add fallback speech-to-text support using the Whisper Large V3 Turbo model (`openai/whisper-large-v3-turbo`).
- Add fallback text-to-speech support using the Qwen custom voice model (`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`).
- Add runtime status/error handling that surfaces which provider was used and why fallback occurred.
- Add configuration and validation logic for fallback provider settings and API inputs.

## Capabilities

### New Capabilities
- `speech-provider-fallback`: Automatically route STT/TTS operations to Hugging Face model endpoints when Deepgram is unavailable or unusable.

### Modified Capabilities
- None.

## Impact

- Affected code: browser-side transcription and TTS service modules, settings/state management, and UI status messaging.
- Dependencies/systems: Deepgram API integration flow, Hugging Face inference endpoint integration, request/retry/error handling.
- API/config: additional environment variables and/or user-configurable provider settings for fallback behavior.
