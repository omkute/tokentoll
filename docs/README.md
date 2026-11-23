# tokenToll Documentation

Milestones M1–M3 are implemented, verified, and archived; M4–M10 remain planning-only. This directory separates stable project context from change-specific OpenSpec work.

## Reading Guide

- [Vision](vision.md): problem, mission, users, goals, and success criteria.
- [Requirements](requirements.md): maintained functional and non-functional requirements with stable identifiers.
- [Architecture](architecture.md): accepted boundaries, conceptual components, constraints, and known unknowns.
- [Roadmap](roadmap.md): ten incremental, independently verifiable milestones.
- [Glossary](glossary.md): canonical project terminology.
- [ADRs](adr/README.md): accepted constraints and the status of architectural decisions.
- [Traceability](traceability.md): mapping from `requirements.txt` to maintained documentation.

## Authority and Scope

1. `requirements.txt` is retained as the historical source input for this documentation baseline. Any statement inside it about document authority describes that earlier baseline and is superseded by this list.
2. `docs/requirements.md`, accepted ADRs, and `docs/architecture.md` maintain global project requirements and constraints.
3. OpenSpec main specs under `openspec/specs/` define accepted behavioral specifications. Archived changes under `openspec/changes/archive/` are historical evidence, not active scope.
4. `openspec/changes/<change>/` holds an active, bounded change's proposal, delta specs, design, and tasks.
5. Implementation and tests provide evidence of delivered behavior; they do not silently override requirements.

Resolve contradictions explicitly before implementation. Global documentation should not be copied into a project-wide OpenSpec proposal. Each OpenSpec change should cover one small vertical slice and link the relevant requirement identifiers.

OpenSpec 2.0.0 is initialized for Codex. Repository skills live under `.agents/skills/`, and `openspec/config.yaml` selects the `spec-driven` schema (`proposal → specs → design → tasks`). Start a bounded change with `$openspec-propose "your idea"` in Codex CLI or IDE, or select `openspec-propose` from Skills in the desktop app.
