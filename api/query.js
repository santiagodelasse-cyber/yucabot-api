import { createClient } from "@supabase/supabase-js";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// === Embeddings (HF: mxbai-embed-large-v1) ===============================
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

  // Formato flexible para distintas respuestas del endpoint
  let embedding = null;
  if (Array.isArray(result)) {
    if (result[0]?.embedding && Array.isArray(result[0].embedding)) {
      embedding = result[0].embedding;
    } else if (Array.isArray(result[0])) {
      embedding = result[0];
    } else if (typeof result[0] === "number") {
      embedding = result;
    }
  } else if (Array.isArray(result?.embedding)) {
    embedding = result.embedding;
  }

  if (!embedding || !Array.isArray(embedding)) {
    console.error("❌ Resultado inesperado de Hugging Face (embeddings):", result);
    throw new Error("No se pudo extraer un embedding válido del resultado de Hugging Face.");
  }

  console.log(`✅ Embedding generado con ${embedding.length} dimensiones.`);
  return embedding;
}

// === Texto generativo (HF) con fallback ===================================
async function hfGenerate(model, prompt) {
  const resp = await fetch(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 280,
          temperature: 0.6,
          do_sample: true
        }
      }),
    }
  );

  if (!resp.ok) {
    const errTxt = await resp.text();
    throw new Error(`HF ${model} error: ${errTxt}`);
  }

  const data = await resp.json();
  // HuggingFace suele devolver [{ generated_text: "..." }]
  const text = Array.isArray(data) ? (data[0]?.generated_text || "") : (data.generated_text || "");
  if (!text) throw new Error(`HF ${model} devolvió sin texto utilizable`);
  return text;
}

async function generateAnswer(context, question) {
  // Prompt claro y breve en español
  const prompt = `
Eres YucaBot, asistente para estudios fitness (Pilates, Yoga, Barre, Functional Training) en Mérida.
Responde en español, de forma breve y clara, SOLO usando el CONTEXTO.
Si no está en el contexto, responde literalmente: "No encontré esa información en los documentos."

CONTEXTO:
${context}

PREGUNTA:
${question}

RESPUESTA:
`.trim();

  // Modelo principal (gratis y estable)
  const primary = "HuggingFaceH4/zephyr-7b-beta";
  // Fallbacks razonables gratuitos
  const fallbacks = [
    "mistralai/Mistral-7B-Instruct-v0.2",
    "tiiuae/falcon-7b-instruct"
  ];

  // Intenta el principal
  try {
    const out = await hfGenerate(primary, prompt);
    return out;
  } catch (e1) {
    console.warn("⚠️ Primary model failed:", e1.message);
  }

  // Intenta fallbacks en orden
  for (const m of fallbacks) {
    try {
      const out = await hfGenerate(m, prompt);
      return out;
    } catch (e) {
      console.warn(`⚠️ Fallback ${m} failed:`, e.message);
    }
  }

  // Último recurso: respuesta extractiva mínima desde el contexto
  const fallbackPlain =
    "No encontré esa información en los documentos.\n\n" +
    "Fragmentos relevantes:\n" +
    context.slice(0, 600);
  return fallbackPlain;
}

// === Endpoint principal ====================================================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = await (req.json ? req.json() : req.body);
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

    const context = (data || []).map((d) => d.content).join("\n\n");

    console.log("🤖 Generando respuesta con Hugging Face (con fallback)...");
    const answer = await generateAnswer(context || "No hay contexto disponible.", query);

    console.log("✅ Respuesta generada correctamente");
    return res.status(200).json({
      success: true,
      answer,
      sources: data || [],
    });
  } catch (error) {
    console.error("💥 Error al procesar la consulta:", error);
    return res.status(500).json({ error: error.message });
  }
}
