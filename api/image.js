const PRIMARY_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const FALLBACK_MODEL = 'gemini-2.5-flash-image';
const POLLINATIONS_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'gptimage';

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
    'Preserve identity, face, body proportions, important objects, realistic materials, perspective and existing text unless explicitly asked to change them.',
    'Support HD enhancement, restoration, sharpening, denoise, exposure, shadows, highlights, color grading, background removal/replacement, sky changes, object/person removal/addition/replacement, recoloring, clothing/hairstyle changes, portrait retouching, cinematic looks, studio/dramatic lighting, 3D effects, 3D logos, logo placement, frames, borders, posters, thumbnails, banners, profile pictures, product mockups, stickers, typography, social-media creatives, artistic styles, composites, perspective changes, cropping and reframing.',
    'For additions, integrate new elements with correct scale, perspective, lighting, shadows and reflections.',
    'For removals, reconstruct the background naturally without obvious artifacts.',
    'For text and names, use the exact spelling requested, make it readable and stylish, and integrate it into the composition.',
    'For Independence Day or celebration requests, create a polished patriotic design while keeping the subject recognizable.',
    'If the user asks for a complete creative transformation, use strong professional design judgment instead of applying a weak filter.',
    `USER EDIT REQUEST:\n${String(prompt).trim()}`
  ].join('\n');
}

async function callPollinations(image, mimeType, prompt, imageSize, aspectRatio) {
  if (!process.env.POLLINATIONS_API_KEY) {
    const error = new Error('POLLINATIONS_API_KEY is not configured.');
    error.status = 503;
    error.code = 'POLLINATIONS_KEY_MISSING';
    throw error;
  }

  const form = new FormData();
  const bytes = Buffer.from(cleanBase64(image), 'base64');
  form.append('model', POLLINATIONS_MODEL);
  form.append('prompt', buildInstruction(prompt));
  form.append('image', new Blob([bytes], { type: mimeType }), `source.${mimeType.split('/')[1]}`);
  form.append('quality', imageSize === '4K' ? 'high' : imageSize === '2K' ? 'medium' : 'low');
  if (aspectRatio && aspectRatio !== 'auto') form.append('aspect_ratio', aspectRatio);

  const response = await fetch('https://gen.pollinations.ai/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}` },
    body: form
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(text || `Pollinations image edit failed with ${response.status}.`);
    error.status = response.status;
    error.code = 'POLLINATIONS_ERROR';
    throw error;
  }

  if (contentType.includes('application/json')) {
    const data = await response.json();
    const url = data?.data?.[0]?.url || data?.url || data?.image;
    if (!url) throw Object.assign(new Error('Pollinations returned no image.'), { status: 502, code: 'NO_IMAGE_OUTPUT' });
    return { image: url, model: `pollinations/${POLLINATIONS_MODEL}` };
  }

  const out = Buffer.from(await response.arrayBuffer());
  const outputMime = contentType.split(';')[0] || 'image/png';
  return { image: `data:${outputMime};base64,${out.toString('base64')}`, model: `pollinations/${POLLINATIONS_MODEL}` };
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
            { inline_data: { mime_type: mimeType, data: cleanBase64(image) } }
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
    throw Object.assign(new Error(text || 'Gemini did not return an edited image.'), { status: 502, code: 'NO_IMAGE_OUTPUT', model });
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
    if (!image || !mimeType || !prompt) return res.status(400).json({ error: 'Image, mimeType and prompt are required.' });
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) return res.status(400).json({ error: 'Please upload a PNG, JPEG or WebP image.' });

    const size = new Set(['1K', '2K', '4K']).has(imageSize) ? imageSize : '2K';
    const ratio = new Set(['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).has(aspectRatio) ? aspectRatio : 'auto';

    // Preferred no-Google-billing path.
    if (process.env.POLLINATIONS_API_KEY) {
      try {
        return res.status(200).json(await callPollinations(image, mimeType, prompt, size, ratio));
      } catch (error) {
        console.error('Pollinations image edit failed:', error);
        // If Gemini is configured too, fall through to it. Otherwise expose a useful setup message.
        if (!process.env.GEMINI_API_KEY) {
          return res.status(Number(error.status) || 502).json({
            error: 'Free image editor is temporarily unavailable.',
            diagnostic: { code: error.code, message: error.message, provider: 'pollinations' }
          });
        }
      }
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'Image editing is not configured yet.',
        diagnostic: { code: 'NO_IMAGE_PROVIDER', message: 'Add POLLINATIONS_API_KEY for the no-Google-billing image editor.' }
      });
    }

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

    const status = Number(lastError?.status) >= 400 && Number(lastError?.status) < 600 ? Number(lastError.status) : 500;
    return res.status(status).json({
      error: 'SK AI could not edit that image right now.',
      diagnostic: { status, code: lastError?.code, model: lastError?.model, message: lastError?.message }
    });
  } catch (error) {
    console.error('SK AI image edit request failed:', error);
    return res.status(500).json({ error: 'SK AI could not edit that image right now.', diagnostic: { status: 500, code: error?.code, message: error?.message } });
  }
}
