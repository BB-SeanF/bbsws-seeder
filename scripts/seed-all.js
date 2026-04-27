#!/usr/bin/env node
// scripts/seed-all.js
// Master seeder: runs all 7 seeders in sequence with consolidated reporting

import { spawn } from "node:child_process";
import { requireArg, getArg, hasFlag } from "./cli.js";

const school = requireArg("school");
const stopOnError = hasFlag("stop-on-error");
const dryRun = hasFlag("dry-run");
const autoLoginRetry = !hasFlag("no-auto-login-retry");
const requestedTypesRaw = getArg("types", null);

const allSeeders = [
  { type: "news", script: "seed-news" },
  { type: "events", script: "seed-events" },
  { type: "text", script: "seed-text" },
  { type: "links", script: "seed-links" },
  { type: "lists", script: "seed-lists" },
  { type: "downloads", script: "seed-downloads" },
  { type: "photos", script: "seed-photos" },
];

function normalizeSeederToken(token) {
  return String(token || "")
    .trim()
    .toLowerCase()
    .replace(/^seed-/, "")
    .replace(/\.js$/, "");
}

function parseRequestedSeeders(rawTypes) {
  if (!rawTypes) return allSeeders;

  const rawTokens = rawTypes
    .split(",")
    .map((s) => normalizeSeederToken(s))
    .filter(Boolean);

  const uniqueTokens = [...new Set(rawTokens)];
  const resolved = [];
  const invalid = [];

  for (const token of uniqueTokens) {
    const match = allSeeders.find((s) => s.type === token);
    if (!match) {
      invalid.push(token);
      continue;
    }
    resolved.push(match);
  }

  if (invalid.length > 0) {
    const supported = allSeeders.map((s) => s.type).join(", ");
    throw new Error(`Invalid --types value(s): ${invalid.join(", ")}. Supported types: ${supported}`);
  }

  if (resolved.length === 0) {
    throw new Error("--types did not include any valid seeder types");
  }

  return resolved;
}

let selectedSeeders = parseRequestedSeeders(requestedTypesRaw);

if (dryRun) {
  const dryRunSupported = new Set(["news", "events"]);
  const unsupported = selectedSeeders.filter((s) => !dryRunSupported.has(s.type));

  if (unsupported.length > 0) {
    console.log(
      `⚠️ Dry-run is only implemented for: ${Array.from(dryRunSupported).join(", ")}. ` +
      `Skipping: ${unsupported.map((s) => s.type).join(", ")}`
    );
    selectedSeeders = selectedSeeders.filter((s) => dryRunSupported.has(s.type));
  }

  if (selectedSeeders.length === 0) {
    throw new Error("--dry-run selected but no requested seeders support dry-run yet");
  }
}

// Extract flags to pass through to each seeder
const args = process.argv.slice(2);
const passThroughArgs = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === "--school" || arg === "--types") {
    i++;
    continue;
  }

  if (arg === "--stop-on-error") {
    continue;
  }

  passThroughArgs.push(arg);
}

const results = [];
let totalSkippedCats = 0;
let totalSkippedItems = 0;
let totalCreatedCats = 0;
let totalCreatedItems = 0;
const runStartedAt = Date.now();

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function runSeeder(seederName) {
  return new Promise((resolve) => {
    const cmd = `node`;
    const seederPath = `./scripts/${seederName}.js`;
    const cmdArgs = ["--school", school, ...passThroughArgs];
    const startedAtMs = Date.now();

    console.log(`\n📋 Running ${seederName}...`);

    const child = spawn(cmd, [seederPath, ...cmdArgs], {
      stdio: "pipe",
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startedAtMs;

      // Parse summary line from output
      // Format: "Summary: Skipped X categories (Y items), Created A categories (B items)"
      const summaryMatch = stdout.match(
        /Summary: Skipped (\d+) categories \((\d+) items\), Created (\d+) categories \((\d+) items\)/
      );

      const result = {
        seeder: seederName,
        exitCode: code,
        output: stdout,
        stderr,
        durationMs,
        summary: null,
      };

      if (summaryMatch) {
        result.summary = {
          skippedCats: parseInt(summaryMatch[1]),
          skippedItems: parseInt(summaryMatch[2]),
          createdCats: parseInt(summaryMatch[3]),
          createdItems: parseInt(summaryMatch[4]),
        };

        totalSkippedCats += result.summary.skippedCats;
        totalSkippedItems += result.summary.skippedItems;
        totalCreatedCats += result.summary.createdCats;
        totalCreatedItems += result.summary.createdItems;
      }

      results.push(result);
      console.log(`⏱️ ${seederName} finished in ${formatDuration(durationMs)}`);
      resolve(result);
    });
  });
}

