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
import { fakeGoogle, withVer } from './helpers/fake-script-api.mjs';
import { readFileSync } from 'node:fs';
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
  let offline = false, dropResponse = false, oldBackend = false, noSelfUpdate = false, htmlOnce = null, htmlLeft = 0;
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  const handler = async route => {   // 其他尺寸的頁面也共用同一個假後端
    const req = route.request(), url = req.url();
    if (url.startsWith(BASE)) return route.continue();
    if (url.startsWith(GAS_URL)) {
      const body = req.postData() || '{}';
      const parsed = JSON.parse(body);
      if (offline) { calls.push({ method: parsed.method, offline: true }); return route.abort('internetdisconnected'); }
      calls.push({ method: parsed.method, args: parsed.args });
      if (htmlOnce === parsed.method) {   // 模擬 Google 在執行程式前就擋下（部署切換中、需要授權），回傳網頁
        if (--htmlLeft <= 0) htmlOnce = null;
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body><p>Sorry, unable to open the file at this time.</p></body></html>' });
      }
      if (noSelfUpdate && parsed.method === 'selfUpdate')   // 模擬還沒有自我更新功能的舊後端
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '未知的功能：selfUpdate' }) });
      g.nextRequest();
      const out = g.call('doPost', { postData: { contents: body } });
      if (parsed.method === 'selfUpdate' && JSON.parse(out.text).ok) oldBackend = false;   // 更新成功後，手機連到的就是新後端
      if (dropResponse) return route.abort('timedout');   // 試算表已寫入，但回應在路上遺失
      let text = out.text;
      if (oldBackend) { const j = JSON.parse(text); if (j.data) delete j.data.backend; text = JSON.stringify(j); }   // 模擬沒部署新版的舊後端
      return route.fulfill({ status: 200, contentType: 'application/json', body: text });
    }
    external.push(url); return route.abort();
  };
  await page.route('**/*', handler);
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
    await bar.locator('[data-bk="close"]').click();
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

  await step('立即更新：後端還沒有更新功能時顯示首次設定說明；有的話按一下就部署新版、提醒消失', async () => {
    // 假的 GitHub 與 Apps Script API：GitHub 上有比專案新的版本
    const code = readFileSync(join(root, 'Code_單一檔案版.gs'), 'utf8'), man = readFileSync(join(root, 'appsscript.json'), 'utf8');
    const f = fakeGoogle({ github: { 'Code_單一檔案版.gs': withVer(code, '2099.01.01-0000'), 'appsscript.json': man },
      files: [{ name: 'appsscript', type: 'JSON', source: man }, { name: '程式碼', type: 'SERVER_JS', source: code }, { name: 'Index', type: 'HTML', source: 'old' }] });
    g.ctx.UrlFetchApp = f.UrlFetchApp; g.ctx.ScriptApp = f.ScriptApp;
    oldBackend = true; noSelfUpdate = true;
    await page.reload();
    const bar = page.locator('#backendBar');
    await bar.waitFor();
    await bar.locator('[data-bk="update"]').click();
    await page.waitForFunction(() => /第一次需要手動設定/.test(document.getElementById('backendBar').innerText));
    await shot('12-首次設定說明');
    assert.equal(f.writes.length, 0);
    noSelfUpdate = false;
    await bar.locator('[data-bk="update"]').click();
    await toastHas(/已從 .+ 更新到 2099\.01\.01-0000/, 8000);
    await page.waitForFunction(() => !document.getElementById('backendBar'));
    assert.equal(f.deployed().deploymentConfig.description, 'GitHub 2099.01.01-0000');
    assert.equal(f.state.files.find(x => x.name === 'Index').source, 'old');
    assert.ok(calls.some(c => c.method === 'selfUpdate'));
  });

  const card = y => g.book(y).getSheetByName('卡費');
  const subRow = (y, name) => g.call('readSubs_', y).find(r => r.name === name);
  await step('固定訂閱：資產頁打開清單，顯示本期（11/6 帳單）訂閱與合計', async () => {
    await page.click('nav [data-view="assets"]');
    await page.click('#v-assets [data-act="subs"]');
    await page.locator('#v-subs .list').first().waitFor();
    const txt = await page.locator('#v-subs').innerText();
    const d = g.call('getSubs_', 2026, 11);
    assert.match(txt, new RegExp('本期固定訂閱合計\\s*\\$' + d.totals[10].toLocaleString('en-US')));
    assert.match(txt, /影音B/); assert.match(txt, /最早可以從 12 月 6 日帳單起修改/);
    await shot('13-固定訂閱清單');
  });

  await step('固定訂閱：新增 Claude 690（12 月起，含明年）→ 兩份卡費表都寫入 → 按復原後兩邊都消失', async () => {
    const before = JSON.stringify([...card(2026).cells].sort()) + JSON.stringify([...card(2027).cells].sort());
    await page.click('#v-subs [data-sb="add"]');
    await page.fill('#sbName', 'Claude'); await page.fill('#sbAmt', '690');
    assert.equal(await page.inputValue('#sbFrom'), '12');
    assert.equal(await page.isChecked('#sbNext'), true);
    await shot('14-新增訂閱');
    await page.click('[data-se="save"]');
    await toastHas(/已新增「Claude」 每期 \$690，從 12 月 6 日帳單起/);
    g.nextRequest();
    assert.deepEqual(Array.from(subRow(2026, 'Claude').values), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 690]);
    assert.deepEqual(Array.from(subRow(2027, 'Claude').values), Array(12).fill(690));
    assert.ok(calls.filter(c => c.method === 'saveSub').every(c => c.args.rid), '修改要帶請求編號');
    await page.locator('#v-subs .qbar').waitFor();
    assert.match(await page.locator('#v-subs .qbar').innerText(), /新增「Claude」/);
    await page.click('#v-subs [data-sb="undo"]');
    await toastHas(/已復原：Claude/);
    await page.waitForFunction(() => !document.querySelector('#v-subs .qbar'));
    g.nextRequest();
    assert.equal(JSON.stringify([...card(2026).cells].sort()) + JSON.stringify([...card(2027).cells].sort()), before, '復原後卡費表要回到原狀');
  });

  await step('固定訂閱：影音B 從 12 月起改成 680（只改今年）；切到明年看得到 2027 的訂閱', async () => {
    await page.click('#v-subs [data-sb="edit"][data-n="影音B"]');
    await page.fill('#sbAmt', '680');
    await page.uncheck('#sbNext');
    await page.click('[data-se="save"]');
    await toastHas(/已修改「影音B」 每期 \$680/);
    g.nextRequest();
    const v = Array.from(subRow(2026, '影音B').values);
    assert.deepEqual(v.slice(0, 11), Array(11).fill(630), '11 月以前（已扣款）不能動');
    assert.equal(v[11], 680);
    assert.deepEqual(Array.from(subRow(2027, '影音B').values), Array(12).fill(630), '沒勾明年就不動 2027');
    await page.click('#v-subs [data-act="sb-next"]');
    await page.waitForFunction(() => /12 月 6 日帳單/.test(document.getElementById('v-subs').innerText) && /\$680/.test(document.getElementById('v-subs').innerText));
    await page.click('#v-subs [data-act="sb-next"]');
    await page.waitForFunction(() => /2027年1月/.test(document.getElementById('v-subs').innerText) && /購物 分期/.test(document.getElementById('v-subs').innerText));
    await shot('15-明年訂閱');
    // 還原，避免影響後面的步驟
    await page.click('#v-subs [data-act="sb-prev"]');
    await page.waitForFunction(() => /\$680/.test(document.getElementById('v-subs').innerText));
    await page.click('#v-subs [data-sb="undo"]');
    await toastHas(/已復原：影音B/);
  });

  await step('信用卡對帳：顯示本期固定訂閱明細', async () => {
    await page.click('nav [data-view="records"]');
    await page.click('#v-records [data-act="bill"]');
    await page.waitForFunction(() => /本期固定訂閱：/.test(document.getElementById('modalBox').innerText));
    const bill = g.call('getBill_', 2026, 12);
    for (const x of bill.subs) assert.match(await page.locator('#modalBox').innerText(), new RegExp(x.name.replace(/[()（）]/g, '.') + ' \\$' + x.amount.toLocaleString('en-US')));
    await page.click('[data-b="close"]');
  });

  await step('回應不是資料時顯示中文說明；開啟時沒問到後端版本，之後自動補上', async () => {
    htmlOnce = 'init'; htmlLeft = 1;
    await page.reload();
    await toastHas(/後端回應的不是資料（可能正在部署新版本或需要重新授權）.*原文：Sorry, unable to open the file/);
    await shot('16-回應不是資料');
    await page.click('nav [data-view="today"]');
    const v = g.get('BACKEND_VERSION');
    await page.waitForFunction(t => document.getElementById('v-today').innerText.indexOf('後端版本 ' + t) >= 0, v, { timeout: 8000 });
  });

  await step('開啟時連續 3 次都失敗：之後只要有一個請求成功，就自動補問後端版本', async () => {
    htmlOnce = 'init'; htmlLeft = 3;
    const nVer = calls.filter(c => c.method === 'version').length;
    // 數 init 請求：第一次＋自動重試 2 次（每次間隔 4 秒），全部被擋下
    const threeInits = new Promise((res, rej) => {
      let n = 0;
      const on = req => { if (req.url().startsWith(GAS_URL) && JSON.parse(req.postData() || '{}').method === 'init' && ++n === 3) { page.off('request', on); res(); } };
      page.on('request', on);
      setTimeout(() => { page.off('request', on); rej(new Error('15 秒內只看到 ' + n + ' 次 init，開啟失敗後沒有自動重試')); }, 15000);   // 等待上限，不是硬等
    });
    await page.reload();
    await threeInits;
    await toastHas(/後端回應的不是資料/);
    assert.equal(htmlOnce, null, '三次 init 都應該被擋下');
    await page.click('nav [data-view="records"]');
    await page.locator('#v-records .list').first().waitFor();
    await page.click('nav [data-view="today"]');
    const v = g.get('BACKEND_VERSION');
    await page.waitForFunction(t => document.getElementById('v-today').innerText.indexOf('後端版本 ' + t) >= 0, v, { timeout: 8000 });
    assert.ok(calls.filter(c => c.method === 'version').length > nVer, '要自動補問版本');
  });

  // ---------------- 記帳頁改版：一個畫面記完、可以復原 ----------------
  const ledger = () => JSON.stringify([...g.book(2026).getSheetByName('2026年11月').cells].filter(([k]) => +k.split(',')[0] >= 16).sort());
  await step('記帳頁：三種 iPhone 尺寸打開時，16 個數字鍵和「記一筆」都不用捲動就按得到；iPhone 15 以上連科目也看得到', async () => {
    for (const vp of [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      const c2 = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await c2.addInitScript(u => { try { if (!localStorage.getItem('kakeiboCfg')) localStorage.setItem('kakeiboCfg', JSON.stringify({ url: u, k: 'test-token' })); } catch (e) {} }, GAS_URL);
      const p2 = await c2.newPage(); await p2.route('**/*', handler);
      await p2.goto(BASE + '/index.html'); await p2.locator('#v-entry .submit').waitFor();
      const m = await p2.evaluate(() => {
        const nav = document.getElementById('nav').getBoundingClientRect().top, dock = document.querySelector('#v-entry .dock').getBoundingClientRect().top;
        const inView = e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= nav + 0.5; };
        const above = e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= dock + 0.5; };   // 上方的科目／項目不能被下方固定區蓋住
        return { scrollTop: document.getElementById('v-entry').scrollTop, keys: [...document.querySelectorAll('#v-entry .keys button')].filter(inView).length,
          submit: inView(document.querySelector('#v-entry .submit')), amount: inView(document.querySelector('#v-entry .amount')),
          cats: [...document.querySelectorAll('#v-entry .cats button')].every(above), items: !!document.querySelector('#v-entry .items.wrap') && above(document.querySelector('#v-entry .items.wrap button')) };
      });
      await p2.screenshot({ path: join(OUT, '20-記帳頁-' + vp.width + '.png') });
      await c2.close();
      assert.equal(m.scrollTop, 0); assert.equal(m.keys, 16, vp.width + '：16 個數字鍵都要在畫面內'); assert.ok(m.submit, vp.width + '：記一筆要在畫面內'); assert.ok(m.amount, vp.width + '：金額要在畫面內');
      if (vp.height >= 844) { assert.ok(m.cats, vp.width + '：科目要在畫面內'); assert.ok(m.items, vp.width + '：消費項目要在畫面內'); }
    }
  });

  await step('記帳頁：輸入時金額一直看得到；⌫ 和 C 可用；摘要一行顯示、點了展開詳細且會記住', async () => {
    await page.click('nav [data-view="entry"]');
    await page.click('#v-entry [data-act="pay"][data-v="現金"]');
    await page.click('#v-entry [data-act="cat"][data-v="食物"]');
    for (const k of ['3', '4', '5']) await page.click('#v-entry .keys [data-act="key"][data-v="' + k + '"]');
    await page.click('#v-entry .bsp');
    assert.match(await page.locator('#v-entry .amount .v').innerText(), /^\$34$/);
    await page.click('#v-entry .keys [data-v="C"]');
    assert.match(await page.locator('#v-entry .amount .v').innerText(), /^\$0$/);
    assert.match(await page.locator('#v-entry .bline').innerText(), /食物｜今天(還剩|超出) \$[\d,]+｜本月(剩|超支) \$/);
    await page.click('#v-entry .bline');
    assert.match(await page.locator('#v-entry .ndetail').innerText(), /今日額度/);
    await page.reload(); await page.locator('#v-entry .ndetail').waitFor();
    await page.click('#v-entry .bline');
    assert.equal(await page.locator('#v-entry .ndetail').count(), 0);
  });

  await step('記帳頁：＋備註打開輸入框，備註會送出；消費項目不再橫向捲動被切掉', async () => {
    await page.click('#v-entry [data-act="noteopen"]');
    await page.fill('#note', '測試備註');
    await page.locator('#note').blur();   // 打字時數字鍵會收起，像手機上先按「完成」收鍵盤
    for (const k of ['5', '5']) await page.click('#v-entry .keys [data-v="' + k + '"]');
    await page.click('#v-entry .submit');
    await toastHas(/已記錄/);
    assert.equal(lastCall('add').args.note, '測試備註');
    const ov = await page.evaluate(() => { const x = document.querySelector('#v-entry .items.wrap'); return x.scrollWidth - x.clientWidth; });
    assert.ok(ov <= 1, '消費項目不應該橫向溢出：' + ov);
  });

  await step('記完按「復原」：試算表回到記之前；一卡通連自動加值一起復原、餘額回到原本', async () => {
    const before = ledger();
    for (const k of ['7', '7']) await page.click('#v-entry .keys [data-v="' + k + '"]');
    await page.click('#v-entry .submit');
    await toastHas(/已記錄.*\$77/);
    await shot('21-記完可復原');
    await page.click('#toast .tact');
    await toastHas(/已復原：/);
    g.nextRequest(); assert.equal(ledger(), before, '復原後流水帳要回到原狀');
    // 一卡通：餘額不夠，會自動加值
    g.nextRequest(); const bal0 = g.call('ecardBalance_');
    await page.click('#v-entry [data-act="pay"][data-v="一卡通"]');
    for (const k of ['9', '0', '0']) await page.click('#v-entry .keys [data-v="' + k + '"]');
    assert.match(await page.locator('#v-entry .bline').innerText(), /會自動加值 \$\d/);
    await page.click('#v-entry .submit');
    await toastHas(/已自動加值/);
    await page.click('#toast .tact');
    await toastHas(/已復原：.*（含一卡通自動加值 \d 筆）/);
    g.nextRequest(); assert.equal(ledger(), before); assert.equal(g.call('ecardBalance_'), bal0);
    await page.click('#v-entry [data-act="pay"][data-v="現金"]');
  });

  await step('預扣模式：項目清單很長時，數字鍵和「記一筆繳費」也不用捲動就按得到', async () => {
    await page.click('#v-entry [data-act="pay"][data-v="預扣"]');
    await page.locator('#v-entry .ppgrid').waitFor();
    const m = await page.evaluate(() => {
      const nav = document.getElementById('nav').getBoundingClientRect().top, inView = e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= nav + 0.5; };
      return { tall: document.getElementById('v-entry').scrollHeight > window.innerHeight, keys: [...document.querySelectorAll('#v-entry .keys button')].filter(inView).length, submit: inView(document.querySelector('#v-entry .submit')) };
    });
    assert.ok(m.tall, '預扣清單應該比畫面高（不然測不到）');
    assert.equal(m.keys, 16); assert.ok(m.submit);
    // 固定區要貼齊底部：和底部選單之間不能露出後面的內容
    const gap = await page.evaluate(() => document.getElementById('nav').getBoundingClientRect().top - document.querySelector('#v-entry .dock').getBoundingClientRect().bottom);
    assert.ok(Math.abs(gap) <= 1, '固定區和底部選單之間有 ' + gap + 'px 縫隙');
    await shot('22-預扣模式');
    await page.click('#v-entry [data-act="pay"][data-v="現金"]');
  });

  // 事故：預扣模式打開備註時，iPhone 鍵盤彈出後畫面變矮，下方固定的數字鍵把備註框蓋住
  await step('打字時（iPhone 鍵盤彈出）：備註、自行輸入框不會被下方數字鍵蓋住；鍵盤收起後數字鍵回來', async () => {
    const vp0 = page.viewportSize();
    const check = async (sel) => {
      await page.setViewportSize({ width: vp0.width, height: 380 });   // 模擬鍵盤占掉下半部
      // 等畫面處理完縮小（有上限，逾時就照當下狀態判斷，不硬等）
      await page.waitForFunction(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.bottom <= window.innerHeight; }, sel, { timeout: 3000 }).catch(() => {});
      return page.evaluate(s => {
        const n = document.querySelector(s).getBoundingClientRect(), d = document.querySelector('#v-entry .dock'), dr = d.getBoundingClientRect();
        const dockShown = getComputedStyle(d).display !== 'none' && dr.height > 0;
        return { focused: document.activeElement === document.querySelector(s), top: n.top, bottom: n.bottom, h: window.innerHeight, covered: dockShown && n.bottom > dr.top + 0.5 };
      }, sel);
    };
    for (const mode of ['預扣', '現金']) {
      await page.click('#v-entry [data-act="pay"][data-v="' + mode + '"]');
      if (mode === '預扣') await page.locator('#v-entry .ppgrid').waitFor();
      if (await page.locator('#note').count() === 0) await page.click('#v-entry [data-act="noteopen"]');
      await page.focus('#note');
      const m = await check('#note');
      if (mode === '預扣') await shot('23-預扣備註打字');
      assert.ok(m.focused, mode + '：備註框要有焦點');
      assert.ok(!m.covered, mode + '：備註框被數字鍵蓋住 ' + JSON.stringify(m));
      assert.ok(m.top >= 0 && m.bottom <= m.h + 0.5, mode + '：備註框要在畫面內 ' + JSON.stringify(m));
      await page.locator('#note').blur();
      await page.setViewportSize(vp0);
      assert.ok(await page.locator('#v-entry .dock .submit').isVisible(), mode + '：鍵盤收起後「記一筆」要回來');
    }
    await page.fill('#note', ''); await page.locator('#note').blur();
  });

  await step('離線暫存後按「復原」：從佇列拿掉，恢復連線後也不會上傳', async () => {
    const before = ledger(), nAdd = calls.filter(c => c.method === 'add' && !c.offline).length;
    offline = true;
    for (const k of ['4', '4']) await page.click('#v-entry .keys [data-v="' + k + '"]');
    await page.click('#v-entry .submit');
    await toastHas(/目前離線，已暫存/);
    await page.click('#toast .tact');
    await toastHas(/已取消這筆暫存的記帳/);
    assert.equal(await page.locator('#v-entry .qbar').count(), 0);
    offline = false;
    assert.equal(await page.evaluate(() => S.queue.length), 0);
    assert.equal(calls.filter(c => c.method === 'add' && !c.offline).length, nAdd, '不能上傳');
    assert.equal(ledger(), before);
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
