// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const handlebars = require("handlebars");
const { PDFDocument } = require("pdf-lib");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ⭐ 星表示ヘルパー
handlebars.registerHelper("renderStars", function (score) {
  const full = "★".repeat(score);
  const empty = "☆".repeat(5 - score);
  return full + empty;
});

// ☑ ランク一致判定ヘルパー
handlebars.registerHelper("isEqual", function (a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

// HTML→PDFバッファ生成
async function generatePdfFromHtml(templateFileName, data) {
  const templatePath = path.join(__dirname, "templates", templateFileName);
  const templateSource = fs.readFileSync(templatePath, "utf8");
  const stylePath = path.join(__dirname, "style.css");
  const styleContent = fs.readFileSync(stylePath, "utf8");
  const template = handlebars.compile(templateSource);
  const html = template({ ...data, injectedStyle: styleContent });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfBuffer = await page.pdf({
    format: "A4",
    landscape: true,
    printBackground: true,
  });

  await browser.close();
  return pdfBuffer;
}

// PDF結合
async function mergePdfBuffers(buffers) {
  const mergedPdf = await PDFDocument.create();
  for (const buffer of buffers) {
    const pdf = await PDFDocument.load(buffer);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  return await mergedPdf.save();
}

// 使用テンプレート
const templateFiles = ["page4.html", "page5.html"];

// 通常PDF出力（ダウンロード）
app.post("/generate", async (req, res) => {
  try {
    const data = req.body;
    const pdfBuffers = await Promise.all(
      templateFiles.map((filename) => generatePdfFromHtml(filename, data))
    );
    const mergedBuffer = await mergePdfBuffers(pdfBuffers);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(mergedBuffer));
  } catch (err) {
    console.error("PDF生成エラー:", err);
    res.status(500).send("PDF生成中にエラーが発生しました");
  }
});

// -----------------------------
// Kintoneアップロード機能
// -----------------------------
const KINTONE_DOMAIN = "https://fmitpjt.cybozu.com";
const KINTONE_APP_ID = "3311"; // アプリID
const KINTONE_API_TOKEN = "YBkqHdz9WqUyCOm213oo7HSlgBb6w4xZC0D7SHG6"; // 環境に合わせて

app.post("/kintone-upload", async (req, res) => {
  try {
    const data = req.body;
    const recordId = data.recordId;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;

    // ファイル名を安全に作成
    const sanitize = (s) => (s || "").replace(/[\\/:*?"<>|()\[\]{}]/g, "").trim();
    const filename = `${sanitize(data.company)}(${data.company_no})_組織診断レポート${dateStr}.pdf`;

    // PDF作成
    const pdfBuffers = await Promise.all(
      templateFiles.map((filename) => generatePdfFromHtml(filename, data))
    );
    const mergedBuffer = await mergePdfBuffers(pdfBuffers);

    // バッファをファイルとして扱う
    const form = new FormData();
    form.append("file", Buffer.from(mergedBuffer), {
      filename,
      contentType: "application/pdf",
    });

    // ファイルアップロード
    const fileResp = await axios.post(`${KINTONE_DOMAIN}/k/v1/file.json`, form, {
      headers: {
        ...form.getHeaders(),
        "X-Cybozu-API-Token": KINTONE_API_TOKEN,
      },
    });

    const fileKey = fileResp.data.fileKey;

    // レコード更新
    await axios.put(`${KINTONE_DOMAIN}/k/v1/record.json`, {
      app: KINTONE_APP_ID,
      id: recordId,
      record: {
        添付ファイル: {
          value: [{ fileKey }],
        },
      },
    }, {
      headers: {
        "Content-Type": "application/json",
        "X-Cybozu-API-Token": KINTONE_API_TOKEN,
      },
    });

    res.status(200).send("Kintoneへのファイル添付完了");
  } catch (err) {
    console.error("Kintoneアップロード失敗:", err.response?.data || err.message);
    res.status(500).send("Kintoneアップロードエラー");
  }
});
