const express = require("express");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const handlebars = require("handlebars");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ⭐ 星評価の Handlebars ヘルパー
handlebars.registerHelper("renderStars", function (score) {
  const full = "★".repeat(score);
  const empty = "☆".repeat(5 - score);
  return full + empty;
});

app.post("/generate", async (req, res) => {
  try {
    const data = req.body;

    // HTMLテンプレート読み込み
    const templatePath = path.join(__dirname, "templates", "page4.html");
    const templateSource = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(templateSource);
    const html = template(data);

    // Puppeteer起動（Chromiumは puppeteer@19+ が自動ダウンロードする）
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({ format: "A4" });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (error) {
    console.error("PDF生成中にエラーが発生:", error);
    res.status(500).send("PDF生成中にエラーが発生しました");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
