// scripts/seed-lists.js
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
  waitForPhotoTablePreviews,
  reorderByAddedAscending,
  categoryExistsBySearch,
  itemExistsInCategory,
  createSeederContext,
  runSeederWithErrorHandler
} from "./ui.js";

import lists from "../data/lists.json" with { type: "json" };

const school = requireArg("school");
const profile = getArg("profile", "sean");
const preCheck = hasFlag("pre-check");

const headless = getHeadless(false);
const timeoutMs = getTimeoutMs();
const authFile = path.join("auth", profile, `${school}.json`);
const cfg = TYPE_CONFIG.list;

validateConfig(cfg, [
  "hash","addCategoryBtn","categoryForm","categoryName","accessGroup","publicLabel",
  "searchInput","searchBtn",
  "maxImages","saveAndAddItem","addItemBtn","itemTitle","itemShortDescIframe","itemLongDescIframe",
  "imageDropZone","imageInput","photoTable","saveItem","organizeBtn","sortAddedAscBtn","saveOrderBtn"
], "TYPE_CONFIG.list");

function assertExists(p) {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
}

runSeederWithErrorHandler(async () => {
  const { browser, context, page } = await createSeederContext(authFile, headless);
  page.setDefaultTimeout(timeoutMs);

  if (!Array.isArray(lists.categories)) throw new Error('data/lists.json must contain { "categories": [ ... ] }');

  let skippedCategories = 0;
  let createdCategories = 0;
  let skippedItems = 0;
  let createdItems = 0;

  await goToCategoryPage(page, { school, type: cfg.hash });

  for (const category of lists.categories) {
    console.log(`➡️ List category: ${category.name}`);

    if (preCheck && await categoryExistsBySearch(page, category.name, cfg.searchInput, cfg.searchBtn, timeoutMs)) {
      console.log(`⏭️ Skipping existing category: ${category.name}`);
      skippedCategories++;
      continue;
    }

    await page.locator(cfg.searchInput).first().clear().catch(() => {});

    const maxImages = Number(category.maxImages ?? 0);

    await clickId(page, cfg.addCategoryBtn, timeoutMs);
    const form = page.locator(cfg.categoryForm);
    await form.waitFor({ state: "visible", timeout: timeoutMs });

    await ensureLabelActive(form, `${cfg.accessGroup} ${cfg.publicLabel}`, timeoutMs);
    await fillId(page, `${cfg.categoryForm} ${cfg.categoryName}`, category.name, timeoutMs);
    await fillId(page, `${cfg.categoryForm} ${cfg.maxImages}`, String(maxImages), timeoutMs);

    await clickId(page, cfg.saveAndAddItem, timeoutMs);
    await waitForBackToList(page, cfg.addItemBtn, timeoutMs);

    for (let i = 0; i < category.items.length; i++) {
      const item = category.items[i];
      console.log(`   • Item: ${item.title}`);

      if (preCheck && await itemExistsInCategory(page, item.title)) {
        console.log(`   ⏭️ Skipping existing item: ${item.title}`);
        skippedItems++;
        continue;
      }

      await clickId(page, cfg.addItemBtn, timeoutMs);
      await page.locator(cfg.itemTitle).waitFor({ state: "visible", timeout: timeoutMs });

      await fillId(page, cfg.itemTitle, item.title, timeoutMs);

      await fillTinyMceSourceDialog(page, cfg.itemShortDescIframe, item.shortDescription ?? "", timeoutMs);
      await fillTinyMceSourceDialog(page, cfg.itemLongDescIframe, item.longDescription ?? "", timeoutMs);

      if (maxImages > 0) {
        const paths = Array.isArray(item.imagePaths)
          ? item.imagePaths
          : item.imagePath ? [item.imagePath] : [];

        const filesToUpload = paths.slice(0, maxImages);

        if (filesToUpload.length > 0) {
          filesToUpload.forEach(assertExists);

          const input = page.locator(`${cfg.imageDropZone} ${cfg.imageInput}`);
          await input.setInputFiles(filesToUpload);

          await waitForPhotoTablePreviews(page, {
            expectedCount: filesToUpload.length,
            tableSelector: cfg.photoTable,
            timeout: timeoutMs
          });
        }
      }

      await clickId(page, cfg.saveItem, timeoutMs);
      await waitForBackToList(page, cfg.addItemBtn, timeoutMs);
      createdItems++;
    }

    await waitForBackToList(page, cfg.addItemBtn, timeoutMs);
    await reorderByAddedAscending(page, cfg, timeoutMs);
    createdCategories++;

    await goToCategoryPage(page, { school, type: cfg.hash });
  }

  console.log(`Summary: Skipped ${skippedCategories} categories (${skippedItems} items), Created ${createdCategories} categories (${createdItems} items)`);
  console.log("✅ Lists seeding complete");
  return { browser, page };
}, "lists");