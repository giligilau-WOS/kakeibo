// 家計簿後端金額與狀態邏輯：屬性測試（node:test，不需安裝套件）
// 執行：node --test tests/
// 每個屬性至少跑 500 組亂數（固定種子，失敗可重現）。全程只用假試算表，不連網。
process.env.TZ = 'Asia/Taipei';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadGas, rng, RUNS } from './helpers/gas.mjs';
import { buildWorkbook2026, CATS, TRAVEL_FULL } from './fixtures/workbook.mjs';

const TOPUP = '一卡通儲值';
function fresh(seed, opt) {
  const g = loadGas({ props: { TOKEN: 't' } });
  const wb = buildWorkbook2026(g, Object.assign({ seed }, opt || {}));
  return { g, wb };
}
const snap = (sh, fromRow = 1) => JSON.stringify([...sh.cells].filter(([k]) => +k.split(',')[0] >= fromRow).sort());
const pad = n => String(n).padStart(2, '0');
const ledgerRows = sh => { const out = []; for (let r = 16; r <= 515; r++) if (sh.val(r, 14) !== '') out.push({ r, date: sh.val(r, 11), cat: sh.val(r, 12), amt: sh.val(r, 14), pay: sh.val(r, 16) }); return out; };

// ---------------------------------------------------------------- 日期與月份換算
test('日期：上個月／下個月互為反函數，跨年正確', () => {
  const { g } = fresh(1), R = rng(11);
  for (let i = 0; i < RUNS; i++) {
    const y = R.int(2020, 2035), m = R.pick([1, 12, R.int(1, 12)]);
    const p = g.call('prevMonth_', y, m), n = g.call('nextMonth_', y, m);
    assert.deepEqual({ ...g.call('nextMonth_', p.y, p.m) }, { y, m });
    assert.deepEqual({ ...g.call('prevMonth_', n.y, n.m) }, { y, m });
    assert.ok(p.m >= 1 && p.m <= 12 && n.m >= 1 && n.m <= 12);
  }
});

test('日期：加減天數往返不變，含閏年 2 月與月底', () => {
  const { g } = fresh(1), R = rng(12);
  for (let i = 0; i < RUNS; i++) {
    const y = R.pick([2024, 2026, 2027, 2028, R.int(2020, 2035)]), m = R.pick([2, 12, 1, R.int(1, 12)]);
    const d = R.pick([1, 28, g.call('daysIn_', y, m), R.int(1, g.call('daysIn_', y, m))]);
    const s = y + '-' + pad(m) + '-' + pad(d), k = R.pick([1, -1, 31, -31, 366, R.int(-400, 400)]);
    assert.equal(g.call('addDaysStr_', g.call('addDaysStr_', s, k), -k), s);
    const want = new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
    assert.equal(g.call('addDaysStr_', s, k), want, s + ' 加 ' + k + ' 天');
  }
  assert.equal(g.call('daysIn_', 2028, 2), 29);
  assert.equal(g.call('daysIn_', 2027, 2), 28);
});

test('日期：繳費期限不會超過月底（例如 2 月 30 日）', () => {
  const { g } = fresh(1), R = rng(13);
  for (let i = 0; i < RUNS; i++) {
    const y = R.int(2024, 2030), m = R.int(1, 12), due = R.pick([0, 20, 29, 30, 31, R.int(1, 31)]);
    const s = g.call('dueDate_', y, m, due);
    assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(+s.slice(8) <= g.call('daysIn_', y, m) && +s.slice(8) >= 1, s);
  }
});

test('日期：信用卡帳單期間＝前前月 23 日～前月 22 日（跨年）', () => {
  const { g } = fresh(1);
  for (const y of [2026, 2027]) for (let m = 1; m <= 12; m++) {
    const b = g.call('getBill_', y, m), p1 = g.call('prevMonth_', y, m), p2 = g.call('prevMonth_', p1.y, p1.m);
    assert.equal(b.from, p2.y + '-' + pad(p2.m) + '-23');
    assert.equal(b.to, p1.y + '-' + pad(p1.m) + '-22');
  }
});

