import OpenAI from 'openai';

// ─── Constants ────────────────────────────────────────────────────────────────

const RESPONSE_MODES = [
  'invite',
  'reflect_back',
  'connect_claims',
  'check_relationship',
  'ask_for_example',
  'ask_for_clarification',
  'challenge_gently',
  'summarize_and_close',
];

const CAUSE_LIKE = ['cause', 'motivation', 'reason', 'why'];

// ─── Initial state factory ────────────────────────────────────────────────────

export function initialConversationState() {
  return {
    topic: null,
    studentClaims: [],
    relationships: [],
    uncertainties: [],
    emergingTheory: '',
    nextNeededPiece: '',
    repeatedMoveTracker: {
      lastQuestionTypes: [],
      lastResponseModes: [],
    },
    understandingSignals: {
      recall: false,
      explanation: false,
      causalConnection: false,
      exampleOrEvidence: false,
      transferableClaim: false,
    },
  };
}

// ─── Helper: selectResponseMode ───────────────────────────────────────────────
// Suggests a mode based on the current state. The LLM may override with
// a better-informed choice, but this hint guides it away from bad patterns.

export function selectResponseMode(conversationState, latestStudentMessage) {
  const { studentClaims, understandingSignals, repeatedMoveTracker, topic } = conversationState;
  const recentQuestions = repeatedMoveTracker.lastQuestionTypes.slice(-2);

  // Uncertainty signals → invite gently
  if (/\b(i don'?t know|idk|not sure|unsure|i'?m not|no idea)\b/i.test(latestStudentMessage)) {
    return 'invite';
  }

  // Repeated cause-like questions → break the loop
  const causeCounts = recentQuestions.filter(q => CAUSE_LIKE.includes(q)).length;
  if (causeCounts >= 2) {
    if (!understandingSignals.exampleOrEvidence) return 'ask_for_example';
    return 'connect_claims';
  }

  // No topic yet
  if (!topic || studentClaims.length === 0) return 'invite';

  // All four signals present → can close
  if (
    understandingSignals.recall &&
    understandingSignals.explanation &&
    understandingSignals.causalConnection &&
    understandingSignals.exampleOrEvidence
  ) {
    return 'summarize_and_close';
  }

  // Has claims but no example yet
  if (studentClaims.length >= 1 && !understandingSignals.exampleOrEvidence) {
    return 'ask_for_example';
  }

  // Has claims but no causal link yet
  if (studentClaims.length >= 1 && !understandingSignals.causalConnection) {
    return 'check_relationship';
  }

  // Multiple claims → connect them
  if (studentClaims.length >= 2) return 'connect_claims';

  // Single claim → reflect it back
  return 'reflect_back';
}

// ─── Helper: enforceBehaviorRules ─────────────────────────────────────────────
// Hard rules that override both the suggestion and the LLM's chosen mode.

export function enforceBehaviorRules(suggestedMode, conversationState) {
  const { understandingSignals, repeatedMoveTracker } = conversationState;
  const recentModes = repeatedMoveTracker.lastResponseModes.slice(-2);

  // Cannot close without example/evidence
  if (suggestedMode === 'summarize_and_close' && !understandingSignals.exampleOrEvidence) {
    return 'ask_for_example';
  }

  // Cannot repeat the exact same mode 3 turns in a row
  if (recentModes.length === 2 && recentModes[0] === suggestedMode && recentModes[1] === suggestedMode) {
    const alternatives = RESPONSE_MODES.filter(
      m => m !== suggestedMode && m !== 'summarize_and_close'
    );
    return alternatives[Math.floor(Math.random() * alternatives.length)];
  }

  return suggestedMode;
}

// ─── Helper: buildMeaningModel ────────────────────────────────────────────────
// Merges the LLM's structured output back into the running conversation state.

export function buildMeaningModel(conversationState, llmOutput) {
  const updated = {
    ...conversationState,
    repeatedMoveTracker: {
      lastQuestionTypes: [...conversationState.repeatedMoveTracker.lastQuestionTypes],
      lastResponseModes: [...conversationState.repeatedMoveTracker.lastResponseModes],
    },
    understandingSignals: { ...conversationState.understandingSignals },
    studentClaims: [...conversationState.studentClaims],
    relationships: [...conversationState.relationships],
    uncertainties: [...conversationState.uncertainties],
  };

  if (llmOutput.topic && !updated.topic) updated.topic = llmOutput.topic;

  if (llmOutput.newClaim && !updated.studentClaims.includes(llmOutput.newClaim)) {
    updated.studentClaims.push(llmOutput.newClaim);
  }

  if (llmOutput.relationshipToPriorClaims?.type) {
    updated.relationships.push(llmOutput.relationshipToPriorClaims);
  }

  if (llmOutput.updatedEmergingTheory) updated.emergingTheory = llmOutput.updatedEmergingTheory;
  if (llmOutput.nextNeededPiece) updated.nextNeededPiece = llmOutput.nextNeededPiece;

  if (llmOutput.understandingSignals) {
    Object.assign(updated.understandingSignals, llmOutput.understandingSignals);
  }

  if (llmOutput.responseMode) {
    updated.repeatedMoveTracker.lastResponseModes.push(llmOutput.responseMode);
    if (updated.repeatedMoveTracker.lastResponseModes.length > 4) {
      updated.repeatedMoveTracker.lastResponseModes.shift();
    }
  }

  if (llmOutput.questionType) {
    updated.repeatedMoveTracker.lastQuestionTypes.push(llmOutput.questionType);
    if (updated.repeatedMoveTracker.lastQuestionTypes.length > 4) {
      updated.repeatedMoveTracker.lastQuestionTypes.shift();
    }
  }

  return updated;
}

