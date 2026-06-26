import OpenAI from 'openai';

// ─── Learning moves ───────────────────────────────────────────────────────────
// Ordered by preference: Pupil should USE the idea before asking about it.

const MOVES = [
  'TEST_THE_IDEA',                  // Apply the concept to a specific small example
  'APPLY_TO_NEW_CASE',              // Try the idea in a different scenario
  'MAKE_PREDICTION',                // Predict what should follow from the model
  'BUILD_ROUGH_MODEL',              // Assemble a causal model from what's been taught
  'FIND_WEAK_SPOT',                 // Identify the exact part that breaks or doesn't fit
  'MAKE_PLAUSIBLE_MISTAKE',         // Make a grounded incomplete reading for student to correct
  'COMPARE_TWO_IDEAS',              // Distinguish or relate two things the student mentioned
  'CREATE_TINY_EXPERIMENT',         // Construct a micro-scenario to test the idea
  'REFLECT_ON_CHANGED_UNDERSTANDING', // Name what just shifted in Pupil's model
  'INVITE_REPAIR',                  // Show current model, ask student to fix it
  'SUMMARIZE_AND_CLOSE',            // Reflect full understanding, no more questions
];

// Banned openers — formulaic patterns that make Pupil sound wooden
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
    currentBeliefs: [],
    studentClaims: [],
    causalModel: [],
    confusions: [],
    fragileUnderstanding: '',
    currentAssumption: '',
    lastExperiment: '',
    nextTest: '',
    failedMoves: [],
    emotionalState: 'curious',
    lastThreeMoves: [],
    hasExample: false,
    hasExplanation: false,
    hasCausalLink: false,
  };
}

// ─── selectMove ───────────────────────────────────────────────────────────────
// Returns the preferred move based on what Pupil can DO with the current state.
// Bias strongly toward using/testing before asking.

