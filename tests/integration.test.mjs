// Run only against the disposable SillyTavern instance, never a real account.
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(pathToFileURL(process.env.ST_READER_PLAYWRIGHT).href);
const url = process.env.ST_READER_TEST_URL;
if (!url || new URL(url).port !== '8001') throw new Error('Use the isolated test server on port 8001.');
for (let attempt=0; attempt<40; attempt++) {
    try { const result=await fetch(url,{signal:AbortSignal.timeout(1000)}); if(result.ok) break; } catch {}
    if (attempt===39) throw new Error('Isolated server did not become ready.');
    await new Promise(resolve=>setTimeout(resolve,500));
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let page;
try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type()==='error') console.log('Browser console:', msg.text().slice(0,300)); });
    await page.goto(url);
    await page.waitForFunction(() => window.SillyTavern?.getContext);
    await page.waitForFunction(() => document.querySelector('#st-story-reader-open') || [...document.querySelectorAll('dialog[open] textarea, dialog[open] input[type="text"]')].some(el=>el.getClientRects().length));
    const welcomeInputs = page.locator('dialog[open] textarea:visible, dialog[open] input[type="text"]:visible');
    if (await welcomeInputs.count()) {
        await welcomeInputs.first().fill('Reader test');
        const confirm = page.locator('dialog[open] .popup-button-ok');
        if (await confirm.count()) await confirm.click();
    }
    await page.locator('#st-story-reader-open').waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.locator('#sr-extension-settings').count(), 1);
    await page.evaluate(() => {
        const ctx = window.SillyTavern.getContext();
        ctx.chat.splice(0, ctx.chat.length,
            {is_user: true, mes:'EXCLUDED_USER'},
            {is_user: false, name:'独立示例', mes:'<think_fox~>EXCLUDED_ANALYSIS</think_fox~><content>雨停了。\n\n书店亮起了一盏灯。</content><fox_tip>EXCLUDED_TIP</fox_tip>'},
        );
        window.readerChatBefore = JSON.stringify(ctx.chat);
    });
    // In a fresh test profile other welcome overlays may exist; invoke only our
    // own public entry point so the test cannot accidentally click a host dialog.
    await page.evaluate(async () => {
        const reader = await import('/scripts/extensions/third-party/ST-StoryReader/index.js');
        reader.openReader();
    });
    await page.locator('#st-story-reader').waitFor({ state: 'visible' });
    const body = await page.locator('.sr-article').innerText();
    assert.ok(body.includes('书店亮起了一盏灯。'));
    assert.ok(!body.includes('EXCLUDED_'));
    await page.locator('[data-action="close"]').click();
    assert.equal(await page.evaluate(() => JSON.stringify(SillyTavern.getContext().chat) === window.readerChatBefore), true);
    assert.deepEqual(errors.filter(x => /story-reader|reader-core/i.test(x)), []);
    console.log('PASS SillyTavern 1.19.0 loads manifest, activation hook, chat button and settings entry');
    console.log('PASS real ST context extraction and return without chat mutation');
    console.log('Other browser errors:', JSON.stringify(errors));
} catch (error) {
    console.log('Integration diagnostic:', await page?.evaluate(() => ({title:document.title,body:document.body.innerText.slice(0,1400),context:typeof window.SillyTavern, readerButtons:document.querySelectorAll('#st-story-reader-open').length})));
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page?.screenshot({path:fileURLToPath(new URL('../test-results/integration.png',import.meta.url))});
    throw error;
} finally { await browser.close(); }
