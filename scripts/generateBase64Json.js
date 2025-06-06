// scripts/generateBase64Json.js
const fs = require("fs");
const path = require("path");

const imageDir = path.join(__dirname, "../images");
const outputPath = path.join(__dirname, "../assets/base64-images.json");

const output = {};

fs.readdirSync(imageDir).forEach(file => {
  const fullPath = path.join(imageDir, file);
  const key = path.basename(file, path.extname(file)); // 例: arrow.png → arrow
  const ext = path.extname(file).slice(1); // png, jpgなど
  const base64 = fs.readFileSync(fullPath).toString("base64");
  output[key] = `data:image/${ext};base64,${base64}`;
});

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`✅ base64-images.json を生成しました (${Object.keys(output).length}件)`);
