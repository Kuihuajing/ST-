// Optional independent UI test. Pass the path to an installed playwright-core.
// No real chat, credentials or model endpoint is used.
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightPath = process.env.ST_READER_PLAYWRIGHT;
if (!playwrightPath) throw new Error('Set ST_READER_PLAYWRIGHT to the installed playwright-core index.mjs path.');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const vendorRoot = process.env.ST_READER_VENDOR_ROOT || 'D:/SillyTavern/node_modules';
const outputDir = path.resolve(root, 'test-results');
await mkdir(outputDir, { recursive: true });
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        let filename;
        if (url.pathname === '/') filename = path.join(root, 'tests/fixture.html');
        else if (url.pathname === '/vendor/showdown.js') filename = path.join(vendorRoot, 'showdown/dist/showdown.min.js');
        else if (url.pathname === '/vendor/purify.js') filename = path.join(vendorRoot, 'dompurify/dist/purify.min.js');
        else if (url.pathname.startsWith('/extension/')) {
            filename = path.resolve(root, url.pathname.slice('/extension/'.length));
            if (!filename.startsWith(root + path.sep)) throw new Error('Outside test root');
        } else { res.writeHead(404).end(); return; }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
        res.writeHead(200, { 'Content-Type': `${types[path.extname(filename)] || 'application/octet-stream'}; charset=utf-8` });
        res.end(await readFile(filename));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
try {
    browser = await chromium.launch({ executablePath: process.env.ST_READER_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
    await page.goto(base);
    await page.waitForFunction(() => window.readerReady);
    const before = await page.evaluate(() => JSON.stringify(window.fixtureChat));
    await page.locator('#send_textarea').focus();
    await page.locator('#st-story-reader-open').click();
    await page.locator('#st-story-reader').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.sr-section').count(), 3);
    const text = await page.locator('.sr-article').innerText();
    for (const hidden of ['USER_SENTINEL','HIDDEN_PLAN','FALSE_BODY','CHOICE_SENTINEL','STATE_SENTINEL','REASONING_SENTINEL','ALTERNATIVE_SENTINEL','UNTAGGED_SENTINEL','SYSTEM_SENTINEL']) assert.ok(!text.includes(hidden), hidden);
    assert.equal(await page.locator('.sr-article img, .sr-article script').count(), 0);
    assert.equal(await page.evaluate(() => !!window.readerXss), false);
    assert.equal(external.length, 0);
    check('body-only reading, no auxiliary text, scripts or network resources');
    await page.locator('.sr-viewport').evaluate(el => { el.scrollTop = 1100; });
    await page.locator('[data-action="close"]').click();
    assert.equal(await page.locator('.sr-section').count(), 0);
    assert.equal(await page.locator('#send_textarea').inputValue(), '草稿应保持原样。');
    assert.equal(await page.evaluate(() => JSON.stringify(window.fixtureChat)), before);
    await page.locator('#st-story-reader-open').click();
    assert.ok(await page.locator('.sr-viewport').evaluate(el => el.scrollTop) > 900);
    check('return to unchanged chat, drop rendered text, restore reading position');
    await page.locator('[data-action="theme"]').click();
    assert.equal(await page.locator('#st-story-reader').getAttribute('data-theme'), 'night');
    await page.locator('[data-action="larger"]').click();
    assert.equal(await page.locator('[data-action="font-size"]').innerText(), '22');
    check('theme and font controls');
    await page.locator('[data-action="options"]').click();
    await page.locator('input[name="fallback"]').check();
    await page.locator('.sr-options button[type="submit"]').click();
    assert.equal(await page.locator('.sr-section').count(), 4);
    await page.locator('input[name="fallback"]').uncheck();
    await page.locator('.sr-options button[type="submit"]').click();
    assert.equal(await page.locator('.sr-section').count(), 3);
    await page.locator('[data-action="options"]').click();
    check('untagged compatibility is explicit and reversible');
    await page.evaluate(() => { window.fixtureChat.push({mes:'<content>一盏新灯亮了。</content>'});window.emitFixtureEvent('GENERATION_ENDED'); });
    await page.waitForFunction(() => document.querySelectorAll('.sr-section').length === 4);
    await page.evaluate(() => { window.fixtureChat[1].mes = '<content>修改后的第一节。</content>'; window.emitFixtureEvent('MESSAGE_EDITED'); });
    await page.waitForFunction(() => document.querySelector('.sr-section')?.textContent.includes('修改后的第一节'));
    check('new generations and message edits refresh the view');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let exported=''; for await (const chunk of stream) exported += chunk.toString('utf8');
    assert.ok(exported.includes('修改后的第一节。'));
    assert.ok(!exported.includes('HIDDEN_PLAN'));
    check('TXT export contains only displayed story');
    await page.evaluate(() => { window.fixtureChatId='new-chat';window.fixtureContext.chat=[{mes:'<content>另一个故事。</content>'}];window.emitFixtureEvent('CHAT_CHANGED'); });
    await page.waitForFunction(() => document.querySelectorAll('.sr-section').length === 1);
    assert.equal(await page.locator('.sr-section').innerText(), '另一个故事。');
    assert.equal(await page.locator('.sr-viewport').evaluate(el => el.scrollTop), 0);
    check('chat changes reset reading position and content');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#st-story-reader').evaluate(el => el.open), false);
    check('Escape returns to creation');
    // Restore the neutral long story for layout inspection screenshots.
    await page.evaluate(value => { window.fixtureContext.chat=JSON.parse(value);window.fixtureChatId='fixture-chat';window.fixtureSettings.local_story_reader.theme='paper';window.fixtureSettings.local_story_reader.fontSize=20;window.fixtureSettings.local_story_reader.positions={}; }, before);
    await page.locator('#st-story-reader-open').click();
    await page.screenshot({ path: path.join(outputDir, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('#st-story-reader').evaluate(el => el.getBoundingClientRect().width <= window.innerWidth));
    await page.locator('[data-action="toc"]').click();
    await page.locator('.sr-toc button').nth(1).click();
    assert.equal(await page.locator('#st-story-reader').evaluate(el => el.classList.contains('sr-toc-open')), false);
    await page.screenshot({ path: path.join(outputDir, 'mobile.png') });
    check('mobile layout and chapter navigation');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    check('no uncaught browser errors or external requests');
    console.log(JSON.stringify({passed:checks.length, screenshots:outputDir}));
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
