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
    'The uploaded image is the source image. The user instruction below is the exact edit brief.',
    'Perform the requested visual edit and return the finished image. Do not answer with instructions or a text-only description.',
    'Understand natural-language instructions in English, Urdu, Hindi and Roman Urdu.',
    'Apply multiple requested changes together when they do not conflict.',
    'Preserve the identity, face, body proportions, important objects, realistic materials, perspective and existing text unless the user explicitly asks to change them.',
    'Support, when requested: HD enhancement, restoration, sharpening, denoise, exposure, shadows, highlights, color grading, background removal or replacement, sky changes, object/person removal, object/person addition, object replacement, recoloring, clothing changes, hairstyle changes, portrait retouching, skin cleanup, cinematic looks, studio lighting, dramatic lighting, 3D effects, 3D logos, logo creation or placement, frames, borders, posters, thumbnails, banners, profile pictures, product mockups, stickers, typography, social-media creatives, artistic styles, composites, perspective changes, cropping and reframing.',
    'For additions, make the new elements look naturally integrated with correct scale, perspective, lighting, shadows and reflections.',
    'For removals, reconstruct the background naturally and do not leave obvious artifacts.',
    'For text and names, use the exact spelling requested by the user, make it readable and stylish, and integrate it into the composition.',
    'For logos, create clean professional geometry with realistic depth, bevels, reflections and lighting when requested.',
    'For Independence Day or other celebration requests, create an appropriate polished patriotic design while keeping the subject recognizable.',
    'If the user asks for a complete creative transformation, use your own design judgment to make the result polished rather than merely applying a weak filter.',
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
            { text: buildInstruction(prompt) },
            {
              inline_data: {
                mime_type: mimeType,
                data: cleanBase64(image)
              }
            }
          ]
        }],
        generationConfig
      })
    }
  );

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
    const text = parts.map((part) => part?.text).filter(Boolean).join(' ').trim();
    const error = new Error(text || 'Gemini did not return an edited image.');
    error.status = 502;
    error.code = 'NO_IMAGE_OUTPUT';
    error.model = model;
    throw error;
  }

  const blob = imagePart.inlineData || imagePart.inline_data;
  const outputMime = blob.mimeType || blob.mime_type || 'image/png';
  return {
    image: `data:${outputMime};base64,${blob.data}`,
    model
  };
}

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

    const size = new Set(['1K', '2K', '4K']).has(imageSize) ? imageSize : '2K';
    const ratio = new Set(['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).has(aspectRatio)
      ? aspectRatio
      : 'auto';

    const models = [PRIMARY_MODEL];
    if (FALLBACK_MODEL !== PRIMARY_MODEL) models.push(FALLBACK_MODEL);

    let lastError = null;
    for (const model of models) {
      try {
        const result = await callGemini(model, image, mimeType, prompt, size, ratio);
        return res.status(200).json(result);
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
      error: 'SK AI could not edit that image right now.',
      diagnostic: {
        status,
        code: lastError?.code,
        model: lastError?.model,
        message: lastError?.message,
        hint: status === 429
          ? 'Image-model quota is exhausted. Add billing or use a project/key with image quota, then try again.'
          : undefined
      }
    });
  } catch (error) {
    console.error('SK AI image edit request failed:', error);
    return res.status(500).json({
      error: 'SK AI could not edit that image right now.',
      diagnostic: { status: 500, code: error?.code, message: error?.message }
    });
  }
}
