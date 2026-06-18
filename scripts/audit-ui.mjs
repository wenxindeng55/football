import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve('audit-output');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
const FALLBACK_URLS = ['http://127.0.0.1:5175/', 'http://127.0.0.1:5173/'];

async function urlReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBaseUrl() {
  if (process.env.AUDIT_URL) return process.env.AUDIT_URL;
  for (const url of FALLBACK_URLS) {
    if (await urlReachable(url)) return url;
  }
  return FALLBACK_URLS[FALLBACK_URLS.length - 1];
}

function isApiUrl(url) {
  try {
    return new URL(url).pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

await fs.mkdir(OUT_DIR, { recursive: true });

const baseUrl = await resolveBaseUrl();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const logs = [];
const requests = [];
const responses = [];

page.on('console', (msg) => {
  logs.push({
    type: msg.type(),
    text: msg.text(),
    location: msg.location(),
  });
});

page.on('pageerror', (err) => {
  logs.push({
    type: 'pageerror',
    text: err.message,
    stack: err.stack,
  });
});

page.on('request', (req) => {
  requests.push({
    method: req.method(),
    url: req.url(),
    resourceType: req.resourceType(),
  });
});

page.on('response', async (res) => {
  const url = res.url();
  const item = {
    url,
    status: res.status(),
    contentType: res.headers()['content-type'] || '',
  };

  if (isApiUrl(url)) {
    try {
      const text = await res.text();
      item.bodyPreview = text.slice(0, 1200);
    } catch (error) {
      item.bodyPreview = `Could not read body: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  responses.push(item);
});

const viewportResults = [];

for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.screenshot({
    path: path.join(OUT_DIR, `ui-${viewport.name}.png`),
    fullPage: true,
  });

  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const overflowing = Array.from(document.querySelectorAll('*'))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .slice(0, 30)
      .map((element) => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className.slice(0, 180) : '',
        text: (element.textContent || '').trim().slice(0, 100),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: root.scrollWidth,
      documentClientWidth: root.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      hasHorizontalOverflow: root.scrollWidth > root.clientWidth + 1 || body.scrollWidth > root.clientWidth + 1,
      overflowing,
    };
  });

  viewportResults.push({
    name: viewport.name,
    screenshot: path.join(OUT_DIR, `ui-${viewport.name}.png`),
    ...result,
  });
}

const visibleText = await page.locator('body').innerText().catch(() => '');
const buttons = await page.locator('button').evaluateAll((nodes) =>
  nodes.map((node, index) => ({
    index,
    text: node.innerText,
    disabled: node.disabled,
    ariaLabel: node.getAttribute('aria-label'),
  })),
).catch(() => []);

const consoleErrors = logs.filter((item) => item.type === 'error' || item.type === 'pageerror');
const auditSummary = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  screenshots: viewportResults.map((item) => ({ name: item.name, path: item.screenshot })),
  hasHorizontalOverflow: viewportResults.some((item) => item.hasHorizontalOverflow),
  viewportResults,
  consoleErrorCount: consoleErrors.length,
  consoleErrors,
  requestCount: requests.length,
  apiResponses: responses.filter((item) => isApiUrl(item.url)),
};

await fs.writeFile(path.join(OUT_DIR, 'ui-audit-summary.json'), JSON.stringify(auditSummary, null, 2), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'ui-console-logs.json'), JSON.stringify(logs, null, 2), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'ui-requests.json'), JSON.stringify(requests, null, 2), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'ui-responses.json'), JSON.stringify(responses, null, 2), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'ui-buttons.json'), JSON.stringify(buttons, null, 2), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'ui-visible-text.txt'), visibleText, 'utf8');

await browser.close();

console.log(`Audit finished. Base URL: ${baseUrl}`);
console.log(`Screenshots: ${viewportResults.map((item) => item.screenshot).join(', ')}`);
console.log(`Horizontal overflow: ${auditSummary.hasHorizontalOverflow ? 'yes' : 'no'}`);
console.log(`Console errors: ${consoleErrors.length}`);
