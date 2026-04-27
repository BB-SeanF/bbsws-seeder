// scripts/seed-events.js
import path from "node:path";

import { requireArg, getTimeoutMs, hasFlag, getHeadless } from "./cli.js";
import { validateConfig } from "./validate.js";
import { goToCategoryPage } from "./nav.js";
import { TYPE_CONFIG } from "./types.js";
import {
  clickId,
  fillId,
  ensureLabelActive,
  fillTinyMceSourceDialog,
  fillIfVisible,
  checkIfVisible,
  clickFirstVisible,
  toMmDdYyyy,
  categoryExistsBySearch,
  authFileForSchool,
  resolveAuthFileForSchool,
  createSeederContext,
  runSeederWithErrorHandler
} from "./ui.js";

import events from "../data/events.json" with { type: "json" };

const school = requireArg("school");
const dryRun = hasFlag("dry-run");
const preCheck = hasFlag("pre-check");
const headless = getHeadless(false);
const timeoutMs = getTimeoutMs();
const authFile = resolveAuthFileForSchool(school);
const cfg = TYPE_CONFIG.event;

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
    "saveAndAddItem",
    "itemTitle",
    "saveItem",
    "saveAndAddItemEvent",
    "cancelItem"
  ],
  "TYPE_CONFIG.event"
);

async function fillTinyIfVisible(page, iframeSelector, html) {
  if (html == null) return false;
  const iframe = page.locator(`iframe${iframeSelector}`).first();
  if ((await iframe.count()) === 0) return false;
  if (!(await iframe.isVisible().catch(() => false))) return false;
  await fillTinyMceSourceDialog(page, iframeSelector, html, timeoutMs);
  return true;
}

async function saveEventOrThrow(page, { addAnother, eventTitle }) {
  const saveSelector = addAnother ? cfg.saveAndAddItemEvent : cfg.saveItem;
  await clickId(page, saveSelector, timeoutMs);

  if (addAnother) {
    await page.locator(cfg.itemTitle).waitFor({ state: "visible", timeout: timeoutMs });
    return;
  }

  try {
    await page.locator(cfg.cancelItem).waitFor({ state: "hidden", timeout: timeoutMs });
    await page.locator("#site-modal").waitFor({ state: "hidden", timeout: timeoutMs });
    return;
  } catch {
    const errors = await page.evaluate(() => {
      const modal = document.querySelector("#site-modal") || document.body;
      return Array.from(
        modal.querySelectorAll(
          ".validation-summary-errors, .field-validation-error, .text-danger, .error, .help-block"
        )
      )
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);
    });

    if (errors.length > 0) {
      throw new Error(`Event save validation failed: ${errors.join(" | ")}`);
    }

    // Some event saves commit without auto-closing the editor
    await clickId(page, cfg.cancelItem, timeoutMs);
    await page.locator(cfg.cancelItem).waitFor({ state: "hidden", timeout: timeoutMs });
    await page.locator(cfg.itemTitle).waitFor({ state: "hidden", timeout: timeoutMs }).catch(() => {});
  }
}

async function fillSingleEvent(page, item) {
  await clickFirstVisible(page, [cfg.singleEventRadio, "#rdoSingleEvents"], timeoutMs);

  if (!item.startDate) {
    throw new Error(`Single event requires startDate: ${item.title}`);
  }

  await fillId(page, cfg.startDate, toMmDdYyyy(item.startDate), timeoutMs);
  await fillIfVisible(page, cfg.startTime, item.startTime);
  await fillIfVisible(page, cfg.endDate, toMmDdYyyy(item.endDate));
  await fillIfVisible(page, cfg.endTime, item.endTime);
}

