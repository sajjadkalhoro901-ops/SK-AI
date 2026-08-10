const MODEL = 'gemini-3.1-flash-image';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { image, mimeType, prompt, imageSize = '2K', aspectRatio = 'auto' } = body;
    if (!image || !mimeType || !prompt) return res.status(400).json({ error: 'Image, mimeType and prompt are required.' });
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) return res.status(400).json({ error: 'Please upload a PNG, JPEG or WebP image.' });

    const size = new Set(['512', '1K', '2K', '4K']).has(imageSize) ? imageSize : '2K';
    const ratio = new Set(['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']).has(aspectRatio) ? aspectRatio : 'auto';
    const instruction = [
      'You are SK AI Professional Image Editor.',
      'Edit the uploaded source image and return the finished edited image.',
      'Preserve identity, important objects, proportions, facial features and existing text unless explicitly asked to change them.',
      'Support HD enhancement, upscaling, lighting, exposure, color grading, contrast, shadows, highlights, denoise, restoration, background replacement/removal, object/person addition/removal/replacement, recoloring, clothing and hairstyle changes, portrait retouching, cinematic looks, 3D effects, 3D logos, logo placement, frames, borders, posters, thumbnails, product mockups, stickers, typography, social-media creatives, artistic styles, composites, perspective changes, cropping and reframing.',
      'Apply all requested edits together when they do not conflict.',
      'For logos/text keep spelling legible and integrate them cleanly with realistic depth, lighting and perspective.',
      'For lighting match light direction, shadows, reflections and scene color for realism.',
      'For frames/posters/layouts keep the main subject unobstructed and make the design polished.',
      `User editing instruction: ${String(prompt).trim()}`
    ].join('\n');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: instruction },
          { inline_data: { mime_type: mimeType, data: image.replace(/^data:[^;]+;base64,/, '') } }
        ] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          responseFormat: { image: { ...(ratio !== 'auto' ? { aspectRatio: ratio } : {}), imageSize: size } }
        }
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
    if (!imagePart) return res.status(502).json({ error: 'Gemini did not return an edited image.' });
    const blob = imagePart.inlineData || imagePart.inline_data;
    const outputMime = blob.mimeType || blob.mime_type || 'image/png';
    return res.status(200).json({ image: `data:${outputMime};base64,${blob.data}` });
  } catch (error) {
    console.error('SK AI image edit failed:', error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    return res.status(status).json({ error: 'SK AI could not edit that image right now.', diagnostic: { status, code: error?.code, message: error?.message } });
  }
}