test('差分：前端 ymAdd 與後端 prevMonth_／nextMonth_ 結果一致', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/function ymAdd\([^\n]*/)[0];
  const ymAdd = vm.runInNewContext('(' + src.replace('function ymAdd', 'function') + ')');
  const { g } = fresh(1), R = rng(14);
  for (let i = 0; i < RUNS; i++) {
    const y = R.int(2020, 2035), m = R.int(1, 12);
    assert.deepEqual({ ...ymAdd({ y, m }, -1) }, { ...g.call('prevMonth_', y, m) });
    assert.deepEqual({ ...ymAdd({ y, m }, 1) }, { ...g.call('nextMonth_', y, m) });
  }
});

// ---------------------------------------------------------------- 記帳
test('記帳：新增寫進第一個空列，刪除後流水帳完全回到原狀', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(100 + i), { g, wb } = fresh(100 + i), sh = wb.month(11);
    for (let k = 0; k < R.int(0, 6); k++) { const r = R.int(16, 30); sh.set(r, 11, '2026-11-0' + R.int(1, 9)).set(r, 12, '食物').set(r, 13, 'x').set(r, 14, R.int(1, 99)).set(r, 16, '現金'); }
    let firstEmpty = 16; while (sh.val(firstEmpty, 11) !== '' || sh.val(firstEmpty, 14) !== '') firstEmpty++;
    const before = snap(sh, 16);
    const cat = R.pick(CATS.concat(['國旅'])), amt = R.pick([1, -50, 999999, R.int(1, 5000)]);
    const res = g.call('addEntry_', { date: '2026-11-' + pad(R.int(1, 30)), cat, item: '測試', amount: R.bool() ? String(amt) : amt.toLocaleString('en-US'), pay: R.pick(['現金', '信用卡']) });
    assert.equal(res.row, firstEmpty);
    assert.equal(sh.val(res.row, 14), amt);
    assert.equal(sh.val(res.row, 12), cat === '國旅' ? TRAVEL_FULL : cat);
    g.call('deleteEntry_', { y: 2026, m: 11, row: res.row });
    assert.equal(snap(sh, 16), before);
  }
});

test('記帳：0 元、不認得的科目、錯誤日期會被擋下，不寫入任何格子', () => {
  const { g, wb } = fresh(2), sh = wb.month(11), before = snap(sh);
  for (const a of [{ amount: 0, cat: '食物' }, { amount: '', cat: '食物' }, { amount: 100, cat: '零用錢' }, { amount: 100, cat: '食物', date: '2026/11/18' }])
    assert.throws(() => g.call('addEntry_', Object.assign({ date: '2026-11-18', item: 'x', pay: '現金' }, a)));
  assert.equal(snap(sh), before);
});

test('記帳：在紀錄頁編輯但不改任何欄位，試算表不應該變（含一卡通）', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(300 + i), { g, wb } = fresh(300 + i), sh = wb.month(11);
    const pay = R.pick(['現金', '信用卡', '一卡通']);
    const res = g.call('addEntry_', { date: '2026-11-' + pad(R.int(1, 18)), cat: R.pick(CATS), item: '早餐', amount: R.int(1, 400), pay, noTopup: true });
    const before = snap(sh, 16);
    g.nextRequest();
    const r = g.call('getRecords_', 2026, 11).rows.find(x => x.row === res.row);
    // 前端 openEdit → call('update', …) 送出的就是畫面上原本的值
    g.call('updateEntry_', { y: 2026, m: 11, row: r.row, date: r.date, cat: r.cat, item: r.item, amount: String(r.amount), pay: r.pay, note: r.note });
    assert.equal(snap(sh, 16), before, '付款方式「' + pay + '」編輯後被改成「' + sh.val(res.row, 16) + '」');
  }
});

