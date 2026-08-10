import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'SK AI backend is not configured yet.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    // Send the conversation as plain text instead of replaying assistant/tool
    // response items. This keeps the Responses API input valid across turns.
    const transcript = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => `${m.role === 'assistant' ? 'SK AI' : 'User'}: ${m.content.trim()}`)
      .join('\n\n');

    const input = transcript || 'User: Hello';

    const response = await client.responses.create({
      model: 'gpt-5',
      tools: [{ type: 'web_search' }],
      instructions: [
        'You are SK AI, a helpful personal AI assistant.',
        'Understand and respond naturally in English and Roman Urdu.',
        'Be accurate, practical, concise when appropriate, and explain difficult things clearly.',
        'Use web search when the user asks for current, changing, or externally verifiable information.',
        'Reply with only the answer to the user, without prefixes such as "SK AI:".'
      ].join(' '),
      input,
    });

    return res.status(200).json({ reply: response.output_text || 'I could not generate a response.' });
  } catch (error) {
    console.error('SK AI request failed:', error);

    const status = Number(error?.status) || 500;
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const message = typeof error?.message === 'string' ? error.message : 'Unknown OpenAI API error.';

    return res.status(500).json({
      error: 'SK AI could not process that request right now.',
      diagnostic: { status, code, message },
    });
  }
}
