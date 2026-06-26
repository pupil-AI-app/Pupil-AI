import { analyzeConversation } from './conversationEngine.js';
import { generatePupilReply } from './modelService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const history = Array.isArray(body.history) ? body.history : [];

  console.log('[chat] message:', message, '| history turns:', history.length);

  if (!message) {
    return res.status(400).json({ reply: "I didn't catch that — can you try again?" });
  }

  try {
    const plan = await analyzeConversation({ message, history });
    console.log('[chat] plan:', plan.next_move, '| complete:', plan.conversation_complete);

    const reply = await generatePupilReply({ message, history, plan });
    return res.status(200).json({ reply, plan });
  } catch (err) {
    console.error('[chat] error:', err.message);
    return res.status(500).json({ reply: "I'm having trouble hearing that. Can you try again?" });
  }
}
