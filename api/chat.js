import { generatePupilReply } from './modelService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  // Diagnostic: log key presence without exposing value
  const keyPresent = !!process.env.OPENAI_API_KEY;
  const keyPrefix = process.env.OPENAI_API_KEY
    ? process.env.OPENAI_API_KEY.substring(0, 7) + '...'
    : 'NOT SET';
  console.log('[chat] OPENAI_API_KEY present:', keyPresent, '| prefix:', keyPrefix);

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  console.log('[chat] received message:', message);

  if (!message) {
    return res.status(400).json({ reply: "I didn't catch that — can you try again?" });
  }

  try {
    const reply = await generatePupilReply({ message });
    console.log('[chat] sending reply:', reply);
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('[chat] error:', err.message);
    return res.status(500).json({ reply: "I'm having trouble hearing that. Can you try again?" });
  }
}
