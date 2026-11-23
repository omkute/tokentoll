# Spec Delta

## Purpose

Defines the repository quality commands that give contributors and automation one reproducible way to verify formatting, linting, types, behavior, and production output.

## ADDED Requirements

### Requirement: Bun quality commands
The repository SHALL provide Bun commands for formatting, non-mutating format verification, linting, type checking, tests, and a production build, plus one aggregate verification command.

#### Scenario: Individual quality gate succeeds
- **WHEN** a contributor runs an individual quality command against conforming source
- **THEN** that command completes with a zero exit status

#### Scenario: Individual quality gate detects a violation
- **WHEN** a contributor runs an individual quality command against source that violates its gate
- **THEN** that command reports the violation and completes with a non-zero exit status

#### Scenario: Aggregate verification succeeds
- **WHEN** a contributor runs the aggregate verification command against conforming source
- **THEN** it verifies formatting, linting, types, tests, and the production build and completes with a zero exit status

#### Scenario: Aggregate verification detects a failure
- **WHEN** any constituent quality gate fails during aggregate verification
- **THEN** the aggregate command completes with a non-zero exit status

### Requirement: Deterministic dependency installation
The repository SHALL commit Bun package metadata and a lockfile that support a frozen clean installation without requiring application credentials or external service availability.

#### Scenario: Clean frozen installation
- **WHEN** dependencies are installed from the committed package metadata and lockfile in frozen mode
- **THEN** Bun resolves the locked dependency graph without modifying the lockfile or requiring application credentials

### Requirement: Production build verification
The production-build command SHALL emit runnable JavaScript from the TypeScript service and fail when production compilation cannot complete.

#### Scenario: Valid production source is built
- **WHEN** the production-build command runs against valid source
- **THEN** it emits the production service artifact and completes with a zero exit status

#### Scenario: Invalid production source is built
- **WHEN** the production-build command encounters a compilation error
- **THEN** it reports the error and completes with a non-zero exit status
