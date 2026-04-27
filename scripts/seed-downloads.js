// scripts/seed-downloads.js
import path from "node:path";
import fs from "node:fs";

import { requireArg, getArg, getTimeoutMs, getHeadless, hasFlag } from "./cli.js";
import { validateConfig } from "./validate.js";
import { goToCategoryPage } from "./nav.js";
import { TYPE_CONFIG } from "./types.js";
import {
  clickId,
  fillId,
  ensureLabelActive,
  fillTinyMceSourceDialog,
  waitForBackToList,
  waitForUploadProgressToDisappear,
  categoryExistsBySearch,
  itemExistsInCategory,
  createSeederContext,
  runSeederWithErrorHandler
} from "./ui.js";

import downloads from "../data/downloads.json" with { type: "json" };

const school = requireArg("school");
const profile = getArg("profile", "sean");
const preCheck = hasFlag("pre-check");

const headless = getHeadless(false);
const timeoutMs = getTimeoutMs();
const authFile = path.join("auth", profile, `${school}.json`);
const cfg = TYPE_CONFIG.download;

validateConfig(
  cfg,
  [
    "hash",
    "addCategoryBtn",
    "categoryForm",
    "categoryName",
    "searchInput",
    "searchBtn",
    "accessGroup",
    "publicLabel",
    "categoryDescriptionIframe",
    "saveAndAddItem",
    "addItemBtn",
    "itemTitle",
    "itemDescriptionIframe",
    "fileInput",
    "saveItem",
    "uploadProgressSelector"
  ],
  "TYPE_CONFIG.download"
);

function assertExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
}

runSeederWithErrorHandler(async () => {
  const { browser, context, page } = await createSeederContext(authFile, headless);
  page.setDefaultTimeout(timeoutMs);

  if (!Array.isArray(downloads.categories)) {
    throw new Error(`data/downloads.json must contain { "categories": [ ... ] }`);
  }

  let skippedCategories = 0;
  let createdCategories = 0;
  let skippedItems = 0;
  let createdItems = 0;

  await goToCategoryPage(page, { school, type: cfg.hash });

  for (const category of downloads.categories) {
    console.log(`➡️ Download category: ${category.name}`);

    if (preCheck && await categoryExistsBySearch(page, category.name, cfg.searchInput, cfg.searchBtn, timeoutMs)) {
      console.log(`⏭️ Skipping existing category: ${category.name}`);
      skippedCategories++;
      continue;
    }

    await page.locator(cfg.searchInput).first().clear().catch(() => {});

    await clickId(page, cfg.addCategoryBtn, timeoutMs);
    const form = page.locator(cfg.categoryForm);
    await form.waitFor({ state: "visible", timeout: timeoutMs });

    await ensureLabelActive(form, `${cfg.accessGroup} ${cfg.publicLabel}`, timeoutMs);
    await fillId(page, `${cfg.categoryForm} ${cfg.categoryName}`, category.name, timeoutMs);

    if (category.description) {
      await fillTinyMceSourceDialog(
        page,
        cfg.categoryDescriptionIframe,
        category.description,
        timeoutMs
      );
    }

    await clickId(page, cfg.saveAndAddItem, timeoutMs);
    await waitForBackToList(page, cfg.addItemBtn, timeoutMs);

    for (let i = 0; i < category.items.length; i++) {
      const item = category.items[i];
      console.log(`   • Download item: ${item.title}`);

      if (preCheck && await itemExistsInCategory(page, item.title)) {
        console.log(`   ⏭️ Skipping existing item: ${item.title}`);
        skippedItems++;
        continue;
      }

      await clickId(page, cfg.addItemBtn, timeoutMs);
      await page.locator(cfg.itemTitle).waitFor({ state: "visible", timeout: timeoutMs });

      await fillId(page, cfg.itemTitle, item.title, timeoutMs);

      await fillTinyMceSourceDialog(
        page,
        cfg.itemDescriptionIframe,
        item.description ?? "",
        timeoutMs
      );

      if (item.filePath) {
        assertExists(item.filePath);

        const input = page.locator(cfg.fileInput).first();
        await input.setInputFiles(item.filePath);

        await waitForUploadProgressToDisappear(page, {
          progressSelector: cfg.uploadProgressSelector,
          scopeSelector: "body",
          timeout: timeoutMs
        });
      }

      await clickId(page, cfg.saveItem, timeoutMs);
      await waitForBackToList(page, cfg.addItemBtn, timeoutMs);
      createdItems++;
    }

    createdCategories++;

    await goToCategoryPage(page, { school, type: cfg.hash });
  }

  console.log(`Summary: Skipped ${skippedCategories} categories (${skippedItems} items), Created ${createdCategories} categories (${createdItems} items)`);
  console.log("✅ Downloads seeding complete");
  return { browser, page };
}, "downloads");