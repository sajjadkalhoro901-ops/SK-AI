const MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Text is required.' });

    let lastError = null;
    for (const model of MODELS) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Speak naturally in a warm, clear Pakistani Urdu-English voice. Use Roman Urdu pronunciation when the text is Roman Urdu. Moderate pace, clear words, no singing. Text: ${text}` }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
              }
            }
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(data?.error?.message || `Gemini TTS failed with ${response.status}.`);
          error.status = response.status;
          error.code = data?.error?.status || data?.error?.code;
          error.model = model;
          throw error;
        }

        const audio = data?.candidates?.[0]?.content?.parts?.find(
          p => p?.inlineData?.data || p?.inline_data?.data
        );
        const blob = audio?.inlineData || audio?.inline_data;
        if (!blob?.data) {
          const error = new Error('Gemini did not return audio.');
          error.status = 502;
          error.code = 'NO_AUDIO_OUTPUT';
          error.model = model;
          throw error;
        }

        const sourceMime = blob.mimeType || blob.mime_type || 'audio/L16;codec=pcm;rate=24000';
        return res.status(200).json({ audio: blob.data, mimeType: sourceMime, model });
      } catch (error) {
        lastError = error;
        console.error(`SK AI TTS failed on ${model}:`, error);
        if (![400, 404, 408, 409, 429, 500, 502, 503, 504].includes(Number(error?.status))) break;
      }
    }

    const status = Number(lastError?.status) >= 400 && Number(lastError?.status) < 600
      ? Number(lastError.status)
      : 500;
    return res.status(status).json({
      error: 'SK AI ki voice abhi available nahi hai.',
      diagnostic: { status, code: lastError?.code, model: lastError?.model, message: lastError?.message }
    });
  } catch (error) {
    console.error('SK AI TTS failed:', error);
    return res.status(500).json({
      error: 'SK AI could not generate speech right now.',
      diagnostic: { status: 500, code: error?.code, message: error?.message }
    });
  }
}
