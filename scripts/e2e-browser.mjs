#!/usr/bin/env node
/**
 * Browser end-to-end test: sign files through the real upload page, verify
 * one on the verify page, check /account, revoke this browser's key and sign
 * again with its replacement.
 *
 *   E2E_BASE_URL=https://<preview-host> \
 *   E2E_AUTH_PROVIDER=preview-test E2E_AUTH_SECRET=... E2E_VERCEL_BYPASS=... \
 *   node scripts/e2e-browser.mjs
 *
 * Against a local dev server started with DEBUG_AUTH=true, only E2E_BASE_URL
 * is needed (the provider defaults to "debug"). E2E_SCREENSHOTS=<dir> saves a
 * screenshot per step. Needs the `playwright` package and a Chromium (in CI:
 * `npx playwright install --with-deps chromium`); it is not a project
 * dependency.
 *
 * Exit codes: 0 all checks passed, 1 a check failed, 2 bad usage/setup.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("playwright is not installed: npm i --no-save playwright && npx playwright install chromium");
  process.exit(2);
}

const BASE = (process.env.E2E_BASE_URL ?? "").replace(/\/$/, "");
const PROVIDER = process.env.E2E_AUTH_PROVIDER ?? "debug";
const SECRET = process.env.E2E_AUTH_SECRET ?? "";
const BYPASS = process.env.E2E_VERCEL_BYPASS;
const SHOTS = process.env.E2E_SCREENSHOTS;
if (!BASE) {
  console.error("Set E2E_BASE_URL");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const work = mkdtempSync(path.join(tmpdir(), "cp-e2e-"));
const stamp = Date.now();
const files = ["one", "two", "three", "four"].map((n) => {
  const file = path.join(work, `e2e-${n}-${stamp}.txt`);
  writeFileSync(file, `ContentProof browser e2e ${n} ${stamp}\n`);
  return file;
});
const other = path.join(work, "not-the-signed-file.txt");
writeFileSync(other, `a different file ${stamp}\n`);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  extraHTTPHeaders: BYPASS ? { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" } : {},
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

try {
  // Sign in through the API; the browser context shares the cookies.
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/${PROVIDER}`, {
    form: { csrfToken: csrf.csrfToken, json: "true", secret: SECRET },
    maxRedirects: 0,
  });
  const session = await (await context.request.get(`${BASE}/api/auth/session`)).json();
  check("signed in", Boolean(session?.user?.email), session?.user?.email ?? "no session");
  if (!session?.user?.email) throw new Error("sign-in failed; check the provider, secret and bypass");

  // Upload: several files at once, signed with this browser's key.
  await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
  const keyLocator = page.locator('[data-testid="user-key"] code');
  await keyLocator.waitFor({ timeout: 20_000 });
  const firstKey = (await keyLocator.textContent())?.trim();
  check("upload page shows this browser's key", Boolean(firstKey), firstKey);
  await page.setInputFiles('input[type="file"]', files.slice(0, 3));
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="batch-entry"][data-status="done"]').length === 3,
    null,
    { timeout: 90_000 }
  ).catch(() => {});
  const done = await page.locator('[data-testid="batch-entry"][data-status="done"]').count();
  check("three files signed in one batch", done === 3, `${done} done`);
  await shot("01-upload-batch");

  const records = [];
  const entries = page.locator('[data-testid="batch-entry"]');
  for (let i = 0; i < (await entries.count()); i++) {
    await entries.nth(i).click();
    await page.locator('img[alt="QR code containing the verification link"]').waitFor({ timeout: 10_000 });
    records.push((await page.locator("details code").first().textContent())?.trim());
  }
  check("each entry shows its own seal and record", new Set(records).size === 3 && records.every(Boolean));
  check("records are version 3 (signed by this browser's key)", records.every((r) => r?.startsWith("3~")));
  check("no 'not logged' warning", (await page.locator('[data-testid="not-logged"]').count()) === 0);

  // Verify the first record against its file, and against a different file.
  const verify = async (record, file) => {
    await page.goto(`${BASE}/verify#P=${record}`, { waitUntil: "networkidle" });
    await page.getByText("Using ContentProof's currently published keys.").waitFor({ timeout: 20_000 });
    await page.setInputFiles("#fileInput", file);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await page.getByText(/Attestation verified|Not verified/).waitFor({ timeout: 30_000 });
  };
  await verify(records[0], files[0]);
  check("verify page: attestation verified", (await page.getByText("Attestation verified").count()) > 0);
  await page.getByText(/Included in the transparency log/).waitFor({ timeout: 20_000 }).catch(() => {});
  const logText = (await page.locator('[data-testid="log-status"]').textContent()) ?? "";
  check("verify page: inclusion proof and signed tree head verified", /proof and signed tree head verified/.test(logText), logText.trim());
  await shot("02-verify-ok");
  await verify(records[0], other);
  check("verify page: a different file is rejected", (await page.getByText("is not the file that was attested").count()) > 0);

  // Server-side checks agree.
  const head = await (await context.request.get(`${BASE}/api/log/head`)).json();
  check("log head covers the new records", head.size >= 3, `size ${head.size}`);
  const viaApi = await (await context.request.post(`${BASE}/api/verify`, { data: { record: records[1] } })).json();
  check("/api/verify accepts the compact record", viaApi.valid === true && viaApi.userSigned === true, JSON.stringify(viaApi));

  // Account page lists the records and this browser's key.
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await page.locator('ul[aria-label="Your records"] li').first().waitFor({ timeout: 20_000 });
  const listed = await page.locator('ul[aria-label="Your records"] li').count();
  check("account page lists the records", listed >= 3, `${listed} listed`);
  const row = page.locator(`li[data-public-key="${firstKey}"]`);
  await row.locator('[data-testid="this-browser"]').waitFor({ timeout: 20_000 }).catch(() => {});
  check("account page marks this browser's key", (await row.locator('[data-testid="this-browser"]').count()) === 1);
  await shot("03-account");

  // Revoke this browser's key: a replacement is made and signing still works.
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await row.getByRole("button", { name: "Confirm revoke" }).click();
  await page.locator('[data-testid="new-key-note"]').waitFor({ timeout: 20_000 }).catch(() => {});
  check("revoking this browser's key gives it a new one", (await page.locator('[data-testid="new-key-note"]').count()) === 1);
  await shot("04-account-revoked");
  const status = await (await context.request.get(`${BASE}/api/keys/user/${firstKey}`)).json();
  check("public key status shows the revocation, without the email", typeof status.revokedAt === "number" && !("email" in status));

  await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
  await keyLocator.waitFor({ timeout: 20_000 });
  const secondKey = (await keyLocator.textContent())?.trim();
  check("upload page shows the replacement key", Boolean(secondKey) && secondKey !== firstKey);
  await page.setInputFiles('input[type="file"]', files[3]);
  await page.locator('img[alt="QR code containing the verification link"]').waitFor({ timeout: 60_000 }).catch(() => {});
  const fourth = (await page.locator("details code").first().textContent())?.trim() ?? "";
  check("signing works with the replacement key", fourth.startsWith("3~") && fourth.split("~")[6] === secondKey);

  await verify(records[0], files[0]);
  await page.locator('[data-testid="user-key-status"]').waitFor({ timeout: 20_000 }).catch(() => {});
  check("verify page notes the old key was revoked", (await page.locator('[data-testid="user-key-status"]').count()) === 1);
  await shot("05-verify-revoked-key");

  check("no page errors", pageErrors.length === 0, pageErrors.join(" ; ").slice(0, 300));
} catch (error) {
  check("run completed", false, String(error).slice(0, 300));
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
