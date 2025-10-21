// api/ingest.js
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

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

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
  console.error("❌", message);
  return res.status(500).json({ success: false, error: message });
}

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

function normalizeText(s) {
  return s.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
}

async function generateEmbedding(text) {
  const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY;
  if (!HF_API_KEY) throw new Error("HF_API_KEY no está configurada");

  const model = "mixedbread-ai/mxbai-embed-large-v1";
  const input = text.slice(0, 8000);

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
          body: JSON.stringify({ inputs: input, options: { wait_for_model: true } }),
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

export default async function handler(req, res) {
  req.setTimeout(60000);
  if (req.method === "OPTIONS") return ok(res);
  if (req.method !== "POST") {
    setCORS(res);
    return res.status(405).send("error");
  }

  log("📩 Ingest request received");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return err(res, "Faltan variables de entorno de Supabase");
  }

  let file;
  try {
    const form = formidable({});
    const [fields, files] = await form.parse(req);
    file = files.file?.[0];
  } catch (e) {
    return err(res, `Error parseando form-data: ${e.message}`);
  }

  if (!file) return err(res, "No se subió ningún archivo");

  const filePath = file.filepath;
  const fileType = file.mimetype;
  const fileName = file.originalFilename;
  log(`📄 Processing file: ${fileName} (${fileType})`);

  try {
    let textContent = "";
    if (fileType === "application/pdf") {
      textContent = await extractTextFromPDF(filePath);
    } else if (fileType.includes("wordprocessingml")) {
      const dataBuffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      textContent = result.value || "";
    } else if (fileType === "text/plain") {
      textContent = fs.readFileSync(filePath, "utf8");
    } else throw new Error(`Unsupported file type: ${fileType}`);

    textContent = normalizeText(textContent);
    if (!textContent) throw new Error("Archivo vacío o ilegible");

    log("🧠 Generating embedding...");
    const embedding = await generateEmbedding(textContent);

    const EXPECTED_DIMS = 1024;
    let vec = embedding.length === EXPECTED_DIMS
      ? embedding
      : embedding.slice(0, EXPECTED_DIMS).concat(
          Array(EXPECTED_DIMS - embedding.length).fill(0)
        );

    log("🚀 Saving to Supabase...");
    const { error } = await supabase.from("knowledge_base").insert({
      content: textContent.slice(0, 5000),
      embedding: vec,
      created_at: new Date(),
    });

    if (error) throw error;

    log("✅ Documento procesado correctamente");
    return ok(res);
  } catch (e) {
    return err(res, `Fatal ingest error: ${e.message}`);
  } finally {
    try {
      fs.unlinkSync(file.filepath);
    } catch (_) {}
  }
}
