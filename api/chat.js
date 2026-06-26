import { runConversationGovernor, initialConversationState } from './conversationEngine.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const history = Array.isArray(body.history) ? body.history : [];
  const conversationState =
    body.conversationState && typeof body.conversationState === 'object'
      ? body.conversationState
      : initialConversationState();

  console.log('[chat] message:', message, '| history turns:', history.length);

  if (!message) {
    return res.status(400).json({ reply: "I didn't catch that — can you try again?" });
  }

  try {
    const { reply, conversationState: updatedState } = await runConversationGovernor({
      message,
      history,
      conversationState,
    });
    return res.status(200).json({ reply, conversationState: updatedState });
  } catch (err) {
    console.error('[chat] error:', err.message);
    return res.status(500).json({ reply: "I'm having trouble hearing that. Can you try again?" });
  }
}
