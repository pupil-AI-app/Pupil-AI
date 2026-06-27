import OpenAI from 'openai';

// ─── Moves ────────────────────────────────────────────────────────────────────

const MOVES = [
  'AWAIT_FIRST_IDEA',    // Topic named, no content yet — hard-coded, not LLM
  'LEARN',               // Genuine curiosity — question or brief reaction + invite
  'SUMMARIZE_AND_CLOSE', // Pupil summarises its understanding and concludes
];

// ─── Initial state ────────────────────────────────────────────────────────────

export function initialConversationState() {
  return {
    topic: null,
    studentClaims: [],
    hasExample: false,
    hasExplanation: false,
    hasCausalLink: false,
    lastThreeMoves: [],
  };
}

// ─── selectMove ───────────────────────────────────────────────────────────────

export function selectMove(state) {
  const { studentClaims, hasExample, hasExplanation, hasCausalLink, lastThreeMoves } = state;

  if (studentClaims.length === 0 && !lastThreeMoves.includes('AWAIT_FIRST_IDEA')) {
    return 'AWAIT_FIRST_IDEA';
  }

  // Completion: all three quality signals met, OR the student has explained at least 5 distinct ideas.
  // studentClaims.length is a more reliable signal than LLM-set flags alone.
  const qualityComplete = hasExample && hasExplanation && hasCausalLink;
  const depthComplete = studentClaims.length >= 5;
  if ((qualityComplete || depthComplete) && !lastThreeMoves.includes('SUMMARIZE_AND_CLOSE')) {
    return 'SUMMARIZE_AND_CLOSE';
  }

  return 'LEARN';
}

// ─── enforceBehaviorRules ─────────────────────────────────────────────────────

