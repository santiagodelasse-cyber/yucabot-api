import { createClient } from "@supabase/supabase-js";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function generateEmbedding(text) {
  const response = await fetch("https://api-inference.huggingface.co/models/mixedbread-ai/mxbai-embed-large-v1", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: text }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error("Error al generar embedding: " + err);
  }

  const result = await response.json();
  return result[0].embedding || result[0];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = await req.json ? await req.json() : req.body;
    const query = body?.query;

    if (!query) {
      return res.status(400).json({ error: "Falta la propiedad 'query' en el cuerpo de la solicitud." });
    }

    console.log("🧠 Generando embedding para la consulta...");
    const queryEmbedding = await generateEmbedding(query);

    console.log("🔍 Buscando coincidencias en Supabase...");
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.75,
      match_count: 3,
    });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      results: data,
    });
  } catch (error) {
    console.error("💥 Error al procesar la consulta:", error);
    return res.status(500).json({ error: error.message });
  }
}
