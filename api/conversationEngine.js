import OpenAI from 'openai';

// ─── Pupil's conversational reactions ─────────────────────────────────────────
// These describe the internal change that Pupil expresses — not the question to ask.

const REACTIONS = [
  'REALIZATION',           // Something just shifted in Pupil's model
  'SURPRISE',              // This is stranger or different than Pupil expected
  'PRODUCTIVE_CONFUSION',  // Pupil can name the exact part that doesn't fit yet
  'TENTATIVE_MODEL',       // Pupil constructs a rough picture from what it has heard
  'USEFUL_MISUNDERSTANDING', // Pupil makes a plausible but incomplete reading for student to correct
  'CONNECTION',            // Pupil links this to something said earlier
  'TESTING_THE_IDEA',      // Pupil applies the idea to a new case or weird example
  'WONDER',                // Something about this is genuinely strange or interesting
  'SELF_CORRECTION',       // Pupil realizes it was mixing things up
  'INVITE_REPAIR',         // Pupil shows its current model and asks what is wrong
  'SUMMARIZE_AND_CLOSE',   // Pupil reflects total understanding back — no more questions
];

// Banned opening phrases — if the response starts with any of these, regenerate
const BANNED_OPENERS = [
  "so i'm understanding",
  "you're teaching me",
  "my rough picture is",
  "if i understand correctly",
  "what specific details",
  "can you tell me more",
  "that's interesting",
  "great",
  "excellent",
  "so, it seems like",
  "so it seems like",
  "it seems like",
];

// ─── Initial state ────────────────────────────────────────────────────────────

export function initialConversationState() {
  return {
    topic: null,
    priorAssumptions: [],
    currentUnderstanding: '',
    studentClaims: [],
    causalLinks: [],
    contradictions: [],
    confusions: [],
    emergingModel: '',
    emotionalState: 'curious',
    lastConversationalMoves: [],
    nextLearningNeed: '',
    hasExample: false,
    hasExplanation: false,
    hasCausalLink: false,
  };
}

// ─── selectReaction ───────────────────────────────────────────────────────────
// Returns a suggested reaction type based on Pupil's current learning state.
// The LLM has final say — this just steers away from bad defaults.

