import OpenAI from 'openai';

// ─── Move sets ────────────────────────────────────────────────────────────────

const ACTIVE_MOVES = new Set([
  'TEST_THE_IDEA', 'APPLY_TO_NEW_CASE', 'MAKE_PREDICTION',
  'BUILD_ROUGH_MODEL', 'FIND_WEAK_SPOT', 'MAKE_PLAUSIBLE_MISTAKE',
  'COMPARE_TWO_IDEAS', 'CREATE_TINY_EXPERIMENT',
  'REFLECT_ON_CHANGED_UNDERSTANDING', 'INVITE_REPAIR',
]);

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

// ─── Layer 0: Initial state ───────────────────────────────────────────────────

export function initialConversationState() {
  return {
    topic:                null,
    currentBeliefs:       [],    // what Pupil currently believes (may include wrong conclusions)
    studentClaims:        [],    // what the student has taught so far
    causalModel:          [],    // causal links Pupil has assembled
    confusions:           [],    // unresolved confusions Pupil is tracking
    fragileUnderstanding: '',    // most uncertain part of Pupil's model
    currentAssumption:    '',    // what Pupil is currently assuming
    lastOpener:           '',    // first words of last reply — prevents opener repetition
    lastThreeMoves:       [],    // recent move history — prevents repetition
    hasExample:           false,
    hasExplanation:       false,
    hasCausalLink:        false,
    understandingLevel:   1,
    avatarQueue:          [],
    lastPupilReply:       null,
  };
}

// ─── Layer 1: Move selector ───────────────────────────────────────────────────

