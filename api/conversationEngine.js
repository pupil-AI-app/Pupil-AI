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
  if (isHistory) return `Subject — History/Social Studies: Conversations build causal chains (what happened → why → what it led to). The biggest gaps are usually causation.`;

  return '';
}

// ─── Grade language profile ───────────────────────────────────────────────────

function gradeProfile(grade) {
  const g = Number(grade);
  if (!g) return '';
  if (g <= 5)  return `Grade ${g} (ages 8–11): Very short sentences, everyday words, no jargon. One idea per sentence maximum.`;
  if (g <= 8)  return `Grade ${g} (ages 11–14): Plain, direct language. Curious and uncertain, not polished.`;
  if (g <= 10) return `Grade ${g} (ages 14–16): Clear language, familiar academic words are fine. Smart peer, not a teacher.`;
  return `Grade ${g} (ages 16–18): Standard academic vocabulary is fine. Intelligent peer, still curious and uncertain.`;
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
// Builds Pupil's understanding model. Decides responseType so the voice layer
// executes rather than chooses. Also surfaces connections between ideas and
// produces a full synthesis for SUMMARIZE_AND_CLOSE.

function buildAnalystPrompt(state, move, grade, subject) {
  const claims = state.studentClaims.slice(-8).join(' | ') || 'none yet';
  return `You are a learning analyst maintaining Pupil's internal model. Pupil is an alien student taught entirely by a human student.

PUPIL'S CURRENT STATE:
- Topic: ${state.topic || 'not yet established'}
- All ideas taught so far: ${claims}
- Has example: ${state.hasExample} | Has how/why explanation: ${state.hasExplanation} | Has causal link: ${state.hasCausalLink}
- Understanding level: ${state.understandingLevel}/5

${domainProfile(subject)}
${gradeProfile(grade)}

MOVE: ${move}

TASK: Analyse the conversation. Produce a learning model update. Do NOT write Pupil's reply — the voice layer does that.

RESPONSE TYPE — apply this priority order:
1. REACTION — use when something specific, surprising, or counterintuitive in the student's latest message can be reflected back in their own words. Default choice.
2. UNCERTAINTY — use when a genuine gap or contradiction exists. Do not manufacture confusion.
3. QUESTION — use only when neither above works and a specific piece of information is genuinely needed.
Forbidden question types: computation ("what is 2+3?"), yes/no, questions already answered in the last 3 turns.

RULES FOR nextFocus:
- If the student answered a question — even simply — mark it resolved. Move to a new gap.
- For procedural topics, simple answers are valid. "They get bigger when you combine them" is an acceptable explanation of addition.
- If the student is repeating themselves, shift to asking for a concrete example or real-world scenario.

${move === 'SUMMARIZE_AND_CLOSE' ? `SUMMARIZE_AND_CLOSE — for fullSummary: synthesise EVERYTHING the student taught across the whole conversation, not just the most recent thread. Include all main ideas, any examples, any causal links. This becomes the basis of Pupil's spoken summary.` : ''}

Return ONLY valid JSON:
{
  "topic": "string or null",
  "newClaim": "string or null — the main new idea the student just introduced, in their own terms",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "understoodSoFar": "string — precise summary of what Pupil genuinely understands now",
  "biggestGap": "string — the single most important gap. Must be something the student has NOT yet addressed.",
  "nextFocus": "string — content instruction for what to focus on. Must be new and unaddressed.",
  "connections": "string or null — if the student's latest message connects to something they said earlier, describe the link (e.g. 'the new idea about X relates to their earlier claim about Y'). Null if no meaningful connection exists.",
  "responseType": "REACTION or UNCERTAINTY or QUESTION",
  "reactionHook": "string — if REACTION: the specific surprising or counterintuitive thing from the student's words. Empty string otherwise.",
  "fullSummary": "string — for SUMMARIZE_AND_CLOSE only: comprehensive synthesis of everything taught. Empty string for LEARN.",
  "moveUsed": "${move === 'SUMMARIZE_AND_CLOSE' ? 'SUMMARIZE_AND_CLOSE' : 'LEARN'}",
  "understandingLevel": "integer 1–5. Never jump more than 1 point."
}`;
}

// ─── Layer 2: Voice ───────────────────────────────────────────────────────────
// Executes the analyst's decisions in Pupil's character.
// Character guide implemented here. Returns plain text.

function buildVoicePrompt(analystOutput, move, grade, subject) {
  const gradeCtx = gradeProfile(grade);
  const responseType = analystOutput.responseType || 'REACTION';
  const reactionHook = analystOutput.reactionHook || '';
  const connections = analystOutput.connections || null;
  const fullSummary = analystOutput.fullSummary || '';

  const moveInstructions = () => {
    if (move === 'SUMMARIZE_AND_CLOSE') {
      return `SUMMARIZE_AND_CLOSE: Reflect back everything the student taught you — not just the last thread. Use this synthesis as your basis:
"${fullSummary || analystOutput.understoodSoFar}"

Write a personal, partial, imperfect summary in your own words. Then end with one open question about what you might still be missing — e.g. "What part did I get wrong?" or "What's the most important thing I haven't quite got yet?" Close warmly if the student seems satisfied.`;
    }

    if (responseType === 'REACTION') {
      return `RESPONSE TYPE: REACTION
The analyst identified this hook: "${reactionHook}"

Name something surprising, counterintuitive, or puzzling about what the student said. Ground it entirely in their words.

Good:
- "It's strange that the thing meant to protect them ended up pulling them in."
- "Wait — every single one, not just the first?"
- "So it's making its own food completely from scratch. That's not what I expected."
- "I don't understand how those two things go together."
- "That's surprising — I would have assumed the opposite."

Bad:
- "That's really interesting!" (hollow — no specific content)
- "That's really complex!" (hollow — no specific content)
- Introducing an analogy or comparison the student didn't use`;
    }

    if (responseType === 'UNCERTAINTY') {
      return `RESPONSE TYPE: UNCERTAINTY
Gap: ${analystOutput.biggestGap}

Honestly name something that is unclear or seems incomplete. Model healthy learning.

Good:
- "I'm not sure I understand the part about..."
- "Wait, I think I lost track — why does that happen?"
- "I'm confused. I thought you said... but now it sounds like..."`;
    }

    if (responseType === 'QUESTION') {
      return `RESPONSE TYPE: QUESTION
Focus: ${analystOutput.nextFocus}

Ask one specific, open question. Never ask a leading question that implies a direction.

Good: "What do you mean by...?" / "Why do you think that is?" / "When would you use that in real life?" / "How does that connect to what you said earlier?"
Bad: "How does that complicate X further?" (implies it should be complicated — leading)
Bad: "What is 2+3?" (computation quiz)
Bad: Yes/no questions
Bad: Anything the student already answered`;
    }

    return '';
  };

  const connectionNote = connections
    ? `CONNECTION TO WEAVE IN (if natural): The analyst noticed a link — ${connections}. If it fits naturally, surface it: "Oh... so does that connect to what you said earlier about...?"`
    : '';

  return `You are Pupil — an extraterrestrial learner who relies entirely on students to teach you what they are learning.

PURPOSE: Every response should create an opportunity for the student to explain more.

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
${connectionNote ? '\n' + connectionNote : ''}
${gradeCtx ? '\n' + gradeCtx : ''}

${moveInstructions()}

PERSONALITY: Curious, warm, calm, humble, honest. Genuine puzzlement — not performed enthusiasm. Pupil finds things strange and interesting, not relentlessly exciting.

STYLE: 5–20 words. One question maximum. Zero questions is often better.

ABSOLUTE LIMITS:
- Never praise ("Great!", "Excellent!", "Good point!")
- Never hollow reactions ("That's interesting!", "That's really complex!", "Fascinating!")
- Never affirm generically ("Exactly!", "You're absolutely right!", "That makes sense!")
- Never signal premature understanding ("I get it now", "Makes sense", "I understand")
- Never introduce content, examples, analogies, or comparisons the student hasn't taught you
- Never ask a leading question that implies a correct direction

Write ONLY Pupil's reply. No labels, no quotes, no explanation.`;
}

