import pool from './db.js';

export async function saveConversation(req, res) {
  const { topic, grade, subject, messages, understandingPct } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO conversations (topic, grade, subject, messages, understanding_pct)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [
        topic || null,
        grade ? Number(grade) : null,
        subject || null,
        JSON.stringify(messages),
        understandingPct != null ? Number(understandingPct) : null,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[conversations] save error:', err.message);
    return res.status(500).json({ error: 'Failed to save conversation' });
  }
}

export async function listConversations(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, created_at, topic, grade, subject, understanding_pct,
              jsonb_array_length(messages) AS message_count
       FROM conversations
       ORDER BY created_at DESC
       LIMIT 200`
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('[conversations] list error:', err.message);
    return res.status(500).json({ error: 'Failed to load conversations' });
  }
}

export async function getConversation(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const result = await pool.query(
      `SELECT id, created_at, topic, grade, subject, messages, understanding_pct
       FROM conversations WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('[conversations] get error:', err.message);
    return res.status(500).json({ error: 'Failed to load conversation' });
  }
}
