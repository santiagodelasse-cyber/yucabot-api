import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { query, sessionId } = req.body;

    console.log("🧠 Generando embedding...");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });

    const embedding = embeddingResponse.data[0].embedding;
    console.log("✅ Embedding generado:", embedding.length, "dimensiones");

    console.log("🔍 Buscando coincidencias en Supabase...");
    const { data: matches, error: matchError } = await supabase.rpc(
      "match_documents",
      {
        query_embedding: embedding,
        match_threshold: 0.7,
        match_count: 4,
      }
    );

    if (matchError) throw matchError;

    const contextText = matches
      .map((m) => m.content)
      .join("\n\n")
      .slice(0, 5000);

    console.log("🤖 Generando respuesta contextual...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres YucaBot, un asistente de inteligencia artificial especializado en estudios de fitness, bienestar y gestión de clientes. 
          Responde de forma clara, empática y profesional, en español latinoamericano.`,
        },
        {
          role: "user",
          content: `Basado en esta información contextual:\n${contextText}\n\nPregunta del usuario: ${query}`,
        },
      ],
      temperature: 0.4,
    });

    const answer = completion.choices[0].message.content;

    // Guardar en Supabase (historial de sesión)
    await supabase.from("chat_memory").insert({
      session_id: sessionId || "default",
      question: query,
      answer,
      created_at: new Date(),
    });

    return res.status(200).json({ success: true, answer, sources: matches });
  } catch (error) {
    console.error("💥 Error al procesar la consulta:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