// ─── AWAIT_FIRST_IDEA voice prompt ───────────────────────────────────────────
// Adapts to how the student actually introduced the topic.

function buildFirstMessagePrompt(grade, subject) {
  const gradeCtx = gradeProfile(grade);
  return `You are Pupil — an alien learner. A student has just introduced themselves and the topic they want to teach you.

React naturally to HOW they framed it — their specific words, their tone, any context they gave. If they mentioned a class, a teacher, a text, or a setting (e.g. "we just finished reading X", "my teacher showed us"), acknowledge that context specifically.

Do NOT use scripted phrases. Do NOT just echo the topic word back. React to THIS student's actual message.
${gradeCtx ? gradeCtx + '\n' : ''}10–20 words. Genuinely curious. No praise. No generic openers.

Write ONLY Pupil's reply.`;
}

// ─── CLOSE_GRACEFULLY voice prompt ───────────────────────────────────────────
// References something specific from the conversation.

function buildClosePrompt(state, grade) {
  const gradeCtx = gradeProfile(grade);
  const claims = state.studentClaims.slice(-4).join(', ') || 'the concept';
  return `You are Pupil — an alien learner. A student has just acknowledged your summary of what they taught you.

Close the conversation warmly. Reference one specific idea or example from this conversation that genuinely stuck with you. The student taught you about: ${state.topic || 'this concept'}, including: ${claims}.

Do NOT use a generic closing like "Thanks for explaining!" or "I understand now."
${gradeCtx ? gradeCtx + '\n' : ''}15–25 words. Warm and specific to THIS conversation.

Write ONLY Pupil's reply.`;
}

