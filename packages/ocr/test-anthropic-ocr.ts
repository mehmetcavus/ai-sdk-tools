import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ocr, type OCRError } from "./src/index.js";

const filePath = resolve(process.argv[2] || "");
console.log(`Reading file: ${filePath}`);

const buffer = readFileSync(filePath);
console.log(`File size: ${(buffer.length / 1024).toFixed(1)} KB`);

console.log("\n--- Testing Anthropic OCR (invoice schema) ---\n");

try {
  const start = Date.now();
  const data = await ocr(buffer, "invoice", {
    providerOrder: ["anthropic"],
    timeout: 30000,
    retries: 1,
  });

  console.log(`OCR succeeded in ${Date.now() - start}ms!`);
  console.log("Extracted data:", JSON.stringify(data, null, 2));
} catch (error) {
  const ocrError = error as OCRError;
  console.error("OCR failed:", ocrError.message);
  if (ocrError.providerAttempts) {
    for (const attempt of ocrError.providerAttempts) {
      const status = attempt.success ? "OK" : "FAILED";
      console.log(`  ${attempt.provider}: ${status} (${attempt.duration}ms)`);
      if (attempt.error) {
        console.log(`    Error: ${attempt.error.message}`);
      }
    }
  }
}
