const express = require("express");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const handlebars = require("handlebars");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// ⭐ 星評価を描画するHandlebarsヘルパー
handlebars.registerHelper("renderStars", function (score) {
  const full = "★".repeat(score);
  const empty = "☆".repeat(5 - score);
  return full + empty;
});

// PDF生成エンドポイント
app.post("/generate", async (req, res) => {
  const data = req.body;

  const templatePath = path.join(__dirname, "templates", "page4.html");
  const templateSource = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateSource);
  const html = template(data);

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: puppeteer.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdfBuffer = await page.pdf({ format: "A4" });

  await browser.close();

  res.setHeader("Content-Type", "application/pdf");
  res.send(pdfBuffer);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
 