// ---------------------------------------------------------------- 一卡通
test('一卡通：餘額守恆＝校正值＋自動加值 − 一卡通消費；加值筆數剛好夠用', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(500 + i), { g } = fresh(500 + i);
    let bal = 320, calibrated = false;
    for (let k = 0, n = R.int(1, 12); k < n; k++) {
      const op = R.pick(['ecard', 'ecard', 'ecard', 'cash', 'card', 'cal']);
      const date = calibrated ? '2026-11-18' : '2026-11-' + pad(R.int(1, 18));
      if (op === 'cal') { bal = R.pick([0, 499, 500, R.int(0, 3000)]); g.call('setEcard_', { balance: bal }); calibrated = true; }
      else if (op === 'ecard') {
        const amt = R.pick([1, bal, bal + 1, 500, 501, 1000, R.int(1, 1800)]) || 1;
        const topups = bal < amt ? Math.ceil((amt - bal) / 500) : 0;
        const res = g.call('addEntry_', { date, cat: R.pick(CATS), item: '捷運', amount: amt, pay: '一卡通' });
        bal += topups * 500 - amt;
        assert.equal(res.ecard, bal, '第 ' + k + ' 步餘額');
        assert.ok(bal >= 0, '加值後不應為負');
        if (topups) assert.ok(bal < 500, '加值不應多加一次 500');
      } else g.call('addEntry_', { date, cat: R.pick(CATS), item: 'x', amount: R.int(1, 900), pay: op === 'cash' ? '現金' : '信用卡' });
      g.nextRequest();
      assert.equal(g.call('ecardBalance_'), bal);
    }
  }
});

test('一卡通：自動加值記成「一卡通儲值＋信用卡」，不歸到任何日常分類', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(900 + i), { g, wb } = fresh(900 + i);
    g.call('addEntry_', { date: '2026-11-18', cat: R.pick(CATS), item: '捷運', amount: R.int(321, 2500), pay: '一卡通' });
    const tops = ledgerRows(wb.month(11)).filter(r => r.cat === TOPUP);
    assert.ok(tops.length >= 1);
    tops.forEach(t => { assert.equal(t.pay, g.get('CONFIG').cardLabel); assert.equal(t.amt, 500); assert.ok(CATS.indexOf(t.cat) < 0); });
  }
});

test('一卡通：儲值不能算進「本月累計花費」曲線（圖表）', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(1300 + i), { g, wb } = fresh(1300 + i);
    g.call('addEntry_', { date: '2026-11-' + pad(R.int(1, 18)), cat: R.pick(CATS), item: '捷運', amount: R.int(1, 2500), pay: '一卡通' });
    g.nextRequest();
    const want = ledgerRows(wb.month(11)).filter(r => r.cat !== TRAVEL_FULL && r.cat !== TOPUP).reduce((s, r) => s + r.amt, 0);
    const cum = g.call('dailyCum_', 2026, 11);
    assert.equal(cum[cum.length - 1], want, '累計曲線多算了一卡通儲值 $' + (cum[cum.length - 1] - want));
  }
});

test('一卡通：儲值不能算進今日看板的「今天已花」', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(1700 + i), { g, wb } = fresh(1700 + i);
    g.call('addEntry_', { date: '2026-11-18', cat: R.pick(CATS), item: '捷運', amount: R.int(1, 2500), pay: '一卡通' });
    g.nextRequest();
    const want = ledgerRows(wb.month(11)).filter(r => r.date === '2026-11-18' && r.cat !== TRAVEL_FULL && r.cat !== TOPUP).reduce((s, r) => s + r.amt, 0);
    assert.equal(g.call('getDashboard_', '2026-11-18').todaySpent, want);
  }
});

// ---------------------------------------------------------------- 預算調撥
test('調撥：總預算不變；各科目＝原預算＋調入−調出；全部刪除後還原', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(2100 + i), { g } = fresh(2100 + i);
    const base = {}; g.call('readTopRaw_', 2026, 11).cats.forEach(c => { base[c.name] = c.budget; });
    const exp = { ...base };
    for (let k = 0, n = R.int(1, 6); k < n; k++) {
      const from = R.pick(CATS); let to = R.pick(CATS); if (to === from) to = CATS[(CATS.indexOf(from) + 1) % 6];
      const amt = R.pick([1, R.int(1, 5000), 1000000]);
      g.call('transferBudget_', { y: 2026, m: 11, from, to, amount: amt });
      exp[from] -= amt; exp[to] += amt;
      const now = g.call('readTopRaw_', 2026, 11).cats;
      now.forEach(c => assert.equal(c.budget, exp[c.name], c.name));
      assert.equal(now.reduce((s, c) => s + c.budget, 0), Object.values(base).reduce((s, v) => s + v, 0));
    }
    let list;
    while ((list = g.call('transfersFor_', 2026, 11)).length) g.call('deleteLog_', 2026, R.pick(list).row);
    g.call('readTopRaw_', 2026, 11).cats.forEach(c => assert.equal(c.budget, base[c.name], c.name));
  }
});

