// scripts/nav.js
function createSessionExpiredError(school, type) {
  const error = new Error(
    `SESSION_EXPIRED: Authentication expired before loading ${type} categories for ${school}`
  );
  error.code = "SESSION_EXPIRED";
  return error;
}

export async function goToCategoryPage(page, { school, type, readySelector, timeoutMs = 10000 }) {
  const url = `https://${school}.myschoolapp.com/app/school-website?svcid=edu#${type}/category/page`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const readyTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 10000;
  const readySelectors = Array.isArray(readySelector)
    ? readySelector.filter(Boolean)
    : (readySelector ? [readySelector] : []);

  const landedOnLoginEarly = page.url().includes("#login")
    || await page.locator('input[type="password"], #Password').count().catch(() => 0) > 0;

  if (landedOnLoginEarly) {
    throw createSessionExpiredError(school, type);
  }

  // Use a short, opportunistic readiness wait. Downstream selector actions are authoritative.
  if (readySelectors.length > 0) {
    const probeTimeout = Math.min(3000, readyTimeout);
    await Promise.any(
      readySelectors.map((selector) =>
        page.locator(selector).first().waitFor({ state: "visible", timeout: probeTimeout })
      )
    ).catch(() => {});
  } else {
    await page.locator("#site-main .bb-tile-content").first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  }

  const landedOnLogin = page.url().includes("#login")
    || await page.locator('input[type="password"], #Password').count().catch(() => 0) > 0;

  if (landedOnLogin) {
    throw createSessionExpiredError(school, type);
  }
}
