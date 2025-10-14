import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createClient } from "@supabase/supabase-js";

// 🚀 Configuración API (sin bodyParser)
export const config = { api: { bodyParser: false } };

// 🧠 Cliente Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ⚙️ CORS middleware
function allowCors(fn) {
  return async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    return await fn(req, res);
  };
}

// 🔍 Función para extraer texto
async function extractText(filePath, mimeType) {
  if (mimeType === "application/pdf") {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ") + "\n";
    }
    return text;
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (mimeType === "text/plain") {
    return fs.readFileSync(filePath, "utf8");
  }

  throw new Error("Tipo de archivo no soportado");
}

// 💾 Guardar texto y embedding en Supabase
async function saveToSupabase(text) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });

  const { error } = await supabase.from("knowledge_base").insert({
    content: text,
    embedding: embedding.data[0].embedding,
  });

  if (error) throw error;
}

// 📥 Endpoint principal
async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  console.log("📩 Ingest request received");

  const form = formidable({ multiples: false, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err || !files.file) {
      console.error("❌ Error al procesar el archivo:", err);
      return res.status(400).json({ error: "Error al procesar el archivo" });
    }

    const file = files.file[0];
    const filePath = file.filepath;
    const mimeType = file.mimetype;

    console.log(`📄 Procesando archivo: ${file.originalFilename} (${mimeType})`);

    try {
      const text = await extractText(filePath, mimeType);
      await saveToSupabase(text);
      console.log("✅ Documento procesado correctamente");
      res.status(200).json({ message: "Documento procesado correctamente" });
    } catch (error) {
      console.error("💥 Error fatal en ingest:", error);
      res.status(500).json({ error: error.message });
    } finally {
      fs.unlink(filePath, () => {});
    }
  });
}

export default allowCors(handler);