test('調撥：0 元、負數、同科目、不認得的科目會被擋下', () => {
  const { g } = fresh(3);
  for (const a of [{ amount: 0 }, { amount: -5 }, { from: '食物', to: '食物' }, { to: '國旅' }])
    assert.throws(() => g.call('transferBudget_', Object.assign({ y: 2026, m: 11, from: '食物', to: '娛樂', amount: 100 }, a)));
  assert.equal(g.call('transfersFor_', 2026, 11).length, 0);
});

// ---------------------------------------------------------------- 預扣繳費＋還原
function setupPrepaid(R, g, wb) {
  const items = g.get('PREPAID')[2026][0].items, it = R.pick(items), row = it[0];
  for (let m = 1; m <= 12; m++) {
    const kind = R.pick(['zero', 'num', 'num', 'formula', 'blank']);
    if (kind === 'formula') wb.tw.put(row, 1 + m, { v: R.int(1, 99) * 100, f: '=ROUND(B' + row + '*1,0)' });
    else wb.tw.put(row, 1 + m, { v: kind === 'zero' ? 0 : kind === 'blank' ? '' : R.int(1, 99) * 100, f: '' });
  }
  return { key: '台銀:' + row, row };
}
// 有公式的格子只比公式（假試算表不會重算公式的值，真的試算表會），其餘比值
const rowSnap = (tw, row) => JSON.stringify(Array.from({ length: 12 }, (_, i) => { const c = tw.cell(row, 2 + i); return c.f ? { f: c.f } : { v: c.v }; }));

test('預扣繳費：記一筆再刪除，攤平表回到原本的值或公式', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(2600 + i), { g, wb } = fresh(2600 + i), { key, row } = setupPrepaid(R, g, wb);
    const before = rowSnap(wb.tw, row), m = R.int(1, 12);
    g.call('recordPrepaid_', { key, amount: R.int(1, 30000), date: '2026-' + pad(m) + '-' + pad(R.int(1, 28)) });
    // 不能改到 TRACK_START（11 月）以前、而且不是本次繳費月份的歷史欄
    for (let mo = 1; mo < 11; mo++) if (mo !== m) assert.equal(JSON.stringify(JSON.parse(rowSnap(wb.tw, row))[mo - 1]), JSON.stringify(JSON.parse(before)[mo - 1]), mo + " 月被改寫");
    g.nextRequest();
    const log = g.call('readLog_', 2026).filter(r => r.type === '繳費');
    g.call('deleteLog_', 2026, log[0].row);
    assert.equal(rowSnap(wb.tw, row), before);
  }
});

test('預扣繳費：同一項目記兩筆，不論先刪哪一筆，全部刪完都要回到原狀', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(3100 + i), { g, wb } = fresh(3100 + i), { key, row } = setupPrepaid(R, g, wb);
    const before = rowSnap(wb.tw, row), m = R.int(1, 12), date = '2026-' + pad(m) + '-10';
    g.call('recordPrepaid_', { key, amount: R.int(1, 30000), date });
    g.call('recordPrepaid_', { key, amount: R.int(1, 30000), date });
    let log;
    const order = R.bool() ? 'first' : 'last';
    while ((log = g.call('readLog_', 2026).filter(r => r.type === '繳費')).length) g.call('deleteLog_', 2026, (order === 'first' ? log[0] : log[log.length - 1]).row);
    assert.equal(rowSnap(wb.tw, row), before, '刪除順序：' + (order === 'first' ? '先刪第一筆' : '先刪最後一筆'));
  }
});

