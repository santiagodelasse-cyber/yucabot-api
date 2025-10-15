import formidable from "formidable";
import fs from "fs";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";
import PDFParser from "pdf2json";

export const config = { api: { bodyParser: false } };

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---- PDF → texto (sin canvas) ----
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

// ---- Utilidad: si HF regresa lista de listas, promediamos ----
function meanVector(arrays) {
  const len = arrays[0].length;
  const out = new Array(len).fill(0);
  for (const a of arrays) for (let i = 0; i < len; i++) out[i] += a[i];
  for (let i = 0; i < len; i++) out[i] /= arrays.length;
  return out;
}
function normalizeEmbedding(hfJson) {
  // Puede regresar [768] o [[768], [768], ...]
  if (Array.isArray(hfJson) && Array.isArray(hfJson[0])) return meanVector(hfJson);
  if (Array.isArray(hfJson)) return hfJson;
  throw new Error("Respuesta de Hugging Face inesperada");
}

// ---- Hugging Face Inference API (modelos /models/...) ----
async function generateEmbedding(text) {
  const HF_API_KEY = process.env.HF_API_KEY;
  const MODEL =
    process.env.HF_EMBEDDING_MODEL ||
    "sentence-transformers/all-MiniLM-L6-v2"; // barato y rápido

  if (!HF_API_KEY) throw new Error("HF_API_KEY no está configurada");

  // Acortamos para evitar límites de contexto del modelo
  const input = text.slice(0, 2000);

  const resp = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: input,
      options: { wait_for_model: true }, // arranca el modelo si está frío
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Hugging Face ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return normalizeEmbedding(data);
}

// ---- Handler principal ----
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
    // 1) Extraer texto según tipo
    if (fileType === "application/pdf") {
      textContent = await extractTextFromPDF(filePath);
    } else if (
      fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const buf = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: buf });
      textContent = result.value;
    } else if (fileType === "text/plain") {
      textContent = fs.readFileSync(filePath, "utf8");
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    if (!textContent.trim()) throw new Error("El archivo parece vacío o no se pudo leer.");

    // 2) Embedding con HF
    console.log("🧠 Generating embedding...");
    console.log("⚙️ Usando Hugging Face para embeddings...");
    const embedding = await generateEmbedding(textContent);

    // 3) Guardar en Supabase
    console.log("🚀 Saving to Supabase...");
    const { error } = await supabase.from("knowledge_base").insert({
      content: textContent.slice(0, 5000),
      embedding,
      created_at: new Date(),
    });
    if (error) throw error;

    console.log("✅ Documento procesado correctamente");
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("💥 Fatal ingest error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { fs.unlinkSync(filePath); } catch {}
  }
}
