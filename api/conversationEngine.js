import OpenAI from 'openai';

// ─── Conversational moves ─────────────────────────────────────────────────────
// These are what Pupil *does*, not what it asks for.
// The goal is always to create a meaningful reason for the student to respond.

const MOVES = [
  'TRY_AN_INTERPRETATION',       // Pupil restates the idea as a tentative model
  'MAKE_PRODUCTIVE_MISUNDERSTANDING', // Pupil makes a plausible but incomplete reading
  'APPLY_TO_NEW_CASE',           // Pupil tests the idea in a fresh situation
  'REVEAL_CONFUSION',            // Pupil names the exact part it cannot yet connect
  'BUILD_ROUGH_MODEL',           // Pupil constructs a simple causal picture from what it has
  'INVITE_REPAIR',               // Pupil asks the student to fix its current model
  'ASK_FOR_EVIDENCE_OR_EXAMPLE', // Pupil asks for a concrete example (only when needed)
  'SUMMARIZE_AND_CLOSE',         // Pupil reflects total understanding back, no more questions
];

// ─── Initial state ────────────────────────────────────────────────────────────

export function initialConversationState() {
  return {
    topic: null,
    studentClaims: [],
    pupilCurrentModel: '',
    strongestStudentIdea: '',
    possibleMisunderstanding: '',
    studentKnowledgeOpportunity: '',
    lastThreeMoves: [],
    hasExample: false,
    hasExplanation: false,
    hasCausalLink: false,
  };
}

// ─── selectConversationalMove ─────────────────────────────────────────────────
// Returns a move hint based on state. The LLM has final say but
// this steers it away from repetition and weak defaults.

export function selectConversationalMove(conversationState, latestMessage) {
  const {
    studentClaims,
    lastThreeMoves,
    hasExample,
    hasExplanation,
    hasCausalLink,
    topic,
    pupilCurrentModel,
  } = conversationState;

  // Student uncertain → don't pile on, invite what they do know
  if (/\b(i don'?t know|idk|not sure|unsure|no idea|i'?m not sure)\b/i.test(latestMessage)) {
    return 'REVEAL_CONFUSION';
  }

  // No topic yet → try interpreting whatever they said
  if (!topic || studentClaims.length === 0) {
    return 'TRY_AN_INTERPRETATION';
  }

  // All signals present → close
  if (hasExample && hasExplanation && hasCausalLink) {
    return 'SUMMARIZE_AND_CLOSE';
  }

  // Avoid repeating the last move
  const last = lastThreeMoves[lastThreeMoves.length - 1];

  // Pupil has a model but no example → apply it or ask for one
  if (pupilCurrentModel && !hasExample) {
    return last === 'APPLY_TO_NEW_CASE' ? 'ASK_FOR_EVIDENCE_OR_EXAMPLE' : 'APPLY_TO_NEW_CASE';
  }

  // Has example but no causal link → build a model or reveal confusion
  if (hasExample && !hasCausalLink) {
    return last === 'BUILD_ROUGH_MODEL' ? 'REVEAL_CONFUSION' : 'BUILD_ROUGH_MODEL';
  }

  // Has model, has example, no explanation → try misunderstanding or invite repair
  if (pupilCurrentModel && hasExample && !hasExplanation) {
    if (last === 'MAKE_PRODUCTIVE_MISUNDERSTANDING') return 'INVITE_REPAIR';
    return 'MAKE_PRODUCTIVE_MISUNDERSTANDING';
  }

  // Prevent repeating same move twice in a row
  const nonRepeats = MOVES.filter(m => m !== last && m !== 'SUMMARIZE_AND_CLOSE');
  const preferred = ['TRY_AN_INTERPRETATION', 'BUILD_ROUGH_MODEL', 'REVEAL_CONFUSION', 'INVITE_REPAIR'];
  return preferred.find(m => m !== last) || nonRepeats[0];
}

// ─── enforceBehaviorRules ─────────────────────────────────────────────────────
// Hard overrides — these cannot be bypassed by the LLM.