// ---------------------------------------------------------------- 預扣信封：調用與歸還
test('信封調用：借出時水位減少借出額；歸還後帳上淨額為 0、信封水位回到原值', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(3600 + i), { g, wb } = fresh(3600 + i);
    const env0 = g.call('getEnvelopes_', 2026, 11).accounts[0].items.filter(x => x.safe > 0);
    if (!env0.length) continue;
    const it = R.pick(env0), amt = R.pick([1, it.safe, R.int(1, it.safe)]);
    const ye0 = g.call('getEnvelopes_', 2026, 12).accounts[0].items.find(x => x.key === it.key);
    const sum37 = () => Array.from({ length: 12 }, (_, k) => Number(wb.tw.val(37, 2 + k)) || 0).reduce((a, b) => a + b, 0);
    const s0 = sum37();
    g.call('borrowEnvelope_', { key: it.key, amount: amt, cat: R.pick(CATS) });
    g.nextRequest();
    const after = g.call('getEnvelopes_', 2026, 11).accounts[0].items.find(x => x.key === it.key);
    assert.equal(after.balance, it.balance - amt);
    assert.equal(sum37(), s0 + amt);
    const open = g.call('borrowsOpen_', 2026);
    assert.equal(open.length, 1); assert.equal(open[0].amount, amt);
    if (R.bool()) g.setNow('2026-12-0' + R.int(1, 9) + 'T09:00:00+08:00');   // 一半在下個月發薪日才歸還
    g.call('repayBorrow_', { id: open[0].id });
    g.nextRequest();
    assert.equal(sum37(), s0, '借出＋歸還的淨額應為 0');
    assert.equal(g.call('borrowsOpen_', 2026).length, 0);
    const ye1 = g.call('getEnvelopes_', 2026, 12).accounts[0].items.find(x => x.key === it.key);
    assert.equal(ye1.balance, ye0.balance); assert.equal(ye1.yearEnd, ye0.yearEnd);
    assert.throws(() => g.call('repayBorrow_', { id: open[0].id }), /已經歸還/);
  }
});

test('信封調用：超過可安全調用金額、0 元會被擋下', () => {
  const { g } = fresh(4);
  const it = g.call('getEnvelopes_', 2026, 11).accounts[0].items.find(x => x.safe > 0);
  assert.throws(() => g.call('borrowEnvelope_', { key: it.key, amount: it.safe + 1 }), /超過可安全調用/);
  assert.throws(() => g.call('borrowEnvelope_', { key: it.key, amount: 0 }));
  assert.equal(g.call('borrowsOpen_', 2026).length, 0);
});

// ---------------------------------------------------------------- 冪等（離線佇列重送、逾時重試）
test('冪等：同一筆記帳送兩次（離線佇列重送），只能記成一筆', () => {
  const { g, wb } = fresh(5), args = { date: '2026-11-18', cat: '食物', item: '午餐', amount: 120, pay: '現金', note: '' };
  const n0 = ledgerRows(wb.month(11)).length;
  g.call('api', 't', 'add', { ...args }); g.nextRequest(); g.call('api', 't', 'add', { ...args });
  assert.equal(ledgerRows(wb.month(11)).length, n0 + 1);
});

test('冪等：同一筆預扣繳費送兩次，只能記成一筆', () => {
  const { g } = fresh(6), key = '台銀:11', args = { key, amount: 4700, date: '2026-11-18', note: '' };
  g.call('api', 't', 'payPrepaid', { ...args }); g.nextRequest(); g.call('api', 't', 'payPrepaid', { ...args });
  assert.equal(g.call('readLog_', 2026).filter(r => r.type === '繳費').length, 1);
});

test('冪等：同一筆歸還按兩次，第二次會被擋下', () => {
  const { g } = fresh(7);
  const it = g.call('getEnvelopes_', 2026, 11).accounts[0].items.find(x => x.safe > 0);
  g.call('borrowEnvelope_', { key: it.key, amount: 1, cat: '食物' });
  const id = g.call('borrowsOpen_', 2026)[0].id;
  g.call('api', 't', 'repay', { id }); g.nextRequest();
  assert.throws(() => g.call('api', 't', 'repay', { id }), /已經歸還/);
});

test('冪等：校正一卡通餘額送兩次，結果相同', () => {
  const { g } = fresh(8);
  const a = g.call('api', 't', 'setEcard', { balance: 777 }).balance; g.nextRequest();
  const b = g.call('api', 't', 'setEcard', { balance: 777 }).balance;
  assert.equal(a, 777); assert.equal(b, 777);
});

// ---------------------------------------------------------------- 安全
test('密碼錯誤時，任何功能都不會執行', () => {
  const { g, wb } = fresh(9), before = snap(wb.month(11));
  for (const k of [undefined, '', 'T', 'tt']) assert.throws(() => g.call('api', k, 'add', { date: '2026-11-18', cat: '食物', item: 'x', amount: 1, pay: '現金' }), /密碼錯誤/);
  assert.equal(snap(wb.month(11)), before);
});
