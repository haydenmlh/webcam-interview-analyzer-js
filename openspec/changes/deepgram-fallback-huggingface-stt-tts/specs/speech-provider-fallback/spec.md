## ADDED Requirements

### Requirement: STT uses deterministic provider fallback
The system SHALL attempt transcription with Deepgram first and MUST route to the configured Hugging Face STT model (`openai/whisper-large-v3-turbo`) when Deepgram cannot be used due to configured fallback trigger conditions.

#### Scenario: Deepgram transcription succeeds
- **WHEN** a user submits recorded audio for transcription and Deepgram returns a successful response
- **THEN** the system uses Deepgram transcription output and records `providerUsed` as `deepgram`

#### Scenario: Deepgram unavailable triggers STT fallback
- **WHEN** a user submits recorded audio for transcription and Deepgram fails with a fallback-triggering error
- **THEN** the system retries transcription through Hugging Face Whisper Large V3 Turbo and records `providerUsed` as `huggingface` with `fallbackApplied` as true

#### Scenario: Deepgram key invalid triggers STT fallback
- **WHEN** a user submits recorded audio for transcription with a missing or invalid Deepgram key and Hugging Face STT is configured
- **THEN** the system skips or aborts Deepgram usage and performs transcription with Hugging Face while storing `fallbackReason` as key-validation related

### Requirement: TTS uses deterministic provider fallback
The system SHALL attempt text-to-speech generation with Deepgram first and MUST route to the configured Hugging Face TTS model (`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`) when Deepgram cannot be used due to configured fallback trigger conditions.

#### Scenario: Deepgram TTS succeeds
- **WHEN** a user plays interview question text and Deepgram returns valid audio
- **THEN** the system plays Deepgram audio and records `providerUsed` as `deepgram`

#### Scenario: Deepgram TTS failure triggers fallback
- **WHEN** a user plays interview question text and Deepgram TTS fails with a fallback-triggering error
- **THEN** the system requests audio from Hugging Face Qwen TTS, plays the fallback audio, and records `providerUsed` as `huggingface` with `fallbackApplied` as true

### Requirement: Fallback outcomes are visible and traceable
The system MUST surface provider selection outcomes for STT and TTS operations, including whether fallback occurred and why.

#### Scenario: User sees fallback status after transcription
- **WHEN** transcription completes through fallback provider
- **THEN** the UI displays that fallback was used and indicates a human-readable fallback reason

#### Scenario: User sees provider failure when both providers fail
- **WHEN** Deepgram fails and fallback provider also fails for the same operation
- **THEN** the UI displays an actionable error that includes the primary provider failure and fallback failure summary without falsely reporting success

### Requirement: Fallback behavior is configurable and validated
The system MUST validate required configuration for Deepgram and Hugging Face provider paths and SHALL only enable fallback when fallback prerequisites are present.

#### Scenario: Fallback disabled due to missing Hugging Face configuration
- **WHEN** Deepgram fails but required Hugging Face configuration is missing
- **THEN** the system does not attempt fallback and returns a clear configuration error

#### Scenario: Fallback enabled with complete configuration
- **WHEN** the application starts with complete fallback configuration
- **THEN** STT and TTS operations are eligible to fallback according to configured trigger conditions
