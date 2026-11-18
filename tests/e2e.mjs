// 家計簿前端實際操作測試（Playwright + 假後端）
// 執行：node tests/e2e.mjs
// 前端 index.html 由本機伺服器提供；送往 Apps Script 的請求全部被攔下，
// 改由「假試算表＋真正的 Code_單一檔案版.gs（doPost）」回應。其他對外連線一律擋掉。
process.env.TZ = 'Asia/Taipei';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadGas } from './helpers/gas.mjs';
import { buildWorkbook2026 } from './fixtures/workbook.mjs';

// 用環境裡已安裝的 Playwright（全域安裝，ESM import 找不到，所以用 require）
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || join(root, 'tests', 'screenshots');
mkdirSync(OUT, { recursive: true });
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = 'http://127.0.0.1:' + PORT;
const GAS_URL = 'https://fake-gas.invalid/exec';

const g = loadGas({ props: { TOKEN: 'test-token' } });
buildWorkbook2026(g);

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '-d', root], { stdio: 'ignore' });
const results = [];
let failed = 0;
async function step(name, fn) {
  try { await fn(); results.push('✔ ' + name); }
  catch (e) { failed++; results.push('✘ ' + name + '\n    ' + String(e && e.message || e).split('\n').slice(0, 6).join('\n    ')); }
}

