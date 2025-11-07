// server.js (reemplazo completo)
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-5';

/* =========================================================
   Helpers de TOOLS (clima, hora, calc)
   ========================================================= */
// Geocoding por ciudad (Open-Meteo: gratis, sin key)
async function geoCity(name) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=es&format=json`);
  const j = await r.json();
  if (!j?.results?.length) throw new Error('Ciudad no encontrada');
  const c = j.results[0];
  return { name: c.name, country: c.country, lat: c.latitude, lon: c.longitude, timezone: c.timezone };
}
// Clima (Open-Meteo)
async function getWeatherByCoords(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
  const r = await fetch(url); const j = await r.json();
  const cur = j?.current || j?.current_weather || {};
  const t = Math.round(cur.temperature_2m ?? cur.temperature ?? 0);
  const code = cur.weather_code ?? cur.weathercode;
  let cond="Despejado";
  if([1,2,3].includes(code)) cond="Parcialmente nublado";
  if([45,48].includes(code)) cond="Niebla";
  if([51,53,55,56,57].includes(code)) cond="Llovizna";
  if([61,63,65,66,67,80,81,82].includes(code)) cond="Lluvia";
  if([71,73,75,77,85,86].includes(code)) cond="Nieve";
  if([95,96,99].includes(code)) cond="Tormenta";
  return { t, cond };
}
async function tool_getWeather({ city }) {
  const c = await geoCity(city);
  const w = await getWeatherByCoords(c.lat, c.lon);
  return { place: `${c.name}${c.country ? ', '+c.country : ''}`, tempC: w.t, condition: w.cond, source: 'open-meteo.com' };
}
async function tool_getTime({ placeOrTz }) {
  // Intento por ciudad primero; si falla, uso el valor como TZ.
  try {
    const c = await geoCity(placeOrTz);
    const s = new Intl.DateTimeFormat('es-AR', { hour:'2-digit', minute:'2-digit', timeZone: c.timezone, hour12:false }).format(new Date());
    return { place: `${c.name}${c.country ? ', '+c.country : ''}`, time: s, tz: c.timezone };
  } catch {
    const tz = placeOrTz || 'UTC';
    const s = new Intl.DateTimeFormat('es-AR', { hour:'2-digit', minute:'2-digit', timeZone: tz, hour12:false }).format(new Date());
    return { place: tz, time: s, tz };
  }
}
function tool_calc({ expression }) {
  if (!/^[\d+\-*/().\s]+$/.test(expression)) throw new Error('Expresión inválida');
  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${expression})`)();
  if (!isFinite(result)) throw new Error('Resultado no finito');
  return { expression, result };
}

/* =========================================================
   Parser de Intents (lo mantenemos igual)
   ========================================================= */
const SYSTEM_PROMPT = `
Eres un parser de comandos de voz para auto. Devuelves SOLO JSON válido.
Esquema:
{ "intent": "call"|"message"|"music"|"navigate"|"smalltalk"|"unknown",
  "slots": { }, "reply": "string breve y natural en español" }
Reglas:
- "call": slots: { contact?: string, phone?: string }
- "message": slots: { app?: "whatsapp"|"sms", to?: string, body?: string }
- "music": slots: { query?: string, service?: "spotify"|"apple_music" }
- "navigate": slots: { destination?: string }
- "smalltalk": slots: {}
- Si la orden no aplica conduciendo, responde "unknown".
- Nunca incluyas comentarios, SOLO JSON. Idioma: español.
`;
async function gptParse(text) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    })
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(()=> '');
    throw new Error(`OpenAI error ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || '{}';
  try { return JSON.parse(content); }
  catch { return { intent: 'unknown', slots: {}, reply: 'No entendí bien.' }; }
}
app.post('/api/intent', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const parsed = await gptParse(text);
    res.json({ intent: parsed.intent ?? 'unknown', slots: parsed.slots ?? {}, reply: parsed.reply ?? 'Listo.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ intent: 'unknown', slots: {}, reply: 'Hubo un error.' });
  }
});

/* =========================================================
   Chat Q&A con TOOLS (✨ ahora responde de todo)
   ========================================================= */
const ASSISTANT_SYSTEM = `
Eres SmartDrive, asistente de voz para conducción y vida diaria.
- Responde breve (máx. 2 oraciones) y en español rioplatense neutro.
- Usá tools para datos en tiempo real (clima, hora, cálculo, búsqueda si hace falta).
- Si una tool falla, devolvé igual una respuesta útil y ofrecé alternativa.
- Evitá URLs y listas largas. Sé claro y directo.
`;

const toolsSpec = [
  {
    type: 'function',
    function: {
      name: 'getWeather',
      description: 'Clima actual en una ciudad',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'Nombre de la ciudad en cualquier idioma' } },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getTime',
      description: 'Hora local para una ciudad o zona horaria',
      parameters: {
        type: 'object',
        properties: { placeOrTz: { type: 'string', description: 'Ej. "Madrid" o "Europe/Madrid"' } },
        required: ['placeOrTz']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calc',
      description: 'Calculadora aritmética básica (+ - * /, paréntesis)',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'Ej. (2+3)*4/5' } },
        required: ['expression']
      }
    }
  }
  // Si luego querés, podés agregar { type: 'web_search' } si tu backend/proveedor lo soporta.
];

async function callOpenAI(payload) {
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const errText = await r.text().catch(()=> '');
    throw new Error(`OpenAI error ${r.status}: ${errText}`);
  }
  return r.json();
}

app.post('/api/chat', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    // 1) Primer turno con tools habilitadas
    let data = await callOpenAI({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: ASSISTANT_SYSTEM },
        { role: 'user', content: text }
      ],
      tools: toolsSpec,
      tool_choice: 'auto',
      temperature: 0.4
    });

    // 2) Si el modelo pidió tools, resolvemos acá (hasta 2 rondas)
    for (let i = 0; i < 2; i++) {
      const toolCalls = (data.output || []).filter(o => o.type === 'tool_call');
      if (!toolCalls.length) break;

      const toolResults = [];
      for (const call of toolCalls) {
        const { name, arguments: args } = call.tool;
        try {
          let result;
          if (name === 'getWeather') result = await tool_getWeather(args);
          else if (name === 'getTime') result = await tool_getTime(args);
          else if (name === 'calc') result = tool_calc(args);
          else result = { error: 'Tool no implementada' };

          toolResults.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        } catch (e) {
          toolResults.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: e.message }) });
        }
      }

      data = await callOpenAI({
        model: OPENAI_MODEL,
        input: [
          { role: 'system', content: ASSISTANT_SYSTEM },
          { role: 'user', content: text },
          ...(data.output || []).map(o => ({ role: 'assistant', content: o.content || '' })),
          ...toolResults
        ],
        tools: toolsSpec,
        tool_choice: 'auto',
        temperature: 0.4
      });
    }

    const reply =
      (data.output || [])
        .filter(o => o.type === 'message' || o.role === 'assistant')
        .map(o => (o.content?.[0]?.text || o.content || ''))
        .join('\n')
      || data.output_text
      || 'Listo.';

    res.json({ reply: reply.trim() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: 'No pude responder ahora.' });
  }
});

/* =========================================================
   SPA fallback
   ========================================================= */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('SmartDrive backend on :' + PORT));
