// 家計簿後端金額與狀態邏輯：屬性測試（node:test，不需安裝套件）
// 執行：node --test tests/
// 每個屬性至少跑 500 組亂數（固定種子，失敗可重現）。全程只用假試算表，不連網。
process.env.TZ = 'Asia/Taipei';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadGas, rng, RUNS } from './helpers/gas.mjs';
import { buildWorkbook2026, CATS, TRAVEL_FULL, SUBS_2026, SUBS_2027 } from './fixtures/workbook.mjs';
import { fakeGoogle, withVer } from './helpers/fake-script-api.mjs';

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

test('記帳：在紀錄頁把付款方式改成另一種（例如現金→一卡通），試算表存的就是新的付款方式', () => {
  const want = { '現金': '現金', '信用卡': '聯邦信用卡', '一卡通': '一卡通' };
  for (let i = 0; i < RUNS; i++) {
    const R = rng(4600 + i), { g, wb } = fresh(4600 + i), sh = wb.month(11);
    const from = R.pick(['現金', '信用卡', '一卡通']), to = R.pick(['現金', '信用卡', '一卡通']);
    const res = g.call('addEntry_', { date: '2026-11-' + pad(R.int(1, 18)), cat: R.pick(CATS), item: '早餐', amount: R.int(1, 400), pay: from, noTopup: true });
    g.nextRequest();
    const r = g.call('getRecords_', 2026, 11).rows.find(x => x.row === res.row);
    const date = R.bool(0.2) ? '2026-12-01' : r.date;   // 偶爾連日期一起改到下個月
    g.call('updateEntry_', { y: 2026, m: 11, row: r.row, date, cat: r.cat, item: r.item, amount: String(r.amount), pay: to, note: r.note });
    g.nextRequest();
    const m = +date.slice(5, 7), got = g.call('getRecords_', 2026, m).rows.find(x => x.date === date && x.item === '早餐' && x.amount === r.amount);
    assert.ok(got, '改完找不到這筆');
    assert.equal(got.pay, to, from + ' → ' + to);
    assert.equal(wb.month(m).val(got.row, 16), want[to]);
  }
});

test('記帳後復原：任意記一筆（含一卡通自動加值）再復原，流水帳與一卡通餘額都回到原狀', () => {
  let topupCases = 0;
  for (let i = 0; i < RUNS; i++) {
    const R = rng(8100 + i), { g, wb } = fresh(8100 + i), sh = wb.month(11);
    const before = snap(sh, 16), bal0 = g.call('ecardBalance_');
    const pay = R.pick(['現金', '信用卡', '一卡通']);
    const res = g.call('api', 't', 'add', { date: '2026-11-' + pad(R.int(1, 18)), cat: R.pick(CATS.concat(['國旅'])), item: R.pick(['早餐', '捷運', '']), amount: R.pick([1, 320, 321, 1000, R.int(1, 2500)]), pay, rid: 'a' + i });
    if (res.written.length > 1) topupCases++;
    assert.equal(res.written.length, ledgerRows(sh).length - ledgerRows({ val: (r, c) => JSON.parse(before).find(([k]) => k === r + ',' + c)?.[1].v ?? '' }).length, '回報的列數要等於實際新增的列數');
    g.nextRequest();
    g.call('api', 't', 'undoAdd', { y: res.y, m: res.m, rows: res.written, rid: 'u' + i });
    g.nextRequest();
    assert.equal(snap(sh, 16), before, '復原後流水帳要回到原狀');
    assert.equal(g.call('ecardBalance_'), bal0, '一卡通餘額要回到原狀');
  }
  assert.ok(topupCases >= 30, '含自動加值的情況測到太少：' + topupCases);
});

test('記帳後復原：那一列已被改過就整批不動；同一個復原請求送兩次只執行一次', () => {
  const { g, wb } = fresh(30), sh = wb.month(11);
  const a = g.call('api', 't', 'add', { date: '2026-11-18', cat: '食物', item: '早餐', amount: 80, pay: '一卡通', rid: 'x1' });   // 一卡通餘額 320，不會加值
  const b = g.call('api', 't', 'add', { date: '2026-11-18', cat: '食物', item: '捷運', amount: 900, pay: '一卡通', rid: 'x2' });  // 會自動加值
  assert.ok(b.written.length >= 2);
  g.nextRequest();
  g.call('updateEntry_', { y: 2026, m: 11, row: b.written[1].row, date: '2026-11-18', cat: '一卡通儲值', item: '一卡通自動加值', amount: 1000, pay: '信用卡', note: '' });   // 有人把加值金額改了
  const mid = snap(sh, 16);
  g.nextRequest();
  assert.throws(() => g.call('api', 't', 'undoAdd', { y: 2026, m: 11, rows: b.written, rid: 'y1' }), /已經不是剛記的那筆/);
  assert.equal(snap(sh, 16), mid, '不一致時一列都不能刪');
  g.nextRequest();
  g.call('api', 't', 'undoAdd', { y: 2026, m: 11, rows: a.written, rid: 'y2' });
  const afterUndo = snap(sh, 16);
  g.nextRequest();
  // 復原後那一列空出來，又記了一筆內容不同的新紀錄；舊的復原請求重送（同一個 rid）不能把新紀錄刪掉
  g.call('api', 't', 'add', { date: '2026-11-18', cat: '食物', item: '午餐', amount: 150, pay: '現金', rid: 'x3' });
  const withNew = snap(sh, 16);
  g.nextRequest();
  g.call('api', 't', 'undoAdd', { y: 2026, m: 11, rows: a.written, rid: 'y2' });
  assert.equal(snap(sh, 16), withNew, '重送的復原不能再刪東西');
  assert.notEqual(afterUndo, withNew);
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

test('一卡通：儲值不能算進紀錄頁的本月合計、圖表的每日花費與項目排行', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(1900 + i), { g, wb } = fresh(1900 + i);
    g.call('addEntry_', { date: '2026-11-' + pad(R.int(1, 18)), cat: R.pick(CATS), item: '捷運', amount: R.int(1, 2500), pay: '一卡通' });
    g.nextRequest();
    const rows = ledgerRows(wb.month(11)), want = rows.filter(r => r.cat !== TOPUP).reduce((s, r) => s + r.amt, 0);
    assert.equal(g.call('getRecords_', 2026, 11).total, want);
    const ex = g.call('monthExtra_', 2026, 11, 18), daily = ex.daily.cash.concat(ex.daily.card).reduce((a, b) => a + b, 0);
    assert.equal(daily, rows.filter(r => r.cat !== TOPUP && r.cat !== TRAVEL_FULL).reduce((s, r) => s + r.amt, 0));
    assert.ok(!ex.items.some(x => x.item === '一卡通自動加值'));
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

test('預扣繳費：同一項目記多筆（可跨月），不論刪除順序，攤平表都等於「只記剩下那幾筆」的結果', () => {
  const stats = { plain: 0, moved: 0 };
  for (let i = 0; i < RUNS; i++) {
    const R = rng(3100 + i), seed = 3100 + i;
    const pays = Array.from({ length: R.int(2, 4) }, () => ({ amount: R.int(1, 30000), date: '2026-' + pad(R.pick([11, 12, R.int(1, 12)])) + '-' + pad(R.int(1, 28)) }));
    const { g, wb } = fresh(seed), { key, row } = setupPrepaid(rng(seed), g, wb);
    const before = rowSnap(wb.tw, row);
    pays.forEach(p => { g.nextRequest(); g.call('recordPrepaid_', { key, ...p }); });
    g.nextRequest();
    const moved = g.call('readLog_', 2026).some(r => r.type === '繳費' && JSON.parse(r.data).mm !== r.m);
    const alive = pays.map(() => true);
    let anyMoved = moved;
    while (alive.some(Boolean)) {
      g.nextRequest();
      const log = g.call('readLog_', 2026).filter(r => r.type === '繳費'), k = R.int(0, log.length - 1);
      g.call('deleteLog_', 2026, log[k].row);
      alive[alive.map((a, j) => a ? j : -1).filter(j => j >= 0)[k]] = false;
      // 標準答案：在全新的試算表上，只記還留著的那幾筆
      const ref = fresh(seed), refKey = setupPrepaid(rng(seed), ref.g, ref.wb).key;
      pays.forEach((p, j) => { if (alive[j]) { ref.g.nextRequest(); ref.g.call('recordPrepaid_', { key: refKey, ...p }); } });
      ref.g.nextRequest();
      const refMoved = ref.g.call('readLog_', 2026).some(r => r.type === '繳費' && JSON.parse(r.data).mm !== r.m);
      if (refMoved) anyMoved = true;
      if (!moved && !refMoved) {
        assert.equal(rowSnap(wb.tw, row), rowSnap(ref.wb.tw, row), '剩下 ' + alive.filter(Boolean).length + ' 筆時不一致');
      } else {
        // 有「挪用別月計畫」時，保留每筆當初的挪用決定；至少：剩下的紀錄沒動到的格子要是原值
        const touched = new Set(); g.nextRequest();
        g.call('readLog_', 2026).filter(r => r.type === '繳費').forEach(r => { const d = JSON.parse(r.data); touched.add(d.colM - 2); touched.add(d.colMM - 2); });
        const now = JSON.parse(rowSnap(wb.tw, row)), orig = JSON.parse(before);
        now.forEach((c, k) => { if (!touched.has(k)) assert.deepEqual(c, orig[k], (k + 1) + ' 月沒有紀錄卻沒還原'); });
      }
    }
    assert.equal(rowSnap(wb.tw, row), before);
    anyMoved ? stats.moved++ : stats.plain++;
  }
  assert.ok(stats.plain >= 100 && stats.moved >= 20, '兩種情況都要測到夠多次：' + JSON.stringify(stats));
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
// 前端每筆記帳／繳費都帶請求編號 rid（index.html newRid），重送時沿用同一個
test('冪等：同一筆記帳送兩次（離線佇列重送），只能記成一筆', () => {
  const { g, wb } = fresh(5), args = { date: '2026-11-18', cat: '食物', item: '午餐', amount: 120, pay: '現金', note: '', rid: 'r-add-1' };
  const n0 = ledgerRows(wb.month(11)).length;
  g.call('api', 't', 'add', { ...args }); g.nextRequest(); g.call('api', 't', 'add', { ...args });
  assert.equal(ledgerRows(wb.month(11)).length, n0 + 1);
});

test('冪等：同一筆預扣繳費送兩次，只能記成一筆', () => {
  const { g } = fresh(6), key = '台銀:11', args = { key, amount: 4700, date: '2026-11-18', note: '', rid: 'r-pay-1' };
  g.call('api', 't', 'payPrepaid', { ...args }); g.nextRequest(); g.call('api', 't', 'payPrepaid', { ...args });
  assert.equal(g.call('readLog_', 2026).filter(r => r.type === '繳費').length, 1);
});

test('冪等：不同請求編號的相同內容（真的買了兩次）要照常記兩筆；重送的次數再多也只算一次', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(4100 + i), { g, wb } = fresh(4100 + i), n0 = ledgerRows(wb.month(11)).length;
    const args = { date: '2026-11-18', cat: '食物', item: '午餐', amount: R.int(1, 500), pay: R.pick(['現金', '信用卡']), note: '' };
    const rids = Array.from({ length: R.int(1, 4) }, (_, k) => 'r' + i + '-' + k);
    let sends = 0;
    rids.forEach(rid => { for (let t = 0, n = R.int(1, 3); t < n; t++) { g.nextRequest(); g.call('api', 't', 'add', { ...args, rid }); sends++; } });
    assert.equal(ledgerRows(wb.month(11)).length, n0 + rids.length, '送了 ' + sends + ' 次、' + rids.length + ' 個編號');
  }
});

test('冪等：寫入失敗的請求不占用編號，修好後可以用同一個編號重送', () => {
  const { g, wb } = fresh(10), n0 = ledgerRows(wb.month(11)).length;
  const bad = { date: '2026-11-18', cat: '零用錢', item: 'x', amount: 50, pay: '現金', rid: 'r-x' };
  assert.throws(() => g.call('api', 't', 'add', bad));
  g.nextRequest(); g.call('api', 't', 'add', { ...bad, cat: '食物' });
  assert.equal(ledgerRows(wb.month(11)).length, n0 + 1);
});

test('冪等：請求編號只保留最近 200 個，不會讓設定無限長大', () => {
  const { g } = fresh(11);
  for (let k = 0; k < 230; k++) { g.nextRequest(); g.call('api', 't', 'setEcard', { balance: 1 }); g.call('onceByRid_', 'k' + k, 'setEcard', { balance: 1 }); }
  const map = JSON.parse(g.props.get('RIDS'));
  assert.equal(Object.keys(map).length, 200);
  assert.ok(map.k229 && !map.k0);
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

// ---------------------------------------------------------------- 卡費表
test('卡費表：在訂閱區插入新列後，仍讀到「★ 本月6日聯邦卡應繳帳單總額」那一列', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(5100 + i), g = loadGas({ props: { TOKEN: 't' } }), sh = g.book(2027).sheet('卡費');
    // 依真實 2027 版面：第 4 列小計、第 5～12 列訂閱、第 15 列帳單總額；再隨機插入 0～4 列訂閱
    const extra = R.int(0, 4), totalRow = 15 + extra, want = Array.from({ length: 12 }, () => R.int(0, 20000));
    sh.set(4, 1, '① 聯邦固定數位訂閱小計(月初預扣)');
    for (let r = 5; r <= 12 + extra; r++) sh.set(r, 1, '   ├─ 訂閱' + r);
    sh.set(totalRow - 2, 1, '【自動連動：各月非固定刷卡與22日結帳分流】').set(totalRow - 1, 1, '② 本月6日實際出帳應繳之非固定刷卡').set(totalRow, 1, R.pick(['', ' ']) + '★ 本月6日聯邦卡應繳帳單總額 (①+②)');
    for (let r = 4; r <= totalRow + 2; r++) for (let c = 2; c <= 13; c++) if (r !== totalRow) sh.set(r, c, R.int(1, 99));
    want.forEach((v, k) => sh.set(totalRow, 2 + k, v));
    const spec = g.get('PROFILE')[2027].cardDue, m = R.int(1, 12);
    assert.equal(g.call('rowValue_', 2027, spec, m), want[m - 1], '插入 ' + extra + ' 列後 ' + m + ' 月');
  }
});

// ---------------------------------------------------------------- 版本
test('版本：init／refresh／version 都回報後端版本，且不低於前端需要的版本', () => {
  const { g } = fresh(12), v = g.get('BACKEND_VERSION');
  assert.match(v, /^\d{4}\.\d{2}\.\d{2}-\d{4}$/);
  for (const m of ['init', 'refresh', 'version']) assert.equal(g.call('api', 't', m, {}).backend, v, m);
  const need = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/NEED_BACKEND = '([^']+)'/)[1];
  assert.ok(need <= v, '前端需要 ' + need + '，後端只有 ' + v);
});

// ---------------------------------------------------------------- 從 GitHub 自我更新
const REPO_CODE = readFileSync(new URL('../Code_單一檔案版.gs', import.meta.url), 'utf8');
const REPO_MAN = readFileSync(new URL('../appsscript.json', import.meta.url), 'utf8');
const INDEX_SRC = '<!DOCTYPE html><html>舊的 Index，不能被動到</html>';
function selfUpdateRig(o) {
  const g = loadGas({ props: Object.assign({ TOKEN: 't' }, o.props || {}) });
  const f = fakeGoogle({
    github: Object.assign({ 'Code_單一檔案版.gs': o.github, 'appsscript.json': o.manifest || REPO_MAN }, o.githubExtra || {}),
    githubStatus: o.githubStatus, apiEnabled: o.apiEnabled, deployments: o.deployments, apiRateLimited: o.apiRateLimited, userSettingOff: o.userSettingOff,
    files: [{ name: 'appsscript', type: 'JSON', source: o.headManifest || REPO_MAN }, { name: '程式碼', type: 'SERVER_JS', source: o.head }, { name: 'Index', type: 'HTML', source: INDEX_SRC }]
  });
  if (o.depDesc !== undefined) f.deployed().deploymentConfig.description = o.depDesc;
  g.ctx.UrlFetchApp = f.UrlFetchApp; g.ctx.ScriptApp = f.ScriptApp;
  return { g, f };
}
const fileOf = (f, n) => f.state.files.find(x => x.name === n);

test('自我更新：GitHub 較新時寫入程式與設定檔、建立新版本並更新原部署；Index 原樣保留', () => {
  const { g, f } = selfUpdateRig({ head: withVer(REPO_CODE, '2026.11.20-1200'), github: withVer(REPO_CODE, '2026.12.01-0900') });
  const r = g.call('selfUpdate_', {});
  assert.equal(r.updated, true);
  assert.equal(fileOf(f, '程式碼').source, withVer(REPO_CODE, '2026.12.01-0900'));
  assert.equal(fileOf(f, 'appsscript').source, REPO_MAN);
  assert.equal(fileOf(f, 'Index').source, INDEX_SRC);
  assert.equal(f.state.files.length, 3);
  assert.equal(f.deployed().deploymentConfig.versionNumber, 4);
  assert.equal(f.deployed().deploymentConfig.description, 'GitHub 2026.12.01-0900');
  assert.equal(f.deployed('HEAD-ID').deploymentConfig.versionNumber, undefined, '不能動到 HEAD 測試部署');
});

test('自我更新：任意版本組合都遵守「不降版、同版不同內容不更新、已是最新不動」', () => {
  const vs = ['2026.11.20-1000', '2026.11.20-1200', '2026.11.21-0800', '2026.12.01-0900', '2027.01.02-0000'];
  const stats = {};
  for (let i = 0; i < RUNS; i++) {
    const R = rng(5600 + i), vh = R.pick(vs), vg = R.pick(vs), vd = R.pick([null, 'manual', R.pick(vs)]);
    const body = R.pick(['same', 'ws', 'diff']);
    let gh = withVer(REPO_CODE, vg);
    let head = withVer(REPO_CODE, vh);
    if (vg === vh) head = body === 'same' ? gh : body === 'ws' ? gh.replace(/\n$/, '') + '\r\n\n' : gh.replace('function api(', '// 別的內容\nfunction api(');
    const { g, f } = selfUpdateRig({ head, github: gh, depDesc: vd === null ? '' : vd === 'manual' ? '手動部署' : 'GitHub ' + vd });
    const projState = () => JSON.stringify({ files: f.state.files, versions: f.state.versions, deployments: f.state.deployments });   // 只比 Apps Script 專案（GitHub 讀取紀錄不算）
    const before = projState();
    let res, err;
    try { res = g.call('selfUpdate_', {}); } catch (e) { err = e; }
    const sameCode = vg === vh && body !== 'diff';
    if (vg < vh) { assert.ok(err && /不會降版/.test(err.message), '降版要被擋'); assert.equal(f.writes.length, 0); stats.down = (stats.down || 0) + 1; continue; }
    if (vg === vh && body === 'diff') { assert.ok(err && /版本號一樣/.test(err.message)); assert.equal(f.writes.length, 0); stats.samever = (stats.samever || 0) + 1; continue; }
    assert.ok(!err, err && err.message);
    const depV = (vd && vd !== 'manual') ? vd : null;
    if (sameCode && depV && depV >= vg) { assert.equal(res.updated, false); assert.equal(f.writes.length, 0); assert.equal(projState(), before); stats.latest = (stats.latest || 0) + 1; continue; }
    assert.equal(res.updated, true);
    assert.equal(f.writes.filter(w => w.path === '/content').length, sameCode ? 0 : 1, '內容沒變就不重寫');
    assert.equal(f.deployed().deploymentConfig.versionNumber, 4);
    assert.equal(f.deployed().deploymentConfig.description, 'GitHub ' + vg);
    assert.equal(fileOf(f, 'Index').source, INDEX_SRC);
    if (!sameCode) assert.equal(fileOf(f, '程式碼').source, gh);
    stats.deploy = (stats.deploy || 0) + 1;
  }
  for (const k of ['down', 'samever', 'latest', 'deploy']) assert.ok(stats[k] >= 20, '情況「' + k + '」測到太少：' + JSON.stringify(stats));
});

test('自我更新：首次設定（手動貼上後，程式與 GitHub 相同、部署是手動的）會直接部署', () => {
  const v = g0 => withVer(REPO_CODE, '2026.11.20-1200');
  const { g, f } = selfUpdateRig({ head: v().replace(/\n$/, ''), github: v(), depDesc: '' });
  const r = g.call('selfUpdate_', {});
  assert.equal(r.updated, true);
  assert.equal(f.writes.filter(w => w.path === '/content').length, 0);
  assert.equal(f.deployed().deploymentConfig.description, 'GitHub 2026.11.20-1200');
  g.nextRequest();
  assert.equal(g.call('selfUpdate_', {}).updated, false, '第二次執行應該是「已經是最新版」');
});

test('自我更新：抓到壞掉或不完整的檔案時完全不寫入', () => {
  const head = withVer(REPO_CODE, '2026.11.20-1200'), gh = withVer(REPO_CODE, '2026.12.01-0900');
  const man = JSON.parse(REPO_MAN);
  const cases = [
    ['GitHub 404', { github: gh, githubStatus: { 'Code_單一檔案版.gs': 404 } }, /讀不到 GitHub/],
    ['抓到 HTML 錯誤頁', { github: '<html>rate limited</html>' }, /找不到 BACKEND_VERSION/],
    ['程式被截斷', { github: gh.slice(0, 5000) }, /缺少/],
    ['設定檔不是 JSON', { github: gh, manifest: '{ oops' }, /不是正確的 JSON/],
    ['設定檔少了部署權限', { github: gh, manifest: JSON.stringify(Object.assign({}, man, { oauthScopes: man.oauthScopes.filter(x => !/deployments/.test(x)) })) }, /缺少授權範圍/],
    ['設定檔少了 webapp', { github: gh, manifest: JSON.stringify(Object.assign({}, man, { webapp: undefined })) }, /webapp/],
    ['Cloud 專案沒啟用 API（要看到 Google 原文與專案號碼）', { github: gh, apiEnabled: false }, /標準 Cloud 專案[\s\S]*has not been used in project 123/],
    ['使用者開關沒開', { github: gh, userSettingOff: true }, /usersettings[\s\S]*User has not enabled/]
  ];
  for (const [name, o, re] of cases) {
    const { g, f } = selfUpdateRig(Object.assign({ head }, o));
    assert.throws(() => g.call('selfUpdate_', {}), re, name);
    assert.equal(f.writes.length, 0, name + '：不應寫入');
    assert.equal(fileOf(f, '程式碼').source, head, name);
  }
});

test('自我更新：GitHub API 次數被擋（403）時改讀 raw 網址，照樣完成更新', () => {
  const { g, f } = selfUpdateRig({ head: withVer(REPO_CODE, '2026.11.20-1200'), github: withVer(REPO_CODE, '2026.12.01-0900'), apiRateLimited: true });
  assert.equal(g.call('selfUpdate_', {}).updated, true);
  assert.ok(f.state.githubCalls.some(x => x.indexOf('raw:') === 0), '應該有改讀 raw');
  assert.equal(f.deployed().deploymentConfig.description, 'GitHub 2026.12.01-0900');
});

test('自我更新：有多個網頁部署時不猜，要用 DEPLOY_ID 指定', () => {
  const deps = () => [
    { deploymentId: 'HEAD-ID', deploymentConfig: { scriptId: 'SID' }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
    { deploymentId: 'D1', deploymentConfig: { scriptId: 'SID', versionNumber: 3, description: '' }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
    { deploymentId: 'D2', deploymentConfig: { scriptId: 'SID', versionNumber: 2, description: '' }, entryPoints: [{ entryPointType: 'WEB_APP' }] }
  ];
  const base = { head: withVer(REPO_CODE, '2026.11.20-1200'), github: withVer(REPO_CODE, '2026.12.01-0900') };
  const a = selfUpdateRig(Object.assign({ deployments: deps() }, base));
  assert.throws(() => a.g.call('selfUpdate_', {}), /DEPLOY_ID/);
  assert.equal(a.f.writes.length, 0);
  const b = selfUpdateRig(Object.assign({ deployments: deps(), props: { DEPLOY_ID: 'D2' } }, base));
  b.g.call('selfUpdate_', {});
  assert.equal(b.f.deployed('D2').deploymentConfig.versionNumber, 4);
  assert.equal(b.f.deployed('D1').deploymentConfig.versionNumber, 3, '沒指定的部署不能動');
});

test('退回上一版：部署指回前一個版本，專案程式不變；最早版本時會擋下', () => {
  const { g, f } = selfUpdateRig({ head: withVer(REPO_CODE, '2026.11.20-1200'), github: withVer(REPO_CODE, '2026.12.01-0900') });
  g.call('selfUpdate_', {});
  const code = fileOf(f, '程式碼').source;
  assert.equal(g.call('rollbackDeploy_').version, 3);
  assert.equal(f.deployed().deploymentConfig.versionNumber, 3);
  assert.equal(fileOf(f, '程式碼').source, code);
  g.call('rollbackDeploy_'); g.call('rollbackDeploy_');
  assert.equal(f.deployed().deploymentConfig.versionNumber, 1);
  assert.throws(() => g.call('rollbackDeploy_'), /最早/);
  assert.equal(JSON.parse(g.props.get('SELF_UPDATE_LOG')).length, 4);
});

test('自我更新：App 的 selfUpdate 需要正確密碼', () => {
  const { g, f } = selfUpdateRig({ head: withVer(REPO_CODE, '2026.11.20-1200'), github: withVer(REPO_CODE, '2026.12.01-0900') });
  assert.throws(() => g.call('api', 'wrong', 'selfUpdate', {}), /密碼錯誤/);
  assert.equal(f.writes.length, 0);
  assert.equal(g.call('api', 't', 'selfUpdate', {}).updated, true);
});

// ---------------------------------------------------------------- 固定訂閱（卡費表）
const cardSnap = g => JSON.stringify([2026, 2027].map(y => [...g.book(y).getSheetByName('卡費').cells].sort()));
const subOf = (g, y, name) => g.call('readSubs_', y).find(r => r.name === name);

test('固定訂閱：讀出卡費表的訂閱區，名稱去掉樹狀符號，每月合計正確', () => {
  const { g } = fresh(20);
  for (const [y, list] of [[2026, SUBS_2026], [2027, SUBS_2027]]) {
    const d = g.call('getSubs_', y, 12);
    assert.deepEqual(d.rows.map(r => r.name), list.map(x => x[0]));
    for (let k = 0; k < 12; k++) assert.equal(d.totals[k], list.reduce((t, x) => t + x[1][k], 0));
    assert.equal(d.rows.find(r => /分期/.test(r.name)) ? d.rows.find(r => /分期/.test(r.name)).installment : true, true);
  }
  assert.equal(g.call('getSubs_', 2026, 12).minFrom, 12, '11/18：11 月帳單已扣款，只能從 12 月改');
  assert.equal(g.call('getSubs_', 2027, 1).minFrom, 1);
});

test('固定訂閱：任意新增／修改／停用（可含明年），只動到該列的指定月份以後；全部復原後兩份卡費表回到原狀', () => {
  for (let i = 0; i < RUNS; i++) {
    const R = rng(7100 + i), { g } = fresh(7100 + i), orig = cardSnap(g);
    const names = ['影音B', '雲端C', 'AI F', '停用D', '新訂閱X', '新訂閱Y'];
    let ops = 0;
    for (let k = 0, n = R.int(1, 5); k < n; k++) {
      const y = R.pick([2026, 2027]), minF = g.call('minFrom_', y), from = R.int(minF, 12);
      const name = R.pick(names), exists = !!subOf(g, y, name), action = exists ? R.pick(['set', 'stop']) : 'add';
      const amount = R.pick([1, 99, 690, R.int(1, 5000)]), alsoNext = y === 2026 && R.bool();
      const before = { [2026]: g.call('readSubs_', 2026), [2027]: g.call('readSubs_', 2027) };
      g.nextRequest();
      g.call('saveSub_', { y, action, name, amount, from, alsoNext });
      g.nextRequest(); ops++;
      const after = g.call('readSubs_', y), row = after.find(r => r.name === name);
      assert.ok(row, '改完要找得到「' + name + '」');
      for (let mo = 1; mo <= 12; mo++) {
        const want = mo < from ? (exists ? before[y].find(r => r.name === name).values[mo - 1] : 0) : (action === 'stop' ? 0 : amount);
        assert.equal(row.values[mo - 1], want, y + ' 年 ' + name + ' ' + mo + ' 月（' + action + ' 從 ' + from + ' 月）');
      }
      before[y].filter(r => r.name !== name).forEach(r => assert.deepEqual(after.find(x => x.name === r.name).values, r.values, '其他訂閱不能被動到：' + r.name));
      // 新增的列一定在訂閱區裡面（最後一列之前），真的試算表才會把它算進小計 SUM
      if (action === 'add') { const blk = g.call('subBlock_', y); assert.ok(row.row >= blk.first && row.row < blk.last, '新增列的位置 ' + row.row + ' 不在 ' + blk.first + '～' + (blk.last - 1)); }
      if (y === 2027) assert.match(g.book(2027).getSheetByName('卡費').val(row.row, 1), /^   [├└]─ /, '2027 要保留樹狀符號');
      if (alsoNext && action !== 'stop') assert.deepEqual(Array.from(subOf(g, 2027, name).values), Array(12).fill(amount), '明年整年要套用');   // vm 裡的陣列原型不同，先轉成外面的陣列
    }
    // 2027 的帳單總額列被往下推了，仍要讀得到
    assert.equal(g.call('rowValue_', 2027, g.get('PROFILE')[2027].cardDue, 3), 10003);
    for (let k = 0; k < ops; k++) { g.nextRequest(); g.call('undoSub_', {}); }
    g.nextRequest();
    assert.equal(cardSnap(g), orig, '全部復原後要回到原狀');
    assert.equal(g.call('readLog_', 2026).filter(r => r.type === '訂閱').length + g.call('readLog_', 2027).filter(r => r.type === '訂閱').length, 0);
    assert.throws(() => g.call('undoSub_', {}), /沒有可以復原/);
  }
});

test('固定訂閱：已扣款的帳單月份（歷史紀錄）不能改；名稱重複、金額 0 也會擋下', () => {
  const { g } = fresh(21), orig = cardSnap(g);
  for (const a of [{ y: 2026, action: 'set', name: '影音B', amount: 700, from: 11 }, { y: 2026, action: 'set', name: '影音B', amount: 700, from: 1 },
                   { y: 2027, action: 'add', name: '影音B', amount: 100, from: 3 }, { y: 2027, action: 'set', name: '影音B', amount: 0, from: 3 },
                   { y: 2027, action: 'set', name: '不存在', amount: 10, from: 3 }, { y: 2027, action: 'add', name: '', amount: 10, from: 3 }])
    assert.throws(() => g.call('saveSub_', a), undefined, JSON.stringify(a));
  assert.equal(cardSnap(g), orig);
});

test('固定訂閱：只能復原最近一次；同一個請求送兩次只算一次', () => {
  const { g } = fresh(22);
  g.call('api', 't', 'saveSub', { y: 2027, action: 'set', name: '影音B', amount: 700, from: 5, rid: 's1' }); g.nextRequest();
  g.call('api', 't', 'saveSub', { y: 2027, action: 'set', name: '影音B', amount: 700, from: 5, rid: 's1' }); g.nextRequest();
  g.call('api', 't', 'saveSub', { y: 2027, action: 'add', name: '新X', amount: 99, from: 2, rid: 's2' }); g.nextRequest();
  assert.equal(g.call('readLog_', 2027).filter(r => r.type === '訂閱').length, 2, '重送不能多記一筆');
  const first = g.call('readLog_', 2027).find(r => r.type === '訂閱' && r.name === '影音B');
  assert.throws(() => g.call('undoSub_', { y: 2027, row: first.row }), /最近一次/);
  g.call('api', 't', 'undoSub', { rid: 'u1' }); g.nextRequest();
  g.call('api', 't', 'undoSub', { rid: 'u1' }); g.nextRequest();
  assert.ok(!subOf(g, 2027, '新X'), '新X 要被復原');
  assert.equal(subOf(g, 2027, '影音B').values[4], 700, '重送的復原不能多復原一次');
});

test('固定訂閱：帳單對帳附上本期訂閱明細；今日提醒列出本期新增與漲價', () => {
  const { g } = fresh(23);
  for (let m = 1; m <= 12; m++) {
    const subs = g.call('getBill_', 2027, m).subs;
    assert.equal(subs.reduce((t, x) => t + x.amount, 0), SUBS_2027.reduce((t, x) => t + x[1][m - 1], 0), m + ' 月');
  }
  g.call('saveSub_', { y: 2027, action: 'add', name: 'Claude', amount: 690, from: 3 });
  g.call('saveSub_', { y: 2027, action: 'set', name: '影音B', amount: 680, from: 3 });
  g.nextRequest();
  const txt = g.call('subChanges_', 2027, 3).map(c => c.text);
  assert.ok(txt.includes('Claude 新增 $690') && txt.includes('影音B $630→$680'), JSON.stringify(txt));
  assert.deepEqual(Array.from(g.call('subChanges_', 2027, 5).map(c => c.text)), [], '週期性費用（電視G 4、10 月）結束當期不能誤報停止');
  const apr = Array.from(g.call('subChanges_', 2027, 4).map(c => c.text));
  assert.ok(apr.includes('電視G $850（本期才有）'), JSON.stringify(apr));
  assert.ok(apr.includes('購物 分期（3期） 停止'), '分期付完要提醒：' + JSON.stringify(apr));
  assert.ok(!apr.some(x => /Claude|影音B/.test(x)), '4 月 Claude、影音B 沒有變動：' + JSON.stringify(apr));
});

// ---------------------------------------------------------------- 安全
test('密碼錯誤時，任何功能都不會執行', () => {
  const { g, wb } = fresh(9), before = snap(wb.month(11));
  for (const k of [undefined, '', 'T', 'tt']) assert.throws(() => g.call('api', k, 'add', { date: '2026-11-18', cat: '食物', item: 'x', amount: 1, pay: '現金' }), /密碼錯誤/);
  assert.equal(snap(wb.month(11)), before);
});
