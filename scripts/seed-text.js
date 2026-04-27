// scripts/seed-text.js
import path from "node:path";

import { requireArg, getTimeoutMs, getHeadless, hasFlag } from "./cli.js";
import { validateConfig } from "./validate.js";
import { goToCategoryPage } from "./nav.js";
import { TYPE_CONFIG } from "./types.js";
import {
  clickId,
  fillId,
  ensureLabelActive,
  fillTinyMceSourceDialog,
  categoryExistsBySearch,
  authFileForSchool,
  resolveAuthFileForSchool,
  createSeederContext,
  runSeederWithErrorHandler
} from "./ui.js";

import text from "../data/text.json" with { type: "json" };

const school = requireArg("school");
const preCheck = hasFlag("pre-check");
const headless = getHeadless(false);
const timeoutMs = getTimeoutMs();
const authFile = resolveAuthFileForSchool(school);
const cfg = TYPE_CONFIG.text;

if (authFile !== authFileForSchool(school)) {
  console.log(`ℹ️ Using legacy auth state: ${path.relative(process.cwd(), authFile)}`);
}

validateConfig(cfg, [
  "hash","addCategoryBtn","categoryForm","categoryName","accessGroup","publicLabel",
  "saveAndEdit","longTextIframe","saveEdit"
], "TYPE_CONFIG.text");

runSeederWithErrorHandler(async () => {
  const { browser, context, page } = await createSeederContext(authFile, headless);
  page.setDefaultTimeout(timeoutMs);

  if (!Array.isArray(text.categories)) throw new Error('data/text.json must contain { "categories": [ ... ] }');

  let skippedCategories = 0;
  let createdCategories = 0;
  let skippedItems = 0;
  let createdItems = 0;

  await goToCategoryPage(page, { school, type: cfg.hash });

  for (const category of text.categories) {
    console.log(`➡️ Text category: ${category.name}`);

    // Search for category by exact name (only if --pre-check flag is set)
    if (preCheck && await categoryExistsBySearch(page, category.name, cfg.searchInput, cfg.searchBtn, timeoutMs)) {
      console.log(`⏭️ Skipping existing category: ${category.name}`);
      skippedCategories++;
      continue;
    }

    // Clear search before creating new category
    await page.locator(cfg.searchInput).first().clear().catch(() => {});

    await clickId(page, cfg.addCategoryBtn);
    const form = page.locator(cfg.categoryForm);
    await form.waitFor({ state: "visible", timeout: timeoutMs });

    await ensureLabelActive(form, `${cfg.accessGroup} ${cfg.publicLabel}`);
    await fillId(page, `${cfg.categoryForm} ${cfg.categoryName}`, category.name);

    await clickId(page, cfg.saveAndEdit, timeoutMs);

    await fillTinyMceSourceDialog(page, cfg.longTextIframe, category.body ?? "", timeoutMs);

    await clickId(page, cfg.saveEdit, timeoutMs);
    createdCategories++;
    await goToCategoryPage(page, { school, type: cfg.hash });
  }

  console.log(`Summary: Skipped ${skippedCategories} categories (${skippedItems} items), Created ${createdCategories} categories (${createdItems} items)`);
  console.log("✅ Text seeding complete");
  return { browser, page };
}, "text");