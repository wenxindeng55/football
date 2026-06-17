import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE_URL = process.env.AUDIT_URL || 'http://127.0.0.1:5174/'
const OUT_DIR = path.resolve('audit-output')

await fs.mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
})

const logs = []
const requests = []
const responses = []

page.on('console', msg => {
  logs.push({
    type: msg.type(),
    text: msg.text(),
    location: msg.location(),
  })
})

page.on('pageerror', err => {
  logs.push({
    type: 'pageerror',
    text: err.message,
    stack: err.stack,
  })
})

page.on('request', req => {
  requests.push({
    method: req.method(),
    url: req.url(),
    resourceType: req.resourceType(),
  })
})

page.on('response', async res => {
  const url = res.url()
  const item = {
    url,
    status: res.status(),
    contentType: res.headers()['content-type'] || '',
  }

  if (
    url.includes('/api/') ||
    url.toLowerCase().includes('match') ||
    url.toLowerCase().includes('odds') ||
    url.toLowerCase().includes('lineup') ||
    url.toLowerCase().includes('event') ||
    url.toLowerCase().includes('stats')
  ) {
    try {
      const text = await res.text()
      item.bodyPreview = text.slice(0, 3000)
    } catch (e) {
      item.bodyPreview = `Could not read body: ${e.message}`
    }
  }

  responses.push(item)
})

await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })

await page.screenshot({
  path: path.join(OUT_DIR, 'full-page.png'),
  fullPage: true,
})

const visibleText = await page.locator('body').innerText().catch(() => '')
await fs.writeFile(path.join(OUT_DIR, 'visible-text.txt'), visibleText, 'utf8')

const buttons = await page.locator('button').evaluateAll(nodes =>
  nodes.map((node, index) => ({
    index,
    text: node.innerText,
    disabled: node.disabled,
    ariaLabel: node.getAttribute('aria-label'),
  }))
).catch(() => [])

const links = await page.locator('a').evaluateAll(nodes =>
  nodes.map((node, index) => ({
    index,
    text: node.innerText,
    href: node.href,
  }))
).catch(() => [])

await fs.writeFile(path.join(OUT_DIR, 'console-logs.json'), JSON.stringify(logs, null, 2), 'utf8')
await fs.writeFile(path.join(OUT_DIR, 'requests.json'), JSON.stringify(requests, null, 2), 'utf8')
await fs.writeFile(path.join(OUT_DIR, 'responses.json'), JSON.stringify(responses, null, 2), 'utf8')
await fs.writeFile(path.join(OUT_DIR, 'buttons.json'), JSON.stringify(buttons, null, 2), 'utf8')
await fs.writeFile(path.join(OUT_DIR, 'links.json'), JSON.stringify(links, null, 2), 'utf8')

await browser.close()

console.log(`Audit finished. Output: ${OUT_DIR}`)