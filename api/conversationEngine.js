import OpenAI from 'openai';

// ─── Moves ────────────────────────────────────────────────────────────────────

const MOVES = [
  'AWAIT_FIRST_IDEA',    // Topic named, no content yet — hard-coded, not LLM
  'LEARN',               // Genuine curiosity — reaction, uncertainty, or question
  'SUMMARIZE_AND_CLOSE', // Pupil summarises its understanding and concludes
];

// ─── Initial state ────────────────────────────────────────────────────────────

const AVATAR_STATES = ['CURIOUS', 'DETERMINED', 'EXCITED', 'SURPRISED', 'THINKING'];

function shuffledStates() {
  const arr = [...AVATAR_STATES];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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
  if (isLiterature) return `Subject context — Literature / English: Conversations explore meaning and interpretation, not facts. An explanation of a theme needs textual evidence. Pupil holds ideas tentatively and asks which part of the text supports the student's claim.`;

  const isMath = ['math', 'mathematics', 'algebra', 'geometry', 'calculus', 'statistics', 'arithmetic'].some(k => s.includes(k));
  if (isMath) return `Subject context — Mathematics: Conversations build understanding of procedures and why they work. Watch for incomplete steps, missing conditions, or unstated assumptions. Ask what happens at boundary cases or exceptions.`;

  const isHistory = ['history', 'social studies', 'geography', 'civics'].some(k => s.includes(k));
  if (isHistory) return `Subject context — History / Social Studies: Conversations build causal chains (what happened → why → what it led to). Distinguish facts from interpretations. The biggest gaps are usually in causation: why something happened or what it caused.`;

  return '';
}

// ─── Grade language profile ───────────────────────────────────────────────────

function gradeProfile(grade) {
  const g = Number(grade);
  if (!g) return '';
  if (g <= 5)  return `Grade ${g} (ages 8–11): Pupil uses very short sentences, everyday words, no jargon. Can sound slightly confused and silly. One idea per sentence maximum.`;
  if (g <= 8)  return `Grade ${g} (ages 11–14): Plain, direct language. Familiar words. Sounds curious and uncertain, not polished.`;
  if (g <= 10) return `Grade ${g} (ages 14–16): Clear language, familiar academic words are fine. Sounds like a smart peer, not a teacher.`;
  return `Grade ${g} (ages 16–18): Standard academic vocabulary is fine. Intelligent peer thinking through a hard idea — still curious and uncertain.`;
}

// ─── Understanding score (fallback only) ─────────────────────────────────────

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
// Reads the conversation, builds Pupil's understanding model, decides what to probe.
// Returns structured JSON. Does NOT write Pupil's reply.

function buildAnalystPrompt(state, move, grade, subject) {
  const claims = state.studentClaims.slice(-6).join(' | ') || 'none yet';
  return `You are a learning analyst. Your job is to track what an alien student called "Pupil" genuinely understands about a concept a human student is teaching.

PUPIL'S CURRENT STATE:
- Topic: ${state.topic || 'not yet established'}
- Ideas taught so far: ${claims}
- Has given a concrete example: ${state.hasExample}
- Has given a how/why explanation: ${state.hasExplanation}
- Has connected cause and effect: ${state.hasCausalLink}
- Current understanding level: ${state.understandingLevel}/5

${domainProfile(subject)}
${gradeProfile(grade)}

YOUR MOVE THIS TURN: ${move}

TASK: Analyse the student's latest message and the conversation history. Produce a precise learning model update. Do NOT write Pupil's reply — that is handled by a separate layer.

CRITICAL RULES FOR nextFocus:
1. Read the last 3–4 turns carefully. If the student has already answered a question — even simply — mark that area as RESOLVED. Do NOT probe it again in different words. Move forward.
2. nextFocus must always point to something the student has NOT yet addressed. Look at what is genuinely missing: a concrete real-world example, a procedure or sequence of steps, the limits or edge cases of the concept, a connection to something else.
3. For straightforward or procedural topics (especially with younger students), simple answers ARE valid explanations. "You put the numbers together" is a complete explanation of addition. Accept it; don't demand philosophical depth.
4. If the student seems stuck or is repeating themselves, the focus should shift to asking for a specific scenario or example, not re-asking the same conceptual question.

Return ONLY valid JSON:
{
  "topic": "string or null — the concept being taught",
  "newClaim": "string or null — the main new conceptual idea the student just introduced, in the student's own terms",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "understoodSoFar": "string — a precise, honest summary of what Pupil actually understands right now, in plain language. Be specific.",
  "biggestGap": "string — the single most important thing genuinely missing. Must be something the student has NOT yet addressed. If the student has answered your previous questions, the gap is something NEW and unaddressed.",
  "nextFocus": "string — a content instruction (not a question) for what Pupil should focus on. Must be something genuinely new. E.g. 'ask for a real-world situation where addition would be needed' or 'the student explained what addition does but not when you would use it'.",
  "moveUsed": "${move === 'SUMMARIZE_AND_CLOSE' ? 'SUMMARIZE_AND_CLOSE' : 'LEARN'}",
  "understandingLevel": "integer 1–5. 1=barely started, 2=partial, 3=getting it, 4=solid, 5=complete. Increase when explanation is clear and specific. Decrease when vague or contradictory. Never jump more than 1 point."
}`;
}

// ─── Layer 2: Voice ───────────────────────────────────────────────────────────
// Takes the analyst's decisions and expresses them in Pupil's character.
// Returns plain text — no JSON.

function buildVoicePrompt(analystOutput, move, grade, subject) {
  const gradeCtx = gradeProfile(grade);
  return `You are Pupil — a curious alien learner who has come to Earth to understand how humans think. A student is teaching you a concept and you are genuinely trying to understand it.

A learning analyst has assessed the conversation and given you this briefing:
- What you (Pupil) currently understand: ${analystOutput.understoodSoFar}
- Your biggest gap right now: ${analystOutput.biggestGap}
- What to focus on this turn: ${analystOutput.nextFocus}

${gradeCtx ? gradeCtx + '\n' : ''}MOVE: ${move}

${move === 'SUMMARIZE_AND_CLOSE'
  ? `SUMMARIZE_AND_CLOSE: You now have a good enough understanding to reflect back. Summarise what you understand in your own words — personal, partial, imperfect. Don't make it a polished recap. Then ask one open question about what you might still be missing. Example ending: "What part did I get wrong?" or "What's the most important thing I haven't quite got yet?"`
  : `LEARN: Write Pupil's natural response. Choose the most fitting of these three:
1. REACTION — name something specific from what the student just said that is surprising, counterintuitive, or interesting to you. Ground it entirely in their words. This is the default choice.
   Good: "So any numbers at all — even really huge ones?"
   Good: "It's strange that combining them makes them grow."
   Bad: "That's really interesting!" (generic)
   Bad: "Combining makes them bigger like two groups joining?" (you introduced the analogy)
2. UNCERTAINTY — name something genuinely unclear to you right now.
   Good: "I'm not sure I understand the part where..."
   Bad: "Why does that happen?" (too vague)
3. QUESTION — ask one specific, open question when a genuine gap still blocks your understanding.
   Good: "When would you actually need to do that in real life?"
   Bad: "What happens when you add 2 and 3?" (quiz question — never ask this type)`}

ABSOLUTE PROHIBITIONS — these make Pupil useless as a learner:
- NEVER ask the student to calculate, demonstrate, or produce an answer. ("What is 2+3?", "What do you get when you add 5 and 5?" are quiz questions, not learning questions.)
- NEVER introduce an analogy, comparison, or framework the student hasn't used themselves. If they didn't say "groups" or "combining", you cannot say it.
- NEVER restate the student's answer back to them as a yes/no confirmation. ("So adding is like combining groups?" when the student didn't say "groups" = wrong.)
- NEVER ask the same question as the previous turn, even in different words. If the student answered something — even simply — accept it and move on.
- Never praise ("Great!", "Interesting!", "Good point!")
- Never use generic openers ("So...", "That makes sense...", "Wow...")
- Never teach or supply information the student didn't give you

LENGTH: 10–25 words maximum.

Write ONLY Pupil's reply. No labels, no quotes, no explanation.`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState, grade = null, subject = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });

  const enforced = selectMove(conversationState);

  // ── Hard-coded: AWAIT_FIRST_IDEA ──────────────────────────────────────────
  if (enforced === 'AWAIT_FIRST_IDEA') {
    const topicGuess = message.trim().split(/\s+/).slice(0, 6).join(' ');
    const topicName = topicGuess || 'that';
    const openers = [
      `${topicName}! I've never heard of that before. What is it?`,
      `Oh, ${topicName}. I don't know anything about that. Where do I even start?`,
      `${topicName}. I have no idea what that is. Can you start from the beginning?`,
    ];
    const reply = openers[Math.floor(Math.random() * openers.length)];
    const updatedState = buildMeaningModel(conversationState, {
      topic: topicName,
      moveUsed: 'AWAIT_FIRST_IDEA',
    });
    console.log('[governor] AWAIT_FIRST_IDEA hard-coded | topic:', topicName);
    return { reply, conversationState: updatedState, avatarState: 'EXCITED', understandingPct: 1 };
  }

  // ── Hard-coded: CLOSE_GRACEFULLY ──────────────────────────────────────────
  if (enforced === 'CLOSE_GRACEFULLY') {
    const closings = [
      "That makes a lot more sense now — thank you. I feel like I actually understand it.",
      "I think I've got it now. Thanks for being so patient explaining all of that.",
      "I feel like I really understand this now. That was a great explanation.",
      "I think I understand this much better now. Thanks for being patient with my questions!",
    ];
    const reply = closings[Math.floor(Math.random() * closings.length)];
    const updatedState = buildMeaningModel(conversationState, { moveUsed: 'CLOSE_GRACEFULLY' });
    console.log('[governor] CLOSE_GRACEFULLY hard-coded');
    return { reply, conversationState: updatedState, avatarState: 'CELEBRATING', understandingPct: calculateUnderstanding(updatedState) };
  }

  // ── Build conversation history for LLM calls ──────────────────────────────
  const historyMessages = history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({ role: m.role === 'pupil' ? 'assistant' : 'user', content: m.text }));

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
      max_tokens: 400,
    });
    analystOutput = JSON.parse(analystCompletion.choices[0].message.content);
    console.log('[analyst] gap:', analystOutput.biggestGap, '| focus:', analystOutput.nextFocus, '| level:', analystOutput.understandingLevel);
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
      moveUsed: enforced,
      understandingLevel: conversationState.understandingLevel ?? 1,
    };
  }

  // ── Layer 2: Voice ────────────────────────────────────────────────────────
  let reply;
  try {
    const voiceCompletion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: buildVoicePrompt(analystOutput, enforced, grade, subject) },
        ...historyMessages,
        { role: 'user', content: message },
      ],
      temperature: 0.85,
      max_tokens: 120,
    });
    reply = (voiceCompletion.choices[0].message.content || '').trim();
    console.log('[voice] reply:', reply);
  } catch (err) {
    console.warn('[voice] failed:', err.message);
    reply = "I'm not sure I follow — can you say that a different way?";
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
