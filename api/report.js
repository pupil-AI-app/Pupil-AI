import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages = [], conversationState = {}, grade, subject, sessionDurationMs = 0 } = req.body;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  try {
    const report = await generateTeacherReport({ messages, conversationState, grade, subject, sessionDurationMs });
    return res.status(200).json(report);
  } catch (err) {
    console.error('[report] error:', err.message);
    return res.status(500).json({ error: 'Report generation failed' });
  }
}

async function generateTeacherReport({ messages, conversationState, grade, subject, sessionDurationMs }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const topic = conversationState?.topic || 'unknown topic';
  const gradeLabel = grade ? `Grade ${grade}` : null;

  const totalSeconds = Math.round(sessionDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const timeSpent = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  const conversationMessages = messages.filter(m => m.role === 'student' || m.role === 'pupil');
  const transcriptForPrompt = conversationMessages
    .map(m => `${m.role === 'student' ? 'STUDENT' : 'PUPIL'}: ${m.text}`)
    .join('\n\n');

  const prompt = `You are an educational assessment specialist generating a teacher report for a "teach-back" session.

CONTEXT:
- Topic the student taught: ${topic}
- Subject: ${subject || 'General'}
- Grade: ${gradeLabel || 'Not specified'}
- Session duration: ${timeSpent}
- Format: The student explained a concept to an AI character ("Pupil") who started knowing nothing about the topic and asked genuine questions throughout.

FULL CONVERSATION TRANSCRIPT:
${transcriptForPrompt}

CONVERSATION SIGNALS:
- Key claims the student made: ${(conversationState?.studentClaims || []).join('; ') || 'none recorded'}
- Gave a concrete example: ${conversationState?.hasExample || false}
- Gave a how/why explanation: ${conversationState?.hasExplanation || false}
- Made a causal connection: ${conversationState?.hasCausalLink || false}
- Final understanding score: ${conversationState?.understandingLevel || 1}/5

TASK:
Analyse the student's explanation of "${topic}" and produce a teacher-facing assessment report. Return ONLY valid JSON matching this exact shape:

{
  "highlights": ["string", "string", "string"],
  "nextSteps": ["string", "string", "string"],
  "annotatedTranscript": [
    {
      "role": "student or pupil",
      "text": "exact message text copied verbatim",
      "annotation": "teacher note for student turns; null for pupil turns",
      "performance": "correct, partial, incorrect, or na"
    }
  ],
  "score": "check-plus, check, or check-minus",
  "scoreRationale": "1–2 sentences"
}

FIELD GUIDELINES:
- highlights: 3 specific, notable points the student made — quote or closely paraphrase their words. Include both strengths and interesting misconceptions if present.
- nextSteps: 3 concrete, actionable suggestions for the teacher. Name the specific gap or strength this student showed. Indicate whether the student was right, partially right, or wrong on each point.
- annotatedTranscript: include EVERY message from the conversation in order. For STUDENT turns: one-sentence diagnostic annotation (factual, teacher-facing — what was accurate, inaccurate, or incomplete). For PUPIL turns: annotation = null, performance = "na".
- score: check-plus = thorough, mostly accurate, highly engaged; check = adequate with some gaps or vagueness; check-minus = significant gaps, clear inaccuracies, or very limited engagement.
- scoreRationale: justify the score, touching on thoroughness, accuracy, and engagement.

Respond with only valid JSON. No markdown, no code fences, no commentary.`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const report = JSON.parse(raw);

  return {
    ...report,
    topic,
    subject: subject || 'General',
    grade: gradeLabel,
    timeSpent,
    generatedAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  };
}
