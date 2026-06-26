import { generatePupilReply } from './modelService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  console.log('[chat] received message:', message);

  if (!message) {
    return res.status(400).json({ error: 'Missing or invalid message' });
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