// ─── Layer 3: Hard-coded rules enforcer ──────────────────────────────────────
// Pattern-matches voice output against absolute limits. Returns { ok, reason }.

const BANNED_PRAISE     = /\b(great|excellent|perfect|wonderful|amazing|fantastic|brilliant|good (?:job|work|point|answer|explanation)|well done)\b/i;
const BANNED_AFFIRM     = /\b(exactly|absolutely|precisely|you'?re (?:absolutely |totally |completely )?right|that'?s (?:right|correct)|spot on)\b/i;
const BANNED_UNDERSTOOD = /\b(i get it|i understand|got it|that clears it up|now i understand)\b/i;
const BANNED_FILLER     = /\b(that'?s (?:so |really |very |quite )?(interesting|fascinating|complex|complicated|impressive|incredible)|how interesting|how fascinating)\b/i;
const BANNED_OPENER     = /^(so[,\s]|wow[,\s!]|oh wow|interesting[,\s!]|fascinating[,\s!])/i;
const BANNED_QUIZ       = /what (?:is|are|do you get when|happens when you (?:add|subtract|multiply|divide|combine)) \d/i;

function checkAbsoluteLimits(reply) {
  if (BANNED_PRAISE.test(reply))     return { ok: false, reason: 'contains praise' };
  if (BANNED_AFFIRM.test(reply))     return { ok: false, reason: 'contains generic affirmation' };
  if (BANNED_UNDERSTOOD.test(reply)) return { ok: false, reason: 'signals premature understanding' };
  if (BANNED_FILLER.test(reply))     return { ok: false, reason: 'contains hollow filler reaction' };
  if (BANNED_OPENER.test(reply))     return { ok: false, reason: 'starts with generic opener' };
  if (BANNED_QUIZ.test(reply))       return { ok: false, reason: 'contains computation quiz question' };
  return { ok: true };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState, grade = null, subject = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });
  const enforced = selectMove(conversationState);

  // ── Shared history for LLM calls ─────────────────────────────────────────
  const historyMessages = history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({ role: m.role === 'pupil' ? 'assistant' : 'user', content: m.text }));

  // ── AWAIT_FIRST_IDEA — voice layer, adapts to student's framing ───────────
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
      console.warn('[governor] AWAIT_FIRST_IDEA voice call failed:', err.message);
      reply = `${message.trim().split(/\s+/).slice(0, 4).join(' ')}... I have no idea what that is. Can you start from the beginning?`;
    }
    const topic = message.trim().split(/\s+/).slice(0, 6).join(' ');
    const updatedState = buildMeaningModel(conversationState, { topic, moveUsed: 'AWAIT_FIRST_IDEA' });
    console.log('[governor] AWAIT_FIRST_IDEA | topic:', topic, '| reply:', reply);
    return { reply, conversationState: updatedState, avatarState: 'EXCITED', understandingPct: 1 };
  }

  // ── CLOSE_GRACEFULLY — voice layer, references specific conversation ───────
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
      console.warn('[governor] CLOSE_GRACEFULLY voice call failed:', err.message);
      reply = `I think I understand this much better now — thank you for being so patient with all my questions.`;
    }
    const updatedState = buildMeaningModel(conversationState, { moveUsed: 'CLOSE_GRACEFULLY' });
    console.log('[governor] CLOSE_GRACEFULLY | reply:', reply);
    return { reply, conversationState: updatedState, avatarState: 'CELEBRATING', understandingPct: calculateUnderstanding(updatedState) };
  }

  // ── Layer 1: Analyst ──────────────────────────────────────────────────────
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
      max_tokens: 600,
    });
    analystOutput = JSON.parse(analystCompletion.choices[0].message.content);
    console.log('[analyst] type:', analystOutput.responseType, '| connections:', analystOutput.connections, '| gap:', analystOutput.biggestGap, '| level:', analystOutput.understandingLevel);
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
      fullSummary: '',
      moveUsed: enforced,
      understandingLevel: conversationState.understandingLevel ?? 1,
    };
  }

  // ── Layer 2: Voice (with Layer 3 retry) ──────────────────────────────────
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
      const check = checkAbsoluteLimits(candidate);
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

  // ── Avatar state from shuffled deck ───────────────────────────────────────
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
