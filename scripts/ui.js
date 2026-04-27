// scripts/ui.js
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const verboseBrowserErrors = process.argv.includes("--verbose-browser-errors");

function shouldSuppressBrowserError(text) {
  if (!text) return true;

  if (
    text.includes("notifications-client") ||
    text.includes("negotiation") ||
    text.includes("X-Frame-Options")
  ) {
    return true;
  }

  return /Failed to load resource: the server responded with a status of (400|401|403|404|418)\b/i.test(text);
}

export function assertSelector(selector, name) {
  if (!selector) throw new Error(`${name} requires selector`);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createSessionExpiredRuntimeError(context = "page interaction") {
  const error = new Error(`SESSION_EXPIRED: Authentication expired during ${context}`);
  error.code = "SESSION_EXPIRED";
  return error;
}

async function assertNotSessionExpired(page, context = "page interaction") {
  const url = String(page.url() || "");
  const looksLikeLoginUrl = /(#login|\/login\b|\/signin\b)/i.test(url);
  const hasPasswordField =
    (await page.locator('input[type="password"], #Password').count().catch(() => 0)) > 0;

  if (looksLikeLoginUrl || hasPasswordField) {
    throw createSessionExpiredRuntimeError(context);
  }
}

function getInteractionTimeout(timeout) {
  // Keep short user timeouts from making navigation-level controls too flaky.
  const parsed = Number(timeout);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12000;
  return Math.max(12000, parsed);
}

/**
 * Convert ISO date (YYYY-MM-DD) to MM/DD/YYYY
 */
export function toMmDdYyyy(value) {
  if (!value) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const m = String(value).match(iso);
  if (!m) return String(value);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export function authFileForSchool(school, baseDir = process.cwd()) {
  return path.join(baseDir, "auth", `${school}.json`);
}

export function resolveAuthFileForSchool(school, baseDir = process.cwd()) {
  const primary = authFileForSchool(school, baseDir);
  if (fs.existsSync(primary)) return primary;

  for (const profile of ["sean", "default"]) {
    const legacy = path.join(baseDir, "auth", profile, `${school}.json`);
    if (fs.existsSync(legacy)) return legacy;
  }

  return primary;
}

function schoolArgFromProcess() {
  const idx = process.argv.indexOf("--school");
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

async function runLoginRecoveryForSchool(school) {
  return new Promise((resolve) => {
    const child = spawn("node", ["./scripts/login.js", "--school", school], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });

    child.on("error", () => resolve(1));
  });
}

/**
 * Create browser context for seeder with auth state
 */
export async function createSeederContext(authFile, headless = false) {
  if (!fs.existsSync(authFile)) {
    const school = path.basename(String(authFile || ""), ".json") || "<schoolname>";
    throw new Error(
      `AUTH_MISSING: No saved login state found for school '${school}'. ` +
      `Run 'npm run login -- --school ${school}' first.`
    );
  }

  const browser = await chromium.launch({ headless, channel: "chrome" });
  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();

  // Keep normal runs readable while preserving an opt-in verbose mode.
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text() || "";
    if (!verboseBrowserErrors && shouldSuppressBrowserError(text)) {
      return;
    }
    console.error("BROWSER ERROR:", text);
  });

  return { browser, context, page };
}

export async function categoryExistsOnPage(page, categoryName) {
  const target = normalizeText(categoryName);
  if (!target) return false;

  return page.evaluate((expected) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const scope = document.querySelector("#site-main") || document.body;
    const candidates = scope.querySelectorAll(
      ".bb-tile-content tr, .bb-tile-content .list-group-item, .bb-tile-content td a, .bb-tile-content a"
    );

    return Array.from(candidates).some((node) => normalize(node.textContent) === expected);
  }, target);
}

export async function itemExistsInCategory(page, itemTitle) {
  const target = normalizeText(itemTitle);
  if (!target) return false;

  await page.locator("#site-main .bb-tile-content").first().waitFor({
    state: "visible",
    timeout: 10000
  }).catch(() => {});

  return page.evaluate((expected) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const scope = document.querySelector("#site-main") || document.body;
    const candidates = scope.querySelectorAll(
      ".bb-tile-content tr, .bb-tile-content .list-group-item, .bb-tile-content td a, .bb-tile-content a"
    );

    return Array.from(candidates).some((node) => normalize(node.textContent) === expected);
  }, target);
}

