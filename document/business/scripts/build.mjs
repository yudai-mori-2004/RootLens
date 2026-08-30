#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked } from "marked";
import puppeteer from "puppeteer-core";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const businessRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(businessRoot, "../..");
const documentsRoot = path.join(businessRoot, "documents");
const outputRoot = path.join(repoRoot, "output/pdf/business");
const stylesRoot = path.join(businessRoot, "styles");
const systemChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function canAccess(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveChrome() {
  if (process.env.CHROME_BIN) {
    if (!(await canAccess(process.env.CHROME_BIN))) {
      throw new Error(`CHROME_BIN does not exist: ${process.env.CHROME_BIN}`);
    }
    return process.env.CHROME_BIN;
  }

  const cacheRoot = path.join(os.homedir(), ".cache/puppeteer/chrome");
  try {
    const versions = (await fs.readdir(cacheRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      for (const architecture of ["chrome-mac-arm64", "chrome-mac-x64"]) {
        const candidate = path.join(
          cacheRoot,
          version,
          architecture,
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        );
        if (await canAccess(candidate)) return candidate;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (await canAccess(systemChrome)) return systemChrome;
  throw new Error(
    "Chrome was not found. Set CHROME_BIN or install Google Chrome for Testing.",
  );
}

function parseFrontMatter(source, sourcePath) {
  if (!source.startsWith("---\n")) {
    return { attributes: {}, body: source };
  }

  const closing = source.indexOf("\n---\n", 4);
  if (closing === -1) {
    throw new Error(`front matter is not closed: ${sourcePath}`);
  }

  const attributes = {};
  for (const line of source.slice(4, closing).split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    attributes[key] = value;
  }

  return {
    attributes,
    body: source.slice(closing + 5),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function collectMarkdown(targetPath) {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    if (path.extname(targetPath) !== ".md") {
      throw new Error(`not a Markdown document: ${targetPath}`);
    }
    return [targetPath];
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => collectMarkdown(path.join(targetPath, entry.name))),
  );
  return nested.flat();
}

async function renderDocument(sourcePath, tempRoot, browser) {
  const source = await fs.readFile(sourcePath, "utf8");
  const { attributes, body } = parseFrontMatter(source, sourcePath);
  const title =
    attributes.title || path.basename(sourcePath, path.extname(sourcePath));
  const layout = attributes.layout || "legal";
  const variant = attributes.variant || "";
  const page = attributes.page || "A4";
  const margin = attributes.margin || "18mm 20mm 18mm";
  const pageNumbers = attributes.page_numbers !== "false";

  const baseStyles = await fs.readFile(path.join(stylesRoot, "base.css"), "utf8");
  const layoutStyles = await fs.readFile(
    path.join(stylesRoot, `${layout}.css`),
    "utf8",
  );

  const parser = new Marked({
    gfm: true,
    breaks: false,
  });
  parser.use({
    walkTokens(token) {
      if (
        token.type === "image" &&
        !/^(?:[a-z]+:|\/)/i.test(token.href)
      ) {
        token.href = pathToFileURL(
          path.resolve(path.dirname(sourcePath), token.href),
        ).href;
      }
    },
  });

  const renderedBody = await parser.parse(body);
  const pageNumberRule = pageNumbers
    ? `@bottom-center {
        content: counter(page) " / " counter(pages);
        color: #777;
        font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
        font-size: 8pt;
      }`
    : "";
  const pageStyles = `@page {
      size: ${page};
      margin: ${margin};
      ${pageNumberRule}
    }`;
  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${pageStyles}\n${baseStyles}\n${layoutStyles}</style>
</head>
<body class="layout-${escapeHtml(layout)}${
    variant ? ` variant-${escapeHtml(variant)}` : ""
  }">
  <main>${renderedBody}</main>
</body>
</html>
`;

  const relative = path.relative(documentsRoot, sourcePath);
  const tempHtml = path.join(tempRoot, relative.replace(/\.md$/, ".html"));
  const outputPdf = path.join(outputRoot, relative.replace(/\.md$/, ".pdf"));
  await fs.mkdir(path.dirname(tempHtml), { recursive: true });
  await fs.mkdir(path.dirname(outputPdf), { recursive: true });
  await fs.writeFile(tempHtml, html, "utf8");

  const pageHandle = await browser.newPage();
  try {
    await pageHandle.goto(pathToFileURL(tempHtml).href, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await pageHandle.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map(
          (image) =>
            image.complete ||
            new Promise((resolve, reject) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", reject, { once: true });
            }),
        ),
      );
    });
    await pageHandle.pdf({
      path: outputPdf,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      waitForFonts: true,
    });
  } finally {
    await pageHandle.close();
  }

  console.log(`built ${relative.replace(/\.md$/, ".pdf")}`);
}

const requested = process.argv.slice(2);
const targets = requested.length
  ? requested.map((entry) => path.resolve(documentsRoot, entry))
  : [documentsRoot];
const files = (
  await Promise.all(targets.map((target) => collectMarkdown(target)))
)
  .flat()
  .sort();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rootlens-business-"));
const chrome = await resolveChrome();
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  userDataDir: path.join(tempRoot, "chrome-profile"),
  args: [
    "--no-sandbox",
    "--allow-file-access-from-files",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-features=PushMessaging",
  ],
});
try {
  for (const file of files) {
    await renderDocument(file, tempRoot, browser);
  }
  console.log(`done. ${files.length} file(s) built.`);
} finally {
  await browser.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
