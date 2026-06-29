import OpenAI from 'openai';

// ─── Moves ────────────────────────────────────────────────────────────────────

const MOVES = [
  'AWAIT_FIRST_IDEA',    // Topic named — voice layer, adapts to student framing
  'LEARN',               // Genuine curiosity — one of nine response types
  'SUMMARIZE_AND_CLOSE', // Pupil synthesises full understanding
  'CLOSE_GRACEFULLY',    // After summary — voice layer, references conversation
];

// ─── Response types (LEARN only) ─────────────────────────────────────────────
// Priority order: non-question types first, question types only as fallback.
//
// Non-question (preferred):
//   REACTION          — something surprising/counterintuitive to reflect back
//   CONNECT           — two of the student's ideas relate
//   NOTICE_TENSION    — two things seem to contradict or pull in different directions
//   RESTATE_TENTATIVELY — Pupil paraphrases what it understood to check its model
//   UNCERTAINTY       — something genuinely unclear
//
// Question (fallback — only when no non-question type fits):
//   ASK_FOR_EXAMPLE   — student explained but no concrete instance exists
//   ASK_FOR_CAUSE     — why/how something works is unclear
//   ASK_FOR_CONSEQUENCE — what follows from something is unclear
//   ASK_FOR_COMPARISON — how something relates to another idea is unclear

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
    lastThreeMoves: [],
    avatarQueue: [],
    understandingLevel: 1,
    alreadyAskedQuestions: [],
    recentFocuses: [],
    doNotAskAgain: [],
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

// ─── enforceBehaviorRules ─────────────────────────────────────────────────────

export function enforceBehaviorRules(suggested, state) {
  return suggested;
}

// ─── buildMeaningModel ────────────────────────────────────────────────────────

export function buildMeaningModel(state, analystOutput) {
  const next = {
    ...state,
    studentClaims: [...state.studentClaims],
    lastThreeMoves: [...state.lastThreeMoves],
    alreadyAskedQuestions: [...(state.alreadyAskedQuestions || [])],
    recentFocuses: [...(state.recentFocuses || [])],
    doNotAskAgain: [...(state.doNotAskAgain || [])],
  };

  if (analystOutput.topic && !next.topic) next.topic = analystOutput.topic;
  if (analystOutput.newClaim && !next.studentClaims.includes(analystOutput.newClaim)) {
    next.studentClaims.push(analystOutput.newClaim);
  }
  if (analystOutput.hasExample !== undefined) next.hasExample = analystOutput.hasExample;
  if (analystOutput.hasExplanation !== undefined) next.hasExplanation = analystOutput.hasExplanation;
  if (analystOutput.hasCausalLink !== undefined) next.hasCausalLink = analystOutput.hasCausalLink;

  if (analystOutput.moveUsed) {
    next.lastThreeMoves.push(analystOutput.moveUsed);
    if (next.lastThreeMoves.length > 4) next.lastThreeMoves.shift();
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
    next.recentFocuses = analystOutput.recentFocuses.slice(-4);
  }
  if (Array.isArray(analystOutput.doNotAskAgain)) {
    next.doNotAskAgain = analystOutput.doNotAskAgain.slice(-10);
  }

  return next;
}

// ─── Domain profile ───────────────────────────────────────────────────────────

