const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'SK AI backend is not configured yet.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    const transcript = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => `${m.role === 'assistant' ? 'SK AI' : 'User'}: ${m.content.trim()}`)
      .join('\n\n');

    const input = transcript || 'User: Hello';

    const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              'You are SK AI, a helpful personal AI assistant.',
              'Understand and respond naturally in English and Roman Urdu.',
              'Be accurate, practical, concise when appropriate, and explain difficult things clearly.',
              'Use Google Search grounding when the user asks for current, changing, or externally verifiable information.',
              'Reply with only the answer to the user, without prefixes such as "SK AI:".'
            ].join(' ')
          }]
        },
        contents: [{
          role: 'user',
          parts: [{ text: input }]
        }],
        tools: [{ google_search: {} }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || 'Unknown Gemini API error.';
      const code = data?.error?.status || data?.error?.code;
      const error = new Error(message);
      error.status = response.status;
      error.code = code;
      throw error;
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text)
      .filter(Boolean)
      .join('')
      .trim();

    return res.status(200).json({
      reply: reply || 'I could not generate a response.'
    });
  } catch (error) {
    console.error('SK AI request failed:', error);

    const status = Number(error?.status) || 500;
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const message = typeof error?.message === 'string' ? error.message : 'Unknown Gemini API error.';

    return res.status(500).json({
      error: 'SK AI could not process that request right now.',
      diagnostic: { status, code, message },
    });
  }
}
