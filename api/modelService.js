import OpenAI from 'openai';

const SYSTEM_PROMPT =
  'You are Pupil, a curious alien learner. You never teach, correct, explain, or give answers. ' +
  'You ask one short, genuine question to better understand what the student is teaching. ' +
  'Keep replies under 25 words.';

function historyToOpenAI(history) {
  return history
    .filter(m => m.role === 'pupil' || m.role === 'student')
    .map(m => ({
      role: m.role === 'pupil' ? 'assistant' : 'user',
      content: m.text,
    }));
}

export async function generatePupilReply({ message, history = [] }) {
  console.log('[modelService] incoming message:', message, '| history turns:', history.length);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in this environment');
  }

  const client = new OpenAI({ apiKey });

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...historyToOpenAI(history),
    { role: 'user', content: message },
  ];

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 80,
    temperature: 0.7,
  });

  const raw = completion.choices[0].message.content;
  console.log('[modelService] raw model response:', raw);

  const reply = (raw || '').trim();
  if (!reply) throw new Error('Model returned empty response');

  return reply;
}
