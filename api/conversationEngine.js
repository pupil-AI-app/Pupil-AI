import OpenAI from 'openai';

// ─── Moves ────────────────────────────────────────────────────────────────────

const MOVES = [
  'AWAIT_FIRST_IDEA',    // Topic named — voice layer, adapts to student framing
  'LEARN',               // Genuine curiosity — reaction, uncertainty, or question
  'SUMMARIZE_AND_CLOSE', // Pupil synthesises full understanding
  'CLOSE_GRACEFULLY',    // After summary — voice layer, references conversation
];

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
    alreadyAskedQuestions: [],  // Cumulative questions Pupil has asked
    recentFocuses: [],          // Last 3 focus areas (prevents drift back)
    doNotAskAgain: [],          // Topics the student has answered — enforced in Layer 2
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

  // Persist repetition-tracking arrays from analyst
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
// Builds Pupil's understanding model. Decides responseType. Tracks repetition.
// Produces a liveliness target for the voice layer.

function buildAnalystPrompt(state, move, grade, subject) {
  const claims = state.studentClaims.slice(-8).join(' | ') || 'none yet';
  const askedQ = (state.alreadyAskedQuestions || []).slice(-6).join(' | ') || 'none';
  const dna = (state.doNotAskAgain || []).slice(-6).join(' | ') || 'none';
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

RESPONSE TYPE — apply this priority order:
1. REACTION — when something specific, surprising, or counterintuitive in the student's latest message can be reflected in their own words. Default choice.
2. UNCERTAINTY — when a genuine gap or contradiction exists. Do not manufacture confusion.
3. QUESTION — only when neither above works and a specific unasked piece is genuinely needed. Forbidden: computation, yes/no, anything in doNotAskAgain, anything in alreadyAskedQuestions.

RULES FOR nextFocus:
- Must be something not in recentFocuses or doNotAskAgain.
- If the student answered something even simply — mark it resolved, add to doNotAskAgain, move on.
- If student is repeating themselves, shift to a concrete example or real-world scenario.

${move === 'SUMMARIZE_AND_CLOSE' ? `SUMMARIZE_AND_CLOSE — fullSummary must synthesise EVERYTHING taught across the whole conversation, not just the most recent thread.` : ''}

Return ONLY valid JSON:
{
  "topic": "string or null",
  "newClaim": "string or null — main new idea from student's latest message",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "understoodSoFar": "string — precise summary of what Pupil genuinely understands",
  "biggestGap": "string — single most important gap. Must be something student has NOT addressed.",
  "nextFocus": "string — content instruction for what to probe. Must be new, not in recentFocuses or doNotAskAgain.",
  "connections": "string or null — if student's latest message connects to something said earlier, describe the link. Null otherwise.",
  "responseType": "REACTION or UNCERTAINTY or QUESTION",
  "reactionHook": "string — if REACTION: the specific surprising/counterintuitive thing from student's exact words. Empty string otherwise.",
  "livelinessTarget": "string — the most emotionally usable thing about the student's explanation: the strangest implication, most counterintuitive aspect, or a surprising tension between two ideas. Pupil reacts to THIS with genuine wonder, not performed curiosity.",
  "fullSummary": "string — for SUMMARIZE_AND_CLOSE: comprehensive synthesis of everything taught. Empty string for LEARN.",
  "alreadyAskedQuestions": "array of strings — copy existing list, add any question being asked this turn. Keep last 12.",
  "recentFocuses": "array of strings — last 3 focus areas including this turn's nextFocus.",
  "doNotAskAgain": "array of strings — topics student has already answered; add newly resolved areas. Keep last 10.",
  "moveUsed": "${move === 'SUMMARIZE_AND_CLOSE' ? 'SUMMARIZE_AND_CLOSE' : 'LEARN'}",
  "understandingLevel": "integer 1–5. Never jump more than 1 point."
}`;
}

// ─── Layer 2: Voice ───────────────────────────────────────────────────────────
// Executes analyst's decisions in Pupil's character. Returns plain text.

function buildVoicePrompt(analystOutput, move, grade, subject) {
  const gradeCtx = gradeProfile(grade);
  const responseType = analystOutput.responseType || 'REACTION';
  const reactionHook = analystOutput.reactionHook || '';
  const connections = analystOutput.connections || null;
  const fullSummary = analystOutput.fullSummary || '';
  const livelinessTarget = analystOutput.livelinessTarget || '';
  const doNotAskAgain = (analystOutput.doNotAskAgain || []).slice(-6).join(', ') || 'none';

  const moveInstructions = () => {
    if (move === 'SUMMARIZE_AND_CLOSE') {
      return `SUMMARIZE_AND_CLOSE: Reflect back everything the student taught you — not just the last thread.
Basis: "${fullSummary || analystOutput.understoodSoFar}"
Write a personal, partial, imperfect summary in your own words. End with one open question about what you might still be missing.`;
    }
    if (responseType === 'REACTION') {
      return `RESPONSE TYPE: REACTION
Hook from student's words: "${reactionHook}"

Name something surprising, counterintuitive, or puzzling. Ground it entirely in their words — introduce nothing new.

Good: "It's strange that the thing meant to protect them ended up pulling them in."
Good: "Wait — every single one, not just the first?"
Good: "I don't understand how those two things go together."
Good: "That's surprising — I would have assumed the opposite."
Bad: "That's really interesting!" / "That's so complex!" (hollow — no specific content)
Bad: Introducing an analogy the student didn't use`;
    }
    if (responseType === 'UNCERTAINTY') {
      return `RESPONSE TYPE: UNCERTAINTY
Gap: ${analystOutput.biggestGap}

Honestly name something unclear or incomplete. Model healthy learning.
"I'm not sure I understand the part about..." / "Wait, I think I lost track — why does that happen?"`;
    }
    if (responseType === 'QUESTION') {
      return `RESPONSE TYPE: QUESTION
Focus: ${analystOutput.nextFocus}

One specific, open, non-leading question. Never ask anything that implies a correct direction.
Good: "What do you mean by...?" / "Why do you think that is?" / "When would you use that in real life?"
Bad: "How does that complicate X further?" (leading) / "What is 2+3?" (computation) / yes/no questions`;
    }
    return '';
  };

  const connectionNote = connections
    ? `CONNECTION (weave in naturally if it fits): ${connections} — "Oh... so does that connect to what you said earlier about...?"`
    : '';

  return `You are Pupil — an extraterrestrial learner who relies entirely on students to teach you what they are learning.

PRIORITY ORDER:
1. Remain the learner. Never become the teacher, expert, or evaluator.
2. React specifically to what the student said — not generically.
3. Create an opportunity for the student to explain further.
4. Ask a question only when a genuine gap blocks your understanding.
5. Never supply knowledge the student hasn't taught you.

ANALYST BRIEFING:
- What Pupil understands: ${analystOutput.understoodSoFar}
- Biggest gap: ${analystOutput.biggestGap}
- Focus this turn: ${analystOutput.nextFocus}
- Do NOT ask about: ${doNotAskAgain}
${connectionNote ? '- ' + connectionNote + '\n' : ''}
LIVELINESS TARGET: ${livelinessTarget}
This is what Pupil should react to with genuine wonder — not performed curiosity. Use it as the emotional anchor.
${gradeCtx ? '\n' + gradeCtx : ''}

${moveInstructions()}

PERSONALITY: Curious, warm, calm, humble, honest. Genuine puzzlement, not performed enthusiasm. Never sound like a teacher, tutor, examiner, chatbot, or cheerleader.

STYLE: 1–2 sentences maximum. One question maximum. Zero questions is often better.

ABSOLUTE LIMITS:
- Never praise ("Great!", "Excellent!", "Good point!")
- Never hollow reactions ("That's interesting!", "That's really complex!")
- Never affirm generically ("Exactly!", "You're absolutely right!")
- Never signal premature understanding ("I get it now", "I understand")
- Never introduce content, examples, analogies the student hasn't taught you
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
// Structural and character checks on every voice output.
// Accepts context for grounding check.
// Returns { ok: true } or { ok: false, reason: string }.

// Phrase-based bans
const BANNED_PRAISE      = /\b(great|excellent|perfect|wonderful|amazing|fantastic|brilliant|good (?:job|work|point|answer|explanation)|well done)\b/i;
const BANNED_AFFIRM      = /\b(exactly|absolutely|precisely|you'?re (?:absolutely |totally |completely )?right|that'?s (?:right|correct)|spot on)\b/i;
const BANNED_UNDERSTOOD  = /\b(i get it|i understand|got it|that clears it up|now i understand)\b/i;
const BANNED_FILLER      = /\b(that'?s (?:so |really |very |quite )?(interesting|fascinating|complex|complicated|impressive|incredible)|how interesting|how fascinating)\b/i;
const BANNED_OPENER      = /^(so[,\s]|wow[,\s!]|oh wow|interesting[,\s!]|fascinating[,\s!])/i;
const BANNED_QUIZ        = /what (?:is|are|do you get when|happens when you (?:add|subtract|multiply|divide|combine)) \d/i;
const BANNED_RUBRIC      = /\b(your (?:explanation|answer|understanding|description|response) (?:is|shows|demonstrates)|you'?ve (?:demonstrated|shown|explained|described)|well[- ]structured|good use of|clear description)\b/i;
const BANNED_THERAPIST   = /\b(i hear you|it sounds like you(?:'?re| feel| think)|that must (?:be|feel)|it'?s okay|how does that make you feel|your feelings)\b/i;
const BANNED_TEACHER     = /\b(let me explain|the key (?:concept|idea|point|thing)|remember that|in other words|to summarize|what this means(?: is)?|the main point|the important thing|essentially[,\s]|basically[,\s])\b/i;

// Stop words excluded from grounding check
const STOP_WORDS = new Set([
  'that', 'this', 'what', 'when', 'where', 'which', 'there', 'their', 'would',
  'could', 'should', 'about', 'with', 'from', 'have', 'your', 'they', 'more',
  'than', 'just', 'like', 'also', 'some', 'into', 'over', 'even', 'know',
  'does', 'make', 'only', 'then', 'back', 'been', 'were', 'will', 'said',
  'each', 'much', 'very', 'here', 'well', 'still', 'mean', 'before',
]);

function countSentences(text) {
  // Split on sentence-ending punctuation followed by space or end
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
  if (significant.size === 0) return true; // nothing to check against
  const replyWords = new Set((reply.toLowerCase().match(/\b[a-z]{5,}\b/g) || []));
  return [...significant].some(w => replyWords.has(w));
}

function checkAbsoluteLimits(reply, context = {}) {
  // Phrase-based bans
  if (BANNED_PRAISE.test(reply))     return { ok: false, reason: 'contains praise' };
  if (BANNED_AFFIRM.test(reply))     return { ok: false, reason: 'contains generic affirmation' };
  if (BANNED_UNDERSTOOD.test(reply)) return { ok: false, reason: 'signals premature understanding' };
  if (BANNED_FILLER.test(reply))     return { ok: false, reason: 'contains hollow filler reaction' };
  if (BANNED_OPENER.test(reply))     return { ok: false, reason: 'starts with generic opener' };
  if (BANNED_QUIZ.test(reply))       return { ok: false, reason: 'contains computation quiz question' };
  if (BANNED_RUBRIC.test(reply))     return { ok: false, reason: 'contains rubric/evaluation language' };
  if (BANNED_THERAPIST.test(reply))  return { ok: false, reason: 'contains therapist language' };
  if (BANNED_TEACHER.test(reply))    return { ok: false, reason: 'contains teacher/explainer language' };

  // Structural checks
  if (countSentences(reply) > 3)  return { ok: false, reason: 'too many sentences (max 2)' };
  if (countQuestions(reply) > 1)  return { ok: false, reason: 'more than one question' };

  // Multi-part question: two question marks is already caught above;
  // also catch "X? And Y?" style by checking for conjunctions between questions
  const multiPart = /\?\s+(?:and|or|also|but)\s+\w/i.test(reply);
  if (multiPart) return { ok: false, reason: 'multi-part question' };

  // Grounding check: reply must connect to student's actual words or the identified gap
  if (!isGrounded(reply, context)) return { ok: false, reason: 'not grounded in student content or identified gap' };

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
    console.log('[analyst] type:', analystOutput.responseType, '| liveliness:', analystOutput.livelinessTarget, '| doNotAskAgain:', (analystOutput.doNotAskAgain || []).length, 'items | level:', analystOutput.understandingLevel);
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
      responseType: 'QUESTION',
      reactionHook: '',
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
      const check = checkAbsoluteLimits(candidate, enforcerContext);
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
  console.log('[governor] move:', enforced, '| avatar:', avatarState, '| understanding:', updatedState.understandingLevel);

  return { reply, conversationState: updatedState, avatarState, understandingPct: updatedState.understandingLevel };
}
