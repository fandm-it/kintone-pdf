const express = require("express");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const handlebars = require("handlebars");
const { PDFDocument } = require("pdf-lib");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ★ 星評価ヘルパー
handlebars.registerHelper("renderStars", function (score) {
  const full = "★".repeat(score);
  const empty = "☆".repeat(5 - score);
  return full + empty;
});

// ランク一致判定ヘルパー（行をハイライトする用）
handlebars.registerHelper("isEqual", function (a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

// HTML → PDFバッファ生成関数
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
    printBackground: true
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

// 使用するテンプレートファイル名一覧
const templateFiles = ["page4.html", "page5.html"]; // 増えたらここに追加

app.post("/generate", async (req, res) => {
  try {
    const data = req.body;

    // 各テンプレートに対してPDFバッファを生成
    const pdfBuffers = await Promise.all(
      templateFiles.map((filename) => generatePdfFromHtml(filename, data))
    );

    const mergedBuffer = await mergePdfBuffers(pdfBuffers);

    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(mergedBuffer));
  } catch (err) {
    console.error("PDF生成中にエラー:", err);
    res.status(500).send("PDF生成中にエラーが発生しました");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


// Kintone設定（あなたの環境に合わせて）
const KINTONE_DOMAIN = "https://fmitpjt.cybozu.com";
const KINTONE_APP_ID = "3311"; // アプリID
const KINTONE_API_TOKEN = "YBkqHdz9WqUyCOm213oo7HSlgBb6w4xZC0D7SHG6"; // アプリに発行したAPIトークン

app.post("/kintone-upload", async (req, res) => {
  try {
    const data = req.body;

    // 1. PDFバッファ作成
    const pdfBuffers = await Promise.all(
      templateFiles.map((filename) => generatePdfFromHtml(filename, data))
    );
    const mergedBuffer = await mergePdfBuffers(pdfBuffers);

    // 2. バッファをファイルとして扱う
    const form = new FormData();
    form.append("file", Buffer.from(mergedBuffer), {
      filename: "report.pdf",
      contentType: "application/pdf",
    });

    // 3. Kintoneへファイルアップロード（fileKey取得）
    const fileUploadResp = await axios.post(`${KINTONE_DOMAIN}/k/v1/file.json`, form, {
      headers: {
        ...form.getHeaders(),
        "X-Cybozu-API-Token": KINTONE_API_TOKEN,
      },
    });

    const fileKey = fileUploadResp.data.fileKey;

    // 4. レコード登録または更新（添付フィールドコードは '添付ファイル' と仮定）
    await axios.post(`${KINTONE_DOMAIN}/k/v1/record.json`, {
      app: KINTONE_APP_ID,
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

    res.status(200).send("Kintoneにファイルをアップロードしました");
  } catch (err) {
    console.error("Kintoneアップロード失敗:", err.response?.data || err.message);
    res.status(500).send("Kintoneへのアップロードに失敗しました");
  }
});
