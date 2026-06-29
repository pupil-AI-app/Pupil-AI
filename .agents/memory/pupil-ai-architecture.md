---
name: Pupil-AI architecture decisions
description: Core design rules for conversationEngine.js that must never be silently reversed
---

## Architecture: 4-layer system

**Layer 0 — State** tracks Pupil's internal model (not just student claims):
`topic`, `currentBeliefs`, `studentClaims`, `causalModel`, `confusions`, `fragileUnderstanding`, `currentAssumption`, `lastOpener`, `lastThreeMoves`, `hasExample`, `hasExplanation`, `hasCausalLink`, `understandingLevel`, `lastPupilReply`, `avatarQueue`

**Layer 1 — Move selector (JavaScript)** picks a specific move BEFORE the LLM runs, based on state conditions and student message. The LLM executes the selected move; it does not choose from a menu.

**Layer 2 — Move executor (LLM)** receives the specific move name + per-move instructions with concrete Macbeth/chatbot examples. Returns JSON with reply as the final field.

**Layer 3 — Light enforcer** blocks only: praise, generic affirmation, premature closure, teacher voice, hollow filler, generic opener, exact repeat. Does NOT do: grounding checks, sentence count limits, question-type forcing, near-duplicate checks.

## Active moves (primary — the main learning loop)
TEST_THE_IDEA, APPLY_TO_NEW_CASE, MAKE_PREDICTION, BUILD_ROUGH_MODEL, FIND_WEAK_SPOT, MAKE_PLAUSIBLE_MISTAKE, COMPARE_TWO_IDEAS, CREATE_TINY_EXPERIMENT, REFLECT_ON_CHANGED_UNDERSTANDING, INVITE_REPAIR

**Why:** Active moves have Pupil DO things with information (test, predict, mistake, model) rather than only asking for more. MAKE_PLAUSIBLE_MISTAKE is the primary assessment mechanism — when Pupil gets something wrong, students are compelled to think and correct.

## Support moves (secondary — specific situations only)
AWAIT_FIRST_IDEA, SUMMARIZE_AND_CLOSE, CLOSE_GRACEFULLY, REFLECT_ON_CHANGED_UNDERSTANDING (also used after MAKE_PLAUSIBLE_MISTAKE)

## AWAIT_FIRST_IDEA — hard-coded, no LLM
**Why:** LLM-generated first replies introduce prior topic knowledge (e.g. student says "Macbeth", Pupil replies with "ambition" — concept student never mentioned). Hardcoding guarantees topic-agnostic response.
**How to apply:** Never add an LLM call to the AWAIT_FIRST_IDEA branch.

## SUMMARIZE_AND_CLOSE trigger
Fires only when all three completion signals are true: `hasExample && hasExplanation && hasCausalLink`. Not based on `understandingLevel`.

## report.js — stays on gpt-4o-mini
Leave as-is. Intentional.

## Hardcoded opening line
`src/main.jsx` line 9 — "Hey there — I'm ready to learn! What on Earth are you going to teach me about?" — intentional. Do not touch.

## api/ changes require workflow restart
The Express server (server.js) does NOT hot-reload.

## Why previous architecture failed
The old system used 9 passive response types (REACTION, CONNECT, etc.) describing how Pupil relates to what the student said — not what Pupil does with information. Without active moves (especially MAKE_PLAUSIBLE_MISTAKE), Pupil was an interviewer, not a learner. Every bug fix added constraints to the wrong abstraction. The state only tracked student claims, not Pupil's beliefs — so Pupil had no model to be wrong about.

## "basically" is NOT banned
The enforcer's BANNED_TEACHER does not include "basically" or "essentially". "So is it basically [X]?" is a canonical MAKE_PLAUSIBLE_MISTAKE pattern. Do not add these words back to BANNED_TEACHER.
