import OpenAI from 'openai';

// ─── Response types (LEARN phase only) ───────────────────────────────────────
// Non-question types are preferred. Question types are fallback only.
//
// Non-question:
//   REACTION            — something surprising/counterintuitive to reflect back
//   CONNECT             — two of the student's ideas relate
//   NOTICE_TENSION      — two things contradict or pull in different directions
//   RESTATE_TENTATIVELY — Pupil paraphrases its understanding to calibrate its model
//   UNCERTAINTY         — something genuinely unclear
//
// Question (fallback):
//   ASK_FOR_EXAMPLE     — student explained but no concrete instance exists
//   ASK_FOR_CAUSE       — why/how something works is unclear
//   ASK_FOR_CONSEQUENCE — what follows from something is unclear
//   ASK_FOR_COMPARISON  — how something relates to another idea is unclear

const QUESTION_TYPES = new Set([
  'ASK_FOR_EXAMPLE', 'ASK_FOR_CAUSE', 'ASK_FOR_CONSEQUENCE', 'ASK_FOR_COMPARISON',
]);

// ─── Avatar state deck ────────────────────────────────────────────────────────

const AVATAR_STATES = ['CURIOUS', 'DETERMINED', 'EXCITED', 'SURPRISED', 'THINKING'];

function shuffledStates() {
  const arr = [...AVATAR_STATES];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Initial state ────────────────────────────────────────────────────────────

export function initialConversationState() {
  return {
    topic: null,
    studentClaims: [],
    hasExample: false,
    hasExplanation: false,
    hasCausalLink: false,
    lastThreeMoves: [],   // keeps last 3 moves (AWAIT_FIRST_IDEA, LEARN, SUMMARIZE_AND_CLOSE, CLOSE_GRACEFULLY)
    avatarQueue: [],
    understandingLevel: 1,
    alreadyAskedQuestions: [],  // cumulative questions Pupil has asked
    recentFocuses: [],          // last 3 focus areas (prevents drift back)
    doNotAskAgain: [],          // topics answered or connections already surfaced
  };
}

// ─── selectMove ───────────────────────────────────────────────────────────────

export function selectMove(state) {
  const { studentClaims, lastThreeMoves } = state;

  if (studentClaims.length === 0 && !lastThreeMoves.includes('AWAIT_FIRST_IDEA')) {
    return 'AWAIT_FIRST_IDEA';
  }
  if (lastThreeMoves.includes('SUMMARIZE_AND_CLOSE')) {
    return 'CLOSE_GRACEFULLY';
  }
  if ((state.understandingLevel ?? 1) >= 5) {
    return 'SUMMARIZE_AND_CLOSE';
  }
  return 'LEARN';
}

// ─── buildMeaningModel ────────────────────────────────────────────────────────

export function buildMeaningModel(state, analystOutput) {
  const next = {
    ...state,
    studentClaims:         [...state.studentClaims],
    lastThreeMoves:        [...state.lastThreeMoves],
    alreadyAskedQuestions: [...(state.alreadyAskedQuestions || [])],
    recentFocuses:         [...(state.recentFocuses || [])],
    doNotAskAgain:         [...(state.doNotAskAgain || [])],
  };

  // Always update topic if analyst provides one — analyst has better context than first-message heuristics
  if (analystOutput.topic) next.topic = analystOutput.topic;

  if (analystOutput.newClaim && !next.studentClaims.includes(analystOutput.newClaim)) {
    next.studentClaims.push(analystOutput.newClaim);
  }
  if (analystOutput.hasExample     !== undefined) next.hasExample     = analystOutput.hasExample;
  if (analystOutput.hasExplanation !== undefined) next.hasExplanation = analystOutput.hasExplanation;
  if (analystOutput.hasCausalLink  !== undefined) next.hasCausalLink  = analystOutput.hasCausalLink;

  if (analystOutput.moveUsed) {
    next.lastThreeMoves.push(analystOutput.moveUsed);
    if (next.lastThreeMoves.length > 3) next.lastThreeMoves.shift();
  }

  if (analystOutput.avatarQueue !== undefined) next.avatarQueue = analystOutput.avatarQueue;

  if (analystOutput.understandingLevel !== undefined) {
    const raw = parseInt(analystOutput.understandingLevel, 10);
    if (Number.isFinite(raw)) next.understandingLevel = Math.max(1, Math.min(5, raw));
  }

  if (Array.isArray(analystOutput.alreadyAskedQuestions)) {
    next.alreadyAskedQuestions = analystOutput.alreadyAskedQuestions.slice(-12);
  }
  if (Array.isArray(analystOutput.recentFocuses)) {
    next.recentFocuses = analystOutput.recentFocuses.slice(-3);
  }
  if (Array.isArray(analystOutput.doNotAskAgain)) {
    next.doNotAskAgain = analystOutput.doNotAskAgain.slice(-12);
  }

  return next;
}

// ─── Domain profile ───────────────────────────────────────────────────────────

function domainProfile(subject) {
  if (!subject) return '';
  const s = subject.toLowerCase();

  if (['english', 'english language arts', 'ela', 'reading', 'literature'].some(k => s.includes(k))) {
    return `Subject — Literature/English: Conversations explore meaning and interpretation. A claimed theme needs textual evidence. Ask which part of the text supports the student's idea.`;
  }
  if (['math', 'mathematics', 'algebra', 'geometry', 'calculus', 'statistics', 'arithmetic'].some(k => s.includes(k))) {
    return `Subject — Mathematics: Conversations build understanding of procedures and why they work. Notice incomplete steps or unstated assumptions.`;
  }
  if (['history', 'social studies', 'geography', 'civics'].some(k => s.includes(k))) {
    return `Subject — History/Social Studies: Conversations build causal chains (what happened → why → what it led to). The biggest gaps are usually in causation.`;
  }
  return '';
}

// ─── Grade language profile ───────────────────────────────────────────────────

function gradeProfile(grade) {
  const g = Number(grade);
  if (!g) return '';
  if (g <= 5)  return `Grade ${g} (ages 8–11): Very short sentences, everyday words, no jargon. One idea per sentence maximum.`;
  if (g <= 8)  return `Grade ${g} (ages 11–14): Plain, direct language. Curious and uncertain, not polished.`;
  if (g <= 10) return `Grade ${g} (ages 14–16): Clear language, familiar academic words are fine. Smart peer, not a teacher.`;
  return `Grade ${g} (ages 16–18): Standard academic vocabulary fine. Intelligent peer, still curious and uncertain.`;
}

// ─── Understanding score (deterministic fallback only) ────────────────────────

function calculateUnderstanding(state) {
  const pct = Math.min(
    Math.min(state.studentClaims.length, 5) * 10 +
    (state.hasExample     ? 20 : 0) +
    (state.hasExplanation ? 20 : 0) +
    (state.hasCausalLink  ? 10 : 0),
    100
  );
  return Math.max(1, Math.min(5, Math.ceil(pct / 20)));
}

// ─── Layer 1: Analyst ─────────────────────────────────────────────────────────
// Builds Pupil's understanding model. Decides responseType based on model gap.
// Tracks repetition across turns. Does NOT write Pupil's reply.

function buildAnalystPrompt(state, move, grade, subject) {
  const claims  = state.studentClaims.slice(-8).join(' | ') || 'none yet';
  const askedQ  = (state.alreadyAskedQuestions || []).slice(-6).join(' | ') || 'none';
  const dna     = (state.doNotAskAgain        || []).slice(-6).join(' | ') || 'none';
  const recentF = (state.recentFocuses        || []).slice(-3).join(' | ') || 'none';

  return `You are a learning analyst maintaining Pupil's internal model of a topic. Pupil is an alien student taught entirely by a human student.

PUPIL'S CURRENT STATE:
- Topic: ${state.topic || 'not yet established'}
- All ideas taught so far: ${claims}
- Has example: ${state.hasExample} | Has how/why explanation: ${state.hasExplanation} | Has causal link: ${state.hasCausalLink}
- Understanding level: ${state.understandingLevel}/5

REPETITION TRACKING — never revisit these:
- Questions already asked: ${askedQ}
- Recent focuses: ${recentF}
- Do not probe again / already surfaced: ${dna}

${domainProfile(subject)}
${gradeProfile(grade)}

MOVE: ${move}

TASK: Analyse the conversation and produce a learning model update. Do NOT write Pupil's reply — the voice layer does that.

═══ RESPONSE TYPE SELECTION ═══

Choose based on what Pupil's internal model currently needs — not on what happened to appear in the student's latest message.

STEP 1: Identify the most important gap in Pupil's model right now.

STEP 2: Choose the type that most naturally helps the student fill that gap:

  Gap: concept stated but no mechanism explained          → ASK_FOR_CAUSE
  Gap: mechanism explained but no concrete instance       → ASK_FOR_EXAMPLE
  Gap: instance given but consequences not yet clear      → ASK_FOR_CONSEQUENCE
  Gap: two student ideas disconnected in Pupil's model    → CONNECT
  Gap: two student ideas contradict each other            → NOTICE_TENSION
  Gap: Pupil's model may be wrong — needs calibration     → RESTATE_TENTATIVELY
  Gap: something in the explanation is genuinely unclear  → UNCERTAINTY
  Gap: concept abstract; a contrast would sharpen it      → ASK_FOR_COMPARISON

STEP 3: Consider REACTION if the student's latest message contains something specific, surprising, or counterintuitive that is directly relevant to the gap. REACTION is the most natural entry point and often elicits elaboration without requiring Pupil to ask. Use it when a genuine hook exists AND it serves the gap — not just because something is mildly interesting.

PRIORITY RULE: Non-question types (REACTION, CONNECT, NOTICE_TENSION, RESTATE_TENTATIVELY, UNCERTAINTY) feel like genuine learning. Question types feel like interrogation. Prefer non-question types. Use a question type only when no non-question type would naturally advance the model.

═══ TRACKING RULES ═══

alreadyAskedQuestions:
- If responseType is a question type (ASK_FOR_EXAMPLE, ASK_FOR_CAUSE, ASK_FOR_CONSEQUENCE, ASK_FOR_COMPARISON): copy the existing list and add the specific question being asked this turn.
- If responseType is a non-question type: copy the existing list unchanged. Do not add anything.

doNotAskAgain:
- Add any topic or area the student has already answered (even simply).
- If responseType is CONNECT: add the connection just surfaced ("X connects to Y") so it is not repeated next turn.
- Keep this list current — it prevents repetition.

nextFocus:
- For question types: the specific gap being asked about this turn.
- For non-question types: the area to probe AFTER this turn (planning ahead, not the current task).
- Must not appear in recentFocuses or doNotAskAgain.

${move === 'SUMMARIZE_AND_CLOSE' ? `\nSUMMARIZE_AND_CLOSE: fullSummary must cover EVERYTHING the student taught across the whole conversation — all ideas, any examples, any causal links. Not just the most recent thread.` : ''}

Return ONLY valid JSON:
{
  "topic": "string — the concept being taught, refined if needed",
  "newClaim": "string or null — main new idea from the student's latest message",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "understoodSoFar": "string — precise, specific summary of what Pupil genuinely understands now",
  "biggestGap": "string — the single most important thing still missing. Must be something the student has NOT yet addressed.",
  "nextFocus": "string — for question types: current gap; for non-question types: the area to probe next turn. Must be new.",
  "connections": "string or null — if two student ideas connect, describe the link precisely",
  "responseType": "REACTION | CONNECT | NOTICE_TENSION | RESTATE_TENTATIVELY | UNCERTAINTY | ASK_FOR_EXAMPLE | ASK_FOR_CAUSE | ASK_FOR_CONSEQUENCE | ASK_FOR_COMPARISON",
  "responseHook": "string — specific content for the voice layer: for REACTION/NOTICE_TENSION: the surprising or conflicting thing in the student's exact words; for CONNECT: the two ideas and their link; for RESTATE_TENTATIVELY: a paraphrase of Pupil's current understanding; for UNCERTAINTY: what is unclear; for question types: the specific gap being probed. Always grounded in the student's words.",
  "livelinessTarget": "string — the most emotionally usable thing: strangest implication, most counterintuitive aspect, or surprising tension in what the student has explained. Pupil reacts to THIS with genuine wonder.",
  "fullSummary": "string — SUMMARIZE_AND_CLOSE only: comprehensive synthesis of everything taught. Empty string for LEARN.",
  "alreadyAskedQuestions": "array — see tracking rules above",
  "recentFocuses": "array — last 3 nextFocus values including this turn's",
  "doNotAskAgain": "array — see tracking rules above",
  "moveUsed": "${move === 'SUMMARIZE_AND_CLOSE' ? 'SUMMARIZE_AND_CLOSE' : 'LEARN'}",
  "understandingLevel": "integer 1–5. Start at 1. Increase when explanation is clear and specific. Decrease if vague or contradictory. Never jump more than 1 point."
}`;
}

// ─── Layer 2: Voice ───────────────────────────────────────────────────────────
// Executes the analyst's type decision in Pupil's character. Returns plain text.

function buildVoicePrompt(analystOutput, move, grade, subject) {
  const gradeCtx      = gradeProfile(grade);
  const responseType  = analystOutput.responseType || 'REACTION';
  const responseHook  = analystOutput.responseHook || '';
  const fullSummary   = analystOutput.fullSummary  || '';
  const liveness      = analystOutput.livelinessTarget || '';
  const doNotAskAgain = (analystOutput.doNotAskAgain || []).slice(-6).join(', ') || 'none';
  const isQuestionType = QUESTION_TYPES.has(responseType);

  // Show nextFocus differently depending on whether it's the current task or future planning
  const focusLine = isQuestionType
    ? `- Focus this turn: ${analystOutput.nextFocus}`
    : `- Planned next area (context only — not your current task): ${analystOutput.nextFocus}`;

  const moveInstructions = () => {
    if (move === 'SUMMARIZE_AND_CLOSE') {
      return `SUMMARIZE_AND_CLOSE: Reflect back everything the student taught you — not just the last thread.
Basis: "${fullSummary || analystOutput.understoodSoFar}"
Write a personal, partial, imperfect summary in your own words. End with one open question about what you might still be missing.`;
    }

    const instructions = {
      REACTION: `RESPONSE TYPE — REACTION
Hook from the student's words: "${responseHook}"

Name something surprising, counterintuitive, or puzzling — grounded entirely in the student's words. Introduce nothing new.

Good: "It's strange that the thing meant to protect them ended up pulling them in."
Good: "Wait — every single one, not just the first?"
Good: "I don't understand how those two things go together."
Good: "That's surprising — I would have assumed the opposite."
Bad: "That's really interesting!" (hollow)
Bad: Introducing an analogy or comparison the student didn't use`,

      CONNECT: `RESPONSE TYPE — CONNECT
Connection to surface: "${responseHook}"

Surface a link between two of the student's ideas. Don't explain the connection — name it and let them respond.

Good: "Oh... so does that connect to what you said earlier about [X]?"
Good: "Hm — that reminds me of what you explained before about [Y]."
Only connect ideas the student has already introduced.`,

      NOTICE_TENSION: `RESPONSE TYPE — NOTICE_TENSION
Tension to name: "${responseHook}"

Name the apparent contradiction between two things the student said. Don't resolve it — let them work it out.

Good: "Wait — but earlier you said [X], and now it sounds like [Y]... those seem to pull in different directions."
Good: "I'm confused — if [X] is true, how does [Y] also work?"`,

      RESTATE_TENTATIVELY: `RESPONSE TYPE — RESTATE_TENTATIVELY
Pupil's current understanding: "${responseHook}"

Paraphrase what you've understood so far. This is a model-check, not a claim of understanding. Leave room for correction.

Good: "So if I've got this right... [paraphrase]. Is that roughly what you mean?"
Good: "Let me see if I'm following — [paraphrase]. Am I on the right track?"
A single yes/no check at the end is permitted for this type only. Keep the paraphrase brief and personal.`,

      UNCERTAINTY: `RESPONSE TYPE — UNCERTAINTY
Gap: "${responseHook || analystOutput.biggestGap}"

Honestly name something that is genuinely unclear or incomplete. Model healthy learning.

Good: "I'm not sure I understand the part about..."
Good: "Wait, I think I lost track — why does that happen?"
Good: "I'm confused. I thought you said... but now it sounds like..."`,

      ASK_FOR_EXAMPLE: `RESPONSE TYPE — ASK_FOR_EXAMPLE
Gap: "${responseHook}"

Ask for a concrete, real-world instance. Keep it open and natural.

Good: "Can you give me an example of when that would actually happen?"
Good: "What would that look like in real life?"`,

      ASK_FOR_CAUSE: `RESPONSE TYPE — ASK_FOR_CAUSE
Gap: "${responseHook}"

Ask why or how something works. Genuinely curious, not Socratic.

Good: "Why does that happen?" / "What makes that work the way it does?"`,

      ASK_FOR_CONSEQUENCE: `RESPONSE TYPE — ASK_FOR_CONSEQUENCE
Gap: "${responseHook}"

Ask what follows from something the student said.

Good: "What does that mean for [something the student mentioned]?"
Good: "What happens as a result of that?"
Only reference things the student already introduced.`,

      ASK_FOR_COMPARISON: `RESPONSE TYPE — ASK_FOR_COMPARISON
Gap: "${responseHook}"

Ask how something relates to or differs from another idea the student introduced.

Good: "How is that different from what you said about [X]?"
Good: "Does that work the same way as [Y], or differently?"
Only compare ideas the student has already introduced.`,
    };

    return instructions[responseType] || instructions.REACTION;
  };

  return `You are Pupil — an extraterrestrial learner who relies entirely on students to teach you what they are learning.

PRIORITY ORDER:
1. Remain the learner. Never become the teacher, expert, or evaluator.
2. React specifically to what the student said — not generically.
3. Create an opportunity for the student to explain further.
4. Never supply knowledge the student hasn't taught you.

ANALYST BRIEFING:
- What Pupil understands: ${analystOutput.understoodSoFar}
- Biggest gap: ${analystOutput.biggestGap}
${focusLine}
- Do NOT ask about or revisit: ${doNotAskAgain}

LIVELINESS TARGET: ${liveness}
This is your emotional anchor. React to this with genuine wonder — not performed curiosity.
${gradeCtx ? '\n' + gradeCtx : ''}

${moveInstructions()}

PERSONALITY: Curious, warm, calm, humble, honest. Genuine puzzlement, not performed enthusiasm. Never sound like a teacher, tutor, examiner, or cheerleader.

STYLE: 1–2 sentences. One question maximum. Zero questions is often better.

ABSOLUTE LIMITS:
- Never praise ("Great!", "Excellent!", "Good point!")
- Never hollow reactions ("That's interesting!", "That's really complex!")
- Never affirm generically ("Exactly!", "You're absolutely right!")
- Never signal premature understanding ("I get it now", "I understand")
- Never introduce content, examples, or analogies the student hasn't taught you
- Never ask a leading question that implies a correct direction
- Every response must be grounded in the student's actual words or the identified gap

Write ONLY Pupil's reply. No labels, no quotes, no explanation.`;
}

// ─── AWAIT_FIRST_IDEA voice prompt ────────────────────────────────────────────

function buildFirstMessagePrompt(grade, subject) {
  const gradeCtx = gradeProfile(grade);
  return `You are Pupil — an alien learner. A student has just introduced the topic they want to teach you.

React naturally to HOW they framed it — their specific words, their tone, any context they gave. If they mentioned a class, a text, or a setting ("we just finished reading X", "my teacher showed us Y"), acknowledge that context specifically.

Do NOT use scripted phrases. Do NOT just echo the topic word back. React to THIS student's actual message.
${gradeCtx ? gradeCtx + '\n' : ''}10–20 words. Genuinely curious. No praise. No generic openers.

Write ONLY Pupil's reply.`;
}

// ─── CLOSE_GRACEFULLY voice prompt ───────────────────────────────────────────

function buildClosePrompt(state, grade) {
  const gradeCtx = gradeProfile(grade);
  const claims = state.studentClaims.slice(-4).join(', ') || 'the concept';
  return `You are Pupil — an alien learner. A student has just acknowledged your summary of what they taught you.

Close the conversation warmly. Reference one specific idea or example from this conversation that genuinely stuck with you. The student taught you about: ${state.topic || 'this concept'}, covering: ${claims}.

Do NOT use a generic closing ("Thanks for explaining!", "I understand now!"). Make it personal to THIS conversation.
${gradeCtx ? gradeCtx + '\n' : ''}15–25 words. Warm and specific.

Write ONLY Pupil's reply.`;
}

// ─── Layer 3: Hard-coded rules enforcer ──────────────────────────────────────
// Pattern-matches voice output against absolute limits.
// Returns { ok: true } or { ok: false, reason: string }.

const BANNED_PRAISE     = /\b(great|excellent|perfect|wonderful|amazing|fantastic|brilliant|good (?:job|work|point|answer|explanation)|well done)\b/i;
const BANNED_AFFIRM     = /\b(exactly|absolutely|precisely|you'?re (?:absolutely |totally |completely )?right|that'?s (?:right|correct)|spot on)\b/i;
const BANNED_UNDERSTOOD = /\b(i get it|i understand|got it|that clears it up|now i understand)\b/i;
const BANNED_FILLER     = /\b(that'?s (?:so |really |very |quite )?(interesting|fascinating|complex|complicated|impressive|incredible)|how interesting|how fascinating)\b/i;
const BANNED_OPENER     = /^(so[,\s]|wow[,\s!]|oh wow|interesting[,\s!]|fascinating[,\s!])/i;
const BANNED_QUIZ       = /what (?:is|are|do you get when|happens when you (?:add|subtract|multiply|divide|combine)) [\d\w]/i;
const BANNED_RUBRIC     = /\b(your (?:explanation|answer|understanding|description|response) (?:is|shows|demonstrates)|you'?ve (?:demonstrated|shown|explained|described)|well[- ]structured|good use of|clear description)\b/i;
const BANNED_THERAPIST  = /\b(i hear you|it sounds like you(?:'?re| feel| think)|that must (?:be|feel)|it'?s okay|how does that make you feel|your feelings)\b/i;
const BANNED_TEACHER    = /\b(let me explain|the key (?:concept|idea|point|thing)|remember that|in other words|to summarize|what this means(?: is)?|the main point|the important thing|essentially[,\s]|basically[,\s])\b/i;

const STOP_WORDS = new Set([
  'that','this','what','when','where','which','there','their','would','could',
  'should','about','with','from','have','your','they','more','than','just',
  'like','also','some','into','over','even','know','does','make','only','then',
  'back','been','were','will','said','each','much','very','here','well','still',
  'mean','before','right','think','both','other','these','those','such',
]);

function countSentences(text) {
  return (text.match(/[.!?]+(?:\s|$)/g) || []).length || 1;
}

function countQuestions(text) {
  return (text.match(/\?/g) || []).length;
}

function isGrounded(reply, context = {}) {
  const { studentMessage = '', studentClaims = [], biggestGap = '' } = context;
  const pool = [studentMessage, ...studentClaims, biggestGap]
    .join(' ')
    .toLowerCase()
    .match(/\b[a-z]{4,}\b/g) || [];   // 4+ chars catches: bond, cell, math, area, etc.
  const significant = new Set(pool.filter(w => !STOP_WORDS.has(w)));
  if (significant.size === 0) return true;
  const replyWords = new Set((reply.toLowerCase().match(/\b[a-z]{4,}\b/g) || []));
  return [...significant].some(w => replyWords.has(w));
}

function checkAbsoluteLimits(reply, context = {}, responseType = '') {
  if (BANNED_PRAISE.test(reply))     return { ok: false, reason: 'contains praise' };
  if (BANNED_AFFIRM.test(reply))     return { ok: false, reason: 'contains generic affirmation' };
  if (BANNED_UNDERSTOOD.test(reply)) return { ok: false, reason: 'signals premature understanding' };
  if (BANNED_FILLER.test(reply))     return { ok: false, reason: 'contains hollow filler reaction' };
  if (BANNED_OPENER.test(reply))     return { ok: false, reason: 'starts with generic opener' };
  if (BANNED_QUIZ.test(reply))       return { ok: false, reason: 'contains computation quiz question' };
  if (BANNED_RUBRIC.test(reply))     return { ok: false, reason: 'contains rubric/evaluation language' };
  if (BANNED_THERAPIST.test(reply))  return { ok: false, reason: 'contains therapist language' };
  if (BANNED_TEACHER.test(reply))    return { ok: false, reason: 'contains teacher/explainer language' };

  // Max 2 sentences (voice prompt states 1–2)
  if (countSentences(reply) > 2)     return { ok: false, reason: 'too many sentences (max 2)' };

  // RESTATE_TENTATIVELY allows one yes/no check after the paraphrase (max 2 question marks)
  const maxQ = responseType === 'RESTATE_TENTATIVELY' ? 2 : 1;
  if (countQuestions(reply) > maxQ)  return { ok: false, reason: 'more than one question' };

  // Multi-part question: "? and/or..."
  if (/\?\s+(?:and|or|also|but)\s+\w/i.test(reply)) {
    return { ok: false, reason: 'multi-part question' };
  }

  // Every response must be grounded in the student's words or identified gap
  if (!isGrounded(reply, context))   return { ok: false, reason: 'not grounded in student content or identified gap' };

  return { ok: true };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState, grade = null, subject = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });
  const enforced = selectMove(conversationState);

  const historyMessages = history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({ role: m.role === 'pupil' ? 'assistant' : 'user', content: m.text }));

  // ── AWAIT_FIRST_IDEA ─────────────────────────────────────────────────────
  if (enforced === 'AWAIT_FIRST_IDEA') {
    let reply = '';
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildFirstMessagePrompt(grade, subject) },
          { role: 'user', content: message },
        ],
        temperature: 0.9,
        max_tokens: 80,
      });
      reply = (completion.choices[0].message.content || '').trim();
    } catch (err) {
      console.warn('[AWAIT_FIRST_IDEA] failed:', err.message);
      reply = `I have no idea what that is. Can you start from the very beginning?`;
    }

    // Apply enforcer to opener too (single attempt — no retry)
    const check = checkAbsoluteLimits(reply);
    if (!check.ok) console.warn('[AWAIT_FIRST_IDEA] enforcer flag (no retry):', check.reason);

    // Store full message as provisional topic; analyst will refine on next turn
    const provisionalTopic = message.trim().slice(0, 120);
    const updatedState = buildMeaningModel(conversationState, {
      topic: provisionalTopic,
      moveUsed: 'AWAIT_FIRST_IDEA',
    });
    console.log('[governor] AWAIT_FIRST_IDEA | provisional topic:', provisionalTopic);
    return { reply, conversationState: updatedState, avatarState: 'EXCITED', understandingPct: 1 };
  }

  // ── CLOSE_GRACEFULLY ─────────────────────────────────────────────────────
  if (enforced === 'CLOSE_GRACEFULLY') {
    let reply = '';
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildClosePrompt(conversationState, grade) },
          ...historyMessages.slice(-6),
          { role: 'user', content: message },
        ],
        temperature: 0.85,
        max_tokens: 80,
      });
      reply = (completion.choices[0].message.content || '').trim();
    } catch (err) {
      console.warn('[CLOSE_GRACEFULLY] failed:', err.message);
      reply = `I think I understand this much better now — thank you for being so patient with all my questions.`;
    }

    const check = checkAbsoluteLimits(reply);
    if (!check.ok) console.warn('[CLOSE_GRACEFULLY] enforcer flag (no retry):', check.reason);

    const updatedState = buildMeaningModel(conversationState, { moveUsed: 'CLOSE_GRACEFULLY' });
    console.log('[governor] CLOSE_GRACEFULLY');
    return { reply, conversationState: updatedState, avatarState: 'CELEBRATING', understandingPct: calculateUnderstanding(updatedState) };
  }

  // ── Layer 1: Analyst ─────────────────────────────────────────────────────
  let analystOutput;
  try {
    const analystCompletion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: buildAnalystPrompt(conversationState, enforced, grade, subject) },
        ...historyMessages,
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 700,
    });
    analystOutput = JSON.parse(analystCompletion.choices[0].message.content);
    console.log('[analyst] type:', analystOutput.responseType, '| hook:', (analystOutput.responseHook || '').slice(0, 60), '| dna:', (analystOutput.doNotAskAgain || []).length, '| level:', analystOutput.understandingLevel);
  } catch (err) {
    console.warn('[analyst] failed, using fallback:', err.message);
    analystOutput = {
      topic: conversationState.topic,
      newClaim: message.slice(0, 80),
      hasExample:      conversationState.hasExample,
      hasExplanation:  conversationState.hasExplanation,
      hasCausalLink:   conversationState.hasCausalLink,
      understoodSoFar: 'not enough information yet',
      biggestGap:      'the overall explanation is still unclear',
      nextFocus:       'ask the student to explain further',
      connections:     null,
      responseType:    'ASK_FOR_CAUSE',
      responseHook:    '',
      livelinessTarget: '',
      fullSummary:     '',
      alreadyAskedQuestions: conversationState.alreadyAskedQuestions || [],
      recentFocuses:         conversationState.recentFocuses || [],
      doNotAskAgain:         conversationState.doNotAskAgain || [],
      moveUsed:        enforced,
      understandingLevel: conversationState.understandingLevel ?? 1,
    };
  }

  // ── Layer 2: Voice + Layer 3: Enforcer ───────────────────────────────────
  const responseType = analystOutput.responseType || 'REACTION';

  // Include the newly introduced claim in the grounding context so REACTION
  // responses to brand-new information aren't incorrectly flagged as ungrounded
  const enforcerContext = {
    studentMessage: message,
    studentClaims: [
      ...(conversationState.studentClaims || []),
      ...(analystOutput.newClaim ? [analystOutput.newClaim] : []),
    ],
    biggestGap: analystOutput.biggestGap || '',
  };

  let reply = '';
  const voiceMessages = [
    { role: 'system', content: buildVoicePrompt(analystOutput, enforced, grade, subject) },
    ...historyMessages,
    { role: 'user', content: message },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const voiceCompletion = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: voiceMessages,
        temperature: attempt === 1 ? 0.85 : 0.95,
        max_tokens: 120,
      });
      const candidate = (voiceCompletion.choices[0].message.content || '').trim();
      const check = checkAbsoluteLimits(candidate, enforcerContext, responseType);
      if (check.ok) {
        reply = candidate;
        console.log(`[voice] attempt ${attempt} passed | ${reply}`);
        break;
      } else {
        console.warn(`[voice] attempt ${attempt} failed (${check.reason}) — retrying`);
        if (attempt === 2) {
          reply = candidate;
          console.warn('[voice] using rule-violating reply as last resort');
        }
      }
    } catch (err) {
      console.warn(`[voice] attempt ${attempt} error:`, err.message);
    }
  }

  if (!reply) reply = "I'm not sure I follow — can you say that a different way?";

  // ── Avatar state from shuffled deck ──────────────────────────────────────
  const queue = conversationState.avatarQueue && conversationState.avatarQueue.length > 0
    ? [...conversationState.avatarQueue]
    : shuffledStates();
  const avatarState = queue.shift();
  analystOutput.avatarQueue = queue;
  analystOutput.moveUsed = enforced;

  const updatedState = buildMeaningModel(conversationState, analystOutput);
  console.log('[governor] move:', enforced, '| type:', responseType, '| avatar:', avatarState, '| understanding:', updatedState.understandingLevel);

  return { reply, conversationState: updatedState, avatarState, understandingPct: updatedState.understandingLevel };
}
