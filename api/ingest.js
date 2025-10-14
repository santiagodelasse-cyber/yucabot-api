import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";

// Evita que Vercel intente parsear el body automáticamente
export const config = {
  api: {
    bodyParser: false,
  },
};

// Inicializa OpenAI y Supabase
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 📦 Función principal
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("📩 Ingest request received");

  try {
    // 📁 Procesar archivo subido con formidable
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = path.extname(file.originalFilename).toLowerCase();
    let textContent = "";

    // 📖 Detectar tipo de archivo
    if (ext === ".txt") {
      textContent = fs.readFileSync(file.filepath, "utf8");
    } else if (ext === ".pdf") {
      const dataBuffer = fs.readFileSync(file.filepath);
      const pdfData = await pdfParse(dataBuffer);
      textContent = pdfData.text;
    } else if (ext === ".docx") {
      const dataBuffer = fs.readFileSync(file.filepath);
      const docResult = await mammoth.extractRawText({ buffer: dataBuffer });
      textContent = docResult.value;
    } else {
      return res.status(400).json({ error: "Unsupported file format" });
    }

    if (!textContent || textContent.trim().length < 5) {
      return res.status(400).json({ error: "File content is empty or invalid" });
    }

    console.log("🧠 Creating embedding...");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: textContent.slice(0, 8000), // límite de tokens
    });

    const embedding = embeddingResponse.data[0].embedding;

    console.log("🚀 Inserting into Supabase...");
    const { error } = await supabase.from("knowledge_base").insert([
      {
        content: textContent.slice(0, 20000), // por seguridad
        embedding,
      },
    ]);

    if (error) {
      console.error("❌ Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to insert into Supabase" });
    }

    console.log("✅ File processed successfully!");
    res.status(200).json({ message: "File uploaded and processed successfully" });

  } catch (error) {
    console.error("💥 Ingest error:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
}