async function fillRecurringEvent(page, item) {
  await clickFirstVisible(page, [cfg.recurringEventRadio], timeoutMs);

  const recurrence = item.recurrence ?? {};
  const pattern = recurrence.pattern ?? "weekly";

  const patternMap = {
    daily: ["#rdoDaily", "#recurDaily"],
    weekly: ["#rdoWeekly", "#recurWeekly"],
    monthly: ["#rdoMonthly", "#recurMonthly"],
    yearly: ["#rdoYearly", "#recurYearly"]
  };

  const patternSelectors = patternMap[pattern];
  if (!patternSelectors) {
    throw new Error(`Unsupported recurrence pattern: ${pattern}`);
  }
  await clickFirstVisible(page, patternSelectors, timeoutMs);

  await fillIfVisible(page, cfg.recurStart, recurrence.startTime);
  await fillIfVisible(page, cfg.recurEnd, recurrence.endTime);
  await fillIfVisible(page, "#StartRecurrence", toMmDdYyyy(recurrence.startDate));

  if (recurrence.endAfterCount != null) {
    await clickFirstVisible(page, ["#rdoRecurEndCount"], timeoutMs);
    await fillIfVisible(page, "#txtRecurCount", recurrence.endAfterCount);
  } else if (recurrence.endByDate) {
    await clickFirstVisible(page, ["#rdoRecurEndDate"], timeoutMs);
    await fillIfVisible(page, "#EndRecurrence", toMmDdYyyy(recurrence.endByDate));
  }

  if (pattern === "daily") {
    if (recurrence.daily?.weekdaysOnly) {
      await clickFirstVisible(page, ["#rdoWeekdays"], timeoutMs);
    } else if (recurrence.daily?.interval != null) {
      await clickFirstVisible(page, ["#rdoDays"], timeoutMs);
      await fillIfVisible(page, "#txtDailyDays", recurrence.daily.interval);
    }
  }

  if (pattern === "weekly") {
    if (recurrence.weekly?.interval != null) {
      await fillIfVisible(page, "#txtWeeks", recurrence.weekly.interval);
    }
    const days = Array.isArray(recurrence.weekly?.days)
      ? recurrence.weekly.days.map((d) => String(d).toLowerCase())
      : [];
    const dayMap = {
      sunday: "#chkSunday",
      monday: "#chkMonday",
      tuesday: "#chkTuesday",
      wednesday: "#chkWednesday",
      thursday: "#chkThursday",
      friday: "#chkFriday",
      saturday: "#chkSaturday"
    };
    for (const [day, selector] of Object.entries(dayMap)) {
      await checkIfVisible(page, selector, days.includes(day));
    }
  }

  if (pattern === "monthly") {
    if (recurrence.monthly?.mode === "nth-day") {
      await clickFirstVisible(page, ["#rdoMonthSelect"], timeoutMs);
      await fillIfVisible(page, "#ddlb_WeekOfMonth", recurrence.monthly.weekOfMonth);
      await fillIfVisible(page, "#ddlb_Day", recurrence.monthly.dayOfWeekType);
      await fillIfVisible(page, "#txtMonths2", recurrence.monthly.intervalMonths);
    } else {
      await clickFirstVisible(page, ["#rdoMonthDay"], timeoutMs);
      await fillIfVisible(page, "#txtMonthDay", recurrence.monthly?.dayOfMonth);
      await fillIfVisible(page, "#txtMonths", recurrence.monthly?.intervalMonths);
    }
  }

  if (pattern === "yearly") {
    if (recurrence.yearly?.mode === "nth-day") {
      await clickFirstVisible(page, ["#rdoYearlyPeriod"], timeoutMs);
      await fillIfVisible(page, "#ddlb_YearlyWeek", recurrence.yearly.weekOfMonth);
      await fillIfVisible(page, "#ddlb_YearlyDay", recurrence.yearly.dayOfWeekType);
      await fillIfVisible(page, "#ddlb_Month2", recurrence.yearly.month);
    } else {
      await clickFirstVisible(page, ["#rdoYearlyDate"], timeoutMs);
      await fillIfVisible(page, "#ddlb_Month", recurrence.yearly?.month);
      await fillIfVisible(page, "#txtMonthDay", recurrence.yearly?.dayOfMonth);
    }
  }
}

runSeederWithErrorHandler(async () => {
  if (!Array.isArray(events.categories)) {
    throw new Error('data/events.json must contain { "categories": [ ... ] }');
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

  for (const category of events.categories) {
    console.log(`➡️ Event category: ${category.name}`);

    // Dry-run: validate selectors exist and are visible; skip creation
    if (dryRun) {
      console.log(`[dry-run] validating category: "${category.name}"`);
      const addBtn = page.locator(cfg.addCategoryBtn).first();
      await addBtn.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => {
        throw new Error(`Add button not found/visible: ${cfg.addCategoryBtn}`);
      });
      const items = Array.isArray(category.events) ? category.events : [];
      console.log(`[dry-run] ✓ add button visible; would create ${items.length} events`);
      for (const item of items) {
        console.log(`[dry-run]   ✓ would create event: "${item.title}"`);
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

    await ensureLabelActive(form, `${cfg.accessGroup} ${cfg.publicLabel}`, timeoutMs);
    await fillId(page, `${cfg.categoryForm} ${cfg.categoryName}`, category.name, timeoutMs);

    await checkIfVisible(page, `${cfg.categoryForm} ${cfg.showBriefToggle}`, category.showBriefDescription ?? true);
    await checkIfVisible(page, `${cfg.categoryForm} ${cfg.showLongToggle}`, category.showLongDescription ?? true);
    await checkIfVisible(page, `${cfg.categoryForm} ${cfg.enableIcalToggle}`, category.enableIcalFeed ?? true);

    const items = Array.isArray(category.events) ? category.events : [];

    await clickId(page, cfg.saveAndAddItem, timeoutMs);
    createdCategories++;
    await page.locator(cfg.itemTitle).waitFor({ state: "visible", timeout: timeoutMs });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      console.log(`   • Event item: ${item.title}`);
      await fillId(page, cfg.itemTitle, item.title, timeoutMs);

      if ((item.mode ?? "single") === "recurring") {
        await fillRecurringEvent(page, item);
      } else {
        await fillSingleEvent(page, item);
      }

      if (item.details != null) {
        await fillTinyIfVisible(page, cfg.detailsIframe, item.details);
      }

      if (item.longDetails != null) {
        await fillTinyIfVisible(page, cfg.longDetailsIframe, item.longDetails);
      }

      if (item.newLocation) {
        await clickFirstVisible(page, [cfg.newLocationRadio], timeoutMs).catch(() => {});
        await fillIfVisible(page, cfg.newLocation, item.newLocation);
      }

      await fillIfVisible(page, cfg.contactName, item.contactName);
      await fillIfVisible(page, cfg.contactEmail, item.contactEmail);

      if (item.registrationValue != null) {
        const select = page.locator(cfg.registrationSelect).first();
        if (await select.isVisible().catch(() => false)) {
          await select.selectOption(String(item.registrationValue));
        }
      }

      await saveEventOrThrow(page, { addAnother: i < items.length - 1, eventTitle: item.title });
      createdItems++;
    }

    // Already back on list after item save; avoid a full re-navigation per category.
  }

  if (dryRun) {
    console.log("✅ Events dry run complete");
  } else {
    console.log(`Summary: Skipped ${skippedCategories} categories (${skippedItems} items), Created ${createdCategories} categories (${createdItems} items)`);
    console.log("✅ Events seeding complete");
  }

  return { browser, page };
}, "events");
