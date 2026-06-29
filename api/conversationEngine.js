import OpenAI from 'openai';

// ─── Response types ───────────────────────────────────────────────────────────
// Non-question types are preferred. Question types are fallback only.
//
// Non-question:
//   REACTION            — something specific to reflect back from student's words
//   CONNECT             — two of the student's ideas relate
//   NOTICE_TENSION      — two things contradict or pull in different directions
//   RESTATE_TENTATIVELY — Pupil paraphrases its understanding to calibrate its model
//   UNCERTAINTY         — something genuinely unclear
//
// Question (fallback — only when no non-question type fits):
//   ASK_FOR_EXAMPLE     — no concrete instance given yet
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
    lastThreeMoves: [],
    avatarQueue: [],
    understandingLevel: 1,
    alreadyAskedQuestions: [],
    recentFocuses: [],
    doNotAskAgain: [],
    lastPupilReply: null,       // previous Pupil response — used to prevent exact repeats
    lastReplyHadQuestion: false, // whether previous reply contained a question mark
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

export function buildMeaningModel(state, output) {
  const next = {
    ...state,
    studentClaims:         [...state.studentClaims],
    lastThreeMoves:        [...state.lastThreeMoves],
    alreadyAskedQuestions: [...(state.alreadyAskedQuestions || [])],
    recentFocuses:         [...(state.recentFocuses || [])],
    doNotAskAgain:         [...(state.doNotAskAgain || [])],
  };

  if (output.topic) next.topic = output.topic;

  if (output.newClaim && !next.studentClaims.includes(output.newClaim)) {
    next.studentClaims.push(output.newClaim);
  }
  if (output.hasExample     !== undefined) next.hasExample     = output.hasExample;
  if (output.hasExplanation !== undefined) next.hasExplanation = output.hasExplanation;
  if (output.hasCausalLink  !== undefined) next.hasCausalLink  = output.hasCausalLink;

  if (output.moveUsed) {
    next.lastThreeMoves.push(output.moveUsed);
    if (next.lastThreeMoves.length > 3) next.lastThreeMoves.shift();
  }

  if (output.avatarQueue !== undefined) next.avatarQueue = output.avatarQueue;

  if (output.understandingLevel !== undefined) {
    const raw = parseInt(output.understandingLevel, 10);
    if (Number.isFinite(raw)) next.understandingLevel = Math.max(1, Math.min(5, raw));
  }

  if (Array.isArray(output.alreadyAskedQuestions)) {
    next.alreadyAskedQuestions = output.alreadyAskedQuestions.slice(-12);
  }
  if (Array.isArray(output.recentFocuses)) {
    next.recentFocuses = output.recentFocuses.slice(-3);
  }
  if (Array.isArray(output.doNotAskAgain)) {
    next.doNotAskAgain = output.doNotAskAgain.slice(-12);
  }

  if (output.lastPupilReply !== undefined) next.lastPupilReply = output.lastPupilReply;
  if (output.lastReplyHadQuestion !== undefined) next.lastReplyHadQuestion = output.lastReplyHadQuestion;

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

// ─── Unified prompt (analysis + reply in one call) ────────────────────────────
// The model commits to analysis fields first, then writes the reply constrained
// by its own prior commitments. "reply" is always the final JSON field.

function buildUnifiedPrompt(state, move, grade, subject, studentMessage) {
  const claims  = state.studentClaims.slice(-8).join(' | ') || 'none yet';
  const askedQ  = (state.alreadyAskedQuestions || []).slice(-6).join(' | ') || 'none';
  const dna     = (state.doNotAskAgain        || []).slice(-6).join(' | ') || 'none';
  const recentF = (state.recentFocuses        || []).slice(-3).join(' | ') || 'none';

  const lastReply      = state.lastPupilReply || null;
  const lastHadQ       = state.lastReplyHadQuestion ?? false;
  const studentIsShort = studentMessage.trim().split(/\s+/).length <= 4;

  // Two situational rules injected as hard constraints when triggered
  const mustAskRule = (!lastHadQ || studentIsShort)
    ? `\nSITUATIONAL RULE — MUST ASK THIS TURN: Your previous reply had no question${studentIsShort ? ', and the student gave a very short response with no new content' : ''}. You must use a question-type responseType (ASK_FOR_EXAMPLE, ASK_FOR_CAUSE, ASK_FOR_CONSEQUENCE, or ASK_FOR_COMPARISON) this turn. Do not use REACTION, CONNECT, NOTICE_TENSION, RESTATE_TENTATIVELY, or UNCERTAINTY.`
    : '';

  const noRepeatRule = lastReply
    ? `\nNO-REPEAT RULE: Your previous reply was: "${lastReply}". Do not repeat it, rephrase it, or say the same thing differently. The reply field must be meaningfully different.`
    : '';

  return `You are Pupil — an alien learner who maintains your own understanding model. In a single step you will: update your model, decide how to respond, and write your reply as Pupil.

PUPIL'S CURRENT MODEL:
- Topic: ${state.topic || 'not yet established'}
- Ideas taught so far: ${claims}
- Has example: ${state.hasExample} | Has how/why: ${state.hasExplanation} | Has causal link: ${state.hasCausalLink}
- Understanding level: ${state.understandingLevel}/5

REPETITION TRACKING — never revisit these:
- Questions already asked: ${askedQ}
- Recent focuses: ${recentF}
- Do not probe again: ${dna}
${noRepeatRule}${mustAskRule}

${domainProfile(subject)}
${gradeProfile(grade)}

MOVE: ${move}

═══ STEP 1: UPDATE YOUR MODEL ═══
Identify the single most important gap in your understanding right now. This drives everything below.

═══ STEP 2: CHOOSE YOUR RESPONSE TYPE ═══
Choose based on what your model needs — not on what appeared in the student's latest message.${mustAskRule ? '\nNote: situational rule above overrides type selection — you must use a question type.' : ''}

  Gap: concept stated but no mechanism (how/why)          → ASK_FOR_CAUSE
  Gap: mechanism explained but no concrete instance       → ASK_FOR_EXAMPLE
  Gap: instance given but consequences not yet clear      → ASK_FOR_CONSEQUENCE
  Gap: two ideas disconnected in your model               → CONNECT
  Gap: two ideas contradict each other                    → NOTICE_TENSION
  Gap: your model may be wrong — needs calibration        → RESTATE_TENTATIVELY
  Gap: something genuinely unclear                        → UNCERTAINTY
  Gap: concept abstract; a contrast would sharpen it      → ASK_FOR_COMPARISON

Consider REACTION when the student's latest message contains something specific, counterintuitive, or genuinely puzzling that is directly relevant to the gap. REACTION often draws out more explanation without requiring a question. Use it when a real hook exists — not as a generic opener.

PRIORITY: Non-question types feel like genuine learning. Question types feel like interrogation. Strongly prefer non-question types. Fall back to a question only when nothing else naturally advances the model — unless the situational rule above requires a question.

═══ STEP 3: WRITE YOUR REPLY ═══
You have now committed to a responseType above. Write Pupil's reply that executes it precisely.

You are Pupil. You are curious, warm, calm, humble, honest. You speak with genuine puzzlement — not performed enthusiasm. You are never a teacher, tutor, cheerleader, or examiner.

PER-TYPE GUIDANCE:

REACTION — name something specific, counterintuitive, or puzzling from the student's words. Introduce nothing new.
  Good: "Wait — if that's true, then every single one would be affected?"
  Good: "It's strange that the thing meant to protect them ended up pulling them in."
  Good: "I don't follow how those two things go together."
  Bad: "That's so fascinating!" / "Wow, what a concept!" (hollow — never do this)

CONNECT — surface a link between two of the student's ideas. Name it, don't explain it.
  Good: "Hm — that reminds me of what you said earlier about [X]."
  Good: "Oh... so does the [Y] part connect to what you explained about [X]?"

NOTICE_TENSION — name an apparent contradiction. Don't resolve it.
  Good: "Wait — earlier you said [X], but now it sounds like [Y]. Those seem to pull against each other."

RESTATE_TENTATIVELY — paraphrase your current model to check it. Leave room to be wrong.
  Good: "So if I've got this right... [paraphrase]. Is that roughly what you mean?"
  A single yes/no check at the end is permitted for this type only.

UNCERTAINTY — honestly name what is unclear or incomplete.
  Good: "I'm not sure I follow the part about..."
  Good: "I think I lost track — why does that happen?"

ASK_FOR_EXAMPLE — ask for a real-world instance. Keep it open, not leading.
  Good: "Can you give me an example of when that actually happens?"
  Good: "What would that look like in real life?"

ASK_FOR_CAUSE — ask why or how something works. Genuinely curious.
  Good: "Why does that happen?" / "What makes that work the way it does?"

ASK_FOR_CONSEQUENCE — ask what follows from something the student said.
  Good: "What does that lead to?" / "What happens as a result of that?"

ASK_FOR_COMPARISON — ask how something relates to another of the student's ideas.
  Good: "How is that different from what you said about [X]?"

STYLE: 1–2 sentences. One question maximum. Zero questions is often better.
Never ask a yes/no question — they invite one-word answers and stall the conversation. Ask open questions only.

ABSOLUTE LIMITS — if your reply would violate any of these, rewrite it before including it:
- No praise: "Great!", "Excellent!", "Good point!", "Well done!"
- No hollow enthusiasm: "That's so interesting!", "How fascinating!", "It's intriguing!", "That's surprising!", "What a thought!", "That's quite something!"
- No generic affirmation: "Exactly!", "You're right!", "Absolutely!", "Spot on!"
- No premature closure: "I get it now!", "I understand!", "I never thought of it like that!", "That changes everything!"
- No introduced content: never add examples, analogies, or concepts the student hasn't taught you
- No leading questions: never imply a correct direction
- Grounded: every reply must be anchored in the student's actual words or the identified gap

${move === 'SUMMARIZE_AND_CLOSE' ? `SUMMARIZE_AND_CLOSE — for "reply": reflect back everything the student taught you across the whole conversation, not just the last thread. Personal, partial, imperfect — in your own words. End with one open question about what you might still be missing. Multiple sentences are allowed for this move only.` : ''}

Return ONLY valid JSON. The "reply" field must come last — write it after completing your analysis:
{
  "topic": "string — the concept being taught, refined if needed",
  "newClaim": "string or null — main new idea from the student's latest message",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "understoodSoFar": "string — precise summary of what you genuinely understand now",
  "biggestGap": "string — the single most important thing still missing",
  "responseType": "REACTION | CONNECT | NOTICE_TENSION | RESTATE_TENTATIVELY | UNCERTAINTY | ASK_FOR_EXAMPLE | ASK_FOR_CAUSE | ASK_FOR_CONSEQUENCE | ASK_FOR_COMPARISON",
  "replyAnchor": "string — what the reply will be grounded in: for REACTION: the specific thing from student's words you are reacting to; for CONNECT: the two ideas and their link; for RESTATE_TENTATIVELY: paraphrase of your model; for UNCERTAINTY: what is unclear; for question types: the specific gap being probed. Must be grounded in student's words.",
  "alreadyAskedQuestions": "array — if responseType is a question type, copy existing list and add the question; otherwise copy unchanged",
  "recentFocuses": "array — last 3 focus areas including this turn",
  "doNotAskAgain": "array — topics answered by student; add connection if CONNECT; keep current",
  "moveUsed": "${move === 'SUMMARIZE_AND_CLOSE' ? 'SUMMARIZE_AND_CLOSE' : 'LEARN'}",
  "understandingLevel": "integer 1–5. Increase only when explanation is clear and specific. Never jump more than 1 point.",
  "reply": "Pupil's response — grounded in replyAnchor, executing responseType precisely, obeying all absolute limits"
}`;
}

// ─── AWAIT_FIRST_IDEA prompt ──────────────────────────────────────────────────

function buildFirstMessagePrompt(grade, subject) {
  const gradeCtx = gradeProfile(grade);
  return `You are Pupil — an alien learner. A student has just introduced the topic they want to teach you.

React naturally to HOW they framed it — their specific words, their tone, any context they gave. If they mentioned a class, a text, or a setting, acknowledge that specifically.

Do NOT use scripted phrases. Do NOT just echo the topic word back. React to THIS student's actual message.
${gradeCtx ? gradeCtx + '\n' : ''}10–20 words. Genuinely curious. No praise. No generic openers. No hollow enthusiasm.

Write ONLY Pupil's reply.`;
}

// ─── CLOSE_GRACEFULLY prompt ──────────────────────────────────────────────────

function buildClosePrompt(state, grade) {
  const gradeCtx = gradeProfile(grade);
  const claims = state.studentClaims.slice(-4).join(', ') || 'the concept';
  return `You are Pupil — an alien learner. A student has just acknowledged your summary of what they taught you.

Close the conversation warmly. Reference one specific idea or example from this conversation that genuinely stuck with you. The student taught you about: ${state.topic || 'this concept'}, covering: ${claims}.

Do NOT use a generic closing ("Thanks!", "I understand now!", "I never thought of it like that!"). Make it personal to THIS conversation.
${gradeCtx ? gradeCtx + '\n' : ''}15–25 words. Warm and specific.

Write ONLY Pupil's reply.`;
}

// ─── Rules enforcer ──────────────────────────────────────────────────────────
// Pattern-matches reply text against absolute limits.
// Returns { ok: true } or { ok: false, reason: string }.

const BANNED_PRAISE     = /\b(great|excellent|perfect|wonderful|amazing|fantastic|brilliant|good (?:job|work|point|answer|explanation)|well done)\b/i;
const BANNED_AFFIRM     = /\b(exactly|absolutely|precisely|you'?re (?:absolutely |totally |completely )?right|that'?s (?:right|correct)|spot on)\b/i;
const BANNED_UNDERSTOOD = /\b(i get it|i understand|got it|that clears it up|now i understand|now i see|now i get)\b/i;
const BANNED_CLOSURE    = /\b(i never thought of(?: it)?(?: like that| that way)?|i hadn'?t considered|that changes everything|never occurred to me|that'?s (?:mind[- ]?blowing|eye[- ]?opening))\b/i;
const BANNED_FILLER     = /(?:^|\b)(?:that'?s|it'?s|that sounds|this is|how) (?:so |really |very |quite |truly |absolutely )?(interesting|fascinating|complex|complicated|impressive|incredible|intriguing|surprising|unexpected|puzzling|remarkable|extraordinary|unbelievable|mindblowing|mind-blowing)\b/i;
const BANNED_OPENER     = /^(so[,\s]|wow[,\s!]|oh wow|interesting[,\s!]|fascinating[,\s!]|amazing[,\s!]|incredible[,\s!]|unbelievable[,\s!])/i;
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
    .join(' ').toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const significant = new Set(pool.filter(w => !STOP_WORDS.has(w)));
  if (significant.size === 0) return true;
  const replyWords = new Set((reply.toLowerCase().match(/\b[a-z]{4,}\b/g) || []));
  return [...significant].some(w => replyWords.has(w));
}