async function runLoginRecovery() {
  return new Promise((resolve) => {
    const cmd = "node";
    const loginPath = "./scripts/login.js";
    const loginArgs = ["--school", school];

    const child = spawn(cmd, [loginPath, ...loginArgs], {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  console.log(`🌱 Master Seeding Started`);
  console.log(`School: ${school}`);
  console.log(`Seeders: ${selectedSeeders.length}`);
  if (requestedTypesRaw) {
    console.log(`Types: ${selectedSeeders.map((s) => s.type).join(", ")}`);
  }
  console.log(`Stop on error: ${stopOnError ? "enabled" : "disabled"}`);
  console.log(`Auto login retry: ${autoLoginRetry ? "enabled" : "disabled"}`);
  console.log("═".repeat(60));

  let loginRecoveryUsed = false;

  for (const seeder of selectedSeeders) {
    let result = await runSeeder(seeder.script);
    let combinedOutput = `${result.output || ""}\n${result.stderr || ""}`;
    const sessionExpired = /SESSION_EXPIRED/.test(combinedOutput);
    const authMissing = /AUTH_MISSING/.test(combinedOutput);
    const needsLoginRecovery = sessionExpired || authMissing;

    if (needsLoginRecovery) {
      if (autoLoginRetry && !loginRecoveryUsed) {
        loginRecoveryUsed = true;
        const reasonLabel = authMissing ? "Missing auth" : "Session expired";
        console.log(`🔐 ${reasonLabel}. Launching login flow for one automatic retry...`);
        const loginExitCode = await runLoginRecovery();

        if (loginExitCode === 0) {
          console.log(`✅ Login completed. Retrying ${seeder.script} once...`);
          result = await runSeeder(seeder.script);
          combinedOutput = `${result.output || ""}\n${result.stderr || ""}`;

          if (/SESSION_EXPIRED|AUTH_MISSING/.test(combinedOutput)) {
            console.log(`❌ Login recovery did not resolve auth issue in ${seeder.script}`);
            break;
          }

          if (stopOnError && result.exitCode !== 0) {
            console.log(`❌ Stopping early after failure in ${seeder.script} (--stop-on-error)`);
            break;
          }

          continue;
        }

        console.log(`❌ Login retry failed (exit code ${loginExitCode}).`);
      }

      if (authMissing) {
        console.log(`❌ Stopping early after missing auth in ${seeder.script}`);
      } else {
        console.log(`❌ Stopping early after session expiry in ${seeder.script}`);
      }
      break;
    }

    if (stopOnError && result.exitCode !== 0) {
      console.log(`❌ Stopping early after failure in ${seeder.script} (--stop-on-error)`);
      break;
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log("📊 CONSOLIDATED SUMMARY");
  console.log("═".repeat(60));

  for (const result of results) {
    const status = result.exitCode === 0 ? "✅" : "❌";
    const durationText = `in ${formatDuration(result.durationMs || 0)}`;
    if (result.summary) {
      console.log(
        `${status} ${result.seeder}: Skipped ${result.summary.skippedCats} cats (${result.summary.skippedItems} items), Created ${result.summary.createdCats} cats (${result.summary.createdItems} items), ${durationText}`
      );
    } else {
      console.log(
        `${status} ${result.seeder}: Exit code ${result.exitCode} (no summary parsed), ${durationText}`
      );
    }
  }

  console.log("─".repeat(60));
  const successCount = results.filter((r) => r.exitCode === 0).length;
  console.log(`${successCount}/${results.length} executed seeders completed successfully`);
  if (results.length < selectedSeeders.length) {
    console.log(`⏹️ Execution stopped early: ran ${results.length} of ${selectedSeeders.length} selected seeders`);
  }
  console.log(
    `📈 TOTALS: Skipped ${totalSkippedCats} categories (${totalSkippedItems} items), Created ${totalCreatedCats} categories (${totalCreatedItems} items)`
  );
  console.log(`⏱️ Total runtime: ${formatDuration(Date.now() - runStartedAt)}`);
  console.log("═".repeat(60));

  const anyFailed = results.some((r) => r.exitCode !== 0);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Master seeding failed:", err);
  process.exit(1);
});
