/* Checks that every English text on the site has a translation in each language.
 *
 * Opens index.html and legal.html in a headless browser, collects the strings the
 * language switch translates (page text, alt text, labels, the officer list, the
 * 3D path panel) and lists any string missing from i18n-data.js.
 *
 * Run from the repository root:  node tools/check-translations.js
 * Exit code 1 means at least one translation is missing.
 */
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const LANGS = ["fr", "el", "es", "pt"];
const NAMES = { fr: "French", el: "Greek", es: "Spanish", pt: "Portuguese (Brazil)" };

async function stringsOnPage(browser, file, extra) {
  const page = await browser.newPage();
  const used = new Set();
  await page.exposeFunction("__recordTr", (s) => used.add(s));
  // Wrap I18N.tr so strings rendered by app.js and path3d.js are recorded too.
  await page.addInitScript(() => {
    Object.defineProperty(window, "I18N", {
      configurable: true,
      get() { return undefined; },
      set(value) {
        const original = value.tr;
        value.tr = (s) => { window.__recordTr(s); return original(s); };
        Object.defineProperty(window, "I18N", { value, writable: true, configurable: true });
      },
    });
  });
  await page.goto(pathToFileURL(path.join(ROOT, file)).href);
  if (extra) await extra(page);
  for (const lang of [...LANGS, "en"]) {
    await page.evaluate((l) => window.I18N.setLang(l, false), lang);
    await page.waitForTimeout(50);
  }
  const units = await page.evaluate(() => window.I18N.units());
  await page.close();
  return [...units, ...used];
}

async function pathStrings() {
  const mod = await import(pathToFileURL(path.join(ROOT, "path-data.js")).href);
  const items = [...(mod.STATIONS || []), mod.SATELLITE].filter(Boolean);
  const out = [];
  for (const item of items) {
    for (const field of ["kind", "title", "text", "lesson", "jewel", "link"]) {
      if (item[field]) out.push(item[field]);
    }
  }
  return out;
}

(async () => {
  const sandbox = { window: {} };
  new Function("window", fs.readFileSync(path.join(ROOT, "i18n-data.js"), "utf8"))(sandbox.window);
  const dict = sandbox.window.SITE_I18N;

  const browser = await chromium.launch();
  const keys = new Set([
    ...(await stringsOnPage(browser, "index.html", async (page) => {
      const toggle = await page.$("#toggle-officers");
      if (toggle) await toggle.click();
    })),
    ...(await stringsOnPage(browser, "legal.html")),
    ...(await pathStrings()),
  ]);
  await browser.close();

  let missingTotal = 0;
  const report = [];
  for (const lang of LANGS) {
    const missing = [...keys].filter((k) => !(dict[lang] && k in dict[lang]));
    missingTotal += missing.length;
    if (missing.length) {
      report.push(`### ${NAMES[lang]} (${lang}): ${missing.length} missing`);
      missing.forEach((k) => report.push(`- ${k}`));
      report.push("");
    }
  }

  const summary = missingTotal
    ? `## Translations: ${missingTotal} missing\n\nThese English texts have no translation in i18n-data.js, so they show in English in that language.\n\n${report.join("\n")}`
    : `## Translations: complete\n\nAll ${keys.size} texts are translated into ${LANGS.map((l) => NAMES[l]).join(", ")}.`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  process.exit(missingTotal ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
