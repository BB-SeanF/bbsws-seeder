// scripts/seed-links.js
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
  waitForImageInCell,
  categoryExistsBySearch,
  createSeederContext,
  runSeederWithErrorHandler
} from "./ui.js";

import links from "../data/links.json" with { type: "json" };

const school = requireArg("school");
const profile = getArg("profile", "sean");
const preCheck = hasFlag("pre-check");
const headless = getHeadless(false);
const timeoutMs = getTimeoutMs();
const authFile = path.join("auth", profile, `${school}.json`);
const cfg = TYPE_CONFIG.link;

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
    "maxWidth",
    "maxHeight",
    "defaultMaxWidth",
    "defaultMaxHeight",
    "saveAndAddItem",
    "addItemBtn",
    "itemTitle",
    "itemUrl",
    "itemDescriptionIframe",
    "primaryImageInput",
    "hoverImageInput",
    "primaryImageCell",
    "hoverImageCell",
    "saveItem"
  ],
  "TYPE_CONFIG.link"
);

function assertExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }
}

runSeederWithErrorHandler(async () => {
  const { browser, context, page } = await createSeederContext(authFile, headless);
  page.setDefaultTimeout(timeoutMs);

  if (!Array.isArray(links.categories)) {
    throw new Error('data/links.json must contain { "categories": [ ... ] }');
  }

  let skippedCategories = 0;
  let createdCategories = 0;
  let skippedItems = 0;
  let createdItems = 0;

  await goToCategoryPage(page, { school, type: cfg.hash });

  for (const category of links.categories) {
    console.log(`➡️ Links category: ${category.name}`);

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

    await fillId(page, `${cfg.categoryForm} ${cfg.maxWidth}`, cfg.defaultMaxWidth, timeoutMs);
    await fillId(page, `${cfg.categoryForm} ${cfg.maxHeight}`, cfg.defaultMaxHeight, timeoutMs);

    await clickId(page, cfg.saveAndAddItem, timeoutMs);
    await page.locator(cfg.itemTitle).waitFor({ state: "visible", timeout: timeoutMs });

    createdCategories++;

    for (let i = 0; i < category.items.length; i++) {
      const item = category.items[i];
      console.log(`   • Link item: ${item.title}`);



      await fillId(page, cfg.itemTitle, item.title, timeoutMs);
      await fillId(page, cfg.itemUrl, item.url, timeoutMs);

      await fillTinyMceSourceDialog(
        page,
        cfg.itemDescriptionIframe,
        item.description ?? "",
        timeoutMs
      );

      if (item.primaryImagePath) {
        assertExists(item.primaryImagePath);
        const primaryInput = page.locator(cfg.primaryImageInput);
        await primaryInput.setInputFiles(item.primaryImagePath);
        await waitForImageInCell(page, cfg.primaryImageCell, timeoutMs);
      }

      if (item.hoverImagePath) {
        assertExists(item.hoverImagePath);
        const hoverInput = page.locator(cfg.hoverImageInput);
        await hoverInput.setInputFiles(item.hoverImagePath);
        await waitForImageInCell(page, cfg.hoverImageCell, timeoutMs);
      }

      await clickId(page, cfg.saveItem, timeoutMs);
      await page.locator("#site-modal").waitFor({ state: "hidden", timeout: timeoutMs });
      await waitForBackToList(page, cfg.addItemBtn, timeoutMs);
      createdItems++;

      if (i < category.items.length - 1) {
        await clickId(page, cfg.addItemBtn, timeoutMs);
        await page.locator(cfg.itemTitle).waitFor({ state: "visible", timeout: timeoutMs });
      }
    }

    await goToCategoryPage(page, { school, type: cfg.hash });
  }

  console.log(`Summary: Skipped ${skippedCategories} categories (${skippedItems} items), Created ${createdCategories} categories (${createdItems} items)`);
  console.log("✅ Links seeding complete");
  return { browser, page };
}, "links");