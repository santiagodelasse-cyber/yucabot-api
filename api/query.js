// api/query.js
import { createClient } from "@supabase/supabase-js";

// === CORS & Helpers ===
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function ok(res, data) {
  setCORS(res);
  return res.status(200).json(data);
}
function err(res, message = "Internal server error") {
  setCORS(res);
  console.error("❌", message);
  return res.status(500).json({ success: false, error: message });
}

// === Configuración Supabase ===
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// === Generar embedding en Hugging Face ===
async function generateEmbedding(queryText) {
  const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY;
  if (!HF_API_KEY) throw new Error("HF_API_KEY no está configurada");

  const model = "mixedbread-ai/mxbai-embed-large-v1";
  const input = queryText.slice(0, 8000);

  const doFetch = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: input,
            options: { wait_for_model: true },
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Hugging Face error ${response.status}: ${text}`);
      }
      return response.json();
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  };

  let data;
  try {
    data = await doFetch();
  } catch (_) {
    data = await doFetch();
  }

  if (Array.isArray(data) && Array.isArray(data[0])) {
    const len = data[0].length;
    const acc = new Array(len).fill(0);
    for (const vec of data) for (let i = 0; i < len; i++) acc[i] += vec[i];
    const avg = acc.map((v) => v / data.length);
    return avg;
  }

  if (!Array.isArray(data)) throw new Error("Respuesta de HF inesperada.");
  return data;
}

// === Handler Principal ===
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCORS(res);
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    setCORS(res);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query } = req.body || {};
  if (!query || typeof query !== "string") {
    return err(res, "No se proporcionó una consulta válida.");
  }

  console.log(`🧠 Recibida query: "${query}"`);
  try {
    // 1️⃣ Generar embedding para la consulta
    const embedding = await generateEmbedding(query);
    if (!embedding) throw new Error("No se generó embedding válido");

    // 2️⃣ Buscar coincidencias semánticas en Supabase
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.75, // ajustar según necesidad
      match_count: 5,
    });

    if (error) throw error;

    if (!matches || matches.length === 0) {
      console.warn("⚠️ No se encontraron coincidencias relevantes.");
      return ok(res, {
        success: true,
        answer: "No encontré esa información en los documentos.",
        sources: [],
      });
    }

    // 3️⃣ Unir el contexto más relevante
    const contextText = matches
      .map((m) => m.content)
      .slice(0, 3)
      .join("\n\n");

    // 4️⃣ Generar una respuesta resumida estilo ChatGPT (opcional)
    const summaryPrompt = `Eres un asistente profesional de fitness y bienestar. 
Responde brevemente a la siguiente pregunta usando solo el contexto provisto.
Pregunta: "${query}"
Contexto:\n${contextText}\n
Respuesta:`;

    const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY;
    const resp = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: summaryPrompt, parameters: { max_new_tokens: 200 } }),
    });

    let answerText = "Lo siento, no pude generar una respuesta en este momento.";
    if (resp.ok) {
      const result = await resp.json();
      answerText = Array.isArray(result)
        ? result[0]?.generated_text?.replace(summaryPrompt, "").trim()
        : result.generated_text?.trim() || answerText;
    }

    // 5️⃣ Respuesta final
    return ok(res, {
      success: true,
      answer: answerText || "No encontré información suficiente para responder.",
      sources: matches.map((m) => ({
        id: m.id,
        similarity: m.similarity,
      })),
    });
  } catch (e) {
    console.error("💥 Fatal query error:", e);
    return err(res, e.message);
  }
}
