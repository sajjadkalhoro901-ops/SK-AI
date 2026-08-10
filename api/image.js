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

    const size = new Set(['512', '1K', '2K', '4K']).has(imageSize) ? imageSize : '2K';
    const ratio = new Set(['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9']).has(aspectRatio)
      ? aspectRatio
      : 'auto';

    const instruction = [
      'You are SK AI Professional Image Editor.',
      'Edit the uploaded source image and return the finished edited image, not a text-only answer.',
      'Treat the user instruction as the actual edit request and apply it to the uploaded image.',
      'Preserve identity, important objects, proportions, facial features and existing text unless the user explicitly asks to change them.',
      'Support HD enhancement, upscaling, lighting, exposure, color grading, contrast, shadows, highlights, denoise, restoration, background replacement/removal, object/person addition/removal/replacement, recoloring, clothing and hairstyle changes, portrait retouching, cinematic looks, 3D effects, 3D logos, logo placement, frames, borders, posters, thumbnails, product mockups, stickers, typography, social-media creatives, artistic styles, composites, perspective changes, cropping and reframing.',
      'Apply all requested edits together when they do not conflict.',
      'When the user asks for a holiday or Independence Day design, create the requested patriotic visual treatment while keeping the person recognizable.',
      'When the user asks to add a name or other text, render the exact spelling clearly in a stylish, polished font and integrate it naturally into the design.',
      'For logos and text, keep spelling legible and integrate them cleanly with realistic depth, lighting and perspective.',
      'For lighting, match light direction, shadows, reflections and scene color for realism.',
      'For frames, posters and layouts, keep the main subject unobstructed and make the design polished.',
      `User editing instruction: ${String(prompt).trim()}`
    ].join('\n');

    // This endpoint uses the generateContent REST API. For this API the image
    // controls belong under generationConfig.imageConfig, not responseFormat.
    const generationConfig = {
      responseModalities: ['IMAGE'],
      imageConfig: {
        imageSize: size,
        ...(ratio !== 'auto' ? { aspectRatio: ratio } : {})
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: instruction },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: image.replace(/^data:[^;]+;base64,/, '')
                }
              }
            ]
          }],
          generationConfig
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Gemini image editing failed.');
      error.status = response.status;
      error.code = data?.error?.status || data?.error?.code;
      throw error;
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data);

    if (!imagePart) {
      const text = parts.map((part) => part?.text).filter(Boolean).join(' ').trim();
      return res.status(502).json({
        error: 'Gemini did not return an edited image.',
        diagnostic: { model: MODEL, text: text || undefined }
      });
    }

    const blob = imagePart.inlineData || imagePart.inline_data;
    const outputMime = blob.mimeType || blob.mime_type || 'image/png';

    return res.status(200).json({
      image: `data:${outputMime};base64,${blob.data}`
    });
  } catch (error) {
    console.error('SK AI image edit failed:', error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600
      ? Number(error.status)
      : 500;

    return res.status(status).json({
      error: 'SK AI could not edit that image right now.',
      diagnostic: {
        status,
        code: error?.code,
        message: error?.message
      }
    });
  }
}
