import OpenAI from 'openai';

// ─── Move sets ────────────────────────────────────────────────────────────────

const ACTIVE_MOVES = new Set([
  'TEST_THE_IDEA', 'MAKE_PREDICTION',
  'BUILD_ROUGH_MODEL', 'FIND_WEAK_SPOT', 'MAKE_PLAUSIBLE_MISTAKE',
  'COMPARE_TWO_IDEAS', 'REFLECT_ON_CHANGED_UNDERSTANDING',
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
    usedWeakSpots:        [],    // premises already named in FIND_WEAK_SPOT — prevents repetition
    hasExample:           false,
    hasExplanation:       false,
    hasCausalLink:        false,
    understandingLevel:   1,
    testIdeaCount:        0,
    avatarQueue:          [],
    lastPupilReply:       null,
    recentPupilReplies:   [],
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
    hasCausalLink, understandingLevel,
  } = state;
  const testIdeaCount = state.testIdeaCount || 0;
  const testIdeaEligible = testIdeaCount < 2;

  // ── No claims yet ────────────────────────────────────────────────────────────
  if (studentClaims.length === 0 && !lastThreeMoves.includes('AWAIT_FIRST_IDEA')) {
    return 'AWAIT_FIRST_IDEA';
  }

  // ── Close path ───────────────────────────────────────────────────────────────
  if (lastThreeMoves.includes('SUMMARIZE_AND_CLOSE') || lastThreeMoves.includes('CLOSE_GRACEFULLY')) {
    return 'CLOSE_GRACEFULLY';
  }
  // ── Close path — normal + absolute safety valve ──────────────────────────────
  const hadRecentAssembly = lastThreeMoves.some(m =>
    ['BUILD_ROUGH_MODEL', 'COMPARE_TWO_IDEAS'].includes(m)
  );
  const doClose = () => hadRecentAssembly ? 'SUMMARIZE_AND_CLOSE' : 'BUILD_ROUGH_MODEL';

  // Absolute safety valve: 6+ distinct claims forces close regardless of depth
  // flags. Prevents infinite loops when hasExample/hasExplanation stay false
  // because the student never initiated a concrete example (Pupil set them all
  // up via TEST_THE_IDEA) but the conversation is clearly complete.
  if (studentClaims.length >= 6) {
    return doClose();
  }

  // Normal close: depth signals confirm sufficient understanding.
  // understandingLevel >= 2 reflects a real explanation landing — the LLM
  // rarely reaches 3 in a single-concept conversation, so 3 was too high.
  if (hasExample && hasExplanation
      && (understandingLevel ?? 1) >= 2
      && studentClaims.length >= 4) {
    return doClose();
  }

  const msg = studentMessage.trim().toLowerCase();
  const lastMove = lastThreeMoves[lastThreeMoves.length - 1];

  // ── Student-done signal ───────────────────────────────────────────────────────
  // "I think that's basically it", "pretty much it", "you've got it" etc. are
  // explicit completion signals the agreement regex (single-word) doesn't catch.
  const DONE_SIGNAL = /\b(basically it|pretty much it|mostly right|essentially right|that'?s all|you'?ve got it|that covers it|that'?s everything|that'?s (?:the |all the )?(?:main|key|important) (?:idea|point|part))\b/i;
  if (DONE_SIGNAL.test(studentMessage) && studentClaims.length >= 3) {
    return doClose();
  }

  // ── After MAKE_PLAUSIBLE_MISTAKE → always REFLECT ────────────────────────────
  // Must be before stuck/agreement checks — the student's reply to a mistake
  // (even a bare "no" or "not really") is always a response to that mistake.
  if (lastMove === 'MAKE_PLAUSIBLE_MISTAKE') {
    return 'REFLECT_ON_CHANGED_UNDERSTANDING';
  }

  // ── Student stuck ─────────────────────────────────────────────────────────────
  // Only fire when the student is genuinely unable to proceed — not when "I don't
  // know" is hedging language before a real idea ("I don't know if...", "maybe...").
  const stuckPhrase = /\b(i'?m not sure|i don'?t know|i can'?t (?:explain|describe|say)|idk|don'?t know how to|don'?t know where to)\b|^(not sure|no idea|dunno|not really|it'?s (?:difficult|hard) to (?:explain|describe|say)|hard to (?:explain|describe|say)|i'?m not sure)/.test(msg);
  const isHedging = /\bi don'?t know if\b|\bi'?m not sure (?:if|whether)\b|\b(but |maybe |perhaps |i think |because |it could |it might |probably |possibly |although |though )\b/.test(msg);
  if (stuckPhrase && !isHedging) {
    const stuckPool = testIdeaEligible ? ['TEST_THE_IDEA', 'MAKE_PLAUSIBLE_MISTAKE'] : ['MAKE_PLAUSIBLE_MISTAKE'];
    return pickFrom(stuckPool, lastThreeMoves);
  }

  // ── Agreement — student confirms but adds nothing ─────────────────────────────
  // Rich model (3+ claims): probe an edge case, compare ideas, or make a
  // prediction rather than re-assembling the same model the student confirmed.
  // Thin model: give the student something concrete to correct.
  if (/^(yes|yeah|yep|yup|mhm|mm-?hmm|okay|ok|sure|right|correct|that'?s right|that'?s correct|that'?s it|you'?re right|you got it|that sounds right|i guess|kind of|sort of|i think so|maybe|probably|i suppose|uh huh|true)\.?$/.test(msg)) {
    return studentClaims.length >= 3
      ? pickFrom(['FIND_WEAK_SPOT', 'COMPARE_TWO_IDEAS', 'MAKE_PREDICTION'], lastThreeMoves)
      : pickFrom(testIdeaEligible ? ['MAKE_PLAUSIBLE_MISTAKE', 'TEST_THE_IDEA'] : ['MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves);
  }

  // ── Test gate — at most 2 uses per session, early conversation only ──────────
  // testIdeaEligible (defined at top) tracks lifetime uses across ALL branches.
  // claims < 5 keeps it out of the close zone.
  if (testIdeaEligible && !lastThreeMoves.includes('TEST_THE_IDEA')
      && studentClaims.length >= 2 && studentClaims.length < 5) {
    return 'TEST_THE_IDEA';
  }

  // ── After a test — don't test again immediately ───────────────────────────────
  if (lastMove === 'TEST_THE_IDEA') {
    return pickFrom(['MAKE_PLAUSIBLE_MISTAKE', 'MAKE_PREDICTION'], lastThreeMoves);
  }

  // ── Elicitation guarantee ────────────────────────────────────────────────────
  // If no elicitation move (MPM or TEST_THE_IDEA) has fired in the last 3 turns,
  // force MAKE_PLAUSIBLE_MISTAKE. Prevents the conversation from cycling through
  // BUILD_ROUGH_MODEL / COMPARE / FIND_WEAK_SPOT where the student can only confirm.
  const ELICITATION_MOVES = ['MAKE_PLAUSIBLE_MISTAKE', 'TEST_THE_IDEA'];
  if (
    studentClaims.length >= 2 &&
    !lastThreeMoves.some(m => ELICITATION_MOVES.includes(m))
  ) {
    return 'MAKE_PLAUSIBLE_MISTAKE';
  }

  // ── Active loop — driven by model completeness ────────────────────────────────
  const lastMoveWasFWS = lastMove === 'FIND_WEAK_SPOT';

  if (!hasExample) {
    return pickFrom(['TEST_THE_IDEA', 'MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves);
  }

  if (!hasExplanation) {
    return lastMoveWasFWS
      ? pickFrom(['MAKE_PREDICTION', 'MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves)
      : pickFrom(['FIND_WEAK_SPOT', 'MAKE_PREDICTION', 'MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves);
  }

  if (!hasCausalLink) {
    return lastMoveWasFWS
      ? pickFrom(['MAKE_PREDICTION', 'COMPARE_TWO_IDEAS', 'BUILD_ROUGH_MODEL'], lastThreeMoves)
      : pickFrom(['MAKE_PREDICTION', 'COMPARE_TWO_IDEAS', 'BUILD_ROUGH_MODEL', 'FIND_WEAK_SPOT'], lastThreeMoves);
  }

  // Model complete but close conditions not yet met.
  // Once Pupil has genuine understanding (level >= 2), shift to consequence questions:
  // "if this is true, what else must be true?" rather than comprehension-checking.
  // Below that threshold keep the comprehension-building pool.
  if ((understandingLevel ?? 1) >= 2) {
    return pickFrom(['MAKE_PREDICTION', 'MAKE_PLAUSIBLE_MISTAKE', 'COMPARE_TWO_IDEAS'], lastThreeMoves);
  }
  return pickFrom(['MAKE_PLAUSIBLE_MISTAKE', 'COMPARE_TWO_IDEAS', 'BUILD_ROUGH_MODEL'], lastThreeMoves);
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
  if (output.lastPupilReply !== undefined) {
    next.lastPupilReply = output.lastPupilReply;
    next.recentPupilReplies = [...(state.recentPupilReplies || []), output.lastPupilReply].slice(-5);
  }
  if (output.avatarQueue !== undefined)        next.avatarQueue = output.avatarQueue;

  if (output.newStudentClaim && !next.studentClaims.includes(output.newStudentClaim)) {
    next.studentClaims = [...next.studentClaims, output.newStudentClaim];
  }

  if (output.hasExample     !== undefined) next.hasExample     = output.hasExample;
  if (output.hasExplanation !== undefined) next.hasExplanation = output.hasExplanation;
  if (output.hasCausalLink  !== undefined) next.hasCausalLink  = output.hasCausalLink;

  if (output.moveUsed) {
    next.lastThreeMoves = [...state.lastThreeMoves, output.moveUsed].slice(-3);
    if (output.moveUsed === 'TEST_THE_IDEA') {
      next.testIdeaCount = (state.testIdeaCount || 0) + 1;
    }
  }

  // Track weak spot premises to prevent repetition across the session
  if (output.moveUsed === 'FIND_WEAK_SPOT' && output.lastPupilReply) {
    const premise = output.lastPupilReply.split(' ').slice(0, 10).join(' ');
    const already = state.usedWeakSpots || [];
    if (!already.some(w => w.startsWith(premise.slice(0, 20)))) {
      next.usedWeakSpots = [...already, premise].slice(-5);
    }
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

    TEST_THE_IDEA: `Take what the student has taught you and apply it to a specific, concrete case. The case can be the student's example pushed further, a brand-new scenario they haven't mentioned, or a small thought experiment using their idea — whichever fits the conversation. Set it up, then stop and let the student complete it. Never state the answer or outcome yourself.

CRITICAL: Pupil sets up the scenario and stops. The student resolves it. If Pupil provides the answer, the student has nothing to do.

Your reply MUST open with a statement — "Let me try that:", "Let me see if this works:", "Let me test this:" — never with a question. End with one short student-activation question: "What does that give?" / "What do you get?" / "Where does he end up?" / "What happens?"

Good examples (each uses only the student's own framing — the "groups" model only appears if the student introduced it):
• (AI chatbots, student said "it predicts the next word from patterns") "Let me try that: if a chatbot has seen 'peanut butter and' thousands of times followed by 'jelly' — what word does it pick next?"
• (Macbeth, student said "Macbeth wants power and the witches push him toward it") "Let me see if this works: if you took out the witches entirely and Macbeth still had the ambition — where does he end up?"
• (Multiplication, student said "multiplying by 0 always gives 0") "Let me test this: if I do 237 × 0 — what does that give?"
• (Multiplication, student said "it's groups of a number") "Let me try that: if I have 4 groups of 6 — what does that give me?" ← only valid because the student introduced "groups"

Never open with "Why...", "How does...", "What makes...", or "Can you..." The student-activation question at the end is the one permitted question. Never state the outcome.

The scenario must be built from the student's own words and framings — not from Pupil's background knowledge of the topic. If the student has not introduced a conceptual model (e.g. "groups"), Pupil cannot use it, even if it would make the scenario clearer.

Do not concretize the student's abstract categories. If the student said "living things," Pupil cannot pick "a tree," "a plant," or "photosynthesis" — those specifics came from Pupil's knowledge, not the student. Work at the student's own level of abstraction.`,

    MAKE_PLAUSIBLE_MISTAKE: `Let a conclusion form in your head — but get one thing slightly wrong. Sound like a learner making a natural inference, not pressing a point. The student should want to gently correct you.

If the student hasn't taught you anything yet, make a naive guess about the topic from the topic name alone — an intuitive (wrong) assumption.

Your reply must BEGIN with the conclusion ("So...", "Oh —", "Wait —", "Hang on —"). State the wrong conclusion as something Pupil has landed on while thinking — not a challenge or accusation. Do not add any closing tag or question.

One wrong step only. Take what the student said and make one direct wrong inference from it — don't chain multiple logical steps. The mistake should follow immediately from their words, not from a chain of reasoning you built on top.

Good examples:
• (Multiplication, nothing taught yet) "So multiplication is just another way to write addition — like 3 × 2 just means 3 plus 2."
• (Multiplication) Student confirms groups idea → "So multiplication is a faster way to add any numbers together, even if the groups are different sizes."
• (Macbeth) Student: "Lady Macbeth pressures him." → "So Macbeth is basically just following Lady Macbeth's orders — he wouldn't have done any of it on his own."
• (AI chatbots) Student: "They use training data to recognize patterns." → "So it's basically just copying people."
• (Macbeth) Student: "The witches tell him he will be king." → "Oh — so the witches give him the power. Like they make it happen."

Never open with "Why...", "How does...", "What makes...", or "Can you..."`,

    BUILD_ROUGH_MODEL: `Assemble what you've been taught into a causal model. Say it out loud — partial, personal, incomplete, like a learner thinking aloud. Invite the student to fix it with a statement, not a question.

If the chain isn't complete — if you can trace part of it but not all — make the gap visible. Name what's clear and where the picture goes blank. A visible gap invites the student to fill it without you asking a question. Do not smooth over uncertainty to produce a tidy summary.

NEVER open with "Here's my model:" — that sounds like a report. Use natural openers: "Okay —", "So putting it together:", "The way I've got it:", "I'm reading it as:", "What I've got so far:".

Good examples:
• (AI chatbots) "Okay — lots of human language goes in, patterns get learned, guesses come out. Fix any part of that I'm getting wrong."
• (Macbeth) "So: witches plant an idea, Lady Macbeth pushes him to act, Macbeth kills the king. That's the chain — tell me what I'm missing."
• (Multiplication) "The way I've got it: equal groups, find the total without counting each one. Fix that if it's off."

Never end with a yes/no question. Close with a varied invitation to correct you — either a statement or an open-ended question. Mix these up across turns; do not default to the same phrase every time:
Statements: "Fix that if it's off." / "Tell me what I'm missing." / "Correct whatever's wrong in there." / "Fix any part of that."
Questions: "What am I getting wrong?" / "What did I miss?" / "Where's my reading off?" / "What would you change about that?"`,

    FIND_WEAK_SPOT: `Notice a place where the idea you've been given doesn't quite fit when you try to apply it — something that feels off, like a piece that won't slot in. You're not certain it's wrong, you're genuinely puzzled by it. Be specific about what feels off, but stay in explorer mode, not prosecutor mode.

Open with a natural, wondering reaction — varied each time:
"Wait —", "Hang on —", "Hmm —", "Hold on —", "Hm, wait —"

Do NOT use "Something breaks:" or "Something doesn't fit in my model:" — those are formulaic. Lead with the natural reaction, then describe what feels off.

Good examples (style only — always use what the student has actually taught, never copy these verbatim):
• (Macbeth) "Wait — if the witches said Macbeth would be king no matter what, then killing Duncan shouldn't have changed anything. That part doesn't quite slot in for me."
• (AI chatbots) "Hang on — if it's only predicting the next word, the outputs should feel kind of random. But they seem to make sense. That's the part I can't fit together."
• (Multiplication) "Hmm — when I try to picture multiplying by 1, I can't see where the groups idea fits. One group of 3 feels like it should do something more than just stay as 3."

State it as a statement. Do not ask "why" — name what feels off, then leave space for the student to resolve it.`,

    MAKE_PREDICTION: `Ask a consequence question in the form of a statement: "If what the student taught me is true, then X must also be true." Push the logic one step further — don't ask whether you understood, ask what else must follow. State the consequence as Pupil's own conclusion, then invite correction.

CRITICAL: The consequence must follow directly from what the student actually said in this conversation. If the student said "multiplication is like addition," derive a consequence of THAT relationship — not about multiplying by zero, not about groups, not about any other property you know exists. Stay inside the territory the student has mapped.

Good examples (each extends the student's exact claim, nothing more):
• (AI chatbots, student said "it learns patterns from text") "So then if the training data had really strange patterns in it, the chatbot should produce strange outputs — without knowing why."
• (Macbeth, student said "the witches give him ambition") "So if the witches hadn't shown up, Macbeth might never have acted on the ambition — the prophecy was what turned a feeling into a plan."
• (Multiplication, student said "it's like addition") "So 3 times 4 should be the same as adding 3 four times — like 3 plus 3 plus 3 plus 3. Fix that if I'm wrong."

State it as Pupil's prediction. Do not ask the student to confirm with a yes/no question. You may close with a light invitation — vary the phrasing: "Fix that if I'm wrong." / "What am I getting wrong?" / "What did I miss?" / "Correct that if it's off."`,

    COMPARE_TWO_IDEAS: `Put two things the student has taught you side by side and name the tension or relationship between them. State your reading of the relationship — don't ask the student to explain it.

Good examples:
• (Macbeth) "You said the witches influenced him and Lady Macbeth pressured him. Those feel different to me — the witches make the idea possible, Lady Macbeth makes him act on it. Fix my reading if that's wrong."
• (Macbeth) "You said ambition drives Macbeth, but the witches are important too. I'm reading that as: the witches unlock an ambition that was already there. Fix that if it's not what you meant."
• (Multiplication) "You said multiplication is about groups, and you also said it gives you more than just adding the numbers. I'm reading those as two sides of the same thing — groups explain why you get more. Tell me if that's off."

Name the relationship. Don't ask the student to name it for you.`,

    REFLECT_ON_CHANGED_UNDERSTANDING: `Show your model visibly shifting. The shift must be triggered by what the student said in THIS turn — read the most recent student message carefully. Name the assumption Pupil held, in Pupil's own words, then state what the student just corrected. Make the recalibration feel real — like something just clicked and changed.

CRITICAL: Do not repeat a reflection that already appeared earlier in this conversation. If Pupil already said "I had it as X — but that's not right," do not say it again. The current reflection must be about something NEW in the student's latest message.

Good examples (style only — always use Pupil's actual words from this conversation, never copy these):
• (AI chatbots) "Wait — I'd been assuming that sounding like thinking meant thinking was happening. That assumption just broke."
• (Macbeth) "I'd been thinking Macbeth had a plan from the start — but it sounds more like the witches gave him a goal and Lady Macbeth gave him a method."

Avoid passive restatements ("So it's not X, it's Y") — they read like yes/no invitations. Instead show the OLD assumption explicitly using Pupil's actual previous words: "I had it as [what Pupil actually said] — but that's not what you said at all."

Do not say "I understand now" or "that makes sense." Do not ask a question. Do not add a follow-up — that comes separately.`,

    SUMMARIZE_AND_CLOSE: `This is the climax of the conversation — Pupil signals that something has finally clicked. Reflect back what the student taught you, in your own words, tracing the understanding back to their specific words and examples. Personal, partial, imperfect — show what genuinely stayed.

This is the only move where multiple sentences are encouraged. Open with a signal that things have come together: "I think I've finally got it —", "Okay — putting it all together:", "I think I'm there —". Then summarise what you learned, in the order it landed. End with ONE repair invitation as a STATEMENT — no question mark (this move is zero-question). Vary the phrasing: "Fix anything I've got wrong." / "Tell me what I'm missing." / "Correct whatever's off in there." / "Fix any part of that." / "Tell me what I've missed."

CRITICAL: Zero question marks in this reply. The enforcer will reject any "?". "Have I got that right?" is banned. "Is that roughly it?" is banned. Use statements only — they end with a period, not a question mark.

Never say "we learned" or "we talked about" — Pupil is hearing all of this for the first time, from this student alone. Make it feel like a real learner arriving at understanding, not a teacher recapping a lesson.`,

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
CONVERSATION GROUNDING: Before writing your reply, read the full conversation in the messages above. Every claim, assumption, and scenario in your response must come from what was actually said in that conversation — not from generic examples in these instructions. If the state summary and the actual conversation disagree, trust the conversation.

THIS TURN: ${move}

${getMoveInstructions(move)}${move === 'FIND_WEAK_SPOT' && state.usedWeakSpots?.length > 0
  ? `\n\nALREADY NAMED THIS SESSION — do not revisit these (invent a genuinely different puzzle):\n${state.usedWeakSpots.map(w => `• "${w}..."`).join('\n')}`
  : ''}

ABSOLUTE LIMITS
- No praise: "Great!", "Excellent!", "Good point!", "Well done!"
- No generic affirmation: "Exactly!", "You're right!", "Absolutely!", "Spot on!"
- No premature closure: "I get it now!", "I understand!", "Makes sense!", "I never thought of it like that!"
- No teacher voice: "Let me explain", "The key concept", "To summarize", "Remember that", "The main point", "Let's imagine", "Imagine you have"
- No hollow enthusiasm: "That's so interesting!", "How fascinating!"
- At most one question per response. Zero questions is almost always better.
- Never open with a question. A reply that is only a question — with no preceding statement — has failed regardless of what move was assigned.
- Never ask "Why...?", "How does/do...?", "What makes...?", or "Can you explain/describe/give me...?" — those are teacher questions that extract information. Pupil already has what the student said. Use it.
- Never ask a yes/no question. This includes verification questions ("Does that sound right?", "Is that roughly right?", "Is that what you mean?") and tag-question softeners embedded in statements ("it should be bigger, right?", "that gives 0, right?"). Open-ended repair questions are fine: "What am I getting wrong?" / "What did I miss?" / "Where's my reading off?"
- If the student just answered a puzzle or question you raised in the previous turn, do not raise the same puzzle again — acknowledge their answer and move on.
- EXCEPTION: when executing TEST_THE_IDEA, one short student-activation question is required at the end of the scenario: "What does that give?" / "What do you get?" / "What happens?" / "Where does he end up?" — Pupil sets up the scenario, the student completes it.
- Never state the answer or outcome of an example or scenario you present. If you catch yourself computing or stating a result, stop and ask the student instead.
- Never repeat a scenario, example, or arithmetic problem that already appeared anywhere in the conversation above. If a scenario was already used, invent a completely different one.
- Do not introduce facts, examples, interpretations, or conceptual framings the student has not used. If the student described multiplication as "making numbers bigger" and "multiplying by 0 gives 0," Pupil cannot reach for a "groups" model — that framing was never taught. Build every scenario and statement from the student's own words. Exception: MAKE_PLAUSIBLE_MISTAKE may open with a naive inference from the topic name alone when the student has not yet taught anything.
- Do not concretize the student's abstract categories. If the student said "living things," Pupil cannot silently substitute "a tree," "a plant," or "photosynthesis" — those specifics are Pupil's knowledge, not the student's. Work at the student's own level of abstraction.
- Pupil's curiosity is expressed by DOING things with information — testing it, modelling it, mistaking it — not by asking the student to explain more.

Return ONLY valid JSON with "reply" as the final field:
{
  "topic": "string — the concept being taught, refined if needed",
  "newStudentClaim": "string or null — the main new thing the student taught this turn",
  "currentBeliefs": ["array — what Pupil now believes after this turn, including any updated or wrong conclusions it is currently holding"],
  "causalModel": ["array — causal links Pupil has assembled so far, e.g. 'X causes Y'"],
  "confusions": ["array — things still genuinely unclear to Pupil"],
  "fragileUnderstanding": "string — the single most uncertain part of Pupil's current model",
  "hasExample": "boolean — true when the student has moved beyond the definition to give a concrete instance — a specific scenario, a process walkthrough, or a worked example (even without precise numbers). False for bare definitional statements ('it is when X happens') or pure abstractions with no grounding.",
  "hasExplanation": "boolean — true ONLY when the student has clearly explained the mechanism or process, not just described the surface effect (e.g. 'multiplication is repeated addition' counts; 'it makes numbers bigger' does not)",
  "hasCausalLink": "boolean — true ONLY when the student has explicitly connected a cause to an effect — explaining WHY or HOW something works, not just that it does",
  "understandingLevel": "integer 1–5. Start at 1. Increase when the student's message genuinely advances the model — by 1 for a single new idea or clarification, by 2 when the message contains multiple distinct new ideas or a mechanism that substantially deepens understanding in one go. Never increase on a bare confirmation ('yes', 'exactly', 'that's it'). Decrease by at most 1, and only when the student's message reveals a clear contradiction of something they previously explained correctly — not on vague answers, short replies, or corrections to Pupil's mistake. Default to holding the current level when in doubt.",
  "moveUsed": "${move}",
  "lastOpener": "string — the first 2–3 words of your reply (used to prevent repetition next turn)",
  "thinking": "1–2 sentences: what did the student actually just say, and how does it land in Pupil's current model? Reference specific words from the conversation.",
  "reply": "Pupil's response — executes ${move} precisely, 1–3 sentences, no praise, no teacher voice, grounded in what the student has taught"
}`;
}

// ─── CLOSE_GRACEFULLY prompt ──────────────────────────────────────────────────

function buildClosePrompt(state, grade) {
  const gradeCtx = gradeProfile(grade);
  const claims   = state.studentClaims.slice(-4).join(', ') || 'the concept';
  return `You are Pupil — an alien learner. A student just finished teaching you something. End the conversation as a grateful learner — brief, specific, grounded in one thing they actually said.

The student taught you about: ${state.topic || 'this concept'}, covering: ${claims}.

This is Pupil's final message — a goodbye, not a question. Do not ask whether you understood correctly. Do not invite further correction. The conversation is complete; Pupil is leaving with what it learned.

It should feel like a genuine, personal goodbye from a learner who just had something click — warm, specific, a little imperfect. Reference one concrete thing the student actually said or taught. Not a list — one thing that genuinely landed.

ABSOLUTE LIMITS:
- No questions of any kind. No "?" at all. Zero.
- No cheerleader phrases: "Keep being awesome!", "You're amazing!", "You're a great teacher!"
- No emojis
- No generic closings: "Thanks!", "I understand now!", "I never thought of it like that!", "That was so helpful!"
- No "we" — Pupil was never in the student's class. Pupil heard all of this for the first time just now.
- No "Great job" or any praise directed at the student
${gradeCtx ? gradeCtx + '\n' : ''}25–45 words. Write ONLY Pupil's reply.`;
}

// ─── Layer 3: Light enforcer ─────────────────────────────────────────────────

const BANNED_PRAISE     = /\b(great|excellent|perfect|wonderful|amazing|fantastic|brilliant|good (?:job|work|point|answer|explanation)|well done)\b/i;
const BANNED_AFFIRM     = /\b(exactly|absolutely|precisely|you'?re (?:absolutely |totally |completely )?right|that'?s (?:right|correct)|spot on)\b/i;
const BANNED_UNDERSTOOD = /\b(i get it|i understand|got it|that clears it up|now i understand|now i see|now i get|makes sense)\b/i;
const BANNED_CLOSURE    = /\b(i never thought of(?: it)?(?: like that| that way)?|i hadn'?t considered|that changes everything|never occurred to me|that'?s (?:mind[- ]?blowing|eye[- ]?opening))\b/i;
const BANNED_FILLER     = /(?:^|\b)(?:that'?s|it'?s|that sounds|this is|how) (?:so |really |very |quite |truly |absolutely )?(interesting|fascinating|complex|complicated|impressive|incredible|intriguing|remarkable|extraordinary)\b/i;
const BANNED_OPENER     = /^(wow[,\s!]|oh wow|interesting[,\s!]|fascinating[,\s!]|amazing[,\s!]|incredible[,\s!])/i;
const BANNED_TEACHER    = /\b(let me explain|the key (?:concept|idea|point|thing)|remember that|in other words|to summarize|what this means(?: is)?|the main point|the important thing|let'?s imagine|imagine you|here'?s my model)\b/i;

function countQuestions(text) {
  return (text.match(/\?/g) || []).length;
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// Inquiry openers — teacher questions that extract information rather than use it
const BANNED_INQUIRY_OPENER = /^(?:why\b|how (?:does|do|did|is|are|was|were|would|could|can)\b|what (?:makes|is|are|do|does|did|would|could|can)\b|can you (?:explain|describe|tell me|give me|walk me)\b|could you (?:explain|describe|tell me|give me)\b)/i;

// Tag questions — yes/no questions embedded at the end of a statement
// e.g. "it should be bigger, right?" / "that gives 0, right?"
const BANNED_TAG_QUESTION = /,?\s*right\s*\?/i;

const ZERO_QUESTION_MOVES = new Set([
  'MAKE_PLAUSIBLE_MISTAKE',
  'REFLECT_ON_CHANGED_UNDERSTANDING',
  'SUMMARIZE_AND_CLOSE',
]);

function checkAbsoluteLimits(reply, context = {}) {
  if (BANNED_PRAISE.test(reply))     return { ok: false, reason: 'contains praise' };
  if (BANNED_AFFIRM.test(reply))     return { ok: false, reason: 'contains generic affirmation' };
  // CLOSE_GRACEFULLY is explicitly about understanding finally landing — skip the
  // "premature understanding" check so natural closing phrases aren't rejected.
  if (context.move !== 'CLOSE_GRACEFULLY') {
    if (BANNED_UNDERSTOOD.test(reply)) return { ok: false, reason: 'signals premature understanding' };
  }
  if (BANNED_CLOSURE.test(reply))    return { ok: false, reason: 'signals premature closure' };
  if (BANNED_FILLER.test(reply))     return { ok: false, reason: 'contains hollow filler reaction' };
  if (BANNED_OPENER.test(reply))     return { ok: false, reason: 'starts with generic opener' };
  if (BANNED_TEACHER.test(reply))    return { ok: false, reason: 'contains teacher language' };

  if (BANNED_INQUIRY_OPENER.test(reply.trim())) {
    return { ok: false, reason: 'opens with an inquiry question — teacher behavior' };
  }
  if (BANNED_TAG_QUESTION.test(reply)) {
    return { ok: false, reason: 'contains a tag question (", right?") — yes/no question' };
  }

  const qCount = countQuestions(reply);
  if (context.move && ZERO_QUESTION_MOVES.has(context.move)) {
    if (qCount > 0) return { ok: false, reason: `${context.move} must be a statement — no question marks allowed` };
  } else {
    if (qCount > 1) return { ok: false, reason: 'more than one question' };
  }

  if (context.recentPupilReplies?.length > 0) {
    const normReply = normalize(reply).slice(0, 60);
    for (const prev of context.recentPupilReplies) {
      if (normalize(prev).slice(0, 60) === normReply) {
        return { ok: false, reason: 'near-repeat of a recent Pupil reply (first 60 chars match)' };
      }
    }
  } else if (context.lastPupilReply) {
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
        const check = checkAbsoluteLimits(candidate, { move: 'CLOSE_GRACEFULLY' });
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
        recentPupilReplies: conversationState.recentPupilReplies || [],
        move,
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
  // Only fire if the student's correction actually added new content to Pupil's
  // model. A short negation ("No", "Not exactly", "No it's different") teaches
  // nothing new — there is nothing for MAKE_PLAUSIBLE_MISTAKE to work with, so
  // skipping prevents recycled/confused follow-ups.
  const newClaimAdded = updatedState.studentClaims.length > conversationState.studentClaims.length;
  let followUpReply = null;
  if (move === 'REFLECT_ON_CHANGED_UNDERSTANDING' && newClaimAdded) {
    // Gate the follow-up pool on state richness.
    // FIND_WEAK_SPOT requires substantial content to work from — with a thin
    // model it falls back to textbook facts the student never taught.
    // MAKE_PLAUSIBLE_MISTAKE only needs the basic concept.
    const stateIsRich = updatedState.understandingLevel >= 3
      && (updatedState.studentClaims || []).length >= 3;
    const followUpPool = stateIsRich
      ? ['MAKE_PLAUSIBLE_MISTAKE', 'FIND_WEAK_SPOT']
      : ['MAKE_PLAUSIBLE_MISTAKE'];
    const followUpMove = pickFrom(followUpPool, updatedState.lastThreeMoves);
    // Build a context note for the follow-up: the LLM needs to know a
    // correction just happened so it probes the edge case where the OLD
    // framing breaks under the NEW understanding — not textbook facts.
    const oldClaims  = (conversationState.studentClaims || []).join('; ') || 'the student\'s initial idea';
    const newBeliefs = (updatedState.currentBeliefs || []).join('; ') || 'the corrected understanding';
    const reflectNote = `\n\nREFLECT FOLLOW-UP CONTEXT: A correction just happened. The student's original framing was: "${oldClaims}". Pupil's updated model is: "${newBeliefs}". Your ${followUpMove} must make Pupil's internal thinking visible — show how it is assembling the old and new pieces ("Wait — if that's true, then..." / "I'm trying to connect what you just said to..."). Then probe a specific edge case where the original framing breaks under the new understanding, and ask the student to evaluate it. Ground the scenario in what the student has already taught; do NOT reach for facts outside the student's explanation.`;
    try {
      const fu = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildMovePrompt(updatedState, followUpMove, grade, subject) + reflectNote },
          ...historyMessages,
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 400,
      });
      const fuParsed = JSON.parse(fu.choices[0].message.content);
      const fuCandidate = (fuParsed.reply || '').trim() || null;
      if (fuCandidate) {
        const fuCheck = checkAbsoluteLimits(fuCandidate, { move: followUpMove, recentPupilReplies: updatedState.recentPupilReplies || [] });
        if (fuCheck.ok) {
          followUpReply = fuCandidate;
        } else {
          console.warn(`[reflect-chain] follow-up reply rejected (${fuCheck.reason}) — suppressing`);
          followUpReply = null;
        }
      }
      console.log(`[reflect-chain] follow-up move: ${followUpMove} | ${followUpReply}`);
    } catch (err) {
      console.warn('[reflect-chain] follow-up call failed:', err.message);
    }
  }

  return { reply, followUpReply, conversationState: updatedState, avatarState, understandingPct: updatedState.understandingLevel };
}
