import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

// 🔥 Función para habilitar CORS
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // ✅ CORS habilitado
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({});
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = fs.readFileSync(file.filepath);
    const text = fileBuffer.toString("utf8");

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
    });

    const embedding = embeddingResponse.data[0].embedding;

    const { error } = await supabase.from("knowledge_base").insert([
      {
        content: text,
        embedding,
      },
    ]);

    if (error) throw error;

    return res.status(200).json({ message: "✅ Documento procesado correctamente" });
  } catch (error) {
    console.error("❌ Error en /api/ingest:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