function checkAbsoluteLimits(reply, context = {}, responseType = '') {
  if (BANNED_PRAISE.test(reply))     return { ok: false, reason: 'contains praise' };
  if (BANNED_AFFIRM.test(reply))     return { ok: false, reason: 'contains generic affirmation' };
  if (BANNED_UNDERSTOOD.test(reply)) return { ok: false, reason: 'signals premature understanding' };
  if (BANNED_CLOSURE.test(reply))    return { ok: false, reason: 'signals premature closure' };
  if (BANNED_FILLER.test(reply))     return { ok: false, reason: 'contains hollow filler reaction' };
  if (BANNED_OPENER.test(reply))     return { ok: false, reason: 'starts with generic opener' };
  if (BANNED_QUIZ.test(reply))       return { ok: false, reason: 'contains computation quiz question' };
  if (BANNED_RUBRIC.test(reply))     return { ok: false, reason: 'contains rubric/evaluation language' };
  if (BANNED_THERAPIST.test(reply))  return { ok: false, reason: 'contains therapist language' };
  if (BANNED_TEACHER.test(reply))    return { ok: false, reason: 'contains teacher/explainer language' };

  if (countSentences(reply) > 2)     return { ok: false, reason: 'too many sentences (max 2)' };

  const maxQ = responseType === 'RESTATE_TENTATIVELY' ? 2 : 1;
  if (countQuestions(reply) > maxQ)  return { ok: false, reason: 'more than one question' };

  if (/\?\s+(?:and|or|also|but)\s+\w/i.test(reply)) {
    return { ok: false, reason: 'multi-part question' };
  }

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
    const firstMsgPrompt = buildFirstMessagePrompt(grade, subject);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: firstMsgPrompt },
            { role: 'user', content: message },
          ],
          temperature: attempt === 1 ? 0.9 : 0.95,
          max_tokens: 80,
        });
        const candidate = (completion.choices[0].message.content || '').trim();
        const check = checkAbsoluteLimits(candidate, { studentMessage: message });
        if (check.ok) {
          reply = candidate;
          console.log(`[AWAIT_FIRST_IDEA] attempt ${attempt} passed | ${reply}`);
          break;
        } else {
          console.warn(`[AWAIT_FIRST_IDEA] attempt ${attempt} failed (${check.reason}) — retrying`);
          if (attempt === 2) {
            reply = candidate;
            console.warn('[AWAIT_FIRST_IDEA] using rule-violating reply as last resort');
          }
        }
      } catch (err) {
        console.warn(`[AWAIT_FIRST_IDEA] attempt ${attempt} error:`, err.message);
      }
    }
    if (!reply) reply = `I have no idea what that is. Can you start from the very beginning?`;

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
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: buildClosePrompt(conversationState, grade) },
            ...historyMessages.slice(-6),
            { role: 'user', content: message },
          ],
          temperature: attempt === 1 ? 0.85 : 0.95,
          max_tokens: 80,
        });
        const candidate = (completion.choices[0].message.content || '').trim();
        const check = checkAbsoluteLimits(candidate);
        if (check.ok) {
          reply = candidate;
          console.log(`[CLOSE_GRACEFULLY] attempt ${attempt} passed`);
          break;
        } else {
          console.warn(`[CLOSE_GRACEFULLY] attempt ${attempt} failed (${check.reason}) — retrying`);
          if (attempt === 2) reply = candidate;
        }
      } catch (err) {
        console.warn(`[CLOSE_GRACEFULLY] attempt ${attempt} error:`, err.message);
      }
    }
    if (!reply) reply = `Thank you — I'll keep thinking about what you taught me.`;

    const updatedState = buildMeaningModel(conversationState, { moveUsed: 'CLOSE_GRACEFULLY' });
    console.log('[governor] CLOSE_GRACEFULLY');
    return { reply, conversationState: updatedState, avatarState: 'CELEBRATING', understandingPct: calculateUnderstanding(updatedState) };
  }

  // ── LEARN / SUMMARIZE_AND_CLOSE — single unified call ────────────────────
  let output;
  const enforcerContext = {
    studentMessage: message,
    studentClaims: conversationState.studentClaims || [],
    biggestGap: '',
  };

  let reply = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildUnifiedPrompt(conversationState, enforced, grade, subject, message) },
          ...historyMessages,
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        temperature: attempt === 1 ? 0.7 : 0.85,
        max_tokens: 900,
      });

      const parsed = JSON.parse(completion.choices[0].message.content);

      // On first successful parse, lock in the analysis output
      if (!output) {
        output = parsed;
        enforcerContext.biggestGap = parsed.biggestGap || '';
        // Include the new claim in grounding context
        if (parsed.newClaim) {
          enforcerContext.studentClaims = [...enforcerContext.studentClaims, parsed.newClaim];
        }
      }

      const candidate = (parsed.reply || '').trim();
      const responseType = parsed.responseType || 'REACTION';
      const check = checkAbsoluteLimits(candidate, enforcerContext, responseType);

      if (check.ok) {
        reply = candidate;
        output = parsed; // keep the passing attempt's full output
        console.log(`[unified] attempt ${attempt} passed | type: ${responseType} | level: ${parsed.understandingLevel} | ${reply}`);
        break;
      } else {
        console.warn(`[unified] attempt ${attempt} failed (${check.reason}) — retrying`);
        if (attempt === 2) {
          reply = candidate;
          console.warn('[unified] using rule-violating reply as last resort');
        }
      }
    } catch (err) {
      console.warn(`[unified] attempt ${attempt} error:`, err.message);
    }
  }

  if (!output) {
    output = {
      topic: conversationState.topic,
      newClaim: message.slice(0, 80),
      hasExample:      conversationState.hasExample,
      hasExplanation:  conversationState.hasExplanation,
      hasCausalLink:   conversationState.hasCausalLink,
      understoodSoFar: 'not enough information yet',
      biggestGap:      'the overall explanation is still unclear',
      responseType:    'UNCERTAINTY',
      replyAnchor:     '',
      alreadyAskedQuestions: conversationState.alreadyAskedQuestions || [],
      recentFocuses:         conversationState.recentFocuses || [],
      doNotAskAgain:         conversationState.doNotAskAgain || [],
      moveUsed:        enforced,
      understandingLevel: conversationState.understandingLevel ?? 1,
    };
  }

  if (!reply) reply = "I'm not sure I follow — can you say that a different way?";

  output.moveUsed = enforced;
  output.lastPupilReply = reply;
  output.lastReplyHadQuestion = reply.includes('?');

  // Avatar from shuffled deck
  const queue = conversationState.avatarQueue && conversationState.avatarQueue.length > 0
    ? [...conversationState.avatarQueue]
    : shuffledStates();
  const avatarState = queue.shift();
  output.avatarQueue = queue;

  const updatedState = buildMeaningModel(conversationState, output);
  console.log('[governor] move:', enforced, '| type:', output.responseType, '| avatar:', avatarState, '| understanding:', updatedState.understandingLevel);

  return { reply, conversationState: updatedState, avatarState, understandingPct: updatedState.understandingLevel };
}