export async function itemExistsOnPage(page, itemTitle) {
  const target = normalizeText(itemTitle);
  if (!target) return false;

  return page.evaluate((expected) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const modal = document.querySelector("#site-modal") || document.body;
    
    const candidates = modal.querySelectorAll(
      "tbody tr, .list-group-item, td, th, a, button, div[role='row'], span.item-title, .item-name"
    );

    return Array.from(candidates).some((node) => {
      const text = normalize(node.textContent);
      return text === expected || text.startsWith(expected + " ");
    });
  }, target);
}

/**
 * Search for a category by exact name using the search UI.
 * Returns true if found, false otherwise.
 */
export async function categoryExistsBySearch(page, categoryName, searchInputSelector, searchBtnSelector, timeoutMs = 10000) {
  if (!categoryName || !searchInputSelector || !searchBtnSelector) return false;

  try {
    const target = normalizeText(categoryName);
    if (!target) return false;

    const searchInput = page.locator(searchInputSelector).first();
    const searchButton = page.locator(searchBtnSelector).first();

    await searchInput.clear().catch(() => {});
    await searchInput.fill(categoryName);
    await searchButton.click();

    const start = Date.now();
    const maxWait = Math.max(1000, Number(timeoutMs) || 10000);
    let lastFingerprint = "";
    let stableRounds = 0;

    while (Date.now() - start < maxWait) {
      const result = await page.evaluate((expected) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const scope = document.querySelector("#site-main") || document.body;
        const candidates = scope.querySelectorAll(
          ".bb-tile-content tr, .bb-tile-content .list-group-item, .bb-tile-content td a, .bb-tile-content a"
        );
        const texts = Array.from(candidates)
          .map((node) => normalize(node.textContent))
          .filter(Boolean);
        return {
          found: texts.some((text) => text === expected),
          fingerprint: texts.slice(0, 200).join("||")
        };
      }, target);

      if (result.found) {
        return true;
      }

      if (result.fingerprint === lastFingerprint) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        lastFingerprint = result.fingerprint;
      }

      // If results are stable for a bit, treat as definitive miss.
      if (stableRounds >= 3 && Date.now() - start >= 1200) {
        return false;
      }

      await page.waitForTimeout(250);
    }

    return false;
  } catch (e) {
    // If search fails, assume category doesn't exist (don't throw)
    return false;
  }
}

/**
 * Wrap seeder async logic with error handling and cleanup
 */
export async function runSeederWithErrorHandler(asyncFn, typeLabel) {
  let browser;
  let page;
  const school = schoolArgFromProcess();
  let retriedAfterAuthMissing = false;

  while (true) {
    try {
      const result = await asyncFn();
      browser = result.browser;
      page = result.page;
      if (browser) {
        await browser.close();
      }
      process.exit(0);
    } catch (e) {
      const message = String(e?.message || e || "");
      const canAutoRecover =
        /AUTH_MISSING/.test(message)
        && !retriedAfterAuthMissing
        && !!school
        && process.env.BBSWS_WEB_MODE !== "1";

      if (canAutoRecover) {
        retriedAfterAuthMissing = true;
        console.log(`🔐 Missing auth for ${school}. Launching login flow for one automatic retry...`);

        const loginExitCode = await runLoginRecoveryForSchool(school);
        if (loginExitCode === 0) {
          console.log(`✅ Login completed. Retrying seed-${typeLabel} once...`);
          continue;
        }

        console.error(`❌ Login retry failed (exit code ${loginExitCode}).`);
      }

      if (page) {
        await page.screenshot({ path: "error.png", fullPage: true }).catch(() => {});
      }
      console.error(`❌ seed-${typeLabel} failed:`, e);
      if (browser) {
        await browser.close().catch(() => {});
      }
      process.exit(1);
    }
  }
}

/**
 * Fill field only if selector exists and element is visible
 */
export async function fillIfVisible(page, selector, value) {
  if (!selector || value == null) return false;

  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return false;
  if (!(await el.isVisible().catch(() => false))) return false;

  await el.fill(String(value));
  return true;
}

/**
 * Check/uncheck checkbox only if selector exists and element is visible
 */
export async function checkIfVisible(page, selector, shouldBeChecked) {
  if (!selector || typeof shouldBeChecked !== "boolean") return false;

  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return false;
  if (!(await el.isVisible().catch(() => false))) return false;

  const checked = await el.isChecked().catch(() => null);
  if (checked === null) return false;

  if (checked !== shouldBeChecked) {
    await el.click();
  }
  return true;
}

/**
 * Try clicking multiple selectors, with DOM-click fallback for hidden inputs.
 * Useful for BBSWS radio buttons that are hidden behind styled controls.
 */
