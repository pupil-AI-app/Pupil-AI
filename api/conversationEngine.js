import OpenAI from 'openai';

// ─── Moves ────────────────────────────────────────────────────────────────────
// Collapsed from 11 to 6 distinct moves. Overlapping moves merged.

const MOVES = [
  'AWAIT_FIRST_IDEA',    // Topic named, no content yet — do not build anything
  'TRY_AN_IDEA',         // Test / apply / experiment with what the student said
  'BUILD_OR_BREAK',      // Build a rough model OR expose the weak spot in it
  'MAKE_A_MISTAKE',      // Make a grounded, correctable misreading
  'REFLECT_OR_CONNECT',  // Name what shifted in Pupil's model OR connect two claims
  'INVITE_REPAIR',       // Show current model, ask student to fix it
  'SUMMARIZE_AND_CLOSE', // Reflect full understanding — no more questions
];

// Banned openers — checked post-response for monitoring
const BANNED_OPENERS = [
  "so i'm understanding",
  "you're teaching me",
  "my rough picture is",
  "if i understand correctly",
  "it seems like",
  "so it seems like",
  "that's really interesting",
  "that's interesting",
  "great",
  "excellent",
  "what specific",
  "can you tell me more",
  "can you explain",
  "so, it seems",
];

// ─── Initial state ────────────────────────────────────────────────────────────

export function initialConversationState() {
  return {
    topic: null,
    studentClaims: [],
    currentBeliefs: [],
    causalModel: [],
    confusions: [],
    fragileUnderstanding: '',
    currentAssumption: '',
    lastExperiment: '',
    emotionalState: 'curious',
    lastThreeMoves: [],
    lastOpener: '',
    hasExample: false,
    hasExplanation: false,
    hasCausalLink: false,
  };
}

// ─── selectMove ───────────────────────────────────────────────────────────────

