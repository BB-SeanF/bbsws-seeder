// scripts/seed-photos.js
import fs from "node:fs";
import path from "node:path";

import { requireArg, getArg, getTimeoutMs, getHeadless, hasFlag } from "./cli.js";
import { validateConfig } from "./validate.js";
import { goToCategoryPage } from "./nav.js";
import { TYPE_CONFIG } from "./types.js";
import {
  clickId,
  fillId,
  ensureLabelActive,
  categoryExistsBySearch,
  authFileForSchool,
  resolveAuthFileForSchool,
  createSeederContext,
  runSeederWithErrorHandler
} from "./ui.js";

import photosData from "../data/photos.json" with { type: "json" };

const school = requireArg("school");
const preCheck = hasFlag("pre-check");

const headless = getHeadless(false);
const timeoutMs = getTimeoutMs();
const albumIndex = Number(getArg("album", "0"));

const authFile = resolveAuthFileForSchool(school);
const cfg = TYPE_CONFIG.photo;

if (authFile !== authFileForSchool(school)) {
  console.log(`ℹ️ Using legacy auth state: ${path.relative(process.cwd(), authFile)}`);
}

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
    "saveAndAddPhotos",
    "albumTitle",
    "fileInput",
    "previewTable",
    "previewRow",
    "photoTitleInput",
    "photoCaptionInput",
    "photoTagsInput",
    "addItemBtn"
  ],
  "TYPE_CONFIG.photo"
);

function assertExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Photo file not found: ${filePath}`);
  }
}

async function waitForUploadInputReady(page) {
  await page.waitForFunction(
    (selector) => {
      const el = document.querySelector(selector);
      return !!el && !el.disabled;
    },
    cfg.fileInput,
    { timeout: timeoutMs }
  );
}

async function waitForNewPhotoRow(page, beforeCount) {
  await page.waitForFunction(
    ({ table, row, before }) =>
      document.querySelectorAll(`${table} ${row}`).length > before,
    {
      table: cfg.previewTable,
      row: cfg.previewRow,
      before: beforeCount
    },
    { timeout: timeoutMs }
  );
}

async function applyMetadata(row, photo) {
  await row.click();

  if (photo.title) {
    await row.locator(cfg.photoTitleInput).fill(photo.title);
  }
  if (photo.caption) {
    await row.locator(cfg.photoCaptionInput).fill(photo.caption);
  }
  if (photo.tags) {
    await row.locator(cfg.photoTagsInput).fill(photo.tags);
  }
}

async function saveAlbumHardAndVerify(page, albumTitle) {
  const saveBtn = page.locator("#btnSavePhoto");
  await saveBtn.waitFor({ state: "visible", timeout: timeoutMs });
  await saveBtn.click();

  // 2) Verify editor actually closed (album title input goes away)
  // If it doesn't close quickly, click Save once more and wait again.
  try {
    await page.waitForSelector("#tb-photo-title", { state: "detached", timeout: timeoutMs });
  } catch {
    await saveBtn.click().catch(() => {});
    await page.waitForSelector("#tb-photo-title", { state: "detached", timeout: timeoutMs });
  }

  await page.locator(cfg.addItemBtn).waitFor({ state: "visible", timeout: timeoutMs });
  await page.locator(`text="${albumTitle}"`).first().waitFor({ state: "visible", timeout: timeoutMs });
}

runSeederWithErrorHandler(async () => {
  const { browser, context, page } = await createSeederContext(authFile, headless);
  page.setDefaultTimeout(timeoutMs);

  if (!Array.isArray(photosData.categories)) {
    throw new Error('data/photos.json must contain { "categories": [ ... ] }');
  }

  let skippedCategories = 0;
  let createdCategories = 0;
  let skippedItems = 0;
  let createdItems = 0;

  await goToCategoryPage(page, { school, type: cfg.hash });

  for (const category of photosData.categories) {

    if (preCheck && await categoryExistsBySearch(page, category.name, cfg.searchInput, cfg.searchBtn, timeoutMs)) {
      console.log(`⏭️ Skipping existing category: ${category.name}`);
      skippedCategories++;
      continue;
    }

    await page.locator(cfg.searchInput).first().clear().catch(() => {});


    const albums = Array.isArray(category.albums)
      ? category.albums
      : Array.isArray(category.photos)
        ? [{
            title: category.albumName ?? category["album name"] ?? category.name,
            photos: category.photos
          }]
        : [];
    const album = albums[albumIndex];

    if (!album) {
      console.log(`ℹ️ No album at index ${albumIndex} for category "${category.name}"`);
      continue;
    }

    console.log(`➡️ Photo category: ${category.name}`);
    console.log(`   🖼️ Single album run: [${albumIndex}] ${album.title}`);

    await clickId(page, cfg.addCategoryBtn, timeoutMs);

    const form = page.locator(cfg.categoryForm);
    await form.waitFor({ state: "visible", timeout: timeoutMs });

    await ensureLabelActive(form, `${cfg.accessGroup} ${cfg.publicLabel}`, timeoutMs);
    await fillId(page, `${cfg.categoryForm} ${cfg.categoryName}`, category.name, timeoutMs);

    await Promise.all([
      page.waitForSelector(cfg.albumTitle, { state: "visible", timeout: timeoutMs }),
      clickId(page, cfg.saveAndAddPhotos, timeoutMs)
    ]);

    await fillId(page, cfg.albumTitle, album.title, timeoutMs);
    await waitForUploadInputReady(page);

    for (const photo of album.photos) {
      assertExists(photo.filePath);

      const beforeCount = await page
        .locator(`${cfg.previewTable} tbody ${cfg.previewRow}`)
        .count();

      const fileInput = page.locator(cfg.fileInput).first();
      await fileInput.setInputFiles(photo.filePath);

      await waitForNewPhotoRow(page, beforeCount);

      const row = page
        .locator(`${cfg.previewTable} tbody ${cfg.previewRow}`)
        .last();

      await applyMetadata(row, photo);
      createdItems++;
    }

    await saveAlbumHardAndVerify(page, album.title);
    createdCategories++;
    await goToCategoryPage(page, { school, type: cfg.hash });
  }

  console.log(`Summary: Skipped ${skippedCategories} categories (${skippedItems} items), Created ${createdCategories} categories (${createdItems} items)`);
  console.log("✅ Single-album Photos seeding complete");
  return { browser, page };
}, "photos");