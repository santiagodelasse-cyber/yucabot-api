import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

// Desactiva el parser por defecto de Vercel (porque usamos formidable)
export const config = {
  api: {
    bodyParser: false,
  },
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parsear el archivo enviado desde Lovable
    const form = formidable({});
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Leer el contenido del archivo
    const fileBuffer = fs.readFileSync(file.filepath);
    const text = fileBuffer.toString("utf8");

    // Generar embeddings con OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Guardar en Supabase
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
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