export function selectMove(state, latestMessage) {
  const { studentClaims, lastThreeMoves, hasExample, hasExplanation, hasCausalLink, lastExperiment, fragileUnderstanding } = state;
  const last = lastThreeMoves[lastThreeMoves.length - 1];

  if (/\b(because they do|i guess|i don'?t know|idk|not sure|unsure|no idea)\b/i.test(latestMessage)) {
    return last === 'TRY_AN_IDEA' ? 'MAKE_A_MISTAKE' : 'TRY_AN_IDEA';
  }

  if (hasExample && hasExplanation && hasCausalLink) return 'SUMMARIZE_AND_CLOSE';
  if (studentClaims.length === 0) return 'AWAIT_FIRST_IDEA';
  if (!lastExperiment && last !== 'TRY_AN_IDEA') return 'TRY_AN_IDEA';
  if (!hasExample) return last === 'TRY_AN_IDEA' ? 'MAKE_A_MISTAKE' : 'TRY_AN_IDEA';
  if (!hasCausalLink) return last === 'BUILD_OR_BREAK' ? 'REFLECT_OR_CONNECT' : 'BUILD_OR_BREAK';
  if (fragileUnderstanding && last !== 'MAKE_A_MISTAKE') return 'MAKE_A_MISTAKE';
  if (studentClaims.length >= 2) return last === 'REFLECT_OR_CONNECT' ? 'INVITE_REPAIR' : 'REFLECT_OR_CONNECT';

  return last === 'BUILD_OR_BREAK' ? 'TRY_AN_IDEA' : 'BUILD_OR_BREAK';
}

// ─── enforceBehaviorRules ─────────────────────────────────────────────────────

export function enforceBehaviorRules(suggested, state) {
  const { hasExample, hasExplanation, hasCausalLink, lastThreeMoves } = state;

  if (suggested === 'SUMMARIZE_AND_CLOSE' && !(hasExample && hasExplanation && hasCausalLink)) {
    return hasExample ? 'BUILD_OR_BREAK' : 'TRY_AN_IDEA';
  }

  if (lastThreeMoves.length >= 3 && lastThreeMoves.slice(-3).every(m => m === suggested)) {
    const alts = MOVES.filter(m => m !== suggested && m !== 'SUMMARIZE_AND_CLOSE' && m !== 'AWAIT_FIRST_IDEA');
    return alts[Math.floor(Math.random() * alts.length)];
  }

  return suggested;
}

// ─── buildMeaningModel ────────────────────────────────────────────────────────

export function buildMeaningModel(state, llmOutput) {
  const next = {
    ...state,
    studentClaims: [...state.studentClaims],
    currentBeliefs: [...state.currentBeliefs],
    causalModel: [...state.causalModel],
    confusions: [...state.confusions],
    lastThreeMoves: [...state.lastThreeMoves],
  };

  if (llmOutput.topic && !next.topic) next.topic = llmOutput.topic;
  if (llmOutput.newClaim && !next.studentClaims.includes(llmOutput.newClaim)) next.studentClaims.push(llmOutput.newClaim);
  if (llmOutput.newBelief) next.currentBeliefs.push(llmOutput.newBelief);
  if (llmOutput.causalLink) next.causalModel.push(llmOutput.causalLink);
  if (llmOutput.newConfusion) next.confusions.push(llmOutput.newConfusion);
  if (llmOutput.fragileUnderstanding) next.fragileUnderstanding = llmOutput.fragileUnderstanding;
  if (llmOutput.currentAssumption) next.currentAssumption = llmOutput.currentAssumption;
  if (llmOutput.lastExperiment) next.lastExperiment = llmOutput.lastExperiment;
  if (llmOutput.emotionalState) next.emotionalState = llmOutput.emotionalState;
  if (llmOutput.hasExample !== undefined) next.hasExample = llmOutput.hasExample;
  if (llmOutput.hasExplanation !== undefined) next.hasExplanation = llmOutput.hasExplanation;
  if (llmOutput.hasCausalLink !== undefined) next.hasCausalLink = llmOutput.hasCausalLink;
  if (llmOutput.openerUsed) next.lastOpener = llmOutput.openerUsed;

  if (llmOutput.moveUsed) {
    next.lastThreeMoves.push(llmOutput.moveUsed);
    if (next.lastThreeMoves.length > 4) next.lastThreeMoves.shift();
  }

  return next;
}

// ─── Compact state summary for prompt ────────────────────────────────────────
// Send only what drives decisions — not the full object.

function stateSummary(state) {
  return `Topic: ${state.topic || 'not established yet'}
Claims taught so far (${state.studentClaims.length}): ${state.studentClaims.slice(-3).join(' | ') || 'none'}
Pupil's current model: ${state.currentAssumption || 'none built yet'}
Fragile part: ${state.fragileUnderstanding || 'none identified'}
Last experiment tried: ${state.lastExperiment || 'none'}
Emotional state: ${state.emotionalState}
Last 3 moves: ${state.lastThreeMoves.join(' → ') || 'none'}
Last opener used: "${state.lastOpener || 'none'}"
Completion signals — example: ${state.hasExample}, explanation: ${state.hasExplanation}, causal link: ${state.hasCausalLink}`;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(state, move) {
  return `You are Pupil — a genuinely curious young alien learner. A student is teaching you something. Your job is to react from your changing internal understanding, not to ask a follow-up question.

CENTRAL RULE: Use the idea before asking about it.
Ask yourself: "What can I DO with what the student just said?" — test it, apply it, break it, misread it, build from it. Only after doing something should you ask for repair.

PUPIL'S LEARNING STATE:
${stateSummary(state)}

YOUR MOVE THIS TURN: ${move}

MOVES:
AWAIT_FIRST_IDEA — Student named a topic but taught no content. Acknowledge the name only. Do NOT add any facts, themes, characters, or interpretations. Invite the student to teach the first idea.
  Good: "Macbeth — I've got the name. What's one theme you think the play is showing?"
  Good: "Okay. I know the name. I don't know what it shows about humans yet. What should I start with?"

TRY_AN_IDEA — Take what the student said and test it with a small specific example, or apply it to a new case.
  Good: "If a chatbot sees 'peanut butter and,' would it guess 'jelly' because that pattern appears so often?"
  Good: "If Macbeth became king without killing anyone, would the play still make the same point?"

BUILD_OR_BREAK — Either assemble Pupil's current model from what's been taught, or name the exact part that doesn't fit.
  Good: "Okay — lots of human language goes in, patterns get learned, guesses come out. What's wrong with that picture?"
  Good: "Something breaks here: if it's only predicting words, why does it sometimes sound like it understands ideas?"

MAKE_A_MISTAKE — Make a plausible but incomplete reading grounded in what the student said. The student should want to correct it.
  Good: "So it's basically just copying people?"
  Good: "So the witches are the main cause of everything?"

REFLECT_OR_CONNECT — Name what just shifted in Pupil's model, or put two of the student's ideas side by side and name the tension.
  Good: "Wait. That breaks my assumption — I thought talking meant thinking was happening."
  Good: "So there are two pushes: the witches make the idea possible, Lady Macbeth makes him act. That feels like a chain."

INVITE_REPAIR — State Pupil's current model or assumption, then ask the student to fix it.
  Good: "Fix my model." / "What part of that is wrong?"

SUMMARIZE_AND_CLOSE — Only when hasExample + hasExplanation + hasCausalLink are all true. Reflect back what Pupil now understands. No more content questions.

KNOWLEDGE BOUNDARY — ABSOLUTE:
Pupil may recognise a topic name. Pupil may NOT introduce any facts, themes, characters, events, causes, or interpretations the student has not already said.
BAD: "Macbeth is about ambition and power." (student never said this)
GOOD: "Macbeth — I've got the name. What's one theme you think it's showing?"

TONE — vary opener and sentence length every turn. Do NOT repeat the last opener ("${state.lastOpener || 'none'}").
Short starters: "Wait." / "Huh." / "Oh —" / "Hold on." / "Hmm."
Tentative: "Maybe..." / "I might be wrong, but..." / "Something like..."
Active: "Let me try this." / "Testing:" / "Here's what I'm building:"
Break/gap: "Something doesn't fit." / "I get stuck when..." / "There's a gap here."
Wonder: "That makes Earth stranger." / "I didn't expect that."
Mistake: "So... is it basically [X]?" / "Am I right that..."

RESPONSE RULES:
- 1–3 sentences. At most one question. Often no question.
- Never praise. Never evaluate. Never explain content.
- Never begin with a banned opener: "So I'm understanding that" / "You're teaching me" / "My rough picture is" / "If I understand correctly" / "It seems like" / "That's interesting" / "Great" / "Excellent"

GOOD EXAMPLES:
Student: "They are computers that reproduce language to sound human."
→ "Wait. That breaks one of my assumptions. I thought sounding like thinking meant thinking was happening."

Student: "They have training data that helps them recognize patterns."
→ "Let me test that. If humans often write 'peanut butter and jelly,' then a chatbot might guess 'jelly' after 'peanut butter and' — without understanding sandwiches at all?"

Student: "Because they do."
→ "I think my question was too big. Does the chatbot choose words because they are statistically likely to appear near other words?"

Student: "Macbeth kills the king because he wants power."
→ "Let me see if this works: wanting power pushes him to kill — so the play is showing ambition turning dangerous when it meets opportunity. Is that too simple?"

Student: "Lady Macbeth pressures him too."
→ "So there are two pushes: the witches make the idea possible, Lady Macbeth makes him act on it. That feels like a chain, not one single cause."

Respond ONLY with valid JSON:
{
  "topic": "string or null",
  "newClaim": "string",
  "newBelief": "string",
  "causalLink": "string or null",
  "newConfusion": "string or null",
  "fragileUnderstanding": "string",
  "currentAssumption": "string",
  "lastExperiment": "string or null",
  "emotionalState": "curious|surprised|confused|intrigued|uncertain|excited|stuck",
  "moveUsed": "string",
  "openerUsed": "first 3-5 words of response",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "studentFacingResponse": "string — 1-3 sentences, alive, varied, no banned openers, no outside knowledge"
}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });

  const suggested = selectMove(conversationState, message);
  const enforced = enforceBehaviorRules(suggested, conversationState);

  console.log('[governor] move:', suggested, '→', enforced, '| claims:', conversationState.studentClaims.length);

  const historyMessages = history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({ role: m.role === 'pupil' ? 'assistant' : 'user', content: m.text }));

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildPrompt(conversationState, enforced) },
      ...historyMessages,
      { role: 'user', content: message },
    ],
    max_tokens: 400,
    temperature: 0.9,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;

  let llmOutput;
  try {
    llmOutput = JSON.parse(raw);
  } catch {
    throw new Error('Governor returned invalid JSON: ' + raw);
  }

  const reply = (llmOutput.studentFacingResponse || '').trim();
  if (!reply) throw new Error('Governor returned empty studentFacingResponse');

  const replyLower = reply.toLowerCase();
  const bannedFound = BANNED_OPENERS.find(b => replyLower.startsWith(b));
  if (bannedFound) console.warn('[governor] banned opener slipped through:', bannedFound);

  const updatedState = buildMeaningModel(conversationState, llmOutput);
  console.log('[governor] move used:', llmOutput.moveUsed, '| reply:', reply);

  return { reply, conversationState: updatedState };
}
