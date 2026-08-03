## Context

The current application performs speech-to-text transcription and text-to-speech generation through Deepgram calls from the browser using user-provided API keys. If Deepgram is unavailable, misconfigured, or rejects requests, the user loses major interview functionality. The change introduces an additional provider path using Hugging Face models for both STT and TTS while preserving the existing Deepgram-first behavior.

Constraints include browser-based execution, variable network reliability, preserving existing UX flows, and keeping provider selection understandable to users.

## Goals / Non-Goals

**Goals:**
- Preserve transcription and question playback flows when Deepgram cannot be used.
- Use a deterministic provider policy: try Deepgram first, then fallback to Hugging Face when fallback conditions are met.
- Support fallback STT with `openai/whisper-large-v3-turbo` and fallback TTS with `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`.
- Expose provider outcome and fallback reason in UI state so users can understand what happened.
- Keep behavior configurable through environment settings and/or app settings without breaking existing defaults.

**Non-Goals:**
- Replacing Deepgram as the primary provider.
- Building custom model training or hosting infrastructure.
- Redesigning all interview UX screens unrelated to speech provider status.
- Guaranteeing offline speech processing.

## Decisions

1. Provider orchestration layer
- Decision: Introduce a provider abstraction for STT and TTS operations with a shared fallback policy.
- Rationale: Centralizes failover logic, avoids duplicating retry/error behavior across UI handlers, and simplifies testing.
- Alternatives considered:
  - Embed fallback directly in button handlers: rejected due to duplicated error handling.
  - Replace all Deepgram calls with Hugging Face calls: rejected because it removes current BYOK Deepgram workflow.

2. Fallback trigger conditions
- Decision: Trigger fallback on deterministic failure classes (missing/invalid Deepgram key, configured Deepgram endpoint unavailable, auth failure, network failure, non-retryable provider errors based on mapped codes).
- Rationale: Predictable behavior prevents silent switching and keeps troubleshooting straightforward.
- Alternatives considered:
  - Fallback only on network failures: rejected as too narrow.
  - Fallback on any single transient error with no classification: rejected due to possible accidental masking of temporary issues.

3. Model binding and endpoint configuration
- Decision: Bind fallback STT to `openai/whisper-large-v3-turbo` and fallback TTS to `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`, with configurable endpoint/API key settings.
- Rationale: Matches requested models while allowing deployment flexibility.
- Alternatives considered:
  - Hardcode endpoints only: rejected because environments differ.
  - Allow arbitrary model names by default: deferred to reduce configuration complexity in first release.

4. User-facing transparency
- Decision: Persist per-operation metadata (`providerUsed`, `fallbackApplied`, `fallbackReason`) and surface it in transcript/TTS status areas.
- Rationale: Makes failures diagnosable and reduces user confusion.
- Alternatives considered:
  - Silent fallback with no status indicator: rejected due to poor debuggability.

## Risks / Trade-offs

- [Hugging Face latency may be higher than Deepgram] -> Mitigation: show in-progress states and ensure cancellation/timeout handling.
- [Provider response formats differ] -> Mitigation: normalize STT/TTS results through adapter interfaces before UI consumption.
- [Additional configuration complexity] -> Mitigation: provide sane defaults and clear validation messaging.
- [Fallback masking core Deepgram issues] -> Mitigation: log/store fallback reasons and preserve original error details for debugging.

## Migration Plan

1. Add provider abstraction and adapters while keeping Deepgram flow intact.
2. Add Hugging Face STT/TTS adapters and configuration fields.
3. Introduce fallback policy with explicit trigger mapping.
4. Update UI state/messages to display provider and fallback reason.
5. Validate with manual and automated tests for Deepgram success, Deepgram failure with fallback success, and dual-failure behavior.
6. Rollback strategy: disable fallback via config flag and continue with existing Deepgram-only behavior.

## Open Questions

- Should fallback be enabled by default when Hugging Face credentials are missing, or should the app require explicit opt-in?
- What timeout thresholds should distinguish transient retry from fallback trigger for each provider?
- Should provider usage metadata be included in exported summaries/history artifacts?
