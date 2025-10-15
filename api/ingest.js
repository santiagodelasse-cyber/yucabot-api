import formidable from "formidable";
import fs from "fs";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import PDFParser from "pdf2json";

// 🚀 Soporte Hugging Face opcional
const useHF = process.env.EMBEDDINGS_PROVIDER === "hf";

export const config = { api: { bodyParser: false } };

// ✅ Inicializa OpenAI si hay API key
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ✅ Inicializa Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Función para extraer texto de PDF
async function extractTextFromPDF(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", (err) => reject(err.parserError));
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      const text = pdfData.Pages.map((page) =>
        page.Texts.map((t) => decodeURIComponent(t.R[0].T)).join(" ")
      ).join("\n");
      resolve(text);
    });

    pdfParser.loadPDF(filePath);
  });
}

// ✅ Función para generar embedding (OpenAI o Hugging Face)
async function generateEmbedding(text) {
  if (useHF) {
    console.log("⚙️ Usando Hugging Face para embeddings...");
    const model = "sentence-transformers/all-MiniLM-L6-v2";
    const res = await fetch(
      `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: text.slice(0, 8000) }),
      }
    );
    if (!res.ok) {
      throw new Error(`HF error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const vec = Array.isArray(data[0]) ? data[0] : data;
    return vec.map(Number);
  } else {
    console.log("⚙️ Usando OpenAI para embeddings...");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    return embeddingResponse.data[0].embedding;
  }
}

// ✅ Función principal
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("📩 Ingest request received");

  const form = formidable({});
  const [fields, files] = await form.parse(req);
  const file = files.file?.[0];

  if (!file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = file.filepath;
  const fileType = file.mimetype;
  const fileName = file.originalFilename;
  console.log(`📄 Processing file: ${fileName} (${fileType})`);

  let textContent = "";

  try {
    // ✅ 1. Leer contenido según tipo
    if (fileType === "application/pdf") {
      textContent = await extractTextFromPDF(filePath);
    } else if (
      fileType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const dataBuffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      textContent = result.value;
    } else if (fileType === "text/plain") {
      textContent = fs.readFileSync(filePath, "utf8");
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    if (!textContent.trim()) {
      throw new Error("File appears to be empty or unreadable.");
    }

    // ✅ 2. Generar embedding
    console.log("🧠 Generating embedding...");
    const embedding = await generateEmbedding(textContent);

    // ✅ 3. Guardar en Supabase
    console.log("🚀 Saving to Supabase...");
    const { error } = await supabase.from("knowledge_base").insert({
      content: textContent.slice(0, 5000),
      embedding,
      created_at: new Date(),
    });
    if (error) throw error;

    // ✅ 4. Disparar webhook de n8n
    try {
      const webhookUrl = process.env.N8N_WEBHOOK_URL;
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "ingest_completed",
            filename: fileName,
            timestamp: new Date().toISOString(),
          }),
        });
        console.log("🔔 Webhook enviado a n8n");
      } else {
        console.warn("⚠️ N8N_WEBHOOK_URL no configurada en Vercel");
      }
    } catch (err) {
      console.warn("No se pudo notificar a n8n:", err.message);
    }

    console.log("✅ Documento procesado correctamente");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("💥 Fatal ingest error:", error);
    return res.status(500).json({ error: error.message });
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
}
