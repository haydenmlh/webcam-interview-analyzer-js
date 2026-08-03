## 1. Provider Abstractions and Configuration

- [x] 1.1 Introduce shared STT/TTS provider interfaces and result-normalization types for Deepgram and Hugging Face adapters.
- [x] 1.2 Add fallback-related configuration fields (endpoints, model IDs, credentials, enable flag) with runtime validation.
- [x] 1.3 Add fallback trigger classification utility for Deepgram errors (auth/key, network, endpoint, provider error classes).

## 2. STT Fallback Implementation

- [x] 2.1 Refactor transcription flow to call a provider orchestration function that attempts Deepgram first.
- [x] 2.2 Implement Hugging Face Whisper adapter using `openai/whisper-large-v3-turbo` and map response payloads to normalized transcript output.
- [x] 2.3 Implement deterministic STT fallback routing and metadata output (`providerUsed`, `fallbackApplied`, `fallbackReason`).
- [x] 2.4 Add dual-failure handling so users receive actionable errors when both Deepgram and fallback fail.

## 3. TTS Fallback Implementation

- [x] 3.1 Refactor question text-to-speech flow to use provider orchestration with Deepgram-first behavior.
- [x] 3.2 Implement Hugging Face Qwen TTS adapter using `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` and normalize audio output handling.
- [x] 3.3 Implement deterministic TTS fallback routing with provider metadata and failure reason capture.
- [x] 3.4 Ensure fallback and non-fallback TTS flows preserve existing playback controls and cancellation behavior.

## 4. UI Status and Observability

- [x] 4.1 Extend relevant app state to store per-operation provider metadata for STT and TTS.
- [x] 4.2 Update UI messaging to display fallback usage and human-readable fallback reasons after each operation.
- [x] 4.3 Ensure success/failure states do not report false positives when fallback attempts fail.

## 5. Verification and Regression Safety

- [x] 5.1 Add/extend tests for Deepgram success, Deepgram failure with successful fallback, and dual-failure outcomes for STT.
- [x] 5.2 Add/extend tests for Deepgram success, Deepgram failure with successful fallback, and dual-failure outcomes for TTS.
- [x] 5.3 Add tests for fallback configuration validation behavior (enabled/disabled prerequisites).
- [x] 5.4 Run lint/build/test and verify no regressions in existing recording/transcription/summary workflows.
