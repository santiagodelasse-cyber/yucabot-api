const express = require("express");
const formidable = require("formidable");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const PDFParser = require("pdf2json");

const { insertKnowledge } = require("../lib/supabase");
const {
  generateEmbedding,
  normalizeText,
  truncateForEmbedding,
  EMBEDDING_DIM
} = require("../lib/embedding");

const router = express.Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_STORED_CONTENT = 5000;

const ALLOWED_MIME = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt"
};

function resolveFileType(file) {
  if (file.mimetype && ALLOWED_MIME[file.mimetype]) {
    return ALLOWED_MIME[file.mimetype];
  }

  const ext = path.extname(file.originalFilename || "").toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".txt") return "txt";

  return null;
}

function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_FILE_SIZE,
    keepExtensions: true
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);

      const fileField = files.file || files.document || Object.values(files)[0];
      if (!fileField) {
        return reject(new Error("No file uploaded. Use field name 'file'."));
      }

      const file = Array.isArray(fileField) ? fileField[0] : fileField;
      if (!file || !file.filepath) {
        return reject(new Error("Uploaded file is invalid."));
      }

      resolve({ fields, file });
    });
  });
}

function extractPdfText(filePath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", (err) => reject(err?.parserError || err));
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      const pages = pdfData?.Pages || [];
      const chunks = [];

      pages.forEach((page) => {
        page.Texts?.forEach((textItem) => {
          const decoded = textItem.R?.map((r) => decodeURIComponent(r.T || "")).join("") || "";
          chunks.push(decoded);
        });
      });

      resolve(chunks.join(" "));
    });

    pdfParser.loadPDF(filePath);
  });
}

async function extractDocxText(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  return value || "";
}

async function extractTxtText(filePath) {
  const buffer = await fs.promises.readFile(filePath, "utf8");
  return buffer || "";
}

async function extractText(filePath, type) {
  if (type === "pdf") return extractPdfText(filePath);
  if (type === "docx") return extractDocxText(filePath);
  if (type === "txt") return extractTxtText(filePath);
  throw new Error(`Unsupported file type: ${type}`);
}

function cleanupTempFile(filePath) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

router.post("/", async (req, res, next) => {
  let tempPath;
  try {
    const { file } = await parseMultipart(req);
    tempPath = file.filepath;

    const fileType = resolveFileType(file);
    if (!fileType) {
      return res.status(400).json({ error: "Unsupported file type. Use PDF, DOCX, or TXT." });
    }

    const rawText = await extractText(file.filepath, fileType);
    const normalized = normalizeText(rawText);

    if (!normalized) {
      return res.status(422).json({ error: "The uploaded document contains no readable text." });
    }

    const embeddingText = truncateForEmbedding(normalized);
    const embedding = await generateEmbedding(embeddingText);
    const storedContent = normalized.slice(0, MAX_STORED_CONTENT);

    await insertKnowledge(storedContent, embedding);

    console.log("✓ Ingested document", {
      file: file.originalFilename,
      size: file.size,
      type: fileType,
      storedLength: storedContent.length
    });

    return res.json({
      success: true,
      storedLength: storedContent.length,
      embeddingDimensions: EMBEDDING_DIM
    });
  } catch (error) {
    if (error?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File exceeds 10MB limit." });
    }

    if (error.message?.includes("HUGGINGFACE_API_KEY")) {
      return res.status(500).json({ error: "Embedding service not configured. Set HUGGINGFACE_API_KEY." });
    }

    return next(error);
  } finally {
    cleanupTempFile(tempPath);
  }
});

module.exports = router;