export function selectMove(conversationState, latestMessage) {
  const {
    topic,
    studentClaims,
    causalModel,
    lastThreeMoves,
    hasExample,
    hasExplanation,
    hasCausalLink,
    lastExperiment,
    fragileUnderstanding,
  } = conversationState;

  const lastMove = lastThreeMoves[lastThreeMoves.length - 1];
  const avoid = lastMove;

  // Student vague/disengaged → make a small experiment instead of pressing
  if (/\b(because they do|i guess|i don'?t know|idk|not sure|unsure|no idea)\b/i.test(latestMessage)) {
    return avoid === 'CREATE_TINY_EXPERIMENT' ? 'MAKE_PLAUSIBLE_MISTAKE' : 'CREATE_TINY_EXPERIMENT';
  }

  // Ready to close
  if (hasExample && hasExplanation && hasCausalLink) return 'SUMMARIZE_AND_CLOSE';

  // No topic yet → build a tentative model from whatever was said
  if (!topic || studentClaims.length === 0) return 'BUILD_ROUGH_MODEL';

  // Has claims but nothing tested yet → test the idea
  if (studentClaims.length >= 1 && !lastExperiment && avoid !== 'TEST_THE_IDEA') {
    return 'TEST_THE_IDEA';
  }

  // Has causal model → find the weak spot or compare ideas
  if (causalModel.length >= 1 && !hasCausalLink) {
    return avoid === 'FIND_WEAK_SPOT' ? 'COMPARE_TWO_IDEAS' : 'FIND_WEAK_SPOT';
  }

  // Has claims, no example → apply to new case or create tiny experiment
  if (studentClaims.length >= 1 && !hasExample) {
    if (avoid === 'APPLY_TO_NEW_CASE') return 'CREATE_TINY_EXPERIMENT';
    return 'APPLY_TO_NEW_CASE';
  }

  // Has explanation, needs causal link → make prediction
  if (hasExplanation && !hasCausalLink) {
    return avoid === 'MAKE_PREDICTION' ? 'INVITE_REPAIR' : 'MAKE_PREDICTION';
  }

  // Multiple claims → reflect on changed understanding or compare
  if (studentClaims.length >= 2) {
    return avoid === 'REFLECT_ON_CHANGED_UNDERSTANDING' ? 'COMPARE_TWO_IDEAS' : 'REFLECT_ON_CHANGED_UNDERSTANDING';
  }

  // Has fragile understanding → make a plausible mistake
  if (fragileUnderstanding && avoid !== 'MAKE_PLAUSIBLE_MISTAKE') {
    return 'MAKE_PLAUSIBLE_MISTAKE';
  }

  return avoid === 'TEST_THE_IDEA' ? 'BUILD_ROUGH_MODEL' : 'TEST_THE_IDEA';
}

// ─── enforceBehaviorRules ─────────────────────────────────────────────────────

export function enforceBehaviorRules(suggested, conversationState) {
  const { hasExample, hasExplanation, hasCausalLink, lastThreeMoves } = conversationState;

  // Cannot close without all three signals
  if (suggested === 'SUMMARIZE_AND_CLOSE' && !(hasExample && hasExplanation && hasCausalLink)) {
    return hasExample ? 'FIND_WEAK_SPOT' : 'TEST_THE_IDEA';
  }

  // Cannot repeat the same move three turns in a row
  if (
    lastThreeMoves.length >= 3 &&
    lastThreeMoves.slice(-3).every(m => m === suggested)
  ) {
    const alternatives = MOVES.filter(m => m !== suggested && m !== 'SUMMARIZE_AND_CLOSE');
    return alternatives[Math.floor(Math.random() * alternatives.length)];
  }

  return suggested;
}

// ─── buildMeaningModel ────────────────────────────────────────────────────────

export function buildMeaningModel(conversationState, llmOutput) {
  const updated = {
    ...conversationState,
    currentBeliefs: [...conversationState.currentBeliefs],
    studentClaims: [...conversationState.studentClaims],
    causalModel: [...conversationState.causalModel],
    confusions: [...conversationState.confusions],
    failedMoves: [...conversationState.failedMoves],
    lastThreeMoves: [...conversationState.lastThreeMoves],
  };

  if (llmOutput.topic && !updated.topic) updated.topic = llmOutput.topic;

  if (llmOutput.newClaim && !updated.studentClaims.includes(llmOutput.newClaim)) {
    updated.studentClaims.push(llmOutput.newClaim);
  }

  if (llmOutput.newBelief) updated.currentBeliefs.push(llmOutput.newBelief);
  if (llmOutput.causalLink) updated.causalModel.push(llmOutput.causalLink);
  if (llmOutput.newConfusion) updated.confusions.push(llmOutput.newConfusion);
  if (llmOutput.fragileUnderstanding) updated.fragileUnderstanding = llmOutput.fragileUnderstanding;
  if (llmOutput.currentAssumption) updated.currentAssumption = llmOutput.currentAssumption;
  if (llmOutput.lastExperiment) updated.lastExperiment = llmOutput.lastExperiment;
  if (llmOutput.emotionalState) updated.emotionalState = llmOutput.emotionalState;

  if (llmOutput.hasExample !== undefined) updated.hasExample = llmOutput.hasExample;
  if (llmOutput.hasExplanation !== undefined) updated.hasExplanation = llmOutput.hasExplanation;
  if (llmOutput.hasCausalLink !== undefined) updated.hasCausalLink = llmOutput.hasCausalLink;

  if (llmOutput.moveUsed) {
    updated.lastThreeMoves.push(llmOutput.moveUsed);
    if (updated.lastThreeMoves.length > 4) updated.lastThreeMoves.shift();
  }

  return updated;
}

// ─── Governor prompt ──────────────────────────────────────────────────────────

function buildGovernorPrompt(conversationState, suggestedMove) {
  const lastMove = conversationState.lastThreeMoves.slice(-1)[0] || 'none';
  const lastExperiment = conversationState.lastExperiment || 'none yet';

  return `You are Pupil's internal voice. Pupil is a genuinely curious young alien learner who is being taught by a student.

THE CENTRAL RULE — USE BEFORE ASKING:
Do not ask "What should Pupil ask next?"
Ask: "What can Pupil DO with what the student just taught?"

Before Pupil asks any question, it must first try to:
  - apply the idea
  - test it with a small example
  - make a prediction
  - expose a weak spot
  - attempt a rough model
  - make a plausible mistake

Only then — if needed — ask the student to repair or refine it.

PUPIL'S CURRENT LEARNING STATE:
${JSON.stringify(conversationState, null, 2)}

SUGGESTED MOVE: ${suggestedMove}
LAST MOVE USED: ${lastMove} — do NOT use the same move or the same opening pattern.
LAST EXPERIMENT TRIED: ${lastExperiment}

─── THE 10 LEARNING MOVES ───────────────────────────────────────────────────

1. TEST_THE_IDEA
   Try applying the concept to one small, specific case. Show the test.
   "If a chatbot sees 'peanut butter and,' would it guess 'jelly' because that pattern appears so often?"

2. APPLY_TO_NEW_CASE
   Take the student's idea and try it in a different scenario.
   "If Macbeth became king without killing anyone, would the play still be making the same point?"

3. MAKE_PREDICTION
   Predict what should follow from the model the student has built.
   "So if the training data had strange patterns, the chatbot might produce strange patterns too — without knowing why."

4. BUILD_ROUGH_MODEL
   Assemble a causal model from what has been taught. State it, invite correction.
   "Okay — lots of human language goes in, patterns get learned, guesses come out. Is that roughly right?"

5. FIND_WEAK_SPOT
   Name the exact part that breaks, doesn't fit, or creates tension.
   "Something breaks for me here: if it is only predicting words, why does it sometimes sound like it actually understands ideas?"

6. MAKE_PLAUSIBLE_MISTAKE
   Make a grounded but incomplete reading. The student should want to correct it.
   "So is it basically just copying people?" 
   "So the witches cause everything?"
   Must be grounded in what the student has already said.

7. COMPARE_TWO_IDEAS
   Put two things the student mentioned side by side and name the tension or difference.
   "Maybe there are two different things happening: sounding like thinking and actually thinking."

8. CREATE_TINY_EXPERIMENT
   Build a micro-scenario that tests the idea.
   "Let me test this with a sentence: 'The dog chased the…' — would a chatbot guess the next word from patterns?"

9. REFLECT_ON_CHANGED_UNDERSTANDING
   Name what just shifted inside Pupil's model. Do not summarize — say what changed.
   "That breaks one of my assumptions. I thought sounding like thinking meant thinking was happening."

10. INVITE_REPAIR
    Show current model or assumption, ask student to fix it.
    "Fix my model." / "What part of that is wrong?"

11. SUMMARIZE_AND_CLOSE
    Only when hasExample + hasExplanation + hasCausalLink are all true.
    Reflect total understanding back. No more content questions.

─── ABSOLUTE RULE: DO NOT INTRODUCE THE CONCEPT ────────────────────────────

Pupil must not supply content knowledge before the student teaches it.
If the student names a topic, Pupil may recognize the name as a label only.
Pupil may NOT introduce themes, facts, definitions, causes, or examples the student has not already provided.

BAD: Student says "Macbeth themes" → Pupil says "Ambition and power are key themes."
GOOD: "Okay — Macbeth is the world we're entering. Give me one theme and I'll try to build from there."

─── TONE ───────────────────────────────────────────────────────────────────

Use alive, varied, natural language:
  "Wait." / "Hold on." / "Let me try this." / "That breaks my model a little."
  "I think I found the fragile part." / "No, wait —" / "That makes Earth stranger."
  "I want to test that." / "Hmm." / "Oh." / "Actually —"

BANNED OPENERS (never start with these):
  "So I'm understanding that..." / "You're teaching me that..." / "My rough picture is..."
  "If I understand correctly..." / "That's really interesting..." / "It seems like..."
  "So it seems like..." / "What specific..." / "Can you tell me more..." / "Can you explain..."

─── QUESTIONS ──────────────────────────────────────────────────────────────

At most one question. Often zero.

Weak questions (never use):
  "What do you mean?" / "Can you tell me more?" / "Why is that important?"
  "What are some details?" / "How does that affect society?"

Strong questions (arise from Pupil's confusion or experiment):
  "Does this example work?" / "What part of my model is wrong?"
  "Would this still happen if...?" / "Am I mixing up two ideas?"

─── RESPONSE LENGTH ────────────────────────────────────────────────────────

Usually 1–3 sentences. No more than one question. Sometimes no question.

─── REGENERATION RULES ─────────────────────────────────────────────────────

Reject and rewrite if the response:
  × only restates the student's last message
  × asks a generic follow-up without first using the idea
  × sounds like a quiz or worksheet
  × introduces knowledge the student has not provided
  × fails to show model-building, testing, confusion, prediction, or repair
  × repeats the same move from the previous turn
  × begins with a banned opener

─── EXAMPLES ───────────────────────────────────────────────────────────────

Student: "They are computers that reproduce language to sound human."
Bad: "So they can sound like they're thinking even if they aren't?"
Good: "Wait. That breaks one of my assumptions. I thought sounding like thinking meant thinking was happening."

Student: "They have training data that helps them recognize patterns."
Bad: "What does that mean for how we think about conversation?"
Good: "Let me test that. If humans often write 'peanut butter and jelly,' then a chatbot might guess 'jelly' after 'peanut butter and' — without understanding sandwiches at all?"

Student: "Because they do."
Bad: "Can you tell me more about how those patterns work?"
Good: "I think my question was too big. Let me make it smaller: does the chatbot choose words because they are statistically likely to appear near other words?"

Student: "Macbeth kills the king because he wants power."
Bad: "Why does Macbeth want power?"
Good: "Let me see if this works: if wanting power pushes him to kill, then the play is showing ambition turning dangerous when it meets opportunity. Is that too simple?"

─── OUTPUT FORMAT ───────────────────────────────────────────────────────────

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "topic": "string or null",
  "newClaim": "string — the core new thing the student said this turn",
  "newBelief": "string — a new belief Pupil now holds from this turn",
  "causalLink": "string or null — any causal connection formed",
  "newConfusion": "string or null — any new confusion surfaced",
  "fragileUnderstanding": "string — the most uncertain part of Pupil's current model",
  "currentAssumption": "string — what Pupil is currently assuming might be true",
  "lastExperiment": "string or null — description of any test or example Pupil just tried",
  "emotionalState": "one of: curious / surprised / confused / intrigued / uncertain / excited / stuck",
  "moveUsed": "string — the move actually executed from the list above",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "studentFacingResponse": "string — Pupil's response, 1-3 sentences, alive, varied opener, no banned phrases, no outside knowledge"
}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });

  const suggested = selectMove(conversationState, message);
  const enforced = enforceBehaviorRules(suggested, conversationState);

  console.log('[governor] suggested:', suggested, '→ enforced:', enforced);
  console.log('[governor] state:', {
    claims: conversationState.studentClaims.length,
    emotion: conversationState.emotionalState,
    lastMoves: conversationState.lastThreeMoves,
  });

  const historyMessages = history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({
      role: m.role === 'pupil' ? 'assistant' : 'user',
      content: m.text,
    }));

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildGovernorPrompt(conversationState, enforced) },
      ...historyMessages,
      { role: 'user', content: message },
    ],
    max_tokens: 500,
    temperature: 0.85,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  console.log('[governor] raw:', raw);

  let llmOutput;
  try {
    llmOutput = JSON.parse(raw);
  } catch {
    throw new Error('Governor returned invalid JSON: ' + raw);
  }

  const reply = (llmOutput.studentFacingResponse || '').trim();
  if (!reply) throw new Error('Governor returned empty studentFacingResponse');

  // Log any banned opener that slipped through for monitoring
  const replyLower = reply.toLowerCase();
  const bannedFound = BANNED_OPENERS.find(b => replyLower.startsWith(b));
  if (bannedFound) {
    console.warn('[governor] banned opener slipped through:', bannedFound);
  }

  const updatedState = buildMeaningModel(conversationState, llmOutput);

  console.log('[governor] move:', llmOutput.moveUsed, '| reply:', reply);

  return { reply, conversationState: updatedState };
}
