import formidable from "formidable";
import fs from "fs";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";
import PDFParser from "pdf2json";

export const config = { api: { bodyParser: false } };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Extraer texto de PDF ---
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

// --- Generar embedding usando Hugging Face ---
async function generateEmbedding(text) {
  const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
  if (!HF_API_KEY) throw new Error("HF_API_KEY no está configurada");

  const model = "mixedbread-ai/mxbai-embed-large-v1"; // ✅ modelo correcto de embeddings

  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: text.slice(0, 8000),
      options: { wait_for_model: true },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hugging Face error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Si el modelo devuelve matriz, promediamos los vectores
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const len = data[0].length;
    const avg = new Array(len).fill(0);
    for (const vec of data) for (let i = 0; i < len; i++) avg[i] += vec[i];
    return avg.map((v) => v / data.length);
  }

  return data;
}

// --- Handler principal ---
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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

    if (!textContent.trim()) throw new Error("El archivo está vacío o no se pudo leer.");

    console.log("🧠 Generating embedding...");
    console.log("⚙️ Usando modelo de Hugging Face: mixedbread-ai/mxbai-embed-large-v1");

    const embedding = await generateEmbedding(textContent);

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