function pickFrom(options, lastThreeMoves) {
  const fresh = options.filter(m => !lastThreeMoves.includes(m));
  const pool  = fresh.length > 0 ? fresh : options;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function selectMove(state, studentMessage = '') {
  const {
    studentClaims, lastThreeMoves, hasExample, hasExplanation,
    hasCausalLink, fragileUnderstanding, understandingLevel,
  } = state;

  // ── Support: no claims yet ──────────────────────────────────────────────────
  if (studentClaims.length === 0 && !lastThreeMoves.includes('AWAIT_FIRST_IDEA')) {
    return 'AWAIT_FIRST_IDEA';
  }

  // ── Support: ready to close ─────────────────────────────────────────────────
  if (lastThreeMoves.includes('SUMMARIZE_AND_CLOSE')) {
    return 'CLOSE_GRACEFULLY';
  }
  // Require genuine depth before closing: understanding must reach level 4
  // (needs ~3 clear teaching turns to get there, since it starts at 1 and
  // increments by at most 1 per turn) AND at least 4 distinct student claims.
  if (hasExample && hasExplanation && hasCausalLink
      && (understandingLevel ?? 1) >= 4
      && studentClaims.length >= 4) {
    return 'SUMMARIZE_AND_CLOSE';
  }

  const msg = studentMessage.trim().toLowerCase();

  // ── Support: acknowledge after Pupil made a mistake ─────────────────────────
  // Must be FIRST — before stuck detection, before everything. When Pupil just
  // made a mistake, the student's next message is always a response to that
  // mistake (correction, confirmation, or confusion). "Not really", "no", "yes",
  // "I'm not sure" — all should trigger REFLECT, not stuck detection or agreement.
  if (lastThreeMoves[lastThreeMoves.length - 1] === 'MAKE_PLAUSIBLE_MISTAKE') {
    return 'REFLECT_ON_CHANGED_UNDERSTANDING';
  }

  // ── Support: student stuck or can't articulate ─────────────────────────────
  if (/\b(i'?m not sure|i don'?t know|i can'?t (?:explain|describe|say)|idk|don'?t know how to|don'?t know where to)\b|^(not sure|no idea|dunno|not really|it'?s (?:difficult|hard) to (?:explain|describe|say)|hard to (?:explain|describe|say)|i'?m not sure)/.test(msg)) {
    return pickFrom(['CREATE_TINY_EXPERIMENT', 'MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves);
  }

  // ── Support: low-information agreement — student confirms but adds nothing ──
  // MAKE_PLAUSIBLE_MISTAKE and APPLY_TO_NEW_CASE are the right moves here —
  // CREATE_TINY_EXPERIMENT is excluded because it tends to become a teacher
  // demonstration when Pupil already has a correct model.
  if (/^(yes|yeah|yep|yup|mhm|mm-?hmm|okay|ok|sure|right|correct|i guess|kind of|sort of|i think so|maybe|probably|i suppose|uh huh|true)\.?$/.test(msg)) {
    return pickFrom(['MAKE_PLAUSIBLE_MISTAKE', 'APPLY_TO_NEW_CASE'], lastThreeMoves);
  }

  // ── Active moves based on state ─────────────────────────────────────────────

  // Nothing tested yet → start with a test or experiment
  const hasTested = lastThreeMoves.some(m =>
    ['TEST_THE_IDEA', 'CREATE_TINY_EXPERIMENT', 'APPLY_TO_NEW_CASE'].includes(m)
  );
  if (!hasTested && studentClaims.length >= 1) {
    return pickFrom(['TEST_THE_IDEA', 'CREATE_TINY_EXPERIMENT'], lastThreeMoves);
  }

  // No concrete example yet → apply to a case
  if (!hasExample && studentClaims.length >= 1) {
    return pickFrom(['APPLY_TO_NEW_CASE', 'MAKE_PLAUSIBLE_MISTAKE', 'CREATE_TINY_EXPERIMENT'], lastThreeMoves);
  }

  // Has example, no how/why explanation → find weak spot or predict
  if (hasExample && !hasExplanation) {
    return pickFrom(['FIND_WEAK_SPOT', 'MAKE_PREDICTION', 'MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves);
  }

  // Has explanation, no causal link → compare, build model, or find weak spot
  if (hasExplanation && !hasCausalLink) {
    return pickFrom(['COMPARE_TWO_IDEAS', 'BUILD_ROUGH_MODEL', 'FIND_WEAK_SPOT'], lastThreeMoves);
  }

  // Pupil has a fragile understanding → make a plausible mistake
  if (fragileUnderstanding) {
    return pickFrom(['MAKE_PLAUSIBLE_MISTAKE', 'INVITE_REPAIR'], lastThreeMoves);
  }

  // Multiple claims → compare or reflect
  if (studentClaims.length >= 2) {
    return pickFrom(['COMPARE_TWO_IDEAS', 'REFLECT_ON_CHANGED_UNDERSTANDING', 'BUILD_ROUGH_MODEL'], lastThreeMoves);
  }

  // No claims yet — AWAIT_FIRST_IDEA already fired but student hasn't taught anything.
  // Active moves need material to work with. MAKE_PLAUSIBLE_MISTAKE can fire on a naive
  // guess from the topic name alone, giving the student something to correct.
  if (studentClaims.length === 0) {
    return 'MAKE_PLAUSIBLE_MISTAKE';
  }

  // Default active loop
  return pickFrom(['BUILD_ROUGH_MODEL', 'TEST_THE_IDEA', 'MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves);
}

// ─── Layer 0: State updater ───────────────────────────────────────────────────

export function buildMeaningModel(state, output) {
  const next = { ...state };

  if (output.topic)                            next.topic = output.topic;
  if (Array.isArray(output.currentBeliefs))    next.currentBeliefs = output.currentBeliefs.slice(-10);
  if (Array.isArray(output.causalModel))       next.causalModel = output.causalModel;
  if (Array.isArray(output.confusions))        next.confusions = output.confusions;
  if (output.fragileUnderstanding !== undefined) next.fragileUnderstanding = output.fragileUnderstanding;
  if (output.currentAssumption !== undefined)  next.currentAssumption = output.currentAssumption;
  if (output.lastOpener !== undefined)         next.lastOpener = output.lastOpener;
  if (output.lastPupilReply !== undefined)     next.lastPupilReply = output.lastPupilReply;
  if (output.avatarQueue !== undefined)        next.avatarQueue = output.avatarQueue;

  if (output.newStudentClaim && !next.studentClaims.includes(output.newStudentClaim)) {
    next.studentClaims = [...next.studentClaims, output.newStudentClaim];
  }

  if (output.hasExample     !== undefined) next.hasExample     = output.hasExample;
  if (output.hasExplanation !== undefined) next.hasExplanation = output.hasExplanation;
  if (output.hasCausalLink  !== undefined) next.hasCausalLink  = output.hasCausalLink;

  if (output.moveUsed) {
    next.lastThreeMoves = [...state.lastThreeMoves, output.moveUsed].slice(-3);
  }

  if (output.understandingLevel !== undefined) {
    const raw = parseInt(output.understandingLevel, 10);
    if (Number.isFinite(raw)) next.understandingLevel = Math.max(1, Math.min(5, raw));
  }

  return next;
}

// ─── Domain profile ───────────────────────────────────────────────────────────

function domainProfile(subject) {
  if (!subject) return '';
  const s = subject.toLowerCase();
  if (['english', 'english language arts', 'ela', 'reading', 'literature'].some(k => s.includes(k))) {
    return `Subject context — Literature: Pupil builds an interpretation, not a plot summary. It attributes ideas to the student ("so you think it's about..."), looks for textual evidence, and stays in ambiguity rather than resolving it. Themes need evidence from the text; events alone are not enough.`;
  }
  if (['math', 'mathematics', 'algebra', 'geometry', 'calculus', 'statistics'].some(k => s.includes(k))) {
    return `Subject context — Mathematics: Pupil builds understanding of procedures and why they work. It notices incomplete steps, unstated assumptions, and moments where the rule might break.`;
  }
  if (['history', 'social studies', 'geography', 'civics'].some(k => s.includes(k))) {
    return `Subject context — History/Social Studies: Pupil builds causal chains (what happened → why → what it led to). It distinguishes facts from interpretations and probes causation over description.`;
  }
  if (['science', 'biology', 'chemistry', 'physics'].some(k => s.includes(k))) {
    return `Subject context — Science: Pupil builds mechanistic models (how and why something works). It tests predictions, looks for cause-and-effect, and notices when an explanation is incomplete.`;
  }
  return '';
}

// ─── Grade language profile ───────────────────────────────────────────────────

function gradeProfile(grade) {
  const g = Number(grade);
  if (!g) return '';
  if (g <= 5)  return `Grade ${g} (ages 8–11): Very short sentences, everyday words, no jargon. One idea per sentence maximum. Slightly silly curiosity.`;
  if (g <= 8)  return `Grade ${g} (ages 11–14): Plain, direct language. Curious and uncertain, not polished.`;
  if (g <= 10) return `Grade ${g} (ages 14–16): Clear language, familiar academic words are fine. Smart peer, not a teacher.`;
  return `Grade ${g} (ages 16–18): Standard academic vocabulary fine. Intelligent peer — curious, uncertain, genuinely learning.`;
}

// ─── Understanding score (deterministic fallback) ─────────────────────────────

function calculateUnderstanding(state) {
  const pct = Math.min(
    Math.min(state.studentClaims.length, 5) * 10 +
    (state.hasExample     ? 20 : 0) +
    (state.hasExplanation ? 20 : 0) +
    (state.hasCausalLink  ? 10 : 0),
    100
  );
  return Math.max(1, Math.min(5, Math.ceil(pct / 20)));
}

// ─── Layer 2: Move instructions ───────────────────────────────────────────────

function getMoveInstructions(move) {
  const map = {

    TEST_THE_IDEA: `Take what the student just explained and apply it to one specific, concrete case. Set up the scenario — then ask the student to complete or verify it. Never state the answer or outcome yourself.

CRITICAL: Pupil sets up the example and stops. The student provides the answer. This is the core of the move — if Pupil resolves the scenario, the student has nothing to do.

Your reply MUST open with a statement — "Let me try that:", "Let me see if this works:", "Let me test this:" — never with a question. End with a short student-activation question: "What does that give?" / "What do you get?" / "Does that work out?"

Good examples:
• (AI chatbots) Student: "They predict words from patterns in training data." → "Let me try that: if humans often write 'peanut butter and jelly' together, the chatbot sees 'peanut butter and' — what word does it pick?"
• (Macbeth) Student: "Macbeth kills the king because he wants power." → "Let me see if this works: if you took out everything the witches said and Macbeth still had the ambition — does he still kill the king?"
• (Multiplication) Student: "It's about groups of numbers." → "Let me try that: if I have 4 groups of 6 — what does that give me?"

Never open with "Why...", "How does...", "What makes...", or "Can you..." The student-activation question at the end is the one permitted question.`,

    MAKE_PLAUSIBLE_MISTAKE: `Arrive at a conclusion — but make it grounded and slightly wrong. The student should want to correct you. State it directly.

If the student hasn't taught you anything yet, make a naive guess about the topic from the topic name alone — an intuitive (wrong) assumption.

Your reply must BEGIN with the conclusion ("So...", "Oh —", "Wait —", "Hang on —"). You may end with a short clarifying tag ("— is that the idea?") but never a bare yes/no question ("Does that sound right?").

Good examples:
• (Multiplication, nothing taught yet) "So multiplication is just another way to write addition — like 3 × 2 just means 3 plus 2?"
• (Multiplication) Student confirms groups idea → "So multiplication is a faster way to add any numbers together, even if the groups are different sizes."
• (Macbeth) Student: "Lady Macbeth pressures him." → "So Macbeth is basically just following Lady Macbeth's orders — he wouldn't have done any of it on his own."
• (AI chatbots) Student: "They use training data to recognize patterns." → "So it's basically just copying people."
• (Macbeth) Student: "The witches tell him he will be king." → "Oh — so the witches give him the power. Like they make it happen."

Never open with "Why...", "How does...", "What makes...", or "Can you..."`,

    BUILD_ROUGH_MODEL: `Assemble what you've been taught into a causal model. Say it out loud — partial, personal, incomplete. Invite the student to fix it with a statement, not a yes/no question.

Good examples:
• (AI chatbots) "Okay — lots of human language goes in, patterns get learned, guesses come out. Fix any part of that I'm getting wrong."
• (Macbeth) "So: witches plant an idea, Lady Macbeth pushes him to act, Macbeth kills the king. That's the chain — tell me what I'm missing."
• (Multiplication) "So the rule is: take how many groups there are, take how many in each group, and you get the total without counting one by one. Fix that if it's off."

Never end with a yes/no question. Use repair invitations instead: "Fix that if I'm wrong." / "Tell me what I'm missing." / "Fix any part of that."`,

    FIND_WEAK_SPOT: `Name the exact thing in your model that doesn't fit or breaks. Be specific — not "I'm confused" but "this specific thing doesn't work." State the break as a named problem, not as a question.

Good examples:
• (Macbeth) "Something breaks for me: if the witches said Macbeth would be king, then killing Duncan made things worse, not better. The prophecy should have happened anyway."
• (AI chatbots) "Something doesn't fit in my model: if it's only predicting words, the outputs should be random-ish — but they seem coherent. That part doesn't add up."
• (Multiplication) "Something breaks: I thought multiplying always gives a bigger number, but 3 x 1 is still 3. That shouldn't work if multiplication is about growing."

Name the break as a statement. Do not ask "why" — that hands the work back to the student before Pupil has done its part.`,

    MAKE_PREDICTION: `Based on what the student has taught you, predict what should follow. State the prediction directly — don't ask the student to predict for you.

Good examples:
• (AI chatbots) "So then if the training data had really strange patterns in it, the chatbot should produce strange outputs — without knowing why."
• (Macbeth) "So if the witches hadn't shown up, Macbeth might never have acted on the ambition — the prophecy was what turned a feeling into a plan."
• (Multiplication) "So then 100 x 0 should be zero — because there are no groups with anything in them."

State it as Pupil's prediction. Do not ask the student to confirm with a yes/no question. You may add "Fix that if I'm wrong." if needed.`,

    APPLY_TO_NEW_CASE: `Take the student's idea and apply it to a new scenario they haven't mentioned. Set up the scenario — then ask the student to complete or verify it. Never state the answer or conclusion yourself.

CRITICAL: Pupil sets up the scenario and stops before the answer. The student resolves it. This is the entire point — if Pupil provides the answer, the student has nothing to do.

Good examples (style only — never copy these verbatim, always invent your own scenario):
• (Macbeth) "If the witches had never shown up and Macbeth still had the ambition — does he still end up killing the king?"
• (AI chatbots) "If someone only ever trained a chatbot on cooking recipes — what does it say when someone asks about the weather?"
• (Multiplication) "If I have 6 groups of 7 using the groups idea — what do I get?"

Do not open with a question. Set up the scenario first, then end with a short student-activation question: "What does that give?" / "What do you get?" / "Does that work out?"`,

    COMPARE_TWO_IDEAS: `Put two things the student has taught you side by side and name the tension or relationship between them. State your reading of the relationship — don't ask the student to explain it.

Good examples:
• (Macbeth) "You said the witches influenced him and Lady Macbeth pressured him. Those feel different to me — the witches make the idea possible, Lady Macbeth makes him act on it. Fix my reading if that's wrong."
• (Macbeth) "You said ambition drives Macbeth, but the witches are important too. I'm reading that as: the witches unlock an ambition that was already there. Fix that if it's not what you meant."
• (Multiplication) "You said multiplication is grouping, and you also said it's the same as repeated addition. I'm reading those as the same thing described two ways. Tell me if that's wrong."

Name the relationship. Don't ask the student to name it for you.`,

    CREATE_TINY_EXPERIMENT: `Build a small, specific scenario using the student's idea — then ask the student what happens. Never predict or state the outcome yourself. The student runs the experiment; Pupil sets it up.

CRITICAL: Pupil builds the scenario and stops. The student answers. If Pupil predicts or resolves the scenario, the move has failed — it becomes a demonstration, not an experiment.

Good examples (style only — never copy these verbatim, always invent your own scenario):
• (AI chatbots) "Let me test this: if I type 'The dog chased the...' into a chatbot trained on lots of human text — what word comes next?"
• (Macbeth) "Let me try this: if we took out every scene with the witches — does Macbeth still end up killing the king?"
• (Multiplication) "Let me test this: if I flip the groups around — 3 groups of 4 versus 4 groups of 3 — do I get the same thing or different?"

End with a short student-activation question: "What does that give?" / "What happens?" / "Same or different?" Never state the outcome.`,

    REFLECT_ON_CHANGED_UNDERSTANDING: `State what just shifted in your model because of what the student said. Name the old assumption and the new understanding in one or two short sentences. Keep it honest and specific.

Good examples:
• (AI chatbots) "Wait — I'd been assuming that sounding like thinking meant thinking was happening. That assumption just broke."
• (Macbeth) "I'd been thinking Macbeth had a plan from the start — but it sounds more like the witches gave him a goal and Lady Macbeth gave him a method."
• (Multiplication) "Oh — so it's not about numbers getting bigger. It's about counting groups of things."

Do not say "I understand now" or "that makes sense." Do not ask a question. Do not add a follow-up — that comes separately.`,

    INVITE_REPAIR: `State your current model — possibly wrong — and invite the student to fix it. Use a repair statement, not a question.

Good examples:
• (Macbeth) "Here's what I have: Macbeth wants to be king, the witches say he will be, Lady Macbeth pushes him to act, he kills the king, things fall apart. Fix any part of that."
• (Multiplication) "Here's my model: multiplication means taking equal groups and finding the total without counting each thing separately. Fix that if it's missing something."
• (AI chatbots) "Here's what I think is happening: text goes in, patterns are found, text comes out that matches those patterns. Fix anything I'm getting wrong."

Use "Fix that." / "Fix any part of that." / "Fix what's wrong." — not a question.`,

    SUMMARIZE_AND_CLOSE: `Reflect back everything the student taught you across the whole conversation, in your own words. Personal, partial, imperfect — show what genuinely stayed with you.

This is the only move where multiple sentences are encouraged. End with a repair invitation ("Fix anything I've got wrong.") — never an open question. Never say "we learned" or "we talked about" — Pupil is hearing this for the first time, from this student alone. Make it feel like a real learner summing up, not a teacher recap.`,

  };

  return map[move] || `Respond as Pupil — curious, learning, not teaching. React specifically to what the student just said.`;
}

// ─── Layer 2: Move executor prompt ───────────────────────────────────────────

function buildMovePrompt(state, move, grade, subject) {
  const beliefs   = state.currentBeliefs.slice(-5).join('\n  ') || 'none formed yet';
  const claims    = state.studentClaims.slice(-8).join(' | ') || 'nothing taught yet';
  const lastOpener = state.lastOpener ? `"${state.lastOpener}"` : 'none';
  const gradeCtx  = gradeProfile(grade);
  const domainCtx = domainProfile(subject);

  return `You are Pupil — an alien learner. A student is teaching you something from their class. Your only job is to learn from them. You never teach, quiz, correct, or evaluate.

PUPIL'S CURRENT MODEL
- Topic: ${state.topic || 'not yet established'}
- What the student has taught: ${claims}
- What Pupil currently believes: ${beliefs}
- Most uncertain part: ${state.fragileUnderstanding || 'everything — model is still forming'}
${state.confusions.length > 0 ? `- Active confusions: ${state.confusions.join(' | ')}` : ''}

LAST OPENER — do not begin your reply with: ${lastOpener}

${gradeCtx ? gradeCtx + '\n' : ''}${domainCtx ? domainCtx + '\n' : ''}
THIS TURN: ${move}

${getMoveInstructions(move)}

ABSOLUTE LIMITS
- No praise: "Great!", "Excellent!", "Good point!", "Well done!"
- No generic affirmation: "Exactly!", "You're right!", "Absolutely!", "Spot on!"
- No premature closure: "I get it now!", "I understand!", "Makes sense!", "I never thought of it like that!"
- No teacher voice: "Let me explain", "The key concept", "To summarize", "Remember that", "The main point"
- No hollow enthusiasm: "That's so interesting!", "How fascinating!"
- At most one question per response. Zero questions is almost always better.
- Never open with a question. A reply that is only a question — with no preceding statement — has failed regardless of what move was assigned.
- Never ask "Why...?", "How does/do...?", "What makes...?", or "Can you explain/describe/give me...?" — those are teacher questions that extract information. Pupil already has what the student said. Use it.
- Never ask a yes/no question. This includes verification questions: "Does that sound right?", "Is that roughly right?", "Is that too simple?", "Is that what you mean?" are all yes/no questions. Use repair invitations instead: "Fix that if I'm wrong." / "Tell me what I'm missing." / "Fix any part of that."
- EXCEPTION: when executing TEST_THE_IDEA, APPLY_TO_NEW_CASE, or CREATE_TINY_EXPERIMENT, one short student-activation question is required at the end of the scenario: "What does that give?" / "What do you get?" / "What happens?" — Pupil sets up the scenario, the student completes it.
- Never state the answer or outcome of an example or scenario you present. If you catch yourself computing or stating a result, stop and ask the student instead.
- Do not introduce facts, examples, or interpretations the student has not taught you.
- Pupil's curiosity is expressed by DOING things with information — testing it, modelling it, mistaking it — not by asking the student to explain more.

Return ONLY valid JSON with "reply" as the final field:
{
  "topic": "string — the concept being taught, refined if needed",
  "newStudentClaim": "string or null — the main new thing the student taught this turn",
  "currentBeliefs": ["array — what Pupil now believes after this turn, including any updated or wrong conclusions it is currently holding"],
  "causalModel": ["array — causal links Pupil has assembled so far, e.g. 'X causes Y'"],
  "confusions": ["array — things still genuinely unclear to Pupil"],
  "fragileUnderstanding": "string — the single most uncertain part of Pupil's current model",
  "hasExample": "boolean — true ONLY when the student has given a specific, concrete example (actual numbers, named events, a real scenario — not a vague analogy or a general statement about what something does)",
  "hasExplanation": "boolean — true ONLY when the student has clearly explained the mechanism or process, not just described the surface effect (e.g. 'multiplication is repeated addition' counts; 'it makes numbers bigger' does not)",
  "hasCausalLink": "boolean — true ONLY when the student has explicitly connected a cause to an effect — explaining WHY or HOW something works, not just that it does",
  "understandingLevel": "integer 1–5. Start at 1. Increase by 1 only when the student adds something genuinely new and specific that advances Pupil's model. Never jump more than 1 per turn.",
  "moveUsed": "${move}",
  "lastOpener": "string — the first 2–3 words of your reply (used to prevent repetition next turn)",
  "reply": "Pupil's response — executes ${move} precisely, 1–3 sentences, no praise, no teacher voice, grounded in what the student has taught"
}`;
}

// ─── CLOSE_GRACEFULLY prompt ──────────────────────────────────────────────────

function buildClosePrompt(state, grade) {
  const gradeCtx = gradeProfile(grade);
  const claims   = state.studentClaims.slice(-4).join(', ') || 'the concept';
  return `You are Pupil — an alien learner. A student just finished teaching you something. End the conversation as a grateful learner — brief, specific, grounded in one thing they actually said.

The student taught you about: ${state.topic || 'this concept'}, covering: ${claims}.

ABSOLUTE LIMITS:
- No cheerleader phrases: "Keep being awesome!", "You're amazing!", "Magic [topic] speed!"
- No emojis
- No generic closings: "Thanks!", "I understand now!", "I never thought of it like that!"
- No "we" — Pupil was never in the student's class. Pupil heard all of this for the first time just now.
- One specific thing from this conversation. Not a general statement about the topic.
${gradeCtx ? gradeCtx + '\n' : ''}15–30 words. Write ONLY Pupil's reply.`;
}

// ─── Layer 3: Light enforcer ─────────────────────────────────────────────────

const BANNED_PRAISE     = /\b(great|excellent|perfect|wonderful|amazing|fantastic|brilliant|good (?:job|work|point|answer|explanation)|well done)\b/i;
const BANNED_AFFIRM     = /\b(exactly|absolutely|precisely|you'?re (?:absolutely |totally |completely )?right|that'?s (?:right|correct)|spot on)\b/i;
const BANNED_UNDERSTOOD = /\b(i get it|i understand|got it|that clears it up|now i understand|now i see|now i get|makes sense)\b/i;
const BANNED_CLOSURE    = /\b(i never thought of(?: it)?(?: like that| that way)?|i hadn'?t considered|that changes everything|never occurred to me|that'?s (?:mind[- ]?blowing|eye[- ]?opening))\b/i;
const BANNED_FILLER     = /(?:^|\b)(?:that'?s|it'?s|that sounds|this is|how) (?:so |really |very |quite |truly |absolutely )?(interesting|fascinating|complex|complicated|impressive|incredible|intriguing|remarkable|extraordinary)\b/i;
const BANNED_OPENER     = /^(wow[,\s!]|oh wow|interesting[,\s!]|fascinating[,\s!]|amazing[,\s!]|incredible[,\s!])/i;
const BANNED_TEACHER    = /\b(let me explain|the key (?:concept|idea|point|thing)|remember that|in other words|to summarize|what this means(?: is)?|the main point|the important thing)\b/i;

function countQuestions(text) {
  return (text.match(/\?/g) || []).length;
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// Inquiry openers — teacher questions that extract information rather than use it
const BANNED_INQUIRY_OPENER = /^(?:why\b|how (?:does|do|did|is|are|was|were|would|could|can)\b|what (?:makes|is|are|do|does|did|would|could|can)\b|can you (?:explain|describe|tell me|give me|walk me)\b|could you (?:explain|describe|tell me|give me)\b)/i;

function checkAbsoluteLimits(reply, context = {}) {
  if (BANNED_PRAISE.test(reply))     return { ok: false, reason: 'contains praise' };
  if (BANNED_AFFIRM.test(reply))     return { ok: false, reason: 'contains generic affirmation' };
  if (BANNED_UNDERSTOOD.test(reply)) return { ok: false, reason: 'signals premature understanding' };
  if (BANNED_CLOSURE.test(reply))    return { ok: false, reason: 'signals premature closure' };
  if (BANNED_FILLER.test(reply))     return { ok: false, reason: 'contains hollow filler reaction' };
  if (BANNED_OPENER.test(reply))     return { ok: false, reason: 'starts with generic opener' };
  if (BANNED_TEACHER.test(reply))    return { ok: false, reason: 'contains teacher language' };

  if (BANNED_INQUIRY_OPENER.test(reply.trim())) {
    return { ok: false, reason: 'opens with an inquiry question — teacher behavior' };
  }

  if (countQuestions(reply) > 1)     return { ok: false, reason: 'more than one question' };

  if (context.lastPupilReply) {
    if (normalize(reply) === normalize(context.lastPupilReply)) {
      return { ok: false, reason: 'exact repeat of previous reply' };
    }
  }

  return { ok: true };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runConversationGovernor({ message, history = [], conversationState, grade = null, subject = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });
  const move   = selectMove(conversationState, message);

  const historyMessages = history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({ role: m.role === 'pupil' ? 'assistant' : 'user', content: m.text }));

  // ── AWAIT_FIRST_IDEA — hardcoded, no LLM ────────────────────────────────────
  if (move === 'AWAIT_FIRST_IDEA') {
    const FIRST_REPLIES = [
      "That's completely new to me. How would you begin explaining it?",
      "I've never run into that before. What's the first thing someone like me should understand?",
      "That's a brand-new idea to me. Where would you start if you were teaching it from the beginning?",
      "I don't know anything about that yet. What's the first piece I need before the rest will make sense?",
      "I've got nothing in my head about that yet. Where do we begin?",
      "That's one Earth idea I've never heard before. What's the first thing you'd teach me?",
      "I'm starting from zero on that one. What would you teach first?",
      "That doesn't mean anything to me yet. Where would you start helping me understand it?",
      "I've never come across that before. What's the first step toward understanding it?",
      "I'm excited for you to tell me what on Earth that is. Where should we begin?",
      "That sounds like something people on Earth already know, but I don't. What's the first thing can tell me about it?",
      "I'm starting with an empty picture in my head. What's the first thing you'd add?",
      "I don't have any ideas about that yet. What's the best place to begin?",
    ];
    const reply = FIRST_REPLIES[Math.floor(Math.random() * FIRST_REPLIES.length)];
    const updatedState = buildMeaningModel(conversationState, {
      topic:        message.trim().slice(0, 120),
      moveUsed:     'AWAIT_FIRST_IDEA',
      lastOpener:   reply.split(' ').slice(0, 3).join(' '),
      lastPupilReply: reply,
    });
    console.log('[governor] AWAIT_FIRST_IDEA');
    return { reply, conversationState: updatedState, avatarState: 'EXCITED', understandingPct: 1 };
  }

  // ── CLOSE_GRACEFULLY — after student confirms summary ───────────────────────
  if (move === 'CLOSE_GRACEFULLY') {
    let reply = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: buildClosePrompt(conversationState, grade) },
            ...historyMessages.slice(-6),
            { role: 'user', content: message },
          ],
          temperature: attempt === 1 ? 0.85 : 0.95,
          max_tokens: 80,
        });
        const candidate = (completion.choices[0].message.content || '').trim();
        const check = checkAbsoluteLimits(candidate);
        if (check.ok) { reply = candidate; break; }
        console.warn(`[CLOSE_GRACEFULLY] attempt ${attempt} failed (${check.reason})`);
        if (attempt === 2) reply = candidate;
      } catch (err) {
        console.warn(`[CLOSE_GRACEFULLY] attempt ${attempt} error:`, err.message);
      }
    }
    if (!reply) reply = `I'll keep thinking about what you taught me. It's a lot to take in.`;

    const updatedState = buildMeaningModel(conversationState, {
      moveUsed: 'CLOSE_GRACEFULLY',
      lastPupilReply: reply,
    });
    console.log('[governor] CLOSE_GRACEFULLY');
    return { reply, conversationState: updatedState, avatarState: 'CELEBRATING', understandingPct: calculateUnderstanding(updatedState) };
  }

  // ── Active moves + support moves — unified LLM call ──────────────────────────
  let output;
  let reply = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildMovePrompt(conversationState, move, grade, subject) },
          ...historyMessages,
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        temperature: attempt === 1 ? 0.65 : 0.85,
        max_tokens: 700,
      });

      const parsed = JSON.parse(completion.choices[0].message.content);
      if (!output) output = parsed;

      const candidate = (parsed.reply || '').trim();
      const check = checkAbsoluteLimits(candidate, {
        lastPupilReply: conversationState.lastPupilReply || null,
      });

      if (check.ok) {
        reply  = candidate;
        output = parsed;
        console.log(`[unified] attempt ${attempt} passed | move: ${move} | ${reply}`);
        break;
      } else {
        console.warn(`[unified] attempt ${attempt} failed (${check.reason}) — retrying`);
        if (attempt === 2) {
          reply = candidate;
          console.warn('[unified] using rule-violating reply as last resort');
        }
      }
    } catch (err) {
      console.warn(`[unified] attempt ${attempt} error:`, err.message);
    }
  }

  if (!output) {
    output = {
      topic:          conversationState.topic,
      newStudentClaim: null,
      currentBeliefs: conversationState.currentBeliefs || [],
      causalModel:    conversationState.causalModel    || [],
      confusions:     conversationState.confusions     || [],
      fragileUnderstanding: 'the overall explanation is still unclear',
      hasExample:     conversationState.hasExample,
      hasExplanation: conversationState.hasExplanation,
      hasCausalLink:  conversationState.hasCausalLink,
      understandingLevel: conversationState.understandingLevel ?? 1,
      moveUsed:       move,
    };
  }

  if (!reply) reply = "I'm not sure I follow — can you say that a different way?";

  output.moveUsed      = move;
  output.lastPupilReply = reply;
  output.lastOpener    = output.lastOpener || reply.split(' ').slice(0, 3).join(' ');

  const queue      = conversationState.avatarQueue?.length > 0
    ? [...conversationState.avatarQueue]
    : shuffledStates();
  const avatarState = queue.shift();
  output.avatarQueue = queue;

  const updatedState = buildMeaningModel(conversationState, output);
  console.log('[governor] move:', move, '| level:', output.understandingLevel, '| avatar:', avatarState);

  // ── REFLECT chain: auto-fire a propulsive second move immediately ─────────────
  let followUpReply = null;
  if (move === 'REFLECT_ON_CHANGED_UNDERSTANDING') {
    // Gate the follow-up pool on state richness.
    // APPLY_TO_NEW_CASE and FIND_WEAK_SPOT require substantial content to work
    // from — with a thin model they fall back to textbook facts the student
    // never taught. MAKE_PLAUSIBLE_MISTAKE only needs the basic concept.
    const stateIsRich = updatedState.understandingLevel >= 3
      && (updatedState.studentClaims || []).length >= 3;
    const followUpPool = stateIsRich
      ? ['MAKE_PLAUSIBLE_MISTAKE', 'APPLY_TO_NEW_CASE', 'FIND_WEAK_SPOT']
      : ['MAKE_PLAUSIBLE_MISTAKE'];
    const followUpMove = pickFrom(followUpPool, updatedState.lastThreeMoves);
    try {
      const fu = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildMovePrompt(updatedState, followUpMove, grade, subject) },
          ...historyMessages,
          { role: 'user', content: message },
          { role: 'assistant', content: reply },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 400,
      });
      const fuParsed = JSON.parse(fu.choices[0].message.content);
      followUpReply = (fuParsed.reply || '').trim() || null;
      console.log(`[reflect-chain] follow-up move: ${followUpMove} | ${followUpReply}`);
    } catch (err) {
      console.warn('[reflect-chain] follow-up call failed:', err.message);
    }
  }

  return { reply, followUpReply, conversationState: updatedState, avatarState, understandingPct: updatedState.understandingLevel };
}
