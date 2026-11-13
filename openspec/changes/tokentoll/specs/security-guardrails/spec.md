# Spec Delta

## Purpose

Enforces pre-execution and post-execution enterprise security guardrails including Personally Identifiable Information (PII) redaction and prompt injection defenses.

## ADDED Requirements

### Requirement: Inbound PII Detection and Redaction
The system SHALL inspect inbound prompt content against configured PII patterns (such as credit card numbers, Social Security Numbers, emails, and API secrets) and redact or mask detected entities according to tenant policy.

#### Scenario: Sensitive data detected with redaction enabled
- **WHEN** a client sends a prompt containing an unmasked credit card number or SSN with PII redaction policy enabled
- **THEN** the gateway replaces the sensitive entity with an obfuscated token (e.g., `[REDACTED_SSN]`) prior to upstream forwarding

#### Scenario: PII detection with strict blocking policy
- **WHEN** a client sends a prompt containing restricted sensitive information and the tenant policy specifies strict rejection
- **THEN** the gateway rejects the request with an HTTP 400 Bad Request error stating that PII policy was violated

### Requirement: Prompt Injection and Jailbreak Filtering
The system SHALL evaluate incoming prompt payloads against known prompt injection and jailbreak heuristics, rejecting requests exceeding defined threat severity thresholds.

#### Scenario: Malicious prompt injection payload detected
- **WHEN** an incoming prompt contains recognized system prompt override or jailbreak markers exceeding the risk threshold
- **THEN** the gateway halts request processing, returns an HTTP 400 Bad Request with a security violation code, and records a security audit log

#### Scenario: Benign prompt execution
- **WHEN** an incoming prompt passes security inspection with a risk score below the threat threshold
- **THEN** the gateway routes the prompt to the upstream model without delay

### Requirement: Outbound Response Scrubbing
The system SHALL inspect upstream LLM completions for leaked credentials, private keys, or enterprise-sensitive patterns before sending the response to the client.

#### Scenario: Upstream completion leaks private keys or credentials
- **WHEN** an upstream model generates an output containing detected private keys or enterprise secrets
- **THEN** the gateway scrubs the compromised content, logs an alert to the security audit log, and delivers a sanitized response