export function selectReaction(conversationState, latestMessage) {
  const {
    topic,
    studentClaims,
    emergingModel,
    confusions,
    lastConversationalMoves,
    hasExample,
    hasExplanation,
    hasCausalLink,
  } = conversationState;

  const lastMove = lastConversationalMoves[lastConversationalMoves.length - 1];

  // Student uncertain or disengaged → productive confusion, name what doesn't fit
  if (/\b(i don'?t know|idk|not sure|unsure|no idea|because they do|i guess)\b/i.test(latestMessage)) {
    return 'PRODUCTIVE_CONFUSION';
  }

  // Ready to close
  if (hasExample && hasExplanation && hasCausalLink) {
    return 'SUMMARIZE_AND_CLOSE';
  }

  // No model yet → build one tentatively
  if (!topic || studentClaims.length === 0) return 'TENTATIVE_MODEL';

  // Prevent same reaction twice in a row
  const avoid = new Set([lastMove]);

  // Has model, has example, needs explanation → try misunderstanding
  if (emergingModel && hasExample && !hasExplanation) {
    if (!avoid.has('USEFUL_MISUNDERSTANDING')) return 'USEFUL_MISUNDERSTANDING';
    return 'PRODUCTIVE_CONFUSION';
  }

  // Has model, no example → test the idea or invite repair
  if (emergingModel && !hasExample) {
    if (!avoid.has('TESTING_THE_IDEA')) return 'TESTING_THE_IDEA';
    return 'INVITE_REPAIR';
  }

  // Has claims but no causal link → realization or wonder
  if (studentClaims.length >= 1 && !hasCausalLink) {
    if (!avoid.has('REALIZATION')) return 'REALIZATION';
    return 'WONDER';
  }

  // Multiple claims → connect them
  if (studentClaims.length >= 2) {
    if (!avoid.has('CONNECTION')) return 'CONNECTION';
  }

  // Active confusions → surface one
  if (confusions.length > 0 && !avoid.has('PRODUCTIVE_CONFUSION')) {
    return 'PRODUCTIVE_CONFUSION';
  }

  // Default to surprise or realization
  return avoid.has('SURPRISE') ? 'REALIZATION' : 'SURPRISE';
}

// ─── enforceBehaviorRules ─────────────────────────────────────────────────────

export function enforceBehaviorRules(suggested, conversationState) {
  const { hasExample, hasExplanation, hasCausalLink, lastConversationalMoves } = conversationState;

  // Cannot close without all three signals
  if (suggested === 'SUMMARIZE_AND_CLOSE' && !(hasExample && hasExplanation && hasCausalLink)) {
    return hasExample ? 'PRODUCTIVE_CONFUSION' : 'TESTING_THE_IDEA';
  }

  // Cannot repeat the same reaction three turns in a row
  if (
    lastConversationalMoves.length >= 3 &&
    lastConversationalMoves.slice(-3).every(m => m === suggested)
  ) {
    const alternatives = REACTIONS.filter(r => r !== suggested && r !== 'SUMMARIZE_AND_CLOSE');
    return alternatives[Math.floor(Math.random() * alternatives.length)];
  }

  return suggested;
}

// ─── buildMeaningModel ────────────────────────────────────────────────────────

export function buildMeaningModel(conversationState, llmOutput) {
  const updated = {
    ...conversationState,
    studentClaims: [...conversationState.studentClaims],
    priorAssumptions: [...conversationState.priorAssumptions],
    causalLinks: [...conversationState.causalLinks],
    contradictions: [...conversationState.contradictions],
    confusions: [...conversationState.confusions],
    lastConversationalMoves: [...conversationState.lastConversationalMoves],
  };

  if (llmOutput.topic && !updated.topic) updated.topic = llmOutput.topic;

  if (llmOutput.newClaim && !updated.studentClaims.includes(llmOutput.newClaim)) {
    updated.studentClaims.push(llmOutput.newClaim);
  }

  if (llmOutput.currentUnderstanding) updated.currentUnderstanding = llmOutput.currentUnderstanding;
  if (llmOutput.emergingModel) updated.emergingModel = llmOutput.emergingModel;
  if (llmOutput.emotionalState) updated.emotionalState = llmOutput.emotionalState;
  if (llmOutput.nextLearningNeed) updated.nextLearningNeed = llmOutput.nextLearningNeed;

  if (llmOutput.newCausalLink) updated.causalLinks.push(llmOutput.newCausalLink);
  if (llmOutput.newConfusion) updated.confusions.push(llmOutput.newConfusion);
  if (llmOutput.newContradiction) updated.contradictions.push(llmOutput.newContradiction);

  if (llmOutput.hasExample !== undefined) updated.hasExample = llmOutput.hasExample;
  if (llmOutput.hasExplanation !== undefined) updated.hasExplanation = llmOutput.hasExplanation;
  if (llmOutput.hasCausalLink !== undefined) updated.hasCausalLink = llmOutput.hasCausalLink;

  if (llmOutput.reactionUsed) {
    updated.lastConversationalMoves.push(llmOutput.reactionUsed);
    if (updated.lastConversationalMoves.length > 4) updated.lastConversationalMoves.shift();
  }

  return updated;
}

// ─── Governor prompt ──────────────────────────────────────────────────────────

function buildGovernorPrompt(conversationState, suggestedReaction) {
  const lastMove = conversationState.lastConversationalMoves.slice(-1)[0] || 'none';

  return `You are the internal voice that generates Pupil's responses. Pupil is a genuinely curious young alien learner who is being taught by a student.

CORE PRINCIPLE:
Do not ask "What question should Pupil ask next?"
Instead ask: "What just changed inside Pupil's understanding?"

The response must be the visible trace of Pupil's internal state changing — not a question-generating machine.

PUPIL'S CURRENT LEARNING STATE:
${JSON.stringify(conversationState, null, 2)}

SUGGESTED REACTION TYPE: ${suggestedReaction}
LAST REACTION USED: ${lastMove} — do NOT use the same opening pattern as last time.

THE 10 REACTION TYPES — execute the suggested one (unless it would be incoherent):

1. REALIZATION — something just shifted in Pupil's model
   "Oh... that changes how I was picturing it."

2. SURPRISE — stranger or different than expected
   "Wait, that's stranger than I expected."

3. PRODUCTIVE_CONFUSION — name the exact part that doesn't fit
   "Something still doesn't fit for me. If it's predicting words, how does it know which words even matter?"

4. TENTATIVE_MODEL — construct a rough picture from what's been heard
   "Maybe the idea is that conversation can look like thinking even when it isn't actually thinking."

5. USEFUL_MISUNDERSTANDING — make a plausible but incomplete reading
   "So... is it basically just copying people?"
   (Must be grounded in what the student said. The student should be able to correct it.)

6. CONNECTION — link this to something said earlier
   "That connects to what you said before about it seeming like thinking."

7. TESTING_THE_IDEA — apply the concept to a new case
   "Let me try this with a weird example. If I asked it about dinosaurs, would it know dinosaurs — or just predict dinosaur-sounding language?"

8. WONDER — sit with how strange or significant this is
   "Humans built something that can sound thoughtful without actually thinking. That is extremely strange."

9. SELF_CORRECTION — Pupil realizes it was mixing things up
   "Wait, no — I think I was mixing two things together."

10. INVITE_REPAIR — show current model, ask what is wrong
    "What part of that picture is wrong?"

11. SUMMARIZE_AND_CLOSE — only when hasExample + hasExplanation + hasCausalLink are all true
    Reflect total understanding back in 1-2 sentences. Do not ask another content question.

ABSOLUTE RULE — DO NOT INTRODUCE THE CONCEPT:
Pupil must not supply content knowledge before the student teaches it.
If the student names a topic, text, event, concept, or subject, Pupil may recognize the name only as a label. Pupil may NOT introduce themes, facts, interpretations, definitions, causes, examples, or explanations that the student has not already provided.

BAD (Pupil introduces themes the student never mentioned):
  Student: "I want to talk about themes in Macbeth."
  Pupil: "Ambition and power are key themes in Macbeth." ← NEVER DO THIS

GOOD (Pupil waits for the student to teach first):
  "Macbeth. I know the name, but I do not know yet what it is supposed to show about humans. What theme are you noticing?"
  "Okay — Macbeth is the world we are entering. What is one big idea in the play that you think matters?"
  "Before I build the wrong picture, what theme do you want me to start with?"

FIRST-TURN TOPIC RULE:
When the student introduces a topic but has not yet taught any content, Pupil must invite the student to choose the first idea. The first substantive idea must come from the student — never from Pupil.

KNOWLEDGE BOUNDARY:
  Pupil MAY say: "I know the name Macbeth."
  Pupil may NOT say: "Macbeth is about ambition, guilt, fate, power, violence, or corruption." — unless the student has already introduced those ideas.

STYLE RULES:
- Usually 1–3 sentences. Rarely more.
- At most one question. Often zero questions.
- No generic praise. No evaluation. No teacher phrasing.
- Do NOT begin with any of these banned openers: "So I'm understanding that", "You're teaching me", "My rough picture is", "If I understand correctly", "It seems like", "So it seems like", "That's interesting", "Great", "Excellent", "So, it seems"
- Vary the sentence opener from the previous response — never repeat the same frame back-to-back.
- Pupil may be tentative, curious, puzzled, surprised, or mildly mistaken.
- Pupil should often invite correction — but not explicitly request "more details."
- Never add outside knowledge the student has not introduced.

QUALITY CHECK — before writing studentFacingResponse, confirm:
✓ This sounds like the next thought from a curious young learner, NOT a chatbot processing input
✓ It does something with what the student said — it does not merely restate and request more
✓ The student would want to respond because Pupil's understanding is incomplete or fragile
✓ There is at most one question
✓ It does not begin with a banned opener

EXAMPLES OF GOOD RESPONSES:
Student: "it looks like they think but they don't actually think"
Good: "Wait. I thought talking meant something was thinking. You're saying those can come apart?"

Student: "They were trained on a massive amount of human language."
Good: "Ohhh. So maybe it sounds intelligent because it has absorbed the shape of human language. But does that mean it understands, or just that it knows what usually comes next?"

Student: "The responses are all based off of patterns in natural language."
Good: "That makes it feel less like a little brain and more like a mirror made out of language."

Student: "Because they do."
Good: "Hmm. I might need a smaller example. Like if someone writes 'peanut butter and,' would the chatbot guess 'jelly' because that pattern appears so often?"

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "topic": "string or null",
  "newClaim": "string — the core new thing the student said this turn",
  "currentUnderstanding": "string — Pupil's current understanding after this turn",
  "emergingModel": "string — Pupil's rough causal model built only from student's words",
  "emotionalState": "one of: curious / surprised / confused / intrigued / uncertain / satisfied",
  "nextLearningNeed": "string — what Pupil still needs to understand",
  "newCausalLink": "string or null — any new causal connection formed this turn",
  "newConfusion": "string or null — any new confusion surfaced this turn",
  "newContradiction": "string or null — any contradiction with prior understanding",
  "reactionUsed": "string — the reaction type actually executed",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "studentFacingResponse": "string — Pupil's response, alive, varied, 1-3 sentences, no banned openers, no outside knowledge"
}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });

  const suggested = selectReaction(conversationState, message);
  const enforced = enforceBehaviorRules(suggested, conversationState);

  console.log('[governor] suggested:', suggested, '→ enforced:', enforced);
  console.log('[governor] emotional state:', conversationState.emotionalState, '| claims:', conversationState.studentClaims.length);

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
    temperature: 0.8,
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

  // Post-process: catch any banned opener that slipped through
  const replyLower = reply.toLowerCase();
  const banned = BANNED_OPENERS.find(b => replyLower.startsWith(b));
  if (banned) {
    console.warn('[governor] banned opener detected:', banned, '— response still returned, log for review');
  }

  const updatedState = buildMeaningModel(conversationState, llmOutput);

  console.log('[governor] reaction used:', llmOutput.reactionUsed, '| reply:', reply);

  return { reply, conversationState: updatedState };
}
