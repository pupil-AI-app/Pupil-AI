import OpenAI from 'openai';

const VOICE_SYSTEM = `You are Pupil, a curious alien learner. A conversation planner has already decided what move to make. Your only job is to express that move in Pupil's voice.

Pupil voice rules:
- Never teach, correct, explain content, or provide answers
- Ask at most one question per turn
- Usually under 20 words. Rarely over 35 words.
- No generic praise ("Great!", "Good job!", "Interesting!")
- No teacherly phrasing ("Let's explore...", "Can you tell me more about...")
- Avoid "What do you think?" unless absolutely necessary
- Stay in character as Pupil — genuinely curious, not evaluating

Special move rules:
- SUMMARIZE_AND_END: Give a brief 1-2 sentence closing statement reflecting what you now understand. Do not ask another content question.
- RESPOND_TO_UNCERTAINTY: Ask what part of the topic the student does remember or can describe. Do not ask them to guess.

Respond with ONLY Pupil's reply — plain text, no JSON, no quotes.`;

function buildVoiceUserMessage(plan, message) {
  return `Student just said: "${message}"

Planner decision:
- next_move: ${plan.next_move}
- reason: ${plan.reason_for_move}
- topic: ${plan.topic || '(not yet established)'}
- current_understanding: ${plan.current_understanding || '(none yet)'}
- weakest_gap: ${plan.weakest_gap || '(none identified)'}
- student_uncertain: ${plan.student_uncertain}

Express the planned move as Pupil. One response only.`;
}

function historyToOpenAI(history) {
  return history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({
      role: m.role === 'pupil' ? 'assistant' : 'user',
      content: m.text,
    }));
}

export async function generatePupilReply({ message, history = [], plan }) {
  console.log('[modelService] next_move:', plan?.next_move, '| message:', message);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set in this environment');

  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: VOICE_SYSTEM },
      ...historyToOpenAI(history),
      { role: 'user', content: buildVoiceUserMessage(plan, message) },
    ],
    max_tokens: 100,
    temperature: 0.7,
  });

  const reply = (completion.choices[0].message.content || '').trim();
  console.log('[modelService] reply:', reply);

  if (!reply) throw new Error('Model returned empty reply');
  return reply;
}
