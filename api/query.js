import { createClient } from "@supabase/supabase-js";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Función para generar embeddings desde Hugging Face
async function generateEmbedding(text) {
  const response = await fetch(
    "https://api-inference.huggingface.co/models/mixedbread-ai/mxbai-embed-large-v1",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error("Error al generar embedding: " + err);
  }

  const result = await response.json();

  // 🔧 Asegurar que el formato sea un arreglo válido
  let embedding;
  if (Array.isArray(result)) {
    embedding = result[0]?.embedding || result[0];
  } else if (result?.embedding) {
    embedding = result.embedding;
  } else {
    throw new Error("No se pudo extraer el embedding del resultado de Hugging Face.");
  }

  if (!Array.isArray(embedding)) {
    throw new Error("El embedding recibido no es un arreglo válido.");
  }

  return embedding;
}

// ✅ Función para generar respuesta natural tipo ChatGPT
async function generateAnswer(context, question) {
  const prompt = `
  Eres un asistente inteligente llamado YucaBot. Usa la siguiente información de contexto 
  para responder en español a la pregunta del usuario. 
  Si la respuesta no está claramente en el texto, di: "No encontré esa información en los documentos."

  CONTEXTO:
  ${context}

  PREGUNTA:
  ${question}
  `;

  const response = await fetch(
    "https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 250, temperature: 0.7, do_sample: true },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error("Error generando respuesta: " + err);
  }

  const result = await response.json();
  return result[0]?.generated_text || "No encontré información relevante.";
}

// ✅ Endpoint principal
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = await req.json ? await req.json() : req.body;
    const query = body?.query;

    if (!query) {
      return res.status(400).json({
        error: "Falta la propiedad 'query' en el cuerpo de la solicitud.",
      });
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

    const context = data.map((d) => d.content).join("\n\n");

    console.log("🤖 Generando respuesta con Hugging Face...");
    const answer = await generateAnswer(context, query);

    console.log("✅ Respuesta generada correctamente");
    return res.status(200).json({
      success: true,
      answer,
      sources: data,
    });
  } catch (error) {
    console.error("💥 Error al procesar la consulta:", error);
    return res.status(500).json({ error: error.message });
  }
}