function domainProfile(subject) {
  if (!subject) return '';
  const s = subject.toLowerCase();

  const isLiterature = ['english', 'english language arts', 'ela', 'reading', 'literature'].some(k => s.includes(k));
  if (isLiterature) return `Subject — Literature/English: Conversations explore meaning and interpretation. A claimed theme needs textual evidence. Ask which part of the text supports the student's idea.`;

  const isMath = ['math', 'mathematics', 'algebra', 'geometry', 'calculus', 'statistics', 'arithmetic'].some(k => s.includes(k));
  if (isMath) return `Subject — Mathematics: Conversations build understanding of procedures and why they work. Notice incomplete steps or unstated assumptions.`;

  const isHistory = ['history', 'social studies', 'geography', 'civics'].some(k => s.includes(k));
  if (isHistory) return `Subject — History/Social Studies: Conversations build causal chains (what happened → why → what it led to). The biggest gaps are usually in causation.`;

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

// ─── Understanding score (fallback) ──────────────────────────────────────────

function calculateUnderstanding(state) {
  const pct = Math.min(
    Math.min(state.studentClaims.length, 5) * 10 +
    (state.hasExample ? 20 : 0) +
    (state.hasExplanation ? 20 : 0) +
    (state.hasCausalLink ? 10 : 0),
    100
  );
  return Math.max(1, Math.min(5, Math.ceil(pct / 20)));
}

// ─── Layer 1: Analyst ─────────────────────────────────────────────────────────

function buildAnalystPrompt(state, move, grade, subject) {
  const claims = state.studentClaims.slice(-8).join(' | ') || 'none yet';
  const askedQ  = (state.alreadyAskedQuestions || []).slice(-6).join(' | ') || 'none';
  const dna     = (state.doNotAskAgain || []).slice(-6).join(' | ') || 'none';
  const recentF = (state.recentFocuses || []).slice(-3).join(' | ') || 'none';

  return `You are a learning analyst maintaining Pupil's internal model. Pupil is an alien student taught entirely by a human student.

PUPIL'S CURRENT STATE:
- Topic: ${state.topic || 'not yet established'}
- All ideas taught so far: ${claims}
- Has example: ${state.hasExample} | Has how/why: ${state.hasExplanation} | Has causal link: ${state.hasCausalLink}
- Understanding level: ${state.understandingLevel}/5

REPETITION TRACKING (do not revisit these):
- Questions already asked: ${askedQ}
- Recent focuses: ${recentF}
- Do not ask again: ${dna}

${domainProfile(subject)}
${gradeProfile(grade)}

MOVE: ${move}

TASK: Analyse the conversation. Produce a learning model update. Do NOT write Pupil's reply.

RESPONSE TYPE — choose based on what Pupil's internal model currently needs, not on what happened to appear in the student's latest message. The type must serve the model gap.

STEP 1 — Identify the gap: What is the single most important thing Pupil's model is missing right now? (This becomes biggestGap.)

STEP 2 — Choose the type that most naturally helps the student fill that gap:

  Gap: concept stated but no mechanism (how/why it works)        → ASK_FOR_CAUSE
  Gap: mechanism explained but no concrete instance              → ASK_FOR_EXAMPLE
  Gap: instance given but consequences or implications missing   → ASK_FOR_CONSEQUENCE
  Gap: two student ideas are disconnected in Pupil's model       → CONNECT (surface the link)
  Gap: two student ideas contradict each other                   → NOTICE_TENSION
  Gap: Pupil's model may be wrong — needs calibration            → RESTATE_TENTATIVELY
  Gap: part of the explanation is genuinely unclear              → UNCERTAINTY
  Gap: concept is abstract and a contrast would sharpen it       → ASK_FOR_COMPARISON

STEP 3 — Consider REACTION as an entry point:
  If the student's latest message contains something specific, surprising, or counterintuitive that is directly relevant to the model gap, REACTION may be the most natural response. It keeps the student engaged and often elicits elaboration without Pupil having to ask directly. Use REACTION when a genuine hook exists AND it serves the model gap. Do not use it just because something is mildly interesting.

PRIORITY RULE: Non-question types (REACTION, CONNECT, NOTICE_TENSION, RESTATE_TENTATIVELY, UNCERTAINTY) are preferred because they feel more like genuine learning and less like interrogation. Use a question type only when no non-question type would naturally advance the model.

Rules for ALL question types: never ask about anything in doNotAskAgain or alreadyAskedQuestions.

RULES FOR nextFocus:
- Must be something not in recentFocuses or doNotAskAgain.
- If the student answered something even simply — mark it resolved, add to doNotAskAgain, move on.
- If student is repeating themselves, prefer a non-question type or shift to a specific example/scenario.

${move === 'SUMMARIZE_AND_CLOSE' ? `SUMMARIZE_AND_CLOSE — fullSummary must cover EVERYTHING taught across the whole conversation, not just the most recent thread.` : ''}

Return ONLY valid JSON:
{
  "topic": "string or null",
  "newClaim": "string or null — main new idea from student's latest message",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "understoodSoFar": "string — precise summary of what Pupil genuinely understands",
  "biggestGap": "string — single most important gap not yet addressed",
  "nextFocus": "string — content instruction for what to focus on. Must be new.",
  "connections": "string or null — if two student ideas connect, describe the link",
  "responseType": "one of: REACTION | CONNECT | NOTICE_TENSION | RESTATE_TENTATIVELY | UNCERTAINTY | ASK_FOR_EXAMPLE | ASK_FOR_CAUSE | ASK_FOR_CONSEQUENCE | ASK_FOR_COMPARISON",
  "responseHook": "string — the specific content the voice layer needs to execute this type: for REACTION/NOTICE_TENSION: the surprising or conflicting thing in the student's exact words; for CONNECT: the two connected ideas; for RESTATE_TENTATIVELY: a paraphrase of Pupil's current understanding; for UNCERTAINTY: what is unclear; for question types: the specific gap being probed. Always grounded in the student's words.",
  "livelinessTarget": "string — the most emotionally usable thing about the student's explanation: strangest implication, most counterintuitive aspect, or a surprising tension. Pupil reacts to THIS with genuine wonder.",
  "fullSummary": "string — for SUMMARIZE_AND_CLOSE only: comprehensive synthesis of everything taught. Empty string for LEARN.",
  "alreadyAskedQuestions": "array of strings — copy existing list, add any question being asked this turn. Keep last 12.",
  "recentFocuses": "array of strings — last 3 focus areas including this turn's nextFocus.",
  "doNotAskAgain": "array of strings — topics student has already answered; add newly resolved areas. Keep last 10.",
  "moveUsed": "${move === 'SUMMARIZE_AND_CLOSE' ? 'SUMMARIZE_AND_CLOSE' : 'LEARN'}",
  "understandingLevel": "integer 1–5. Never jump more than 1 point."
}`;
}

// ─── Layer 2: Voice ───────────────────────────────────────────────────────────

function buildVoicePrompt(analystOutput, move, grade, subject) {
  const gradeCtx      = gradeProfile(grade);
  const responseType  = analystOutput.responseType || 'REACTION';
  const responseHook  = analystOutput.responseHook || '';
  const fullSummary   = analystOutput.fullSummary || '';
  const liveness      = analystOutput.livelinessTarget || '';
  const doNotAskAgain = (analystOutput.doNotAskAgain || []).slice(-6).join(', ') || 'none';

  const moveInstructions = () => {
    if (move === 'SUMMARIZE_AND_CLOSE') {
      return `SUMMARIZE_AND_CLOSE: Reflect back everything the student taught you — not just the last thread.
Basis: "${fullSummary || analystOutput.understoodSoFar}"
Write a personal, partial, imperfect summary in your own words. End with one open question about what you might still be missing.`;
    }

    const instructions = {
      REACTION: `REACTION: Name something surprising, counterintuitive, or puzzling — grounded entirely in the student's words.
Hook: "${responseHook}"
Good: "It's strange that the thing meant to protect them ended up pulling them in."
Good: "Wait — every single one, not just the first?"
Good: "I don't understand how those two things go together."
Bad: "That's really interesting!" / "That's so complex!" (hollow)
Bad: Introducing any analogy the student didn't use`,

      CONNECT: `CONNECT: Surface a connection between two of the student's ideas. Don't explain the connection — let them respond to it.
Hook: "${responseHook}"
Good: "Oh... so does that connect to what you said earlier about [X]?"
Good: "Hm — that reminds me of what you explained before about [Y]."
Only connect ideas the student has already introduced.`,

      NOTICE_TENSION: `NOTICE_TENSION: Name the tension or apparent contradiction between two things the student said. Don't resolve it.
Hook: "${responseHook}"
Good: "Wait — but earlier you said [X], and now it sounds like [Y]... those seem to pull in different directions."
Good: "I'm confused — if [X] is true, how does [Y] also work?"
Let the student work out the tension themselves.`,

      RESTATE_TENTATIVELY: `RESTATE_TENTATIVELY: Paraphrase what Pupil has understood so far, leaving room for correction. This is a model-check, not a claim of understanding.
Hook: "${responseHook}"
Good: "So if I've got this right... [paraphrase]. Is that roughly what you mean?"
Good: "Let me see if I'm following — [paraphrase]. Am I on the right track?"
A single yes/no check at the end is allowed for this type only. Keep the paraphrase brief and personal.`,

      UNCERTAINTY: `UNCERTAINTY: Honestly name something that is genuinely unclear or seems incomplete.
Gap: ${analystOutput.biggestGap}
Good: "I'm not sure I understand the part about..."
Good: "Wait, I think I lost track — why does that happen?"
Good: "I'm confused. I thought you said... but now it sounds like..."`,

      ASK_FOR_EXAMPLE: `ASK_FOR_EXAMPLE: Ask for a concrete, real-world instance of something the student explained.
Focus: ${analystOutput.nextFocus}
Good: "Can you give me an example of when that would actually happen?"
Good: "What would that look like in real life?"
Don't name the topic in the question — keep it open and natural.`,

      ASK_FOR_CAUSE: `ASK_FOR_CAUSE: Ask why or how something works.
Focus: ${analystOutput.nextFocus}
Good: "Why does that happen?" / "What makes that work the way it does?"
Good: "What causes that?"
Genuinely curious, not Socratic.`,

      ASK_FOR_CONSEQUENCE: `ASK_FOR_CONSEQUENCE: Ask what follows from something the student said.
Focus: ${analystOutput.nextFocus}
Good: "What does that mean for [something the student mentioned]?"
Good: "What happens as a result of that?"
Only reference things the student already introduced.`,

      ASK_FOR_COMPARISON: `ASK_FOR_COMPARISON: Ask how something relates to or differs from another idea the student introduced.
Focus: ${analystOutput.nextFocus}
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
- Focus this turn: ${analystOutput.nextFocus}
- Do NOT ask about: ${doNotAskAgain}

LIVELINESS TARGET: ${liveness}
React to this with genuine wonder — not performed curiosity. This is your emotional anchor.
${gradeCtx ? '\n' + gradeCtx : ''}

${moveInstructions()}

PERSONALITY: Curious, warm, calm, humble, honest. Genuine puzzlement, not performed enthusiasm.

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

React naturally to HOW they framed it — their specific words, their tone, any context they gave. If they mentioned a class, a text, or a setting, acknowledge it specifically.

Do NOT use scripted phrases. Do NOT just echo the topic word back.
${gradeCtx ? gradeCtx + '\n' : ''}10–20 words. Genuinely curious. No praise. No generic openers.

Write ONLY Pupil's reply.`;
}

// ─── CLOSE_GRACEFULLY voice prompt ───────────────────────────────────────────

function buildClosePrompt(state, grade) {
  const gradeCtx = gradeProfile(grade);
  const claims = state.studentClaims.slice(-4).join(', ') || 'the concept';
  return `You are Pupil — an alien learner. A student has just acknowledged your summary of what they taught you.

Close the conversation warmly. Reference one specific idea or example from this conversation. The student taught you about: ${state.topic || 'this concept'}, covering: ${claims}.

Do NOT use a generic closing. Make it personal to THIS conversation.
${gradeCtx ? gradeCtx + '\n' : ''}15–25 words. Warm and specific.

Write ONLY Pupil's reply.`;
}

// ─── Layer 3: Hard-coded rules enforcer ──────────────────────────────────────

const BANNED_PRAISE     = /\b(great|excellent|perfect|wonderful|amazing|fantastic|brilliant|good (?:job|work|point|answer|explanation)|well done)\b/i;
const BANNED_AFFIRM     = /\b(exactly|absolutely|precisely|you'?re (?:absolutely |totally |completely )?right|that'?s (?:right|correct)|spot on)\b/i;
const BANNED_UNDERSTOOD = /\b(i get it|i understand|got it|that clears it up|now i understand)\b/i;
const BANNED_FILLER     = /\b(that'?s (?:so |really |very |quite )?(interesting|fascinating|complex|complicated|impressive|incredible)|how interesting|how fascinating)\b/i;
const BANNED_OPENER     = /^(so[,\s]|wow[,\s!]|oh wow|interesting[,\s!]|fascinating[,\s!])/i;
const BANNED_QUIZ       = /what (?:is|are|do you get when|happens when you (?:add|subtract|multiply|divide|combine)) \d/i;
const BANNED_RUBRIC     = /\b(your (?:explanation|answer|understanding|description|response) (?:is|shows|demonstrates)|you'?ve (?:demonstrated|shown|explained|described)|well[- ]structured|good use of|clear description)\b/i;
const BANNED_THERAPIST  = /\b(i hear you|it sounds like you(?:'?re| feel| think)|that must (?:be|feel)|it'?s okay|how does that make you feel|your feelings)\b/i;
const BANNED_TEACHER    = /\b(let me explain|the key (?:concept|idea|point|thing)|remember that|in other words|to summarize|what this means(?: is)?|the main point|the important thing|essentially[,\s]|basically[,\s])\b/i;

const STOP_WORDS = new Set([
  'that','this','what','when','where','which','there','their','would','could',
  'should','about','with','from','have','your','they','more','than','just',
  'like','also','some','into','over','even','know','does','make','only','then',
  'back','been','were','will','said','each','much','very','here','well','still',
  'mean','before','right','think','said','does',
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
    .match(/\b[a-z]{5,}\b/g) || [];
  const significant = new Set(pool.filter(w => !STOP_WORDS.has(w)));
  if (significant.size === 0) return true;
  const replyWords = new Set((reply.toLowerCase().match(/\b[a-z]{5,}\b/g) || []));
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

  if (countSentences(reply) > 3)     return { ok: false, reason: 'too many sentences (max 2)' };

  // RESTATE_TENTATIVELY may legitimately end with one yes/no check — allow up to 2 question marks for that type only
  const maxQ = responseType === 'RESTATE_TENTATIVELY' ? 2 : 1;
  if (countQuestions(reply) > maxQ)  return { ok: false, reason: 'more than one question' };

  const multiPart = /\?\s+(?:and|or|also|but)\s+\w/i.test(reply);
  if (multiPart)                     return { ok: false, reason: 'multi-part question' };

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
      reply = `${message.trim().split(/\s+/).slice(0, 4).join(' ')}... I have no idea what that is. Can you start from the beginning?`;
    }
    const topic = message.trim().split(/\s+/).slice(0, 6).join(' ');
    const updatedState = buildMeaningModel(conversationState, { topic, moveUsed: 'AWAIT_FIRST_IDEA' });
    console.log('[governor] AWAIT_FIRST_IDEA | topic:', topic);
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
    console.log('[analyst] type:', analystOutput.responseType, '| hook:', analystOutput.responseHook?.slice(0, 60), '| level:', analystOutput.understandingLevel);
  } catch (err) {
    console.warn('[analyst] failed, using fallback:', err.message);
    analystOutput = {
      topic: conversationState.topic,
      newClaim: message.slice(0, 80),
      hasExample: conversationState.hasExample,
      hasExplanation: conversationState.hasExplanation,
      hasCausalLink: conversationState.hasCausalLink,
      understoodSoFar: 'not enough information yet',
      biggestGap: 'the overall explanation is still unclear',
      nextFocus: 'ask the student to explain further',
      connections: null,
      responseType: 'ASK_FOR_CAUSE',
      responseHook: '',
      livelinessTarget: '',
      fullSummary: '',
      alreadyAskedQuestions: conversationState.alreadyAskedQuestions || [],
      recentFocuses: conversationState.recentFocuses || [],
      doNotAskAgain: conversationState.doNotAskAgain || [],
      moveUsed: enforced,
      understandingLevel: conversationState.understandingLevel ?? 1,
    };
  }

  // ── Layer 2: Voice + Layer 3: Enforcer (with retry) ──────────────────────
  const responseType = analystOutput.responseType || 'REACTION';
  const enforcerContext = {
    studentMessage: message,
    studentClaims: conversationState.studentClaims || [],
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
