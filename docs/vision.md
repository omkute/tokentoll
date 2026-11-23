# Vision

## Problem Statement

Applications that use multiple large-language-model providers otherwise repeat provider integration, routing, reliability, security, quota, caching, accounting, and observability work. Provider-specific behavior also leaks into client code and makes policy enforcement inconsistent.

## Mission

Build tokenToll as a high-performance, multi-tenant AI gateway that exposes a consistent provider-neutral interface and centralizes cross-cutting operational policy. Develop it in small, measurable steps that also teach backend engineering, distributed systems, concurrency, security, and performance.

## Goals

- Present consistent contracts over multiple LLM providers.
- Enforce tenant-aware security, budgets, quotas, and governance at explicit boundaries.
- Route reliably across eligible model deployments while containing provider failures.
- Support non-streaming and streaming traffic with bounded resources and cancellation.
- Produce trustworthy usage, audit, and performance evidence without burdening the hot path.
- Sustain 5,000 RPS in a controlled mock-provider benchmark and keep p95 gateway overhead below 5 ms in a defined steady state. Both are unverified objectives.

## Non-goals

- Reimplement model inference or train models.
- Create different architectural paths based on provider origin or market labels.
- Claim production readiness or benchmark success without evidence.
- Deliver the full roadmap in the foundation milestone.
- Hide major design tradeoffs behind generated code or premature abstractions.

## Target Users and Use Cases

- Application teams use one gateway contract instead of bespoke provider clients.
- Platform operators configure deployments, policies, credentials, budgets, and governance.
- Tenant administrators manage teams and virtual keys within isolated boundaries.
- Engineers observe usage and failures, reproduce benchmarks, and add providers through adapters.

## Success Criteria

Success means each roadmap milestone has an accepted specification, verified behavior, bounded resource use, and documented tradeoffs. The completed system must preserve tenant isolation, protect credentials, degrade safely when providers fail, and publish reproducible latency, throughput, error, CPU, memory, and event-loop-lag results.

## Learning Objectives

Development should make reasoning visible: explain concepts, compare alternatives, implement one approved task at a time, and review security, concurrency, lifecycle, and performance after each change.
