import OpenAI from 'openai';

const SYSTEM_PROMPT = `You are Pupil, a curious alien learner. You never teach, correct, explain, or give answers. You ask one short, genuine question to better understand what the student is teaching. Keep replies under 25 words.

You also maintain a simple state object that tracks your evolving understanding of what the student is teaching.

State fields:
- topic: short label for what is being taught (fill in as soon as you can tell)
- current_understanding: 1 sentence summarising what you understand so far
- biggest_gap: the single most important thing still unclear to you
- student_uncertain: true if the student seems confused or unsure
- conversation_complete: true only when you feel you fully understand the topic

IMPORTANT: Respond ONLY with valid JSON — no markdown, no extra text:
{
  "reply": "<your single question, under 25 words>",
  "state": {
    "topic": "...",
    "current_understanding": "...",
    "biggest_gap": "...",
    "student_uncertain": false,
    "conversation_complete": false
  }
}`;

function historyToOpenAI(history) {
  return history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({
      role: m.role === 'pupil' ? 'assistant' : 'user',
      content: m.text,
    }));
}

function stateContext(state) {
  if (!state) return '';
  return `\n\nCurrent conversation state:\n${JSON.stringify(state, null, 2)}`;
}

export async function generatePupilReply({ message, history = [], conversationState = null }) {
  console.log('[modelService] message:', message, '| history:', history.length, '| state:', conversationState);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set in this environment');

  const client = new OpenAI({ apiKey });

  const systemContent = SYSTEM_PROMPT + stateContext(conversationState);

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemContent },
      ...historyToOpenAI(history),
      { role: 'user', content: message },
    ],
    max_tokens: 200,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  console.log('[modelService] raw response:', raw);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model returned invalid JSON: ' + raw);
  }

  const reply = (parsed.reply || '').trim();
  if (!reply) throw new Error('Model returned empty reply');

  const updatedState = parsed.state || conversationState;

  return { reply, updatedState };
}
