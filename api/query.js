import { createClient } from "@supabase/supabase-js";

// === CONFIGURACIÓN ===
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// === CORS ===
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// === EMBEDDING ===
async function generateEmbedding(text) {
  if (!text || text.trim() === "") throw new Error("Texto vacío para embedding.");

  if (HF_API_KEY) {
    const model = "mixedbread-ai/mxbai-embed-large-v1";
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: text.slice(0, 8000),
        options: { wait_for_model: true },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Error HuggingFace (${response.status}): ${err}`);
    }

    const data = await response.json();
    if (Array.isArray(data) && Array.isArray(data[0])) return data[0];
    if (Array.isArray(data)) return data;
    throw new Error("Respuesta inválida de HuggingFace.");
  }

  if (OPENAI_API_KEY) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    const data = await response.json();
    return data.data[0].embedding;
  }

  throw new Error("No hay API Key configurada para embeddings.");
}

// === RESPUESTA GENERATIVA ===
async function generateAnswer(context, question) {
  const prompt = `
Eres YucaBot, un asistente virtual para estudios de fitness, yoga y bienestar.
Usa el siguiente contexto (extraído de documentos reales) para responder de forma cálida y profesional.

Contexto:
${context}

Pregunta:
${question}

Responde en español con claridad y precisión.
`;

  if (OPENAI_API_KEY) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "No encontré una respuesta relevante.";
  }

  if (HF_API_KEY) {
    const model = "mistralai/Mixtral-8x7B-Instruct-v0.1";
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 300, temperature: 0.7 },
      }),
    });
    const data = await response.json();
    return (
      data[0]?.generated_text?.split("Respuesta:")[1]?.trim() ||
      "No encontré una respuesta relevante."
    );
  }

  throw new Error("No hay API Key configurada para generación de texto.");
}

// === HANDLER ===
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  console.log("🧠 Nueva consulta recibida");

  try {
    const { query } = req.body;
    if (!query || query.trim() === "") throw new Error("Consulta vacía.");

    const queryEmbedding = await generateEmbedding(query);

    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.75,
      match_count: 5,
    });

    if (error) throw error;

    const context = matches?.map((m) => m.content).join("\n\n").slice(0, 4000);
    const answer = await generateAnswer(context, query);

    res.status(200).json({
      success: true,
      answer,
      sources: matches?.map((m) => m.id) || [],
    });
  } catch (err) {
    console.error("💥 Error en query:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
