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

// Handlebarsヘルパー
handlebars.registerHelper("renderStars", (score) => "★".repeat(score) + "☆".repeat(5 - score));
handlebars.registerHelper("isEqual", (a, b, options) => a === b ? options.fn(this) : options.inverse(this));

// テンプレート一覧
const templateFiles = ["page1.html", "page2.html", "page3.html"];

// HTML → PDF化
async function generatePdfFromHtml(templateFileName, data) {
  try {
    console.log(`📄 [START] Generating PDF from: ${templateFileName}`);

    const templatePath = path.join(__dirname, "templates", templateFileName);
    const stylePath = path.join(__dirname, "style.css");
    const templateSource = fs.readFileSync(templatePath, "utf8");
    const styleContent = fs.readFileSync(stylePath, "utf8");
    const base64Images = require("./assets/base64-images.json");

    const template = handlebars.compile(templateSource);
    const html = template({
      ...data,
      injectedStyle: styleContent,
      ...base64Images
    });

    console.log(`🔎 HTML length: ${html.length}`);
    console.log("🔎 HTML preview:", html.slice(0, 200).replace(/\n/g, ""));
    console.log("🔎 Base64 image (arrow) preview:", (data.arrow || "").slice(0, 60));

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 60000
    });

    await page.evaluateHandle('document.fonts.ready');

    const pdfBuffer = await page.pdf({
      format: "legal",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true
    });

    await browser.close();

    console.log(`✅ [SUCCESS] PDF generated from: ${templateFileName}`);

    return pdfBuffer;
  } catch (err) {
    console.error(`❌ [ERROR] PDF generation failed for: ${templateFileName}`);
    console.error(err.message);
    throw err;
  }
}

// PDFマージ
async function mergePdfBuffers(buffers) {
  const merged = await PDFDocument.create();
  for (const buffer of buffers) {
    const pdf = await PDFDocument.load(buffer);
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return await merged.save();
}

// ▼ `/generate` (PDF単独返却)
app.post("/generate", async (req, res) => {
  try {
    const data = req.body;
    const pdfBuffers = [];

    for (const file of templateFiles) {
      try {
        const buf = await generatePdfFromHtml(file, data);
        pdfBuffers.push(buf);
      } catch (err) {
        console.error(`🛑 スキップ: ${file} のPDF生成に失敗しました`);
        return res.status(500).send(`PDF生成失敗: ${file}`);
      }
    }

    const merged = await mergePdfBuffers(pdfBuffers);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(merged));
  } catch (e) {
    console.error("❌ [FATAL] PDF生成中にエラー:", e);
    res.status(500).send("PDF生成中にエラー");
  }
});

// ▼ `/kintone-upload` (PDF作成 + 添付)
const KINTONE_DOMAIN = "https://fmitpjt.cybozu.com";
const KINTONE_APP_ID = "3311";
const KINTONE_API_TOKEN = "YBkqHdz9WqUyCOm213oo7HSlgBb6w4xZC0D7SHG6";

app.post("/kintone-upload", async (req, res) => {
  try {
    const data = req.body;
    const recordId = data.recordId;
    // ファイル名
    const sanitize = (s) => (s || "").replace(/[\\/:*?"<>|()\[\]{}]/g, "").trim();
    const safeCompany = sanitize(data.company);
    const filename = `${safeCompany}(${data.company_no})${data.address}_組織診断レポート_${data.dateStr}.pdf`;

    // PDF作成
    const pdfBuffers = await Promise.all(templateFiles.map(f => generatePdfFromHtml(f, data)));
    const mergedBuffer = await mergePdfBuffers(pdfBuffers);

    // アップロード用FormData
    const form = new FormData();
    form.append("file", Buffer.from(mergedBuffer), {
      filename,
      contentType: "application/pdf"
    });

    // アップロード→fileKey取得
    const uploadRes = await axios.post(`${KINTONE_DOMAIN}/k/v1/file.json`, form, {
      headers: {
        ...form.getHeaders(),
        "X-Cybozu-API-Token": KINTONE_API_TOKEN
      }
    });

    const fileKey = uploadRes.data.fileKey;

    // レコード更新
    await axios.put(`${KINTONE_DOMAIN}/k/v1/record.json`, {
      app: KINTONE_APP_ID,
      id: recordId,
      record: {
        添付ファイル: { value: [{ fileKey }] }
      }
    }, {
      headers: {
        "Content-Type": "application/json",
        "X-Cybozu-API-Token": KINTONE_API_TOKEN
      }
    });

    res.status(200).send("Kintoneに添付完了");
  } catch (e) {
    console.error("アップロード失敗:", e.response?.data || e.message);
    res.status(500).send("添付エラー");
  }
});

// ▼ サーバー起動
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
