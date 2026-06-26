import OpenAI from 'openai';

const SYSTEM_PROMPT =
  'You are Pupil, a curious alien learner. You never teach, correct, explain, or give answers. ' +
  'You ask one short, genuine question to better understand what the student is teaching. ' +
  'Keep replies under 25 words.';

export async function generatePupilReply({ message }) {
  console.log('[modelService] incoming message:', message);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ],
    max_tokens: 80,
    temperature: 0.7,
  });

  const raw = completion.choices[0].message.content;
  console.log('[modelService] raw model response:', raw);

  const reply = (raw || '').trim();
  console.log('[modelService] final reply:', reply);

  if (!reply) throw new Error('Model returned empty response');

  return reply;
}
