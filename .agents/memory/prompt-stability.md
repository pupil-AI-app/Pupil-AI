---
name: Prompt stability rule
description: User instruction about how to treat the conversationEngine.js prompt going forward
---

The user confirmed the current prompt in `api/conversationEngine.js` is close to the desired state and should be preserved.

**Rule:** Make only targeted, minimal edits to the prompt. No rewrites, no restructuring unless something is clearly broken or the user explicitly requests a change.

**Why:** Multiple full rewrites caused drift away from the original character vision. The current version (as of checkpoint baf77e6) represents the best-aligned iteration.

**How to apply:** When a conversation behavior problem arises, prefer fixing the smallest possible thing — a single section, a single example, a single field — rather than restructuring the prompt. Always note what you changed and why.
