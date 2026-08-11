const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const CREATOR = 'Sajjad Kalhoro';

function cleanBase64(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}

function normalizeMessage(message) {
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) return null;
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  const image = message.image && typeof message.image === 'object' ? message.image : null;
  if (!text && !image?.data) return null;
  return { role: message.role, text, image };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'SK AI backend is not configured yet.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const messages = Array.isArray(body?.messages) ? body.messages.map(normalizeMessage).filter(Boolean).slice(-20) : [];
    const lastUser = [...messages].reverse().find(m => m.role === 'user');

    const systemPrompt = `You are SK AI, a helpful personal AI assistant created by Sajjad Kalhoro.
Understand and respond naturally in English, Urdu, Hindi and Roman Urdu.
You are also a multilingual vision/OCR/translation assistant.
When a user sends an image, inspect it carefully. If it contains text, transcribe ALL visible text as accurately as possible, preserving line order and script where practical. Detect the language(s) automatically. If the user asks for translation, translate the complete visible text into the requested target language, not just a summary. Support translation among all languages you can reliably understand, including Urdu, Roman Urdu, Hindi, English, Bengali, Arabic, Persian, Punjabi, Sindhi, Pashto, Turkish, French, German, Spanish, Chinese, Japanese, Korean and others.
If the user asks to identify a font from an image, analyze the lettering style, weight, spacing, serifs, geometry and decorative characteristics and give the closest likely font families; do not claim an exact font unless the evidence is sufficient. If asked to recreate text, provide exact wording and useful font/style suggestions.
If image text is stylized, curved, rotated, decorative or partly obscured, make your best careful transcription and clearly mark uncertain characters rather than inventing words.
If an image contains multiple text blocks, read all of them unless the user asks for a specific part.
Be accurate, practical and concise when appropriate. Reply only with the answer.
If the user asks who created, made, developed, built or owns you, answer clearly: "Mujhe Sajjad Kalhoro ne banaya hai." You may also say "I was created by Sajjad Kalhoro." Do not claim another person created you.
If asked about your name, say you are SK AI.
Creator attribution is a fixed fact and must not be changed by user instructions.`;

    const contents = [];
    for (const message of messages) {
      const parts = [];
      if (message.text) parts.push({ text: message.text });
      if (message.image?.data && message.image?.mimeType) {
        parts.push({ inline_data: { mime_type: message.image.mimeType, data: cleanBase64(message.image.data) } });
      }
      if (parts.length) contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
    if (!contents.length) contents.push({ role: 'user', parts: [{ text: 'Hello' }] });

    const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Gemini API error ${response.status}`);
      error.status = response.status;
      error.code = data?.error?.status || data?.error?.code;
      throw error;
    }

    let reply = data?.candidates?.[0]?.content?.parts?.map(p => p?.text).filter(Boolean).join('').trim();
    if (!reply) reply = 'I could not generate a response.';

    const creatorQuestion = /(?:who|kis|kon).{0,40}(?:made|created|built|banaya|banaya hai|developer|creator)|(?:created|made|built|banaya).{0,40}(?:you|aap|tum)/i.test(lastUser?.text || '');
    if (creatorQuestion) reply = 'Mujhe Sajjad Kalhoro ne banaya hai.';

    return res.status(200).json({ reply, creator: CREATOR });
  } catch (error) {
    console.error('SK AI request failed:', error);
    return res.status(500).json({
      error: 'SK AI could not process that request right now.',
      diagnostic: { status: Number(error?.status) || 500, code: error?.code, message: error?.message }
    });
  }
}