// ─── Governor prompt ──────────────────────────────────────────────────────────

function buildGovernorPrompt(conversationState, enforcedMode) {
  return `You are the conversation governor for Pupil — an alien learner being taught by a student.

PUPIL'S CHARACTER:
- Pupil builds understanding only from what the student says. Never adds outside knowledge.
- Pupil never teaches, corrects, evaluates, or explains content.
- Pupil uses phrases like "So I'm understanding that..." or "You're teaching me..." — not "The correct answer is..."
- No generic praise ("Great!", "Excellent!", "Interesting!"). No teacher-like evaluation.
- Responses are short: 1–3 sentences max.
- Ask at most one question per turn.

CURRENT CONVERSATION STATE:
${JSON.stringify(conversationState, null, 2)}

ENFORCED RESPONSE MODE: ${enforcedMode}
(You must use this mode unless doing so would produce an incoherent or harmful response.)

RESPONSE MODES:
- invite: gently ask what part of the topic the student can describe or remembers
- reflect_back: mirror Pupil's current understanding back, ask for one more piece
- connect_claims: name two things the student said, ask if/how they are connected
- check_relationship: ask about the relationship between two ideas (cause, sequence, contrast, etc.)
- ask_for_example: ask for a specific example, event, moment, or piece of evidence
- ask_for_clarification: ask the student to say more about one unclear part
- challenge_gently: ask a question that tests whether the idea holds up — still from Pupil's curious perspective
- summarize_and_close: reflect total understanding back in 1-2 sentences, no more content questions

RELATIONSHIP TYPES: cause, effect, contrast, example, evidence, uncertainty, theme, sequence

HARD RULES:
1. Do not add knowledge the student has not introduced.
2. Do not ask cause/why/motivation questions if questionType was "cause" in the last two turns.
3. Do not close (summarize_and_close) unless understandingSignals shows: recall + explanation + causalConnection + exampleOrEvidence are all true.
4. Do not close just because the student says "yes."
5. If student shows low engagement (e.g. "I'm bored", "I don't want to"), acknowledge it briefly and lower pressure — do not ask another content question that turn.
6. Do not ask yes/no questions.
7. Use the student's own words when reflecting.

EXAMPLE OF GOOD RESPONSE:
Student: "she pretty much forces him to do it although he was already kind of thinking about it himself"
Good: "Oh — so Lady Macbeth is not the original source of the murder idea. She pushes Macbeth toward something already forming in him. What first plants that idea in his mind?"

Respond ONLY with valid JSON — no markdown fences, no extra text:
{
  "topic": "string or null",
  "newClaim": "string — the core new claim the student made this turn",
  "relationshipToPriorClaims": { "type": "one of the relationship types", "description": "how this claim relates to prior claims" },
  "updatedEmergingTheory": "string — Pupil's current theory built only from student's words",
  "nextNeededPiece": "string — what is still missing for Pupil to fully understand",
  "responseMode": "string — the mode actually used",
  "questionType": "string — type of question asked (cause/example/relationship/contrast/etc), or null if no question",
  "understandingSignals": {
    "recall": boolean,
    "explanation": boolean,
    "causalConnection": boolean,
    "exampleOrEvidence": boolean,
    "transferableClaim": boolean
  },
  "studentFacingResponse": "string — Pupil's response, 1-3 sentences, no praise, no outside knowledge"
}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });

  const suggested = selectResponseMode(conversationState, message);
  const enforced = enforceBehaviorRules(suggested, conversationState);

  console.log('[governor] suggested mode:', suggested, '→ enforced:', enforced);
  console.log('[governor] claims so far:', conversationState.studentClaims.length);

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
    temperature: 0.6,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  console.log('[governor] raw output:', raw);

  let llmOutput;
  try {
    llmOutput = JSON.parse(raw);
  } catch {
    throw new Error('Governor returned invalid JSON: ' + raw);
  }

  const reply = (llmOutput.studentFacingResponse || '').trim();
  if (!reply) throw new Error('Governor returned empty studentFacingResponse');

  const updatedState = buildMeaningModel(conversationState, llmOutput);

  console.log('[governor] mode used:', llmOutput.responseMode, '| reply:', reply);

  return { reply, conversationState: updatedState };
}