export async function clickFirstVisible(page, selectors, timeout = 30000) {
  if (!Array.isArray(selectors)) {
    selectors = [selectors];
  }

  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) continue;

    const visible = await el.isVisible().catch(() => false);
    if (visible) {
      try {
        await el.click({ timeout });
        return selector;
      } catch {
        // Fall through to DOM-click fallback below
      }
    }

    // Some BBSWS radios are hidden inputs behind styled controls
    const clicked = await page
      .evaluate((sel) => {
        const node = document.querySelector(sel);
        if (!node) return false;
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, selector)
      .catch(() => false);

    if (clicked) {
      return selector;
    }
  }
  throw new Error(`No selectable selector found among: ${selectors.join(", ")}`);
}

export async function clickId(page, selector, timeout = 30000) {
  assertSelector(selector, "clickId");
  const el = page.locator(selector);
  const interactionTimeout = getInteractionTimeout(timeout);
  try {
    await el.waitFor({ state: "visible", timeout: interactionTimeout });
  } catch (error) {
    await assertNotSessionExpired(page, `clickId(${selector})`);
    throw error;
  }
  await el.click({ timeout: interactionTimeout });
}

export async function fillId(page, selector, value, timeout = 30000) {
  assertSelector(selector, "fillId");
  const el = page.locator(selector);
  const interactionTimeout = getInteractionTimeout(timeout);
  try {
    await el.waitFor({ state: "visible", timeout: interactionTimeout });
  } catch (error) {
    await assertNotSessionExpired(page, `fillId(${selector})`);
    throw error;
  }
  await el.fill(value);
}

export async function ensureLabelActive(form, labelSelector, timeout = 15000) {
  assertSelector(labelSelector, "ensureLabelActive");
  const label = form.locator(labelSelector);
  await label.waitFor({ state: "visible", timeout });

  const cls = (await label.getAttribute("class").catch(() => "")) || "";
  if (!cls.includes("active")) {
    await label.click();
    await form.waitForFunction(el => el.classList.contains("active"), label);
  }
}
export async function fillTinyMceSourceDialog(page, iframeIdSelector, html, timeout = 30000) {
  assertSelector(iframeIdSelector, "fillTinyMceSourceDialog");

  const iframe = page.locator(`iframe${iframeIdSelector}`);
  await iframe.waitFor({ state: "visible", timeout });

  // Focus the editor instance (important when multiple editors are on the page)
  const frame = page.frameLocator(`iframe${iframeIdSelector}`);
  await frame.locator("body").click({ timeout });

  // Find the TinyMCE root container that owns this iframe
  const editorRoot = iframe.locator(
    'xpath=ancestor::*[contains(@class,"tox-tinymce")]'
  ).first();

  await editorRoot.waitFor({ state: "visible", timeout });

  // Click the "<>" toolbar button (aria-label is typically "Source code")
  const sourceBtn = editorRoot.locator('button[aria-label="Source code"]');
  await sourceBtn.waitFor({ state: "visible", timeout });
  await sourceBtn.click();

  // Dialog + textarea
  const dialog = page.locator(".tox-dialog");
  await dialog.waitFor({ state: "visible", timeout });

  const textarea = dialog.locator("textarea");
  await textarea.waitFor({ state: "visible", timeout });
  await textarea.fill(html ?? "");

  // Save/OK
  const saveBtn = dialog.locator('button:has-text("Save"), button:has-text("OK")');
  await saveBtn.first().click();

  await dialog.waitFor({ state: "hidden", timeout });
}

export async function waitForBackToList(page, addBtnSelector, timeout = 30000) {
  assertSelector(addBtnSelector, "waitForBackToList");
  const interactionTimeout = getInteractionTimeout(timeout);
  await waitForSiteModalToClose(page, interactionTimeout, `returning to list for ${addBtnSelector}`);
  try {
    await page.locator(addBtnSelector).waitFor({ state: "visible", timeout: interactionTimeout });
  } catch (error) {
    await assertNotSessionExpired(page, `waitForBackToList(${addBtnSelector})`);
    throw error;
  }
}

