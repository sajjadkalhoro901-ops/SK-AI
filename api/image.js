const MODEL = 'gemini-3.1-flash-image';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { image, mimeType, prompt, imageSize = '2K', aspectRatio = 'auto' } = body;

    if (!image || !mimeType || !prompt) {
      return res.status(400).json({ error: 'Image, mimeType and prompt are required.' });
    }
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
      return res.status(400).json({ error: 'Please upload a PNG, JPEG or WebP image.' });
    }

    const allowedSizes = new Set(['512', '1K', '2K', '4K']);
    const size = allowedSizes.has(imageSize) ? imageSize : '2K';
    const allowedRatios = new Set(['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']);
    const ratio = allowedRatios.has(aspectRatio) ? aspectRatio : 'auto';

    const instruction = [
      'You are SK AI Professional Image Editor.',
      'Perform the requested image editing precisely and return the edited image.',
      'Treat the uploaded image as the source image and preserve identity, important objects, proportions, facial features, text, and composition unless the user explicitly asks to change them.',
      'Support the full range of normal creative image-editing tasks: HD enhancement and upscaling, lighting and exposure, color grading, contrast, shadows and highlights, sharpness and cleanup, denoise, restoration, background replacement or removal, object/person addition or removal, object replacement, recoloring, clothing changes, hairstyle changes, skin retouching, portrait enhancement, cinematic looks, 3D effects, 3D logos, logo placement, frames, borders, posters, thumbnails, product mockups, stickers, typography, graphic-design layouts, social-media creatives, artistic styles, composites, perspective changes, cropping and reframing.',
      'If the request contains several edits, apply all of them together unless they conflict.',
      'For an edit such as "make it HD", improve detail and clarity while keeping the original appearance natural; do not invent unnecessary changes.',
      'For logos or text, make them clean, centered, legible, correctly spelled, and visually integrated unless the user specifies otherwise.',
      'For lighting, match light direction, shadows, reflections, skin tones, and scene color so the edit looks realistic.',
      'For 3D effects, create convincing depth, materials, reflections, shadows, bevels, and perspective appropriate to the request.',
      'For frames, borders, posters, or graphic layouts, keep the subject unobstructed and make the design polished.',
      `User editing instruction: ${String(prompt).trim()}`
    ].join('\n');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: instruction },
            { inline_data: { mime_type: mimeType, data: image.replace(/^data:[^;]+;base64,/, '') } }
          ]
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(ratio !== 'auto' || size ? { imageConfig: { ...(ratio !== 'auto' ? { aspectRatio: ratio } : {}), imageSize: size } } : {})
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
