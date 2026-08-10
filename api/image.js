const MODEL = 'gemini-3.1-flash-image';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });

  try {
    const { image, mimeType, prompt } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!image || !mimeType || !prompt) return res.status(400).json({ error: 'Image, mimeType and prompt are required.' });
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) return res.status(400).json({ error: 'Please upload a PNG, JPEG or WebP image.' });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: `Edit the provided image according to this instruction: ${prompt}. Preserve everything not requested to change. Return the edited image.` },
            { inline_data: { mime_type: mimeType, data: image.replace(/^data:[^;]+;base64,/, '') } }
          ]
        }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Gemini image editing failed.');
      error.status = response.status;
      error.code = data?.error?.status || data?.error?.code;
      throw error;
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p?.inlineData?.data || p?.inline_data?.data);
    const textPart = parts.find(p => p?.text)?.text || '';
    if (!imagePart) return res.status(502).json({ error: textPart || 'Gemini did not return an edited image.' });

    const blob = imagePart.inlineData || imagePart.inline_data;
    const outputMime = blob.mimeType || blob.mime_type || 'image/png';
    return res.status(200).json({ image: `data:${outputMime};base64,${blob.data}`, message: textPart });
  } catch (error) {
    console.error('SK AI image edit failed:', error);
    return res.status(500).json({
      error: 'SK AI could not edit that image right now.',
      diagnostic: { status: Number(error?.status) || 500, code: error?.code, message: error?.message }
    });
  }
}
