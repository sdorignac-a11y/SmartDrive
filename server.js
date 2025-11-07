// server.js
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
   TOOLS (para /api/chat con Responses API)
   ========================================================= */
async function geoCity(name) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=es&format=json`);
  const j = await r.json();
  if (!j?.results?.length) throw new Error('Ciudad no encontrada');
  const c = j.results[0];
  return { name: c.name, country: c.country, lat: c.latitude, lon: c.longitude, timezone: c.timezone };
}
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
   INTENT PARSER (se mantiene)
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
app.post('/api/intent', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });
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
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(content);
    res.json({ intent: parsed.intent ?? 'unknown', slots: parsed.slots ?? {}, reply: parsed.reply ?? 'Listo.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ intent: 'unknown', slots: {}, reply: 'Hubo un error.' });
  }
});

/* =========================================================
   CHAT con Responses API + TOOLS (responde de todo)
   ========================================================= */
const ASSISTANT_SYSTEM = `
Eres SmartDrive, asistente de voz para conducción y vida diaria.
- Responde breve (máx. 2 oraciones) en español rioplatense neutro.
- Usá tools para datos en tiempo real (clima, hora, cálculo).
- Si una tool falla, devolvé igual una respuesta útil.
- Evitá URLs y listas largas.
`;
const toolsSpec = [
  { type: 'function', function: {
      name: 'getWeather',
      description: 'Clima actual en una ciudad',
      parameters: { type:'object', properties:{ city:{ type:'string' } }, required:['city'] }
  }},
  { type: 'function', function: {
      name: 'getTime',
      description: 'Hora local para una ciudad o zona horaria',
      parameters: { type:'object', properties:{ placeOrTz:{ type:'string' } }, required:['placeOrTz'] }
  }},
  { type: 'function', function: {
      name: 'calc',
      description: 'Calculadora aritmética básica',
      parameters: { type:'object', properties:{ expression:{ type:'string' } }, required:['expression'] }
  }},
];

async function callOpenAI(payload) {
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

app.post('/api/chat', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

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

    // Resolver tool calls (hasta 2 rondas)
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
   PROXIES anti-CORS para el frontend (geo, revgeo, clima, hora)
   ========================================================= */

// /api/geo?name=Tokyo
app.get('/api/geo', async (req, res) => {
  try {
    const name = (req.query.name || '').toString();
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=es&format=json`);
    const j = await r.json();
    if (!j?.results?.length) return res.status(404).json({ error: 'Ciudad no encontrada' });
    const c = j.results[0];
    res.json({ name: c.name, country: c.country, lat: c.latitude, lon: c.longitude, timezone: c.timezone });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'geo failed' });
  }
});

// /api/revgeo?lat=-34.6&lon=-58.4
app.get('/api/revgeo', async (req, res) => {
  try {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Missing lat/lon' });
    const u = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=es`;
    const r = await fetch(u); const j = await r.json(); const p = j?.results?.[0];
    const label = p ? `${p.name}${p.admin1? ', '+p.admin1:''}` : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    res.json({ label });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'revgeo failed' });
  }
});

// /api/weather?lat=-34.6&lon=-58.4
app.get('/api/weather', async (req, res) => {
  try {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'Missing lat/lon' });
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
    const r = await fetch(url); const j = await r.json();
    const cw = j?.current_weather || j?.current || {};
    const code = cw.weathercode ?? cw.weather_code;
    let cond = 'Despejado';
    if([1,2,3].includes(code)) cond='Parcialmente nublado';
    if([45,48].includes(code)) cond='Niebla';
    if([51,53,55,56,57].includes(code)) cond='Llovizna';
    if([61,63,65,66,67,80,81,82].includes(code)) cond='Lluvia';
    if([71,73,75,77,85,86].includes(code)) cond='Nieve';
    if([95,96,99].includes(code)) cond='Tormenta';
    res.json({ t: Math.round(cw.temperature ?? cw.temperature_2m ?? 0), cond });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'weather failed' });
  }
});

// /api/time?place=Tokyo   ó   /api/time?tz=Asia/Tokyo
app.get('/api/time', async (req, res) => {
  try {
    const place = (req.query.place || '').toString();
    const tzReq = (req.query.tz || '').toString();
    let tz = tzReq;
    let label = tzReq;

    if (place) {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=es&format=json`);
      const j = await r.json();
      if (j?.results?.length) {
        const c = j.results[0];
        tz = c.timezone; label = `${c.name}${c.country ? ', '+c.country : ''}`;
      }
    }
    if (!tz) tz = 'UTC';
    const s = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false }).format(new Date());
    res.json({ place: label || tz, time: s, tz });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'time failed' });
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
