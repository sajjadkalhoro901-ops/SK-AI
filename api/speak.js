const MODELS = [
  process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts'
];

const VOICES = {
  male: process.env.GEMINI_MALE_VOICE || 'Fenrir',
  female: process.env.GEMINI_FEMALE_VOICE || 'Aoede'
};

function makePrompt(text) {
  return [
    'You are the voice of SK AI.',
    'Speak naturally and clearly for a Pakistani listener.',
    'If the text is Urdu, speak fluent Pakistani Urdu.',
    'If the text is Roman Urdu, interpret the Latin spelling as Pakistani Urdu and pronounce the words as Urdu, NOT as English letters.',
    'For mixed Roman Urdu and English, switch naturally between Pakistani Urdu pronunciation and normal English pronunciation.',
    'Use a warm, friendly, human conversational tone.',
    'Use a moderate pace, clear pronunciation, natural pauses, and no robotic spelling-out.',
    'Do not add, remove, translate, or explain anything. Speak only the supplied response.',
    `RESPONSE TO SPEAK:\n${text}`
  ].join('\n');
}

async function generate(model, text, voiceName) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: makePrompt(text) }]
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
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

  const part = data?.candidates?.[0]?.content?.parts?.find(
    p => p?.inlineData?.data || p?.inline_data?.data
  );
  const blob = part?.inlineData || part?.inline_data;
  if (!blob?.data) {
    const error = new Error('Gemini did not return audio.');
    error.status = 502;
    error.code = 'NO_AUDIO_OUTPUT';
    error.model = model;
    throw error;
  }

  return {
    audio: blob.data,
    mimeType: blob.mimeType || blob.mime_type || 'audio/L16;codec=pcm;rate=24000',
    model,
    voice: voiceName
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Text is required.' });

    const requested = String(body?.voice || 'female').toLowerCase();
    const voiceName = requested === 'male' ? VOICES.male : VOICES.female;

    let lastError = null;
    for (const model of [...new Set(MODELS.filter(Boolean))]) {
      try {
        return res.status(200).json(await generate(model, text, voiceName));
      } catch (error) {
        lastError = error;
        console.error(`SK AI TTS failed on ${model} (${voiceName}):`, error);
        if (![400, 404, 408, 409, 429, 500, 502, 503, 504].includes(Number(error?.status))) break;
      }
    }

    const status = Number(lastError?.status) >= 400 && Number(lastError?.status) < 600
      ? Number(lastError.status)
      : 500;
    return res.status(status).json({
      error: 'SK AI ki voice abhi available nahi hai.',
      diagnostic: {
        status,
        code: lastError?.code,
        model: lastError?.model,
        voice: voiceName,
        message: lastError?.message
      }
    });
  } catch (error) {
    console.error('SK AI TTS failed:', error);
    return res.status(500).json({
      error: 'SK AI voice mein error aa gaya.',
      diagnostic: { status: 500, code: error?.code, message: error?.message }
    });
  }
}