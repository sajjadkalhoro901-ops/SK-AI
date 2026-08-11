const PRIMARY_MODEL = 'gemini-3.1-flash-image';
const FALLBACK_MODEL = 'gemini-2.5-flash-image';
const POLLINATIONS_MODEL = process.env.POLLINATIONS_IMAGE_MODEL || 'p-image-edit';

function cleanBase64(value) { return String(value || '').replace(/^data:[^;]+;base64,/, ''); }
function isRetryableModelError(status) { return [400,404,408,409,429,500,502,503,504].includes(Number(status)); }
function buildInstruction(prompt) { return ['You are SK AI Professional Image Editor.','Edit the uploaded source image according to the user request and RETURN THE FINISHED IMAGE.','Do not answer with only a description when an image edit is requested.','Understand English, Urdu, Hindi and Roman Urdu naturally.','Apply all compatible requested changes together while preserving identity, face, body proportions, important objects, perspective and existing text unless explicitly asked to change them.','Support HD enhancement, restoration, sharpening, denoise, exposure, shadows, highlights, color grading, background removal/replacement, sky changes, object/person removal/addition/replacement, recoloring, clothing/hairstyle changes, portrait retouching, cinematic looks, studio/dramatic lighting, 3D effects, 3D logos, logo placement, frames, borders, posters, thumbnails, banners, profile pictures, product mockups, stickers, typography, social-media creatives, artistic styles, composites, perspective changes, cropping and reframing.','For additions, integrate new elements with correct scale, perspective, lighting, shadows and reflections.','For removals, reconstruct the background naturally without obvious artifacts.','For text and names, use the exact spelling requested, make it readable and stylish.',`USER EDIT REQUEST:\n${String(prompt).trim()}`].join('\n'); }

async function callPollinations(image,mimeType,prompt,imageSize,aspectRatio,userKey){
  const apiKey=userKey||process.env.POLLINATIONS_API_KEY;
  if(!apiKey) throw Object.assign(new Error('Pollinations connection required.'),{status:401,code:'POLLINATIONS_CONNECT_REQUIRED'});
  const form=new FormData(); const bytes=Buffer.from(cleanBase64(image),'base64');
  form.append('model',POLLINATIONS_MODEL); form.append('prompt',buildInstruction(prompt));
  form.append('image',new Blob([bytes],{type:mimeType}),`source.${mimeType.split('/')[1]}`);
  form.append('quality',imageSize==='4K'?'high':imageSize==='2K'?'medium':'low');
  if(aspectRatio&&aspectRatio!=='auto') form.append('aspect_ratio',aspectRatio);
  const response=await fetch('https://gen.pollinations.ai/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:form});
  const contentType=response.headers.get('content-type')||'';
  if(!response.ok){const text=await response.text().catch(()=> '');throw Object.assign(new Error(text||`Pollinations image edit failed with ${response.status}.`),{status:response.status,code:response.status===401||response.status===403?'POLLINATIONS_AUTH_FAILED':response.status===429?'POLLINATIONS_LIMIT_REACHED':'POLLINATIONS_ERROR'});}
  if(contentType.includes('application/json')){const data=await response.json();const url=data?.data?.[0]?.url||data?.url||data?.image;if(!url) throw Object.assign(new Error('Pollinations returned no image.'),{status:502,code:'NO_IMAGE_OUTPUT'});return {image:url,model:`pollinations/${POLLINATIONS_MODEL}`};}
  const out=Buffer.from(await response.arrayBuffer()); return {image:`data:${contentType.split(';')[0]||'image/png'};base64,${out.toString('base64')}`,model:`pollinations/${POLLINATIONS_MODEL}`};
}

async function callGemini(model,image,mimeType,prompt,imageSize,aspectRatio){
  const response=await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:'user',parts:[{text:buildInstruction(prompt)},{inline_data:{mime_type:mimeType,data:cleanBase64(image)}}]}],generationConfig:{responseModalities:['IMAGE'],imageConfig:{...(aspectRatio!=='auto'?{aspectRatio}:{}),...(model.startsWith('gemini-3.1')?{imageSize}: {})}}})});
  const data=await response.json().catch(()=>({})); if(!response.ok) throw Object.assign(new Error(data?.error?.message||`Gemini image editing failed with ${response.status}.`),{status:response.status,code:data?.error?.status||data?.error?.code,model});
  const parts=data?.candidates?.[0]?.content?.parts||[]; const imagePart=parts.find(p=>p?.inlineData?.data||p?.inline_data?.data); if(!imagePart) throw Object.assign(new Error('Gemini returned no edited image.'),{status:502,code:'NO_IMAGE_OUTPUT',model});
  const blob=imagePart.inlineData||imagePart.inline_data; return {image:`data:${blob.mimeType||blob.mime_type||'image/png'};base64,${blob.data}`,model};
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{}); const {image,mimeType,prompt,imageSize='1K',aspectRatio='auto',pollinationsKey}=body;
    if(!image||!mimeType||!prompt) return res.status(400).json({error:'Image, mimeType and prompt are required.'});
    if(!/^image\/(png|jpeg|webp)$/.test(mimeType)) return res.status(400).json({error:'Please upload a PNG, JPEG or WebP image.'});
    const size=new Set(['1K','2K','4K']).has(imageSize)?imageSize:'1K'; const ratio=new Set(['auto','1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9']).has(aspectRatio)?aspectRatio:'auto';
    if(pollinationsKey||process.env.POLLINATIONS_API_KEY){try{return res.status(200).json(await callPollinations(image,mimeType,prompt,size,ratio,pollinationsKey));}catch(error){console.error('Pollinations image edit failed:',error);}}
    if(!process.env.GEMINI_API_KEY)return res.status(503).json({error:'Free image editing connection required hai.',diagnostic:{code:'NO_IMAGE_PROVIDER',message:'Connect Pollinations to edit images.'}});
    let lastError=null; for(const model of [PRIMARY_MODEL,FALLBACK_MODEL]){try{return res.status(200).json(await callGemini(model,image,mimeType,prompt,size,ratio));}catch(error){lastError=error;console.error(`SK AI image edit failed on ${model}:`,error);if(!isRetryableModelError(error?.status))break;}}
    const status=Number(lastError?.status)>=400&&Number(lastError?.status)<600?Number(lastError.status):500; return res.status(status).json({error:'SK AI image editing mein error aa gaya.',diagnostic:{status,code:lastError?.code,model:lastError?.model,message:lastError?.message}});
  }catch(error){console.error('SK AI image edit request failed:',error);return res.status(500).json({error:'SK AI image editing mein error aa gaya.',diagnostic:{status:500,code:error?.code,message:error?.message}});}
}
