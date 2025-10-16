import { createClient } from "@supabase/supabase-js";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Generar embedding robusto desde Hugging Face
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

  // ⚙️ Formato flexible: detectar vector válido sin importar estructura
  let embedding = null;

  if (Array.isArray(result)) {
    // Caso 1: [{ embedding: [ ... ] }]
    if (result[0]?.embedding && Array.isArray(result[0].embedding)) {
      embedding = result[0].embedding;
    }
    // Caso 2: [ [ ... ] ]
    else if (Array.isArray(result[0])) {
      embedding = result[0];
    }
    // Caso 3: [number, number, number...]
    else if (typeof result[0] === "number") {
      embedding = result;
    }
  } else if (Array.isArray(result.embedding)) {
    // Caso 4: { embedding: [ ... ] }
    embedding = result.embedding;
  }

  if (!embedding || !Array.isArray(embedding)) {
    console.error("❌ Resultado inesperado de Hugging Face:", result);
    throw new Error("No se pudo extraer un embedding válido del resultado de Hugging Face.");
  }

  console.log(`✅ Embedding generado con ${embedding.length} dimensiones.`);
  return embedding;
}

// ✅ Generar respuesta natural tipo ChatGPT
async function generateAnswer(context, question) {
  const prompt = `
  Eres YucaBot, un asistente especializado en fitness boutique (Pilates, Yoga, Barre, Functional Training).
  Usa la siguiente información del documento para responder en español.
  Si no encuentras la respuesta exacta, di: "No encontré esa información en los documentos."

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