export function enforceBehaviorRules(suggestedMove, conversationState) {
  const { hasExample, hasExplanation, hasCausalLink, lastThreeMoves } = conversationState;

  // Cannot close without all three signals
  if (
    suggestedMove === 'SUMMARIZE_AND_CLOSE' &&
    !(hasExample && hasExplanation && hasCausalLink)
  ) {
    return hasExample ? 'REVEAL_CONFUSION' : 'ASK_FOR_EVIDENCE_OR_EXAMPLE';
  }

  // Cannot use the same move three turns running
  if (
    lastThreeMoves.length >= 3 &&
    lastThreeMoves.slice(-3).every(m => m === suggestedMove)
  ) {
    const alternatives = MOVES.filter(m => m !== suggestedMove && m !== 'SUMMARIZE_AND_CLOSE');
    return alternatives[Math.floor(Math.random() * alternatives.length)];
  }

  return suggestedMove;
}

// ─── buildMeaningModel ────────────────────────────────────────────────────────
// Merges LLM output into the running conversation state.

export function buildMeaningModel(conversationState, llmOutput) {
  const updated = {
    ...conversationState,
    studentClaims: [...conversationState.studentClaims],
    lastThreeMoves: [...conversationState.lastThreeMoves],
  };

  if (llmOutput.topic && !updated.topic) updated.topic = llmOutput.topic;

  if (llmOutput.newClaim && !updated.studentClaims.includes(llmOutput.newClaim)) {
    updated.studentClaims.push(llmOutput.newClaim);
  }

  if (llmOutput.pupilCurrentModel) updated.pupilCurrentModel = llmOutput.pupilCurrentModel;
  if (llmOutput.strongestStudentIdea) updated.strongestStudentIdea = llmOutput.strongestStudentIdea;
  if (llmOutput.possibleMisunderstanding) updated.possibleMisunderstanding = llmOutput.possibleMisunderstanding;
  if (llmOutput.studentKnowledgeOpportunity) updated.studentKnowledgeOpportunity = llmOutput.studentKnowledgeOpportunity;

  if (llmOutput.hasExample !== undefined) updated.hasExample = llmOutput.hasExample;
  if (llmOutput.hasExplanation !== undefined) updated.hasExplanation = llmOutput.hasExplanation;
  if (llmOutput.hasCausalLink !== undefined) updated.hasCausalLink = llmOutput.hasCausalLink;

  if (llmOutput.moveUsed) {
    updated.lastThreeMoves.push(llmOutput.moveUsed);
    if (updated.lastThreeMoves.length > 3) updated.lastThreeMoves.shift();
  }

  return updated;
}

// ─── Governor prompt ──────────────────────────────────────────────────────────

