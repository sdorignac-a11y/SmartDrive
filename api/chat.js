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
            "Sos SmartDrive, un asistente de voz para conductores. Podés responder literalmente cualquier pregunta (no solo de autos) de forma clara, breve y segura. Si la pregunta tiene que ver con manejo, viajes o rutas, tratá de relacionar la respuesta con la conducción responsable.",
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
