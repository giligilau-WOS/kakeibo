// 緊急備用金動用（2027）：啟用／取消、動用／補回／刪除的屬性測試。全程只用假試算表。
process.env.TZ = 'Asia/Taipei';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas, rng, RUNS } from './helpers/gas.mjs';
import { buildWorkbook2026, buildWorkbook2027, CATS } from './fixtures/workbook.mjs';

const N = Math.max(50, Math.floor(RUNS / 5));
function fresh(seed, month = 3) {
  const g = loadGas({ props: { TOKEN: 't' }, now: '2027-' + String(month).padStart(2, '0') + '-10T10:00:00+08:00' });
  buildWorkbook2026(g, { seed });
  const wb = buildWorkbook2027(g, rng(seed));
  return { g, wb };
}
const bookSnap = book => JSON.stringify([...book.sheets].filter(([n]) => n !== 'App紀錄').map(([n, sh]) => [n, [...sh.cells].sort()]));
const row69 = wb => Array.from({ length: 12 }, (_, i) => Number(wb.yf.val(69, 2 + i)) || 0);
const efNow = (g, m) => g.call('getEnvelopes_', 2027, m).ef;
const efLogs = g => g.call('readLog_', 2027).filter(l => l.type === '備用金動用' || l.type === '備用金補回');

test('備用金動用：啟用後再取消，整本試算表一格不差；重複啟用不改格子；第 69 列有資料就拒絕', () => {
  for (let i = 0; i < N; i++) {
    const { g, wb } = fresh(9900 + i);
    wb.book.getSheetByName('總表').getRange(1, 1, 20, 14).getValues();   // 先讓 hook 算一次，快照才穩定
    const s0 = bookSnap(wb.book);
    assert.equal(efNow(g, 3).ready, false);
    g.call('setupEf_', 2027); g.nextRequest();
    assert.equal(efNow(g, 3).ready, true);
    const s1 = bookSnap(wb.book);
    assert.notEqual(s1, s0);
    assert.equal(g.call('setupEf_', 2027).already, true);
    assert.equal(bookSnap(wb.book), s1);
    g.call('undoEf_', 2027); g.nextRequest();
    wb.book.getSheetByName('總表').getRange(1, 1, 20, 14).getValues();
    assert.equal(bookSnap(wb.book), s0, '取消後要和啟用前完全相同');
  }
  const { g, wb } = fresh(9950);
  wb.yf.set(69, 7, '別人的資料');
  const s0 = bookSnap(wb.book);
  assert.throws(() => g.call('setupEf_', 2027), /不是空白/);
  assert.equal(bookSnap(wb.book), s0);
});

test('備用金動用：公式——總表第 18 列扣第 69 列、收入第 8 列加第 69 列、永豐支出不含第 69 列', () => {
  const { g, wb } = fresh(9960), Q = "'永豐銀行準備金定期定額'!", COLS = 'BCDEFGHIJKLM', TOPC = 'CDEFGHIJKLMN';
  g.call('setupEf_', 2027);
  for (let i = 0; i < 12; i++) {
    assert.ok(wb.top.getRange(TOPC[i] + '18').getFormula().endsWith('-' + Q + COLS[i] + '69'), (i + 1) + ' 月備用金累計');
    assert.ok(wb.inc.getRange(COLS[i] + '8').getFormula().endsWith('+' + Q + COLS[i] + '69'), (i + 1) + ' 月收入');
    assert.ok(!wb.yf.getRange(COLS[i] + '5').getFormula().includes(COLS[i] + '69'), '永豐活存不受影響');
  }
});

test('備用金動用：選的科目預算剛好多出動用額、備用金減少同額、沒有歸還提醒；全部刪除後回到原值', () => {
  for (let i = 0; i < N; i++) {
    const R = rng(9970 + i), month = R.int(2, 12), { g, wb } = fresh(9970 + i, month);
    g.call('setupEf_', 2027); g.nextRequest();
    const t0 = g.call('readTopRaw_', 2027, month), e0 = efNow(g, month).current, r0 = row69(wb);
    const ops = [];
    for (let k = 0, n = R.int(1, 4); k < n; k++) {
      const cur = efNow(g, month).current;
      if (R.bool(0.7) && cur > 0) { const amt = R.int(1, Math.max(1, Math.floor(cur / 3))), cat = R.pick(CATS); g.call('efUse_', { amount: amt, cat, note: '' }); ops.push({ use: amt, cat }); }
      else { const amt = R.int(1, 5000); g.call('efRepay_', { amount: amt }); ops.push({ repay: amt }); }
      g.nextRequest();
    }
    const used = ops.reduce((t, o) => t + (o.use || 0), 0), repaid = ops.reduce((t, o) => t + (o.repay || 0), 0);
    const t1 = g.call('readTopRaw_', 2027, month);
    CATS.forEach((c, j) => assert.equal(t1.cats[j].budget - t0.cats[j].budget, ops.filter(o => o.cat === c).reduce((t, o) => t + o.use, 0), c));
    assert.equal(row69(wb)[month - 1], r0[month - 1] + used - repaid, '永豐第 69 列');
    assert.equal(efNow(g, month).current, e0 - used + repaid, '備用金餘額');
    assert.equal(g.call('borrowsOpen_', 2027).length, 0, '備用金動用不列入待歸還');
    assert.equal(efNow(g, month).uses.length, ops.length);
    const rows = efLogs(g).map(l => l.row).sort((a, b) => b - a);
    rows.filter(() => R.bool()).forEach(r => { g.call('deleteLog_', 2027, r); g.nextRequest(); });
    const left = efLogs(g).reduce((t, l) => t + (l.type === '備用金動用' ? l.amount : -l.amount), 0);
    assert.equal(row69(wb)[month - 1], r0[month - 1] + left);
    efLogs(g).map(l => l.row).sort((a, b) => b - a).forEach(r => { g.call('deleteLog_', 2027, r); g.nextRequest(); });
    const t2 = g.call('readTopRaw_', 2027, month);
    CATS.forEach((c, j) => assert.equal(t2.cats[j].budget, t0.cats[j].budget, c + ' 刪除後回到原值'));
    assert.deepEqual(row69(wb), r0);
    assert.equal(efNow(g, month).current, e0);
  }
});

test('備用金動用：未啟用、0 元、超過餘額會被擋下；有紀錄時不能取消；同一請求重送只記一筆', () => {
  const { g, wb } = fresh(9990, 3);
  assert.throws(() => g.call('efUse_', { amount: 100, cat: '其他' }), /還沒有啟用/);
  g.call('setupEf_', 2027); g.nextRequest();
  const cur = efNow(g, 3).current;
  assert.equal(cur, 46000);
  assert.throws(() => g.call('efUse_', { amount: 0, cat: '其他' }), /金額/);
  assert.throws(() => g.call('efUse_', { amount: cur + 1, cat: '其他' }), /只有/);
  assert.throws(() => g.call('efRepay_', { amount: -5 }), /金額/);
  assert.deepEqual(row69(wb), Array(12).fill(0));
  for (let k = 0; k < 3; k++) { g.nextRequest(); g.call('api', 't', 'efUse', { amount: 1200, cat: '食物', rid: 'ef-1' }); }
  g.nextRequest(); g.call('api', 't', 'efRepay', { amount: 200, rid: 'ef-2' }); g.nextRequest(); g.call('api', 't', 'efRepay', { amount: 200, rid: 'ef-2' });
  g.nextRequest();
  assert.equal(efLogs(g).length, 2, '重送不能多記');
  assert.equal(row69(wb)[2], 1000);
  assert.throws(() => g.call('undoEf_', 2027), /先刪除/);
});
