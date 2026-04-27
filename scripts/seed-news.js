// scripts/seed-news.js
import path from "node:path";
import fs from "node:fs";

import { requireArg, getArg, getTimeoutMs, hasFlag, getHeadless } from "./cli.js";
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
	fillIfVisible,
	toMmDdYyyy,
	categoryExistsBySearch,

	createSeederContext,
	runSeederWithErrorHandler
} from "./ui.js";

import news from "../data/news.json" with { type: "json" };

function assertExists(filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`File not found: ${filePath}`);
	}
}

const school = requireArg("school");
const profile = getArg("profile", "sean");
const dryRun = hasFlag("dry-run");
const preCheck = hasFlag("pre-check");
const headless = getHeadless(false);
const timeoutMs = getTimeoutMs();
const authFile = path.join("auth", profile, `${school}.json`);
const cfg = TYPE_CONFIG.news;

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
		"saveAndAddItem",
		"addItemBtn",
		"itemTitle",
		"itemSummaryIframe",
		"itemBodyIframe",
		"imageDropZone",
		"imageInput",
		"photoTable",
		"photoCaptionInput",
		"itemCancelBtn",
		"saveItem"
	],
	"TYPE_CONFIG.news"
);

async function uploadNewsPhotos(page, photos, timeout) {
	if (!cfg.imageDropZone || !cfg.imageInput || !cfg.photoTable) return;
	if (!Array.isArray(photos) || photos.length === 0) return;

	const input = page.locator(`#site-modal ${cfg.imageDropZone} ${cfg.imageInput}`).first();
	await input.waitFor({ state: "attached", timeout });

	photos.forEach((photo) => assertExists(photo.filePath));

	await input.setInputFiles(photos.map((photo) => photo.filePath));

	await waitForPhotoTablePreviews(page, {
		expectedCount: photos.length,
		tableSelector: `#site-modal ${cfg.photoTable}`,
		timeout
	});

	for (let i = 0; i < photos.length; i++) {
		const photo = photos[i];
		if (!photo.caption) continue;

		const row = page.locator(`#site-modal ${cfg.photoTable} tbody tr`).nth(i);
		const captionInput = row.locator(cfg.photoCaptionInput).first();
		await captionInput.waitFor({ state: "visible", timeout });
		await captionInput.fill(photo.caption);
	}
}

async function saveNewsItemOrThrow(page, timeout) {
	const button = page.locator(`#site-modal ${cfg.saveItem}`).first();
	await button.waitFor({ state: "visible", timeout });
	await button.click();

	try {
		await page.locator(`#site-modal ${cfg.itemCancelBtn}`).waitFor({ state: "hidden", timeout });
		await page.locator("#site-modal").waitFor({ state: "hidden", timeout });
		return;
	} catch {
		const details = await page.evaluate(() => {
			const modal = document.querySelector("#site-modal") || document.body;
			const errNodes = modal.querySelectorAll(
				".validation-summary-errors, .field-validation-error, .text-danger, .error, .help-block"
			);
			const errors = Array.from(errNodes)
				.map((n) => (n.textContent || "").trim())
				.filter(Boolean);

			const requiredLike = Array.from(modal.querySelectorAll("label"))
				.map((n) => (n.textContent || "").trim())
				.filter((text) => text.includes("*"));

			return { errors, requiredLike };
		});

		const errText = details.errors.length
			? details.errors.join(" | ")
			: "No visible validation text found";
		const requiredText = details.requiredLike.length
			? details.requiredLike.join(", ")
			: "none";

		throw new Error(
			`News item save did not close modal within ${timeout}ms. ` +
			`Validation: ${errText}. Required markers: ${requiredText}`
		);
	}
}

