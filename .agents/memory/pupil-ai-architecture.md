---
name: Pupil-AI architecture decisions
description: Core design rules for conversationEngine.js that must never be silently reversed
---

## AWAIT_FIRST_IDEA — hard-coded, no LLM
The response to the student's very first message is chosen from a small hardcoded pool (random pick). No LLM call. This is intentional and non-negotiable.

**Why:** LLM-generated first replies introduce prior topic knowledge (e.g. student says "Macbeth", Pupil replies with "ambition" and "destructive" — concepts the student never mentioned). Hardcoding guarantees the response is always topic-agnostic.

**How to apply:** If a task touches AWAIT_FIRST_IDEA, keep it hardcoded. Do not add an LLM call to that branch, even to "improve naturalness".

## report.js — stays on gpt-4o-mini
The teacher report generator (`api/report.js`) uses gpt-4o-mini intentionally. Do not upgrade it to gpt-4o.

## Unified call — reply field last
The single gpt-4o call returns JSON with `reply` as the last field so the model commits to its analysis before writing the reply. Do not reorder the JSON schema.

## api/ changes require workflow restart
The Express server (`server.js`) does NOT hot-reload. Any edit to `api/` must be followed by restarting the "Start application" workflow.

## Hardcoded opening line
`src/main.jsx` line 9 — "Hey there — I'm ready to learn! What on Earth are you going to teach me about?" — is intentional. Do not touch it.
