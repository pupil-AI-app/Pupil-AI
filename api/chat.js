export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  return res.status(200).json({
    reply: "Oh! I heard you. Soon I'll answer using the real Pupil engine."
  });
}
