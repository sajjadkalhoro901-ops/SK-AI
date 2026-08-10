const MODEL = 'gemini-3.1-flash-tts-preview';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Text is required.' });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `[natural, warm Pakistani Urdu/English voice, clear pronunciation, moderate pace] ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Gemini TTS failed.');
      error.status = response.status;
      error.code = data?.error?.status || data?.error?.code;
      throw error;
    }

    const audio = data?.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data || p?.inline_data?.data);
    const blob = audio?.inlineData || audio?.inline_data;
    if (!blob?.data) return res.status(502).json({ error: 'Gemini did not return audio.' });
    return res.status(200).json({ audio: blob.data, mimeType: 'audio/pcm;rate=24000' });
  } catch (error) {
    console.error('SK AI TTS failed:', error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    return res.status(status).json({ error: 'SK AI could not generate speech right now.', diagnostic: { status, code: error?.code, message: error?.message } });
  }
}
