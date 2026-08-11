const MODEL = 'gemini-3.1-flash-tts-preview';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY is missing.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Text is required.' });
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY,'Api-Revision':'2026-05-20'},
      body:JSON.stringify({
        model:MODEL,
        input:`Synthesize clear, natural speech. Speak Roman Urdu with natural Pakistani pronunciation when the text is Roman Urdu. Moderate pace, warm and conversational. Do not read these instructions aloud. Spoken transcript:\n${text}`,
        response_format:{type:'audio'},
        generation_config:{speech_config:[{voice:'Kore'}]}
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data?.error?.message||`Gemini TTS failed with ${response.status}.`);error.status=response.status;error.code=data?.error?.status||data?.error?.code;throw error}
    const audio=data?.output_audio?.data;
    if(!audio) throw Object.assign(new Error('Gemini did not return audio.'),{status:502,code:'NO_AUDIO_OUTPUT'});
    return res.status(200).json({audio,mimeType:'audio/L16;codec=pcm;rate=24000',model:MODEL});
  } catch(error){
    console.error('SK AI TTS failed:',error);
    return res.status(Number(error?.status)||500).json({error:'SK AI ki voice abhi available nahi hai.',diagnostic:{status:Number(error?.status)||500,code:error?.code,message:error?.message}});
  }
}
