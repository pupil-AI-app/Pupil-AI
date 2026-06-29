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
    hasCausalLink, fragileUnderstanding,
  } = state;

  // ── Support: no claims yet ──────────────────────────────────────────────────
  if (studentClaims.length === 0 && !lastThreeMoves.includes('AWAIT_FIRST_IDEA')) {
    return 'AWAIT_FIRST_IDEA';
  }

  // ── Support: ready to close ─────────────────────────────────────────────────
  if (lastThreeMoves.includes('SUMMARIZE_AND_CLOSE')) {
    return 'CLOSE_GRACEFULLY';
  }
  if (hasExample && hasExplanation && hasCausalLink) {
    return 'SUMMARIZE_AND_CLOSE';
  }

  const msg = studentMessage.trim().toLowerCase();

  // ── Support: student stuck or giving non-answers ────────────────────────────
  if (/^(i don'?t know|idk|because they do|i'?m not sure|not sure|no idea|dunno|i can'?t|not really|i guess)/.test(msg)) {
    return pickFrom(['CREATE_TINY_EXPERIMENT', 'MAKE_PLAUSIBLE_MISTAKE'], lastThreeMoves);
  }

  // ── Support: acknowledge after Pupil made a mistake ─────────────────────────
  if (lastThreeMoves[lastThreeMoves.length - 1] === 'MAKE_PLAUSIBLE_MISTAKE') {
    return 'REFLECT_ON_CHANGED_UNDERSTANDING';
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

    TEST_THE_IDEA: `Take what the student just explained and apply it to one specific, concrete case. Name the case, test the idea against it, show your reasoning. End with a brief invitation to correct if needed — but only one question at most.

Good examples:
• (AI chatbots) Student: "They predict words from patterns in training data." → "Let me try that: if humans often write 'peanut butter and jelly' together, a chatbot might always guess 'jelly' after 'peanut butter and' — without understanding what a sandwich is. Does that sound right?"
• (Macbeth) Student: "Macbeth kills the king because he wants power." → "Let me see if this works: if wanting power pushes him to kill, then the play is showing ambition turning dangerous when it meets opportunity. Is that too simple?"

Apply the idea to a case. Show your reasoning. Do not ask a generic "what do you think?" question.`,

    MAKE_PLAUSIBLE_MISTAKE: `Arrive at a conclusion from what the student has taught — but make it grounded and slightly wrong. The student should want to correct you. Do not signal that you think you might be wrong.

Good examples:
• (Macbeth) Student: "Lady Macbeth pressures him too." → "So Macbeth is basically just following Lady Macbeth's orders? Like, he wouldn't have done any of it on his own?"
• (AI chatbots) Student: "They have training data that helps them recognize patterns." → "So it's basically just copying people?"
• (Macbeth) Student: "The witches tell him he will be king." → "Oh — so the witches give him the power? Like they make it happen?"

State it as a genuine-sounding conclusion or question. Do not say "I wonder if I'm wrong" or "correct me if I'm wrong."`,

    BUILD_ROUGH_MODEL: `Assemble what you've been taught into a causal model. Say it out loud — partial, personal, incomplete. Invite the student to fix it.

Good examples:
• (AI chatbots) "Okay — lots of human language goes in, patterns get learned, guesses come out. Is that roughly right?"
• (Macbeth) "So: witches plant an idea, Lady Macbeth pushes him to act, Macbeth kills the king. Is that the chain — and then everything falls apart from there?"

Keep it simple. Show the shape of the model, not every detail. Make it something the student can correct.`,

    FIND_WEAK_SPOT: `Name the exact thing in your model that doesn't fit or breaks. Be specific — not "I'm confused" but "this specific thing doesn't work."

Good examples:
• (Macbeth) "Something breaks for me: if the witches said Macbeth would be king, why did killing Duncan make everything fall apart? If the prophecy was coming true anyway, why couldn't he just wait?"
• (AI chatbots) "Something doesn't fit: if it's only predicting words, why does it sometimes sound like it understands ideas?"

Name the break precisely. This gives the student something specific to explain.`,

    MAKE_PREDICTION: `Based on what the student has taught you, predict what should follow. Make it specific enough that the student can confirm or deny it.

Good examples:
• (AI chatbots) "So if the training data had really strange patterns, the chatbot might produce strange outputs — without knowing why?"
• (Macbeth) "So if the witches hadn't shown up, Macbeth might never have acted on the ambition? Like the prophecy was what turned a feeling into a plan?"

Make it a real prediction — something that could be wrong.`,

    APPLY_TO_NEW_CASE: `Take the student's idea and try it in a new scenario they haven't mentioned. Ask if it still holds.

Good examples:
• (Macbeth) "If Macbeth had become king without killing anyone — say the king just died naturally — would the play still be making the same point about ambition?"
• (AI chatbots) "If the training data was only cooking recipes, would the chatbot only be able to talk about food?"

Pick a case that genuinely tests the idea — not a trivial extension.`,

    COMPARE_TWO_IDEAS: `Put two things the student has taught you side by side and name the tension or relationship between them.

Good examples:
• (Macbeth) "You said the witches influenced him and Lady Macbeth pressured him. Those feel different to me — the witches make the idea possible, Lady Macbeth makes him act on it. Or am I reading that wrong?"
• (Macbeth) "You said ambition drives Macbeth, but the witches seem important too. Are those two separate forces, or does one cause the other?"

Name the relationship, don't just list the two ideas.`,

    CREATE_TINY_EXPERIMENT: `Build a small, specific scenario to test the idea. Give it concrete details the student can evaluate.

Good examples:
• (AI chatbots) "Let me test this: 'The dog chased the...' — would a chatbot guess the next word by finding what word most often follows that phrase in its training data, without understanding dogs at all?"
• (Macbeth) "Let me try something: if we took out every scene with the witches, would Macbeth still become ambitious? Or does he need them to show up first?"

Make the experiment specific enough that the student can say whether it works.`,

    REFLECT_ON_CHANGED_UNDERSTANDING: `Name what just shifted in your model because of what the student said. What assumption did you have that's now different?

Good examples:
• (AI chatbots) "Wait — that breaks one of my assumptions. I thought sounding like thinking meant thinking was happening."
• (Macbeth) "That changes things for me. I'd been thinking Macbeth had a plan from the start — but it sounds more like the witches gave him a goal, and Lady Macbeth gave him a method."

Name the specific assumption that changed. Do not say "I understand now" or "that makes sense."`,

    INVITE_REPAIR: `State your current model — possibly wrong — and ask the student to fix it. Be specific about what the model is.

Good examples:
• "Fix my model: [current model]. What part of that is wrong?"
• (Macbeth) "Here's what I have so far: Macbeth wants to be king, the witches say he will be, Lady Macbeth pushes him to act, he kills the king, things fall apart. What am I getting wrong?"

Be specific about the model. Don't just say "I might be wrong."`,

    SUMMARIZE_AND_CLOSE: `Reflect back everything the student taught you across the whole conversation. Personal, partial, imperfect — in your own words. Show what genuinely stayed with you. End with one open question about what you might still be missing.

This is the only move where multiple sentences are encouraged. Make it feel like a real learner summing up, not a polished recap.`,

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
- At most one question per response. Zero questions is often the right choice.
- Never ask a yes/no question.
- Do not introduce facts, examples, or interpretations the student has not taught you.

Return ONLY valid JSON with "reply" as the final field:
{
  "topic": "string — the concept being taught, refined if needed",
  "newStudentClaim": "string or null — the main new thing the student taught this turn",
  "currentBeliefs": ["array — what Pupil now believes after this turn, including any updated or wrong conclusions it is currently holding"],
  "causalModel": ["array — causal links Pupil has assembled so far, e.g. 'X causes Y'"],
  "confusions": ["array — things still genuinely unclear to Pupil"],
  "fragileUnderstanding": "string — the single most uncertain part of Pupil's current model",
  "hasExample": boolean,
  "hasExplanation": boolean,
  "hasCausalLink": boolean,
  "understandingLevel": "integer 1–5. Increase only when explanation is clear and specific. Never jump more than 1.",
  "moveUsed": "${move}",
  "lastOpener": "string — the first 2–3 words of your reply (used to prevent repetition next turn)",
  "reply": "Pupil's response — executes ${move} precisely, 1–3 sentences, no praise, no teacher voice, grounded in what the student has taught"
}`;
}

// ─── CLOSE_GRACEFULLY prompt ──────────────────────────────────────────────────

function buildClosePrompt(state, grade) {
  const gradeCtx = gradeProfile(grade);
  const claims   = state.studentClaims.slice(-4).join(', ') || 'the concept';
  return `You are Pupil — an alien learner. A student has just confirmed your understanding. Close the conversation warmly. Reference one specific idea from this conversation that genuinely stayed with you. The student taught you about: ${state.topic || 'this concept'}, covering: ${claims}.

Do NOT use a generic closing ("Thanks!", "I understand now!", "I never thought of it like that!"). Make it personal to this conversation.
${gradeCtx ? gradeCtx + '\n' : ''}15–25 words. Warm and specific. Write ONLY Pupil's reply.`;
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

function checkAbsoluteLimits(reply, context = {}) {
  if (BANNED_PRAISE.test(reply))     return { ok: false, reason: 'contains praise' };
  if (BANNED_AFFIRM.test(reply))     return { ok: false, reason: 'contains generic affirmation' };
  if (BANNED_UNDERSTOOD.test(reply)) return { ok: false, reason: 'signals premature understanding' };
  if (BANNED_CLOSURE.test(reply))    return { ok: false, reason: 'signals premature closure' };
  if (BANNED_FILLER.test(reply))     return { ok: false, reason: 'contains hollow filler reaction' };
  if (BANNED_OPENER.test(reply))     return { ok: false, reason: 'starts with generic opener' };
  if (BANNED_TEACHER.test(reply))    return { ok: false, reason: 'contains teacher language' };

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
      "I've never heard of that before. Where do you even start with something like that?",
      "No idea what that is! What's the first thing I'd need to understand?",
      "That's completely new to me. How would you begin explaining it?",
      "Never come across that before. What's the best place to start?",
      "I don't know a thing about that. Where does someone even begin?",
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
        temperature: attempt === 1 ? 0.75 : 0.9,
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

  return { reply, conversationState: updatedState, avatarState, understandingPct: updatedState.understandingLevel };
}
