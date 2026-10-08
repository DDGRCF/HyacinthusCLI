// 改动说明：对实测 HTML 做桌面/手机、明暗四组合浏览器检查，验证无溢出、无脚本错误和完整用例；不连接业务 API。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { executable } from './pi-sandbox.mjs';

const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 960 }, { name: 'mobile', width: 390, height: 844 }];

/** Validate only the completed static report, preserving its recorded statuses rather than synthesizing test success. */
async function main() {
  const directory = path.resolve(import.meta.dirname, '../reports');
  const report = JSON.parse(await readFile(path.join(directory, 'suite.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.HYACINTHUS_AGENT_E2E_CHROME_BINARY || executable('google-chrome') });
  const checks = [];
  try {
    for (const viewport of VIEWPORTS) for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, colorScheme });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(directory, 'latest.html')).href);
      const result = await page.evaluate(() => ({
        width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        text: document.body.textContent, scripts: document.querySelectorAll('script').length,
      }));
      assert.equal(errors.length, 0, errors.join('; '));
      assert.ok(result.scrollWidth <= result.width, `${viewport.name}/${colorScheme}: horizontal overflow`);
      assert.equal(result.scripts, 0);
      assert.ok(result.text.includes(report.runId), 'Report is stale or mismatched');
      for (const item of report.cases) assert.ok(result.text.includes(item.name), `Missing report case: ${item.name}`);
      await page.locator('details').first().evaluate(element => { element.open = true; });
      assert.equal(await page.locator('details').first().getAttribute('open'), '');
      checks.push({ viewport: viewport.name, colorScheme, overflow: false, errors: 0 });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ report: report.runId, status: report.status, browserChecks: checks }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