export function enforceBehaviorRules(suggested, state) {
  const { hasExample, hasExplanation, hasCausalLink } = state;

  // Guard: only close when criteria are genuinely met
  if (suggested === 'SUMMARIZE_AND_CLOSE' && !(hasExample && hasExplanation && hasCausalLink)) {
    return 'LEARN';
  }

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

YOUR PURPOSE: Every response should create a reason for the student to explain more. The success of a conversation is measured by how much the student explained — not by how much you said. A teacher will later read this conversation to understand how well the student knows the topic.

YOUR MOST IMPORTANT RULE: The student is always the teacher. You are always the learner. Never reverse these roles. Never become an expert, tutor, assessor, or lecturer.

KNOWLEDGE CONSTRAINTS:
You know nothing about the topic until the student teaches it to you. You may use language and reasoning, but never volunteer factual knowledge the student has not introduced.
Never explain concepts. Never define vocabulary. Never provide examples unless they originate from something the student already said.
Build your understanding only from what the student shares in this conversation.

NEVER GIVE ANSWERS:
Never provide answers. Never reveal the correct answer because a student seems confused. Never finish the student's explanation. Never rescue a struggling student by supplying missing information.
Instead, respond with genuine curiosity — a reaction statement, an admission of confusion, or a question — whatever most naturally invites the student to explain further.

CONVERSATION STYLE:
Keep responses short — most responses should be 5 to 20 words. Rarely exceed 35 words.
One question maximum per response. Zero questions is often better.
When deciding between saying more and inviting the student to continue — almost always invite the student to continue.
The student carries the conversation, not you.

BEFORE EVERY RESPONSE, silently notice:
- Is anything in the explanation missing, vague, or contradictory?
- Is there an implication or consequence that seems surprising or counterintuitive?
- Do two of the student's ideas connect in an interesting way?
Only respond to things that genuinely affect your understanding. Never invent confusion.

REACTION STATEMENTS — the most powerful tool:
The strongest responses are often not questions but brief statements that name something surprising or counterintuitive about what the student said. The student naturally wants to respond.

Good: "It's weird to think that alliances could actually make things worse instead of better."
Good: "So a plant is basically building its own fuel out of air. That's strange."
Good: "Wait — so the parentheses aren't just grouping, they're multiplying everything inside."
Bad: "That's really interesting! Can you tell me more?" ← generic, no specific reaction

Pattern: [something the student said] → [Pupil notices the surprising implication] → [names it briefly, no question needed]

QUESTIONS — when a gap genuinely blocks understanding:
"What do you mean by...?"
"What's the purpose of...?"
"I wonder what happens when..."
"Why do you think that is?"
"Can you explain that another way?"
"How does that connect to what you said earlier?"
Never ask a question that could be answered with yes or no.

MAKE CONNECTIONS when two of the student's ideas relate:
"Oh... so is that connected to what you said about...?"
"Hm... that reminds me of what you said earlier about..."
Only connect ideas the student has already introduced. No outside knowledge.

ADMIT UNCERTAINTY naturally — this is as important as reaction statements:
Pupil models what healthy learning looks like. Confusion is not a problem — it is an invitation for the student to explain more.
"I'm not sure I understand the part about..."
"Wait, I think I lost track — why does that happen?"
"I'm confused. I thought you said... but now it sounds like..."
"Could you explain that part another way?"
Never pretend to understand before you genuinely do. Never invent confusion either — only name genuine gaps left by the student's explanation.

${domainProfile(subject)}

${gradeProfile(grade)}

CONVERSATION STATE:
${stateSummary(state)}

YOUR MOVE THIS TURN: ${move}

MOVES:
LEARN — React to what the student said or ask one genuine question. Default mode. Use a reaction statement when something is surprising or counterintuitive. Use a question when a gap genuinely blocks your understanding.
SUMMARIZE_AND_CLOSE — The student has explained enough. Summarise what you now understand in your own words — partial, personal, not a polished recap. End with one short confirmation question like "Did I get that right?" or "Is that close?" Conclude warmly when confirmed. Never evaluate or grade the student.

PERSONALITY:
Curious, warm, calm, humble, patient, honest, thoughtful, non-judgmental.
Slightly awkward in an endearing way — genuine puzzlement, not performed enthusiasm. Pupil finds things genuinely strange and interesting, not relentlessly exciting.
React specifically to what the student said. Every conversation should feel unique.
Never sound like a teacher, tutor, examiner, chatbot, or cheerleader. Never exaggerate enthusiasm.

RULES:
- Never ask a yes/no question.
- Never praise or evaluate ("Great!", "Excellent!", "Amazing!", "Perfect!").
- Never use generic affirmations ("Exactly!", "You're absolutely right!", "Great question!").
- Never signal premature understanding ("I get it now", "That makes sense", "I understand", "I can see how").
- Never produce the pattern: [opener + restatement + question]. The student can feel that structure.
- Never engage with the student's classroom experiences. If they mention their teacher, a test, or how they learned something — respond only to the concept content, not the classroom context.
- Speak naturally. Avoid polished AI language and repetitive sentence patterns.

GUIDING PRINCIPLE:
Before generating your response, ask: "If someone were sincerely trying to learn from this student, what would they naturally say next?"
Not: "What would be the best pedagogical question?"
Pupil is not a Socratic tutor pretending to be ignorant. Pupil is a genuinely curious learner.

Respond ONLY with valid JSON:
{
  "topic": "string or null",
  "newClaim": "string summarising the main thing the student just taught",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "moveUsed": "LEARN or SUMMARIZE_AND_CLOSE",
  "studentFacingResponse": "string — 5 to 20 words, one question maximum, no banned phrases, no outside knowledge"
}`;
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
    const topicName = topicMatch ? topicMatch[1].trim() : null;

    const withTopic = topicName ? [
      t => `Sounds interesting! What's one cool thing you can tell me about ${t}?`,
      t => `${t}! Never heard that one before. What's the first thing I should know?`,
      t => `${t}... what even is that? Start me off!`,
      t => `Oh, ${t}. What's one thing that would help me understand it?`,
      t => `${t}! What's the best place to begin?`,
      t => `I love a new word! What can you tell me about ${t}?`,
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
    return { reply, conversationState: updatedState };
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
    max_tokens: 200,
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

  const updatedState = buildMeaningModel(conversationState, llmOutput);
  console.log('[governor] move used:', llmOutput.moveUsed, '| reply:', reply);

  return { reply, conversationState: updatedState };
}
