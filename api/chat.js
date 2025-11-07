// /api/chat.js  (Vercel Serverless Function - Node runtime)
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const system = `
Eres un asistente de voz para conductor: responde BREVE (máx. 2 oraciones),
claro, en español rioplatense neutro y SIN listas. Si hay datos que cambian
("precio dólar", "precio nafta", "noticias"), aclara "dato aproximado" o
"puede haber cambiado". Si piden pasos largos, resume. Evita URLs.
    `;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5',
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text }
        ]
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(500).json({ reply: 'No pude responder ahora.', _err: errText });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || 'Listo.';

    // (CORS abierto por si lo necesitás desde otro dominio)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: 'No pude responder ahora.' });
  }
}