export async function waitForSiteModalToClose(page, timeout = 30000, actionLabel = "modal action") {
  const interactionTimeout = getInteractionTimeout(timeout);
  const modal = page.locator("#site-modal").first();

  if ((await modal.count()) === 0) {
    return;
  }

  const finishIfHidden = async () => {
    await modal.waitFor({ state: "hidden", timeout: interactionTimeout });
  };

  try {
    await finishIfHidden();
    return;
  } catch {
    const diagnostics = await page.evaluate(() => {
      const modalEl = document.querySelector("#site-modal") || document.body;
      const errorTexts = Array.from(
        modalEl.querySelectorAll(
          ".validation-summary-errors, .field-validation-error, .text-danger, .error, .help-block"
        )
      )
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);

      const closeClicked = (() => {
        const controls = Array.from(
          modalEl.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')
        );

        const target = controls.find((node) => {
          const id = String(node.id || "").toLowerCase();
          const cls = String(node.className || "").toLowerCase();
          const text = String(node.textContent || node.value || "").trim().toLowerCase();
          const dismiss = String(node.getAttribute?.("data-dismiss") || "").toLowerCase();

          return dismiss === "modal"
            || id.includes("cancel")
            || id.includes("close")
            || cls.includes("close")
            || text === "cancel"
            || text === "close";
        });

        if (!target) return false;
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return true;
      })();

      return { errorTexts, closeClicked };
    });

    if (diagnostics.errorTexts.length > 0) {
      throw new Error(`${actionLabel} validation failed: ${diagnostics.errorTexts.join(" | ")}`);
    }

    if (!diagnostics.closeClicked) {
      await page.keyboard.press("Escape").catch(() => {});
    }

    try {
      await finishIfHidden();
    } catch {
      throw new Error(
        `${actionLabel} did not close #site-modal within ${interactionTimeout}ms and no visible validation text was found`
      );
    }
  }
}

export async function waitForPhotoTablePreviews(
  page,
  { expectedCount, tableSelector, timeout = 30000 } = {}
) {
  if (!tableSelector) throw new Error("waitForPhotoTablePreviews requires tableSelector");
  if (!expectedCount || expectedCount <= 0) return;

  const tbodySel = `${tableSelector} tbody`;
  const rowSel = `${tbodySel} tr`;
  const imgSel = `${rowSel} img`;

  await page.locator(tbodySel).waitFor({ state: "attached", timeout });

  await page.waitForFunction(
    ({ rowSel, imgSel, expected }) => {
      const rows = document.querySelectorAll(rowSel);
      if (rows.length < expected) return false;

      const imgs = Array.from(document.querySelectorAll(imgSel));
      const populated = imgs.filter(img => {
        const src = (img.getAttribute("src") || "").trim();
        return src.length > 0;
      });

      return populated.length >= expected;
    },
    { rowSel, imgSel, expected: expectedCount },
    { timeout }
  );
}

export async function reorderByAddedAscending(page, cfg, timeout = 30000) {
  // Fail fast if config is missing
  if (!cfg.organizeBtn) throw new Error("TYPE_CONFIG.list missing organizeBtn");
  if (!cfg.sortAddedAscBtn) throw new Error("TYPE_CONFIG.list missing sortAddedAscBtn");
  if (!cfg.saveOrderBtn) throw new Error("TYPE_CONFIG.list missing saveOrderBtn");

  // 1) Open organize modal
  await clickId(page, cfg.organizeBtn, timeout);

  // 2) Wait for modal to be open (no modal id, so use presence of sort button)
  const sortBtn = page.locator(cfg.sortAddedAscBtn);
  await sortBtn.waitFor({ state: "visible", timeout });

  // 3) Apply "Order Added Asc"
  await clickId(page, cfg.sortAddedAscBtn, timeout);

  // 4) Save order (also closes modal)
  await clickId(page, cfg.saveOrderBtn, timeout);

  // 5) Confirm modal closed by waiting for sort button to disappear
  await sortBtn.waitFor({ state: "hidden", timeout });
}
// Wait until a link-image preview cell contains an <img> with a non-empty src
export async function waitForImageInCell(page, cellSelector, timeout = 30000) {
  if (!cellSelector) {
    throw new Error("waitForImageInCell requires cellSelector");
  }

  const img = page.locator(`${cellSelector} img`);

  // Wait for the <img> to appear
  await img.first().waitFor({ state: "visible", timeout });

  // And ensure it has a real src (avoid placeholder empty nodes)
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const src = (el.getAttribute("src") || "").trim();
      return src.length > 0;
    },
    `${cellSelector} img`,
    { timeout }
  );
}
export async function waitForUploadProgressToDisappear(page, {
  progressSelector,
  scopeSelector = "body",
  timeout = 30000
} = {}) {
  if (!progressSelector) {
    throw new Error("waitForUploadProgressToDisappear requires progressSelector");
  }

  // Wait until there is NO progress element inside scope
  await page.waitForFunction(
    ({ prog, scope }) => {
      const root = document.querySelector(scope) || document.body;
      return root.querySelectorAll(prog).length === 0;
    },
    { prog: progressSelector, scope: scopeSelector },
    { timeout }
  );
}
