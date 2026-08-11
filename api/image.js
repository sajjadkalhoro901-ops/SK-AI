const PRIMARY_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const FALLBACK_MODEL = 'gemini-2.5-flash-image';

function cleanBase64(value) {
  return String(value || '').replace(/^data:[^;]+;base64,/, '');
}

function isRetryableModelError(status) {
  return [400, 404, 408, 409, 429, 500, 502, 503, 504].includes(Number(status));
}

function buildInstruction(prompt) {
  return [
    'You are SK AI Professional Image Editor, an expert multimodal image-editing assistant.',
    'The uploaded image is the source image. Perform the requested visual edit and return the finished image, not a text-only description.',
    'Understand English, Urdu, Hindi and Roman Urdu naturally.',
    'Apply all compatible requested changes together.',
    'Preserve identity, face, body proportions, important objects, perspective and existing text unless explicitly asked to change them.',
    'Support HD enhancement, restoration, sharpening, denoise, exposure, shadows, highlights, color grading, background removal/replacement, sky changes, object/person removal/addition/replacement, recoloring, clothing/hairstyle changes, portrait retouching, cinematic looks, studio/dramatic lighting, 3D effects, 3D logos, logo placement, frames, borders, posters, thumbnails, banners, profile pictures, product mockups, stickers, typography, social-media creatives, artistic styles, composites, perspective changes, cropping and reframing.',
    'For additions, integrate new elements with correct scale, perspective, lighting, shadows and reflections.',
    'For removals, reconstruct the background naturally without obvious artifacts.',
    'For text and names, use the exact spelling requested, make it readable and stylish, and integrate it into the composition.',
    'For Independence Day or celebration requests, create a polished patriotic design while keeping the subject recognizable.',
    `USER EDIT REQUEST:\n${String(prompt).trim()}`
  ].join('\n');
}

async function callGemini(model, image, mimeType, prompt, imageSize, aspectRatio) {
  const isGemini3 = model.startsWith('gemini-3');
  const generationConfig = {
    responseModalities: ['IMAGE'],
    imageConfig: {
      ...(aspectRatio !== 'auto' ? { aspectRatio } : {}),
      ...(isGemini3 ? { imageSize } : {})
    }
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured.');
    error.status = 503;
    error.code = 'NO_GEMINI_API_KEY';
    throw error;
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: buildInstruction(prompt) },
          { inline_data: { mime_type: mimeType, data: cleanBase64(image) } }
        ]
      }],
      generationConfig
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Gemini image editing failed with ${response.status}.`);
    error.status = response.status;
    error.code = data?.error?.status || data?.error?.code;
    error.model = model;
    throw error;
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data);
  if (!imagePart) {
    throw Object.assign(new Error('Gemini did not return an edited image.'), {
      status: 502,
      code: 'NO_IMAGE_OUTPUT',
      model
    });
  }

  const blob = imagePart.inlineData || imagePart.inline_data;
  const outputMime = blob.mimeType || blob.mime_type || 'image/png';
  return { image: `data:${outputMime};base64,${blob.data}`, model };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { image, mimeType, prompt, imageSize = '2K', aspectRatio = 'auto' } = body;

    if (!image || !mimeType || !prompt) {
      return res.status(400).json({ error: 'Image, mimeType and prompt are required.' });
    }
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
      return res.status(400).json({ error: 'Please upload a PNG, JPEG or WebP image.' });
    }

    const size = new Set(['1K', '2K', '4K']).has(imageSize) ? imageSize : '2K';
    const ratio = new Set(['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).has(aspectRatio)
      ? aspectRatio
      : 'auto';

    const models = [PRIMARY_MODEL];
    if (FALLBACK_MODEL !== PRIMARY_MODEL) models.push(FALLBACK_MODEL);

    let lastError = null;
    for (const model of models) {
      try {
        return res.status(200).json(await callGemini(model, image, mimeType, prompt, size, ratio));
      } catch (error) {
        lastError = error;
        console.error(`SK AI image edit failed on ${model}:`, error);
        if (!isRetryableModelError(error?.status)) break;
      }
    }

    const status = Number(lastError?.status) >= 400 && Number(lastError?.status) < 600
      ? Number(lastError.status)
      : 500;

    return res.status(status).json({
      error: 'SK AI image editing temporarily unavailable hai.',
      diagnostic: {
        status,
        code: lastError?.code,
        model: lastError?.model,
        message: lastError?.message
      }
    });
  } catch (error) {
    console.error('SK AI image edit request failed:', error);
    return res.status(500).json({
      error: 'SK AI image editing mein error aa gaya.',
      diagnostic: { status: 500, code: error?.code, message: error?.message }
    });
  }
}
