const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'SK AI backend is not configured yet.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const transcript = messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-20).map(m => `${m.role === 'assistant' ? 'SK AI' : 'User'}: ${m.content.trim()}`).join('\n\n');
    const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        systemInstruction:{parts:[{text:'You are SK AI, a helpful personal AI assistant. Understand and respond naturally in English, Urdu, Hindi and Roman Urdu. Be accurate, practical and concise when appropriate. Reply only with the answer.'}]},
        contents:[{role:'user',parts:[{text:transcript || 'User: Hello'}]}]
      })
    });
    const data = await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data?.error?.message||`Gemini API error ${response.status}`);error.status=response.status;error.code=data?.error?.status||data?.error?.code;throw error}
    const reply=data?.candidates?.[0]?.content?.parts?.map(p=>p?.text).filter(Boolean).join('').trim();
    return res.status(200).json({reply:reply||'I could not generate a response.'});
  } catch(error){
    console.error('SK AI request failed:',error);
    return res.status(500).json({error:'SK AI could not process that request right now.',diagnostic:{status:Number(error?.status)||500,code:error?.code,message:error?.message}});
  }
}
