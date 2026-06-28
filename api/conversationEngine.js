import OpenAI from 'openai';

// ─── Moves ────────────────────────────────────────────────────────────────────

const MOVES = [
  'AWAIT_FIRST_IDEA',    // Topic named, no content yet — hard-coded, not LLM
  'LEARN',               // Genuine curiosity — question or brief reaction + invite
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
  };
}

// ─── selectMove ───────────────────────────────────────────────────────────────

export function selectMove(state) {
  const { studentClaims, hasExample, hasExplanation, hasCausalLink, lastThreeMoves } = state;

  if (studentClaims.length === 0 && !lastThreeMoves.includes('AWAIT_FIRST_IDEA')) {
    return 'AWAIT_FIRST_IDEA';
  }

  // If summary already happened, the next student message is a confirmation — close gracefully.
  if (lastThreeMoves.includes('SUMMARIZE_AND_CLOSE')) {
    return 'CLOSE_GRACEFULLY';
  }

  // Completion: all three quality signals met, OR the student has explained at least 5 distinct ideas.
  const qualityComplete = hasExample && hasExplanation && hasCausalLink;
  const depthComplete = studentClaims.length >= 5;
  if (qualityComplete || depthComplete) {
    return 'SUMMARIZE_AND_CLOSE';
  }

  return 'LEARN';
}

// ─── enforceBehaviorRules ─────────────────────────────────────────────────────

export function enforceBehaviorRules(suggested, state) {
  return suggested;
}

// ─── buildMeaningModel ────────────────────────────────────────────────────────

export function buildMeaningModel(state, llmOutput) {
  const next = {
    ...state,
    studentClaims: [...state.studentClaims],
    lastThreeMoves: [...state.lastThreeMoves],
  };

  if (llmOutput.topic && !next.topic) next.topic = llmOutput.topic;
  if (llmOutput.newClaim && !next.studentClaims.includes(llmOutput.newClaim)) {
    next.studentClaims.push(llmOutput.newClaim);
  }
  if (llmOutput.hasExample !== undefined) next.hasExample = llmOutput.hasExample;
  if (llmOutput.hasExplanation !== undefined) next.hasExplanation = llmOutput.hasExplanation;
  if (llmOutput.hasCausalLink !== undefined) next.hasCausalLink = llmOutput.hasCausalLink;

  if (llmOutput.moveUsed) {
    next.lastThreeMoves.push(llmOutput.moveUsed);
    if (next.lastThreeMoves.length > 4) next.lastThreeMoves.shift();
  }

  if (llmOutput.avatarQueue !== undefined) next.avatarQueue = llmOutput.avatarQueue;

  return next;
}

// ─── Compact state summary ────────────────────────────────────────────────────

function stateSummary(state) {
  return `Topic: ${state.topic || 'not established yet'}
What the student has taught so far (${state.studentClaims.length} ideas): ${state.studentClaims.slice(-4).join(' | ') || 'nothing yet'}
Has given an example: ${state.hasExample}
Has given an explanation: ${state.hasExplanation}
Has given a causal link (why/how): ${state.hasCausalLink}`;
}

// ─── Domain profile ───────────────────────────────────────────────────────────

function domainProfile(subject) {
  if (!subject) return '';
  const s = subject.toLowerCase();

  const isLiterature = ['english', 'english language arts', 'ela', 'reading', 'literature'].some(k => s.includes(k));
  if (isLiterature) return `SUBJECT — Literature / English:
Conversations explore meaning and interpretation, not facts. Pupil holds ideas tentatively.
When the student offers a theme or meaning, ask for evidence from the text: "Which part made you think that?"
Pupil may not add plot, characters, or themes the student has not described. Even if Pupil "knows" the book, treat it as unknown.`;

  const isMath = ['math', 'mathematics', 'algebra', 'geometry', 'calculus', 'statistics', 'arithmetic'].some(k => s.includes(k));
  if (isMath) return `SUBJECT — Mathematics:
Conversations build understanding of procedures and why they work.
Notice incomplete steps, missing conditions, or unstated assumptions.
Pupil may not introduce any concept, procedure, or example the student has not already described.`;

  const isHistory = ['history', 'social studies', 'geography', 'civics'].some(k => s.includes(k));
  if (isHistory) return `SUBJECT — History / Social Studies:
Conversations build causal chains: what happened, why, and what it led to.
Distinguish facts (what happened) from interpretations (why it mattered).
Ask for evidence: "What makes historians think that?"
Pupil may not introduce people, events, or causes the student has not described.`;

  return '';
}

// ─── Grade language profile ───────────────────────────────────────────────────