runSeederWithErrorHandler(async () => {
	function logDryRun(message) {
		if (dryRun) {
			console.log(`[dry-run] ${message}`);
		}
	}

	if (!Array.isArray(news.categories)) {
		throw new Error('data/news.json must contain { "categories": [ ... ] }');
	}

	let skippedCategories = 0;
	let createdCategories = 0;
	let skippedItems = 0;
	let createdItems = 0;

	// Create browser context (used for both dry-run and real run)
	const { browser, context, page } = await createSeederContext(authFile, headless);
	page.setDefaultTimeout(timeoutMs);

	await goToCategoryPage(page, {
		school,
		type: cfg.hash,
		readySelector: [cfg.addCategoryBtn, cfg.searchInput],
		timeoutMs
	});

	for (const category of news.categories) {
		console.log(`➡️ News category: ${category.name}`);

		// Dry-run: validate selectors exist and are visible; skip creation
		if (dryRun) {
			logDryRun(`validating category: "${category.name}"`);
			const addBtn = page.locator(cfg.addCategoryBtn).first();
			await addBtn.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => {
				throw new Error(`Add button not found/visible: ${cfg.addCategoryBtn}`);
			});
			logDryRun(`✓ add button visible; would create ${category.items.length} items`);
			for (const item of category.items) {
				logDryRun(`  ✓ would create item: "${item.title}"`);
			}
			createdCategories++;
			continue;
		}

		// Real run: create category and items

		if (preCheck && await categoryExistsBySearch(page, category.name, cfg.searchInput, cfg.searchBtn, timeoutMs)) {
			console.log(`⏭️ Skipping existing category: ${category.name}`);
			skippedCategories++;
			continue;
		}

		await page.locator(cfg.searchInput).first().clear().catch(() => {});



		await clickId(page, cfg.addCategoryBtn, timeoutMs);

		const form = page.locator(cfg.categoryForm);
		await form.waitFor({ state: "visible", timeout: timeoutMs });

		await ensureLabelActive(form, `${cfg.accessGroup} ${cfg.publicLabel}`);
		await fillId(page, `${cfg.categoryForm} ${cfg.categoryName}`, category.name, timeoutMs);

		await clickId(page, cfg.saveAndAddItem, timeoutMs);
		await waitForBackToList(page, cfg.addItemBtn, timeoutMs);

		createdCategories++;

		for (let i = 0; i < category.items.length; i++) {
			const item = category.items[i];
			console.log(`   • News item: ${item.title}`);
			await clickId(page, cfg.addItemBtn, timeoutMs);
			await page.locator(`#site-modal ${cfg.itemTitle}`).waitFor({ state: "visible", timeout: timeoutMs });

			await fillId(page, `#site-modal ${cfg.itemTitle}`, item.title, timeoutMs);

			if (cfg.itemAuthor && item.author) {
				await fillIfVisible(page, `#site-modal ${cfg.itemAuthor}`, item.author);
			}

			if (cfg.itemDate && item.date) {
				const filled = await fillIfVisible(page, `#site-modal ${cfg.itemDate}`, toMmDdYyyy(item.date));
				if (filled && cfg.applyItemDateBtn) {
					const applyBtn = page.locator(`#site-modal ${cfg.applyItemDateBtn}`).first();
					if (await applyBtn.isVisible().catch(() => false)) {
						await applyBtn.click();
					}
				}
			}

			await fillTinyMceSourceDialog(page, cfg.itemSummaryIframe, item.summary ?? "");
			await fillTinyMceSourceDialog(page, cfg.itemBodyIframe, item.body ?? "");
			await uploadNewsPhotos(page, item.photos, timeoutMs);

			// Uploading photos can mutate form state; reassert text fields before save
			await fillId(page, `#site-modal ${cfg.itemTitle}`, item.title, timeoutMs);
			if (cfg.itemAuthor && item.author) {
				await fillIfVisible(page, `#site-modal ${cfg.itemAuthor}`, item.author);
			}

			await saveNewsItemOrThrow(page, timeoutMs);
			await waitForBackToList(page, cfg.addItemBtn, timeoutMs);
			createdItems++;
		}

		// Already back on list after item save; avoid a full re-navigation per category.
	}

	console.log(`Summary: Skipped ${skippedCategories} categories (${skippedItems} items), Created ${createdCategories} categories (${createdItems} items)`);
	console.log("✅ News seeding complete");

	return { browser, page };
}, "news");
