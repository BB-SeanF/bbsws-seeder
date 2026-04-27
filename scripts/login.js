
// scripts/login.js
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { requireArg } from "./cli.js";

const school = requireArg("school");

const outDir = path.join("auth");
const outFile = path.join(outDir, `${school}.json`);
const schoolUrl = `https://${school}.myschoolapp.com/`;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Opening: ${schoolUrl}`);
  await page.goto(schoolUrl, { waitUntil: "domcontentloaded" });

  console.log("\n🔐 Complete BBID login in the opened browser.");
  console.log("✅ Once you are fully logged in to the school's site/app, press ENTER here.\n");

  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.pause();

  await context.storageState({ path: outFile });
  console.log(`✅ Saved session: ${outFile}`);

  await browser.close();
  process.exit(0);
})();
