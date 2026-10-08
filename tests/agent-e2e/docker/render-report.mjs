// 改动说明：用真实浏览器检查独立 HTML 报告在桌面和手机尺寸下的渲染，保存截图和实际检查结果。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../../../..');
const artifacts = path.join(repo, '.tmp/e2e/skills-alignment');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const result = { checkedAt: new Date().toISOString(), status: 'passed', viewports: [] };
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(pathToFileURL(path.join(repo, 'docs/reviews/hyacinthus-cli-skills-alignment.html')).href);
    await page.locator('h1').waitFor();
    const content = await page.evaluate(() => ({
      title: document.title,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cases: document.querySelectorAll('section:nth-of-type(3) tbody tr').length,
    }));
    assert.equal(content.cases, 6);
    assert.ok(content.scrollWidth <= content.width, 'Report overflows the viewport');
    assert.deepEqual(errors, []);
    const screenshot = `report-${viewport.width}.png`;
    await page.screenshot({ path: path.join(artifacts, screenshot), fullPage: true });
    await page.screenshot({ path: path.join(artifacts, `report-${viewport.width}-top.png`) });
    result.viewports.push({ ...viewport, ...content, consoleErrors: errors.length, screenshot });
    await page.close();
  }
} catch (error) {
  result.status = 'failed';
  result.error = error.message;
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(path.join(artifacts, 'report-render.json'), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