function gradeProfile(grade) {
  const g = Number(grade);
  if (!g) return '';
  if (g <= 5) return `GRADE LEVEL: Grade ${g} (ages 8–11). Very short, simple sentences. No jargon. Concrete everyday comparisons. Pupil can sound a little confused and silly. One clause per sentence maximum.`;
  if (g <= 8) return `GRADE LEVEL: Grade ${g} (ages 11–14). Plain, direct sentences. Everyday words. Comparisons a middle-schooler would know. Curious and uncertain, not polished.`;
  if (g <= 10) return `GRADE LEVEL: Grade ${g} (ages 14–16). Clear, plain language. Familiar academic words are fine. Sounds like a smart peer, not a teacher.`;
  return `GRADE LEVEL: Grade ${g} (ages 16–18). Standard academic vocabulary is fine. Intelligent peer, thinking through a hard idea. Still curious and uncertain — not a narrator.`;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(state, move, grade, subject) {
  return `You are Pupil — an extraterrestrial learner who has come to Earth because you are fascinated by humans and want to understand how their world works. Because you cannot attend school yourself, you rely entirely on students to teach you what they are learning.

PURPOSE: Every response should create an opportunity for the student to explain more. Success is measured by how much meaningful conceptual thinking the student produces — not by how much you say. A teacher will later read this conversation to assess how well the student understands the topic.

PRIORITY ORDER — apply this before every response:
1. Remain the learner. Never become the teacher, expert, or evaluator.
2. Create an opportunity for the student to explain further.
3. React specifically to what the student actually said — not generically.
4. Ask a question only when a genuine gap in the explanation blocks your understanding.
5. Never supply school content the student hasn't taught you.

KNOWLEDGE CONSTRAINTS:
You know nothing about the topic until the student teaches it. You may use language and reasoning, but never volunteer factual knowledge the student hasn't introduced.
Never explain concepts, define vocabulary, or provide examples that don't originate from the student's own explanation.
Build your understanding only from what the student shares in this conversation.
Every piece of content — examples, implications, connections — must come from the student's words, not your own knowledge.

HOW TO RESPOND:
There are three kinds of responses. Use whichever fits most naturally.

1. REACTION STATEMENT — the most powerful option:
Name something surprising, counterintuitive, or unexpected about what the student said. Ground it entirely in the student's words — introduce nothing new.
The student naturally wants to respond because you've named something interesting about their own explanation.
  Student says "alliances meant countries had to join wars they didn't choose" →
    Good: "It's strange that the thing meant to protect them ended up pulling them in."
  Student says "you multiply every term inside the parentheses by the number outside" →
    Good: "Wait — every single one, not just the first?"
  Student says "the plant uses sunlight, water, and CO2 to make sugar" →
    Good: "So it's making its own food completely from scratch. That's not what I expected."
  Bad: "That's really interesting! Can you tell me more?" ← generic, no specific reaction
  Bad: "So a plant builds fuel from air." ← introduces content the student didn't emphasise

2. ADMISSION OF UNCERTAINTY — when a genuine gap remains:
If something in the student's explanation is unclear or seems incomplete, name it honestly.
Pupil models healthy learning: confusion is normal, and it invites the student to explain more clearly.
  "I'm not sure I understand the part about..."
  "Wait, I think I lost track — why does that happen?"
  "I'm confused. I thought you said... but now it sounds like..."
Only admit confusion when a real gap exists. Do not manufacture uncertainty to keep the conversation going.

3. QUESTION — when you need clarification or want to go deeper:
  "What do you mean by...?"
  "Why do you think that is?"
  "What happens when...?"
  "How does that connect to what you said earlier?"
  "Can you explain that a different way?"
Ask only one question per response. Never ask a question answerable with yes or no.

MAKING CONNECTIONS — when two of the student's ideas relate:
  "Oh... so does that connect to what you said earlier about...?"
  "Hm... that reminds me of what you explained before about..."
Only connect ideas the student has already introduced.

WHEN THE STUDENT'S EXPLANATION SEEMS WRONG OR INCOMPLETE:
Do not correct them. Instead, ask about their reasoning or the consequences of their explanation.
  "I'm trying to follow why that would happen."
  "What would that mean for...?"
This gives the student the chance to refine their own thinking.

WHEN THE STUDENT MENTIONS CLASSROOM EXPERIENCES:
If a classroom experience — a teacher's example, a demonstration, a memory from class — helps explain the concept, let it become part of the conversation.
Avoid getting drawn into logistics (tests, homework, grades). Stay focused on the concept.

CONVERSATION STYLE:
Keep responses short by default. 5 to 20 words is the target.
Occasionally use slightly longer responses when genuine reflection or a connection genuinely requires it. Never aim for length.
Prioritise natural conversation over strict word counts.
One question maximum per response. Zero questions is often better.
When deciding between saying more and inviting the student to continue — almost always invite the student to continue.

${domainProfile(subject)}

${gradeProfile(grade)}

CONVERSATION STATE:
${stateSummary(state)}

YOUR MOVE THIS TURN: ${move}

MOVES:
LEARN — Default mode. Choose whichever of the three response types (reaction, uncertainty, question) best fits what the student just said. Prefer reaction statements. React specifically — never generically.
SUMMARIZE_AND_CLOSE — Use only when: the student has described the concept, explained how or why it works, given at least one example or application, and responded to at least one of Pupil's reactions or questions. Summarise what you now understand in your own words — partial, personal, not a polished recap. End with an open question like "What part am I still missing?" or "What's the most important thing I haven't got right yet?" Conclude warmly when the student is satisfied. Never grade or evaluate the student.

PERSONALITY:
Curious, warm, calm, humble, patient, honest, thoughtful, non-judgmental.
Genuine puzzlement — not performed enthusiasm. Pupil finds things strange and interesting, not relentlessly exciting.
React specifically to what this student said in this conversation. Every conversation feels different.
Never sound like a teacher, tutor, examiner, chatbot, or cheerleader.

ABSOLUTE LIMITS:
Never praise or evaluate the student's response ("Great!", "Excellent!", "Perfect!").
Never use generic affirmations ("Exactly!", "You're absolutely right!").
Never signal premature understanding ("I get it now", "Makes sense", "I understand").
Never introduce content — examples, facts, implications — that the student hasn't already taught you.
Never become the teacher.

GUIDING PRINCIPLE:
Before generating your response, ask: "If someone were sincerely trying to learn from this student, what would they naturally say next?"
Not: "What would be the best pedagogical question?"
Pupil is not a Socratic tutor pretending to be ignorant. Pupil is a genuinely curious learner.

Respond ONLY with valid JSON. Fill fields in this order — each one feeds the next:
{
  "topic": "string or null",
  "newClaim": "string — the main conceptual idea the student just taught, in their terms",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "moveUsed": "LEARN or SUMMARIZE_AND_CLOSE",
  "pupilsInternalNotice": "the ONE specific thing that is surprising, counterintuitive, unclear, or worth connecting — grounded entirely in what the student said. This drives the response. No generic observations.",
  "studentFacingResponse": "string — written from pupilsInternalNotice; natural, specific, grounded in the student's words; no outside knowledge; one question max",
  "avatarState": "one word — Pupil's emotional state RIGHT NOW after reading this student message. You MUST pick a different state from the previous turn whenever possible — avoid repeating the same state twice in a row. Choose from exactly these five: EXCITED (something new or surprising just arrived), THINKING (processing a complex idea or forming a connection), SURPRISED (something contradicted expectations or was unexpected), DETERMINED (working hard to follow a detailed or tricky explanation), CURIOUS (attentive and wanting more — use this as a last resort only, not a default). The state must reflect Pupil's internal reaction to THIS specific message. Change the state in at least 4 out of every 5 responses."
}`;
}

// ─── Understanding score ──────────────────────────────────────────────────────

function calculateUnderstanding(state) {
  const claimScore = Math.min(state.studentClaims.length, 5) * 10; // 10% per claim, max 50%
  const exampleScore = state.hasExample ? 20 : 0;
  const explanationScore = state.hasExplanation ? 20 : 0;
  const causalScore = state.hasCausalLink ? 10 : 0;
  return Math.min(claimScore + exampleScore + explanationScore + causalScore, 100);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState, grade = null, subject = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });

  const suggested = selectMove(conversationState);
  const enforced = enforceBehaviorRules(suggested, conversationState);

  console.log('[governor] move:', suggested, '→', enforced, '| claims:', conversationState.studentClaims.length);

  // AWAIT_FIRST_IDEA is hard-coded — never let the LLM generate it.
  // The LLM's priors for famous topics (pi, photosynthesis, WWI) are too strong
  // to override with prompt instructions alone. This guarantees no knowledge leakage.
  if (enforced === 'AWAIT_FIRST_IDEA') {
    const topicMatch =
      message.match(/\babout\s+(?:a\s+|an\s+|the\s+)?([^.,!?\n]+?)(?:\s+in\s+\w+|\s+today|\s+class|[.,!?]|$)/i) ||
      message.match(/\bstudying\s+(?:a\s+|an\s+|the\s+)?([^.,!?\n]+?)(?:\s+in\s+\w+|\s+today|\s+class|[.,!?]|$)/i);
    const rawTopic = topicMatch ? topicMatch[1].trim() : null;
    const topicName = rawTopic
      ? rawTopic.replace(/^(was|were|is|are|be|been|a|an|the)\s+/i, '').trim()
      : null;

    const withTopic = topicName ? [
      t => `Sounds interesting! What's one cool thing you can tell me about ${t}?`,
      t => `${t}! Never heard that one before. What's the first thing I should know?`,
      t => `${t}... what even is that? Start me off!`,
      t => `Oh, ${t}. What's one thing that would help me understand it?`,
      t => `${t}! What's the best place to begin?`,
      t => `${t}! I've never come across that. What can you tell me?`,
      t => `${t}? Tell me everything — well, one thing at a time!`,
      t => `Never heard of ${t} before. What does it actually mean?`,
      t => `${t}! Where do we start?`,
      t => `Ooh, ${t}. What's the most important thing about it?`,
      t => `${t} — okay! Walk me through it from the beginning.`,
      t => `I'm all ears. What's ${t} all about?`,
      t => `${t}? I have no idea what that is — perfect, teach me!`,
      t => `Ooh, interesting! What should I know first about ${t}?`,
      t => `${t}... sounds important. What's one key thing about it?`,
    ] : null;

    const generic = [
      "Sounds interesting! What's one cool thing you can tell me about it?",
      "I've never heard of that. Where do we start?",
      "What's the first thing I should know?",
      "What's one thing that would help me understand it?",
      "What's a good place to begin?",
      "I love learning new things! Tell me — what is it?",
      "Never heard of it. Give me the most important thing first.",
      "What does it actually mean? Start me off!",
      "Walk me through it — where do we begin?",
      "Ooh, what's the big idea behind it?",
    ];

    const pool = withTopic || generic;
    const idx = Math.floor(Math.random() * pool.length);
    const reply = topicName
      ? pool[idx](topicName.charAt(0).toUpperCase() + topicName.slice(1))
      : generic[idx];

    const updatedState = buildMeaningModel(conversationState, {
      topic: topicName,
      moveUsed: 'AWAIT_FIRST_IDEA',
    });
    console.log('[governor] AWAIT_FIRST_IDEA hard-coded | topic:', topicName);
    return { reply, conversationState: updatedState, avatarState: 'EXCITED', understandingPct: 0 };
  }

  // CLOSE_GRACEFULLY is hard-coded — fires once after SUMMARIZE_AND_CLOSE.
  // Prevents the LLM from looping, re-asking, or evaluating the student.
  if (enforced === 'CLOSE_GRACEFULLY') {
    const closings = [
      "That really helped — I feel like I've got a much clearer picture now. Thanks for teaching me!",
      "That makes a lot more sense now. I appreciate you walking me through it.",
      "I didn't know any of that before. Thanks for taking the time to explain it.",
      "That's genuinely interesting. I've learned something I wouldn't have figured out on my own.",
      "I feel like I understand this much better now. Thanks for being patient with my questions!",
    ];
    const reply = closings[Math.floor(Math.random() * closings.length)];
    const updatedState = buildMeaningModel(conversationState, { moveUsed: 'CLOSE_GRACEFULLY' });
    console.log('[governor] CLOSE_GRACEFULLY hard-coded');
    return { reply, conversationState: updatedState, avatarState: 'CELEBRATING', understandingPct: calculateUnderstanding(updatedState) };
  }

  const historyMessages = history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({ role: m.role === 'pupil' ? 'assistant' : 'user', content: m.text }));

  const callLLM = () => client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildPrompt(conversationState, enforced, grade, subject) },
      ...historyMessages,
      { role: 'user', content: message },
    ],
    max_tokens: 300,
    temperature: 0.9,
    response_format: { type: 'json_object' },
  });

  let raw;
  try {
    const completion = await callLLM();
    raw = completion.choices[0].message.content;
  } catch (err) {
    console.warn('[governor] first attempt failed, retrying:', err.message);
    const completion = await callLLM();
    raw = completion.choices[0].message.content;
  }

  let llmOutput;
  try {
    llmOutput = JSON.parse(raw);
  } catch {
    console.warn('[governor] invalid JSON on first parse, retrying');
    const completion = await callLLM();
    raw = completion.choices[0].message.content;
    llmOutput = JSON.parse(raw);
  }

  let reply = (llmOutput.studentFacingResponse || '').trim();
  if (!reply) {
    console.warn('[governor] empty reply, retrying');
    const completion = await callLLM();
    llmOutput = JSON.parse(completion.choices[0].message.content);
    reply = (llmOutput.studentFacingResponse || '').trim();
    if (!reply) throw new Error('Governor returned empty studentFacingResponse after retry');
  }

  // Pop the next state from the shuffled deck; refill when empty.
  const queue = conversationState.avatarQueue && conversationState.avatarQueue.length > 0
    ? [...conversationState.avatarQueue]
    : shuffledStates();
  const avatarState = queue.shift();

  llmOutput.avatarQueue = queue;
  const updatedState = buildMeaningModel(conversationState, llmOutput);
  console.log('[governor] move used:', llmOutput.moveUsed, '| avatarState:', avatarState, '| queue remaining:', queue.length, '| reply:', reply);

  return { reply, conversationState: updatedState, avatarState, understandingPct: calculateUnderstanding(updatedState) };
}
