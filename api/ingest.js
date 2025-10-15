import formidable from "formidable";
import fs from "fs";
import mammoth from "mammoth";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import PDFParser from "pdf2json"; // Ligero y sin dependencias de canvas

export const config = { api: { bodyParser: false } };

// Inicializar Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Función para extraer texto de PDF ---
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

// --- Generar embedding con Hugging Face ---
async function generateEmbedding(text) {
  const HF_API_KEY = process.env.HF_API_KEY;
  if (!HF_API_KEY) throw new Error("HF_API_KEY no está configurada");

  const response = await fetch(
    "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
    {
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({ inputs: text }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de Hugging Face: ${errText}`);
  }

  const data = await response.json();
  return data[0]; // vector de embedding
}

// --- Handler principal ---
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  console.log("📩 Ingest request received");

  const form = formidable({});
  const [fields, files] = await form.parse(req);
  const file = files.file?.[0];

  if (!file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = file.filepath;
  const fileType = file.mimetype;
  console.log(`📄 Processing file: ${file.originalFilename} (${fileType})`);

  let textContent = "";

  try {
    // Extraer texto según el tipo de archivo
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
      throw new Error("El archivo parece vacío o no se pudo leer.");
    }

    console.log("🧠 Generating embedding...");
    console.log("⚙️ Usando Hugging Face para embeddings...");

    const embedding = await generateEmbedding(textContent.slice(0, 2000));

    console.log("🚀 Saving to Supabase...");
    const { error } = await supabase.from("knowledge_base").insert({
      content: textContent.slice(0, 5000),
      embedding,
      created_at: new Date(),
    });

    if (error) throw error;

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