function buildGovernorPrompt(conversationState, suggestedMove) {
  return `You are the conversation governor for Pupil, a genuinely curious alien learner.

CORE BEHAVIORAL RULE:
Pupil does not ask for more information. Pupil does something with what the student said — then creates a reason for the student to respond.

The interaction pattern is:
Student gives an idea → Pupil tries to understand it → Pupil forms a partial or imperfect model → Student has to clarify, repair, extend, or challenge Pupil's understanding.

PUPIL'S CHARACTER:
- Pupil builds its understanding only from the student's words. It never adds outside knowledge.
- Pupil is tentative, curious, sometimes puzzled, occasionally mildly mistaken.
- Pupil says "So I'm understanding that…" or "My rough picture is…" — not "The correct answer is…"
- No praise. No evaluation. No teacher-like phrasing.
- Responses: 1–3 sentences. At most one question.
- Vary sentence openers. Never repeat the same frame two turns in a row.

CURRENT MEANING MODEL:
${JSON.stringify(conversationState, null, 2)}

SUGGESTED MOVE: ${suggestedMove}
(Use this move unless it produces an incoherent response. You may substitute a better move, but never fall back to simply asking for more information.)

THE 7 MOVES — choose one and execute it:

1. TRY_AN_INTERPRETATION
   Pupil restates the idea as a tentative model. Not a flat summary — an interpretation.
   "So the chatbot is not really thinking — it is imitating the shape of thinking?"

2. MAKE_PRODUCTIVE_MISUNDERSTANDING
   Pupil makes a plausible but incomplete reading that invites the student to correct it.
   "So… is it basically just copying people?"

3. APPLY_TO_NEW_CASE
   Pupil tests the concept in a fresh situation it can reason about from what the student said.
   "If I asked it about dinosaurs, would it know dinosaurs — or just predict dinosaur-sounding language?"

4. REVEAL_CONFUSION
   Pupil names the exact part that does not yet connect.
   "I'm stuck on one part: how can predicting words end up sounding like understanding?"

5. BUILD_ROUGH_MODEL
   Pupil constructs a simple causal picture from what it has heard so far.
   "My rough picture is: a huge ocean of human language goes in, patterns get absorbed, then the chatbot guesses what comes next. What's wrong with that?"

6. INVITE_REPAIR
   Pupil presents its current model and asks the student to fix what is wrong.
   "What part of that picture is wrong?"

7. ASK_FOR_EVIDENCE_OR_EXAMPLE
   Only when a concrete example would genuinely make the idea more real.
   "Can you give me one moment in the play where that shows up?"

8. SUMMARIZE_AND_CLOSE
   Only when hasExample + hasExplanation + hasCausalLink are all true.
   Reflect total understanding back in 1-2 sentences. No more content questions.

WEAK MOVES TO AVOID (never produce these):
- "What specific aspects were discussed?"
- "What details can you share?"
- "Can you tell me more?"
- "Why is that important?"
- Repeating the student's idea and adding a generic question.
- Asking a chain of disconnected follow-up questions.

QUALITY TEST — before finalizing, ask:
1. Does this response do something with what the student said?
2. Would this create a genuine reason for the student to respond?
3. Does this invite the student to clarify, repair, extend, or challenge?
4. Does this avoid adding outside knowledge?
5. Is it under 3 sentences?

EXAMPLES OF GOOD RESPONSES:
Student: "It seems like they are thinking on their own but they're really just predicting words."
Good: "Wait — so the thinking is almost like a disguise made out of word prediction?"
Good: "That makes me suspicious of the word 'thinking.' If it only predicts words, what makes it seem like there is a mind inside?"

Student: "They were trained on a massive amount of human language."
Good: "Okay, my rough picture is: a huge ocean of human language goes in, patterns get absorbed, and then the chatbot guesses what language should come next. What part of that picture is wrong?"
Good: "If it learned from human language, does that mean its answers are kind of made from us?"

Student: "she pretty much forces him to do it although he was already kind of thinking about it himself"
Good: "Oh — so Lady Macbeth is not the original source of the murder idea. She pushes Macbeth toward something already forming in him. What first plants that idea in his mind?"

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "topic": "string or null",
  "newClaim": "string — the core new claim from this turn",
  "pupilCurrentModel": "string — Pupil's full current understanding built only from student's words",
  "strongestStudentIdea": "string — the most significant thing the student has said so far",
  "possibleMisunderstanding": "string — a plausible incomplete reading Pupil could have",
  "studentKnowledgeOpportunity": "string — what the student could teach next that would advance Pupil's understanding",
  "moveUsed": "string — the move actually executed",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "studentFacingResponse": "string — Pupil's response, 1-3 sentences, no praise, no outside knowledge, varied opener"
}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });

  const suggested = selectConversationalMove(conversationState, message);
  const enforced = enforceBehaviorRules(suggested, conversationState);

  console.log('[governor] suggested:', suggested, '→ enforced:', enforced);
  console.log('[governor] claims:', conversationState.studentClaims.length, '| model:', !!conversationState.pupilCurrentModel);

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
    temperature: 0.7,
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

  const updatedState = buildMeaningModel(conversationState, llmOutput);

  console.log('[governor] move used:', llmOutput.moveUsed, '| reply:', reply);

  return { reply, conversationState: updatedState };
}
