import { generatePupilReply } from './modelService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const history = Array.isArray(body.history) ? body.history : [];
  const conversationState = body.conversationState || null;

  console.log('[chat] message:', message, '| history:', history.length, '| state:', conversationState);

  if (!message) {
    return res.status(400).json({ reply: "I didn't catch that — can you try again?" });
  }

  try {
    const { reply, updatedState } = await generatePupilReply({ message, history, conversationState });
    console.log('[chat] reply:', reply, '| updatedState:', updatedState);
    return res.status(200).json({ reply, conversationState: updatedState });
  } catch (err) {
    console.error('[chat] error:', err.message);
    return res.status(500).json({ reply: "I'm having trouble hearing that. Can you try again?" });
  }
}
