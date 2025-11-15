// api/chat.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // ⚠️ PONÉ LA KEY EN .env, NO EN EL CÓDIGO
});

export default async function chatHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userMessage = req.body.message || "";

  if (!userMessage.trim()) {
    return res.status(400).json({ reply: "No recibí ningún mensaje." });
  }

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini", // o el modelo que quieras usar
      messages: [
        {
  role: "system",
  content:
    "Sos SmartDrive, un asistente de inteligencia artificial que responde cualquier pregunta de forma clara, directa y sencilla. Respondé en español neutro. No estás obligado a mencionar autos, manejo ni seguridad vial, salvo que la pregunta sea específicamente sobre esos temas.",
},
        { role: "user", content: userMessage },
      ],
    });

    const reply = completion.choices?.[0]?.message?.content || "No tengo respuesta.";

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Error en /api/chat:", error);
    return res
      .status(500)
      .json({ reply: "Ups, hubo un error procesando tu consulta." });
  }
}
