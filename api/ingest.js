// api/ingest.js
import formidable from "formidable";
import fs from "fs";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";
import PDFParser from "pdf2json";

// ---- Vercel/Node: desactiva el bodyParser para recibir multipart/form-data
export const config = { api: { bodyParser: false } };

// ---- Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---- Helpers CORS (para preflight y respuestas planas compatibles con Lovable)
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function ok(res) {
  setCORS(res);
  return res.status(200).send("ok");
}
function err(res, message = "error") {
  setCORS(res);
  return res.status(500).send("error");
}

// ---- Extrae texto de PDF (ligero, sin canvas)
async function extractTextFromPDF(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on("pdfParser_dataError", (e) => reject(e?.parserError || e));
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        const text = (pdfData.Pages || [])
          .map((page) =>
            (page.Texts || [])
              .map((t) => decodeURIComponent((t.R?.[0]?.T) || ""))
              .join(" ")
          )
          .join("\n");
        resolve(text);
      } catch (e) {
        reject(e);
      }
    });
    pdfParser.loadPDF(filePath);
  });
}

// ---- Normaliza y recorta el texto para embeddings
function normalizeText(s) {
  return s
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

// ---- Genera embedding en Hugging Face (mxbai-embed-large-v1 => 1024 dims)
async function generateEmbedding(text) {
  const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY;
  if (!HF_API_KEY) throw new Error("HF_API_KEY no está configurada");

  const model = "mixedbread-ai/mxbai-embed-large-v1";
  const input = text.slice(0, 8000); // seguridad

  // pequeño helper de retry
  const doFetch = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(
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
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Hugging Face error ${resp.status}: ${t}`);
      }
      return resp.json();
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  };

  // 1–2 reintentos por resiliencia
  let data;
  try {
    data = await doFetch();
  } catch (_) {
    data = await doFetch();
  }

  // Modelos de HF pueden devolver:
  //  - vector plano: [..1024..]
  //  - matriz (por tokens): [[..],[..],...]
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const len = data[0].length;
    const acc = new Array(len).fill(0);
    for (const vec of data) for (let i = 0; i < len; i++) acc[i] += vec[i];
    const avg = acc.map((v) => v / data.length);
    if (!Array.isArray(avg) || !avg.length) {
      throw new Error("Embedding vacío tras promediado.");
    }
    return avg;
  }

  if (!Array.isArray(data)) {
    throw new Error("Respuesta de HF inesperada (no es arreglo).");
  }

  return data;
}

// ---- Handler principal
export default async function handler(req, res) {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return ok(res);
  }
  if (req.method !== "POST") {
    setCORS(res);
    return res.status(405).send("error");
  }

  console.log("📩 Ingest request received");

  // Parse form-data
  let file;
  try {
    const form = formidable({});
    const [fields, files] = await form.parse(req);
    file = files.file?.[0];
  } catch (e) {
    console.error("❌ Error parseando form-data:", e);
    return err(res);
  }

  if (!file) {
    console.error("❌ No file uploaded");
    return err(res);
  }

  const filePath = file.filepath;
  const fileType = file.mimetype;
  const fileName = file.originalFilename;
  console.log(`📄 Processing file: ${fileName} (${fileType})`);

  let textContent = "";

  try {
    // 1) Extraer texto
    if (fileType === "application/pdf") {
      textContent = await extractTextFromPDF(filePath);
    } else if (
      fileType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const dataBuffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      textContent = result.value || "";
    } else if (fileType === "text/plain") {
      textContent = fs.readFileSync(filePath, "utf8");
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    textContent = normalizeText(textContent);
    if (!textContent) throw new Error("El archivo está vacío o ilegible.");

    // 2) Embedding
    console.log("🧠 Generating embedding...");
    const embedding = await generateEmbedding(textContent);

    // Protección: tu tabla es vector(1024) — si trae otro largo, recorta o pad
    const EXPECTED_DIMS = 1024;
    let vec = embedding;
    if (vec.length !== EXPECTED_DIMS) {
      if (vec.length > EXPECTED_DIMS) vec = vec.slice(0, EXPECTED_DIMS);
      else {
        const pad = new Array(EXPECTED_DIMS - vec.length).fill(0);
        vec = vec.concat(pad);
      }
    }

    // 3) Guardar en Supabase
    console.log("🚀 Saving to Supabase...");
    const { error } = await supabase.from("knowledge_base").insert({
      content: textContent.slice(0, 5000),
      embedding: vec, // supabase-js envía array -> pgvector ok
      created_at: new Date(),
    });
    if (error) throw error;

    console.log("✅ Documento procesado correctamente");
    return ok(res); // <-- Respuesta plana "ok" (compat Lovable)
  } catch (e) {
    console.error("💥 Fatal ingest error:", e);
    return err(res);
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
}
