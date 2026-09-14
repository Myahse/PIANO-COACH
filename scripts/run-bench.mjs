import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5173/test-transcribe.html";
const timeoutMs = 600_000;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(timeoutMs);

console.log(`Opening ${url}`);
await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });

await page.waitForFunction(
  () => window.__BENCH__ || window.__BENCH_ERROR__,
  undefined,
  { timeout: timeoutMs },
);

const error = await page.evaluate(() => window.__BENCH_ERROR__);
if (error) {
  console.error("Bench failed:", error);
  process.exitCode = 1;
} else {
  const report = await page.evaluate(() => window.__BENCH__);
  console.log(JSON.stringify(report, null, 2));
}

await browser.close();
