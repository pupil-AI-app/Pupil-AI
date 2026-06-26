import { generatePupilReply } from './modelService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid message' });
  }

  try {
    const reply = await generatePupilReply({ message });
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Pupil reply error:', err);
    return res.status(500).json({ error: 'Failed to generate reply' });
  }
}