const browser = await chromium.launch();
try {
  // 等本機伺服器起來
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/index.html'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(u => { try { if (!localStorage.getItem('kakeiboCfg')) localStorage.setItem('kakeiboCfg', JSON.stringify({ url: u, k: 'test-token' })); } catch (e) {} }, GAS_URL);
  const page = await ctx.newPage();
  const consoleErrors = [], external = [], calls = [];
  let offline = false, dropResponse = false, oldBackend = false;
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/*', async route => {
    const req = route.request(), url = req.url();
    if (url.startsWith(BASE)) return route.continue();
    if (url.startsWith(GAS_URL)) {
      const body = req.postData() || '{}';
      const parsed = JSON.parse(body);
      if (offline) { calls.push({ method: parsed.method, offline: true }); return route.abort('internetdisconnected'); }
      calls.push({ method: parsed.method, args: parsed.args });
      g.nextRequest();
      const out = g.call('doPost', { postData: { contents: body } });
      if (dropResponse) return route.abort('timedout');   // 試算表已寫入，但回應在路上遺失
      let text = out.text;
      if (oldBackend) { const j = JSON.parse(text); if (j.data) delete j.data.backend; text = JSON.stringify(j); }   // 模擬沒部署新版的舊後端
      return route.fulfill({ status: 200, contentType: 'application/json', body: text });
    }
    external.push(url); return route.abort();
  });
  const shot = n => page.screenshot({ path: join(OUT, n + '.png') });
  const toastHas = (re, ms = 5000) => page.waitForFunction(r => new RegExp(r).test(document.getElementById('toast').textContent) && document.getElementById('toast').style.display !== 'none', re.source, { timeout: ms });
  const lastCall = m => calls.filter(c => c.method === m).pop();
  const ledgerCount = () => { let n = 0; const sh = g.book(2026).getSheetByName('2026年11月'); for (let r = 16; r <= 515; r++) if (sh.val(r, 14) !== '') n++; return n; };
  const dash = () => { g.nextRequest(); return g.call('getDashboard_', '2026-11-18'); };

  await page.goto(BASE + '/index.html');

  await step('開啟：顯示記帳頁與本月還能花', async () => {
    await page.locator('#v-entry .submit').waitFor();
    const left = dash().left;
    assert.match(await page.locator('#v-entry').innerText(), new RegExp('\\$' + left.toLocaleString('en-US')));
    await shot('01-記帳頁');
  });

  let left0, n0;
  await step('記一筆現金 120（食物）→ 送出內容正確、試算表多一筆、還能花減少 120', async () => {
    left0 = dash().left; n0 = ledgerCount();
    await page.click('#v-entry [data-act="cat"][data-v="食物"]');
    for (const k of ['1', '2', '0']) await page.click('#v-entry [data-act="key"][data-v="' + k + '"]');
    await page.click('#v-entry .submit');
    await toastHas(/已記錄/);
    const c = lastCall('add');
    assert.equal(c.args.amount, 120); assert.equal(c.args.cat, '食物'); assert.equal(c.args.pay, '現金'); assert.equal(c.args.date, '2026-11-18');
    assert.equal(ledgerCount(), n0 + 1);
    assert.equal(dash().left, left0 - 120);
    await shot('02-記帳完成');
  });

  await step('今日看板：今天已花包含剛剛的 120', async () => {
    await page.click('nav [data-view="today"]');
    await page.locator('#v-today h1').waitFor();
    const d = dash();
    await page.waitForFunction(t => document.getElementById('v-today').innerText.indexOf('今天已花 $' + t) >= 0, d.todaySpent.toLocaleString('en-US'));
    assert.ok(d.todaySpent >= 120);
    await shot('03-今日看板');
  });

  await step('紀錄頁：看得到這筆，刪除後消失、試算表少一筆', async () => {
    await page.click('nav [data-view="records"]');
    const row = page.locator('#v-records button.li', { hasText: '$120' }).first();
    await row.waitFor();
    await shot('04-紀錄頁');
    await row.click();
    await page.click('[data-ed="del"]');
    await toastHas(/已刪除/);
    assert.ok(lastCall('delete'));
    assert.equal(ledgerCount(), n0);
    await page.waitForFunction(() => !/\$120\b/.test(document.getElementById('v-records').innerText));
    assert.equal(dash().left, left0);
  });

  await step('一卡通：餘額 320 付 500 → 提示自動加值 500，記完後餘額 320', async () => {
    await page.click('nav [data-view="entry"]');
    await page.click('#v-entry [data-act="pay"][data-v="一卡通"]');
    for (const k of ['5', '0', '0']) await page.click('#v-entry [data-act="key"][data-v="' + k + '"]');
    assert.match(await page.locator('#v-entry .amount').innerText(), /自動加值 \$500/);
    await shot('05-一卡通加值提示');
    await page.click('#v-entry .submit');
    await toastHas(/一卡通餘額約 \$320/);
    assert.equal(lastCall('add').args.pay, '一卡通');
    g.nextRequest(); assert.equal(g.call('ecardBalance_'), 320);
    await shot('06-一卡通記帳完成');
  });

  await step('預扣信封：調用 100 到日常 → 出現待歸還 → 按已歸還後消失', async () => {
    await page.click('nav [data-view="assets"]');
    await page.click('#v-assets [data-act="env"]');
    const btn = page.locator('#v-env [data-ev="borrow"]').first();
    await btn.waitFor();
    await shot('07-預扣信封');
    await btn.click();
    await page.fill('#bwAmt', '100');
    await page.click('[data-bw="ok"]');
    await toastHas(/已從「.+」調用 \$100/);
    await page.locator('#v-env [data-ev="repay"]').first().waitFor();
    assert.equal(g.call('borrowsOpen_', 2026).length, 1);
    await shot('08-待歸還');
    await page.click('#v-env [data-ev="repay"]');
    await toastHas(/已記錄歸還/);
    await page.waitForFunction(() => !document.querySelector('#v-env [data-ev="repay"]'));
    g.nextRequest(); assert.equal(g.call('borrowsOpen_', 2026).length, 0);
  });

  await step('離線：記帳先暫存，恢復連線後上傳，只記一筆', async () => {
    await page.click('nav [data-view="entry"]');
    await page.click('#v-entry [data-act="pay"][data-v="現金"]');
    const before = ledgerCount();
    offline = true;
    for (const k of ['8', '8']) await page.click('#v-entry [data-act="key"][data-v="' + k + '"]');
    await page.click('#v-entry .submit');
    await toastHas(/目前離線，已暫存/);
    await page.locator('#v-entry .qbar').waitFor();
    assert.match(await page.locator('#v-entry .qbar').innerText(), /1 筆離線記帳/);
    await shot('09-離線暫存');
    offline = false;
    await page.click('#v-entry [data-act="flush"]');
    await toastHas(/離線記帳已全部上傳/);
    assert.equal(ledgerCount(), before + 1);
    assert.equal(await page.locator('#v-entry .qbar').count(), 0);
  });

  await step('回應遺失：試算表已寫入、手機以為失敗而暫存，重送後仍只記一筆', async () => {
    const before = ledgerCount();
    dropResponse = true;
    for (const k of ['6', '6']) await page.click('#v-entry [data-act="key"][data-v="' + k + '"]');
    await page.click('#v-entry .submit');
    await toastHas(/目前離線，已暫存/);
    assert.equal(ledgerCount(), before + 1, '第一次其實已經寫入');
    const rid = lastCall('add').args.rid;
    assert.ok(rid, '記帳請求要帶請求編號');
    dropResponse = false;
    await page.click('#v-entry [data-act="flush"]');
    await toastHas(/離線記帳已全部上傳/);
    const resent = calls.filter(c => c.method === 'add' && c.args && c.args.rid === rid);
    assert.equal(resent.length, 2, '同一個編號送了兩次');
    assert.equal(ledgerCount(), before + 1, '重送後不應多一筆');
  });

  await step('紀錄頁：把一筆現金消費改成一卡通 → 試算表與畫面都是一卡通', async () => {
    await page.click('nav [data-view="records"]');
    const row = page.locator('#v-records button.li', { hasText: '現金' }).first();
    await row.waitFor();
    const r = +(await row.getAttribute('data-row')), sh = g.book(2026).getSheetByName('2026年11月');
    assert.equal(sh.val(r, 16), '現金');
    await row.click();
    await page.selectOption('#edPay', '一卡通');
    await page.click('[data-ed="save"]');
    await toastHas(/已更新/);
    assert.equal(lastCall('update').args.pay, '一卡通', '前端送出的付款方式');
    assert.equal(sh.val(r, 16), '一卡通', '試算表存的付款方式');
    await page.waitForFunction(rr => { const b = document.querySelector('#v-records button.li[data-row="' + rr + '"]'); return b && /・一卡通/.test(b.innerText); }, r);
    await shot('10-紀錄頁改成一卡通');
  });

  await step('紀錄頁：編輯一卡通儲值後按儲存，科目與付款方式不變', async () => {
    await page.click('nav [data-view="records"]');
    const row = page.locator('#v-records button.li', { hasText: '一卡通自動加值' }).first();
    await row.waitFor();
    const r = +(await row.getAttribute('data-row')), sh = g.book(2026).getSheetByName('2026年11月');
    const before = [sh.val(r, 12), sh.val(r, 16)];
    await row.click();
    assert.equal(await page.inputValue('#edCat'), '一卡通儲值');
    await page.click('[data-ed="save"]');
    await toastHas(/已更新/);
    assert.deepEqual([sh.val(r, 12), sh.val(r, 16)], before);
    await page.click('nav [data-view="entry"]');
  });

  await step('後端回錯誤時，畫面顯示錯誤訊息、不暫存', async () => {
    const before = ledgerCount();
    // 金額超過範圍以外的錯誤：送一個後端不認得的科目
    await page.evaluate(() => { S.e.cat = '零用錢'; S.e.amt = '50'; renderEntry(); });
    await page.click('#v-entry .submit');
    await toastHas(/發生錯誤：科目錯誤/);
    assert.equal(ledgerCount(), before);
    assert.equal(await page.locator('#v-entry .qbar').count(), 0);
  });

  await step('版本：後端是新版時不顯示提醒，今日頁底部顯示前後端版本', async () => {
    assert.equal(await page.locator('#backendBar').count(), 0);
    await page.click('nav [data-view="today"]');
    const v = g.get('BACKEND_VERSION');
    await page.waitForFunction(t => document.getElementById('v-today').innerText.indexOf('後端版本 ' + t) >= 0, v);
  });

  await step('版本：手機連到沒部署新版的舊後端 → 顯示提醒，可以關閉，不影響記帳', async () => {
    oldBackend = true;
    await page.reload();
    const bar = page.locator('#backendBar');
    await bar.waitFor();
    assert.match(await bar.innerText(), /後端還沒部署新版本/);
    await shot('11-後端版本提醒');
    await bar.locator('button').click();
    assert.equal(await page.locator('#backendBar').count(), 0);
    const before = ledgerCount();
    await page.click('nav [data-view="entry"]');
    await page.click('#v-entry [data-act="pay"][data-v="現金"]');
    for (const k of ['3', '0']) await page.click('#v-entry [data-act="key"][data-v="' + k + '"]');
    await page.click('#v-entry .submit');
    await toastHas(/已記錄/);
    assert.equal(ledgerCount(), before + 1);
    oldBackend = false;
  });

  await step('沒有任何對外連線、console 沒有錯誤', async () => {
    assert.deepEqual(external, []);
    assert.deepEqual(consoleErrors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(results.join('\n'));
console.log('\n截圖：' + OUT);
console.log(failed ? '\n' + failed + ' 項未通過' : '\n全部通過');
process.exit(failed ? 1 : 0);
