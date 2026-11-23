// 生活備用信封（2027）：建立／還原、支付／刪除的屬性測試。全程只用假試算表。
process.env.TZ = 'Asia/Taipei';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas, rng, RUNS } from './helpers/gas.mjs';
import { buildWorkbook2026, buildWorkbook2027, CATS } from './fixtures/workbook.mjs';

const N = Math.max(50, Math.floor(RUNS / 5));   // 每組要布置整本 2027 試算表，次數比一般屬性少
function fresh(seed) {
  const g = loadGas({ props: { TOKEN: 't' }, now: '2027-03-10T10:00:00+08:00' });
  buildWorkbook2026(g, { seed });
  const wb = buildWorkbook2027(g, rng(seed));
  return { g, wb };
}
const bookSnap = book => JSON.stringify([...book.sheets].filter(([n]) => n !== 'App紀錄').map(([n, sh]) => [n, [...sh.cells].sort()]));
const lifeItem = g => g.call('getEnvelopes_', 2027, 3).accounts.flatMap(a => a.items).find(x => x.life);
const row67 = wb => Array.from({ length: 12 }, (_, i) => Number(wb.yf.val(67, 2 + i)) || 0);

test('生活備用：建立前不會多出空白信封；建立後出現、每月預存等於設定金額', () => {
  for (let i = 0; i < N; i++) {
    const R = rng(9100 + i), { g } = fresh(9100 + i), amt = R.pick([4000, 1, R.int(1, 200) * 100]);
    const n0 = g.call('getEnvelopes_', 2027, 3).accounts.flatMap(a => a.items).length;
    assert.equal(lifeItem(g), undefined);
    g.call('setupLife_', 2027, amt); g.nextRequest();
    const items = g.call('getEnvelopes_', 2027, 3).accounts.flatMap(a => a.items);
    assert.equal(items.length, n0 + 1);
    const it = items.find(x => x.life);
    assert.equal(it.name, '生活備用');
    assert.equal(it.allocYear, amt * 12); assert.equal(it.allocYTD, amt * 3); assert.equal(it.balance, amt * 3); assert.equal(it.paidYTD, 0);
  }
});

test('生活備用：建立後再還原，整本試算表一格不差；重複建立不會再改任何格子', () => {
  for (let i = 0; i < N; i++) {
    const R = rng(9200 + i), { g, wb } = fresh(9200 + i), s0 = bookSnap(wb.book);
    g.call('setupLife_', 2027, R.int(1, 100) * 100); g.nextRequest();
    const s1 = bookSnap(wb.book);
    assert.notEqual(s1, s0);
    assert.equal(g.call('setupLife_', 2027, 999).already, true);
    assert.equal(bookSnap(wb.book), s1, '第二次建立不能改東西');
    g.call('undoLife_', 2027); g.nextRequest();
    assert.equal(bookSnap(wb.book), s0, '還原後要和建立前完全相同');
    assert.equal(g.props.get('LIFE_BAK_2027'), undefined);
    assert.throws(() => g.call('undoLife_', 2027), /備份/);
  }
});

test('生活備用：建立後的公式——永豐多存、其他少同額，支出與回補都算到第 67 列', () => {
  const { g, wb } = fresh(9300), COLS = 'BCDEFGHIJKLM', TOPC = 'CDEFGHIJKLMN', Q = "'永豐銀行準備金定期定額'!";
  const before = Array.from({ length: 12 }, (_, i) => ({ top: wb.top.getRange(TOPC[i] + '7').getFormula() || String(wb.top.val(7, 3 + i)),
                                                         g7: wb.month(i + 1).getRange('G7').getFormula() || String(wb.month(i + 1).val(7, 7)) }));
  g.call('setupLife_', 2027, 4000);
  for (let i = 0; i < 12; i++) {
    const c = COLS[i];
    assert.ok(wb.top.getRange(TOPC[i] + '7').getFormula().endsWith('+' + Q + c + '68'), '總表 ' + (i + 1) + ' 月');
    assert.ok(wb.top.getRange(TOPC[i] + '7').getFormula().includes(before[i].top.replace(/^=/, '')));
    assert.ok(wb.month(i + 1).getRange('G7').getFormula().endsWith('-' + Q + c + '68'), (i + 1) + ' 月其他預算');
    assert.ok(wb.month(i + 1).getRange('G7').getFormula().includes(before[i].g7.replace(/^=/, '')));
    assert.ok(wb.yf.getRange(c + '5').getFormula().endsWith('+' + c + '67'));
    assert.ok(wb.inc.getRange(c + '8').getFormula().includes(Q + c + '67'));
  }
});

test('生活備用：第 67、68 列已有資料時拒絕建立，且不改任何格子', () => {
  for (const [r, c] of [[67, 1], [68, 5], [67, 14]]) {
    const { g, wb } = fresh(9400 + r + c);
    wb.yf.set(r, c, '別人的資料');
    const s0 = bookSnap(wb.book);
    assert.throws(() => g.call('setupLife_', 2027, 4000), /不是空白/);
    assert.equal(bookSnap(wb.book), s0);
    assert.equal(g.props.get('LIFE_BAK_2027'), undefined);
  }
});

test('生活備用：支付後信封減少、選的科目預算剛好多出支付額、沒有歸還提醒；刪除紀錄後全部回到原值', () => {
  for (let i = 0; i < N; i++) {
    const R = rng(9500 + i), { g, wb } = fresh(9500 + i);
    g.call('setupLife_', 2027, R.int(10, 80) * 100); g.nextRequest();
    const t0 = g.call('readTopRaw_', 2027, 3), e0 = lifeItem(g), r0 = row67(wb);
    const pays = [];
    for (let k = 0, n = R.int(1, 4); k < n; k++) {
      const amt = R.int(1, Math.max(1, Math.floor(e0.balance / 4))), cat = R.pick(CATS);
      g.call('lifePay_', { amount: amt, cat, note: '' }); g.nextRequest();
      pays.push({ amt, cat });
    }
    const t1 = g.call('readTopRaw_', 2027, 3), total = pays.reduce((s, p) => s + p.amt, 0);
    CATS.forEach((c, j) => assert.equal(t1.cats[j].budget - t0.cats[j].budget, pays.filter(p => p.cat === c).reduce((s, p) => s + p.amt, 0), c));
    assert.equal(lifeItem(g).balance, e0.balance - total);
    assert.equal(row67(wb)[2], r0[2] + total, '永豐第 67 列 3 月');
    assert.equal(g.call('borrowsOpen_', 2027).length, 0, '生活備用不用歸還');
    assert.equal(g.call('getEnvelopes_', 2027, 3).life.pays.length, pays.length);
    // 依隨機順序刪掉一部分：剩下的紀錄總額要等於第 67 列
    const logs = g.call('readLog_', 2027).filter(l => l.type === '生活備用').map(l => l.row).sort((a, b) => b - a);
    const del = logs.filter(() => R.bool());
    del.forEach(row => { g.call('deleteLog_', 2027, row); g.nextRequest(); });
    const left = g.call('readLog_', 2027).filter(l => l.type === '生活備用').reduce((s, l) => s + l.amount, 0);
    assert.equal(row67(wb)[2], r0[2] + left);
    assert.equal(lifeItem(g).balance, e0.balance - left);
    g.call('readLog_', 2027).filter(l => l.type === '生活備用').map(l => l.row).sort((a, b) => b - a).forEach(row => { g.call('deleteLog_', 2027, row); g.nextRequest(); });
    const t2 = g.call('readTopRaw_', 2027, 3);
    CATS.forEach((c, j) => assert.equal(t2.cats[j].budget, t0.cats[j].budget, c + ' 全部刪除後回到原值'));
    assert.deepEqual(row67(wb), r0);
  }
});

test('生活備用：未建立時不能支付；超過餘額、0 元會被擋下；有支付紀錄時不能取消', () => {
  const { g, wb } = fresh(9600);
  assert.throws(() => g.call('lifePay_', { amount: 100, cat: '其他' }), /還沒有建立/);
  g.call('setupLife_', 2027, 1000); g.nextRequest();
  const bal = lifeItem(g).balance;
  assert.throws(() => g.call('lifePay_', { amount: bal + 1, cat: '其他' }), /只有/);
  assert.throws(() => g.call('lifePay_', { amount: 0, cat: '其他' }), /金額/);
  assert.deepEqual(row67(wb), Array(12).fill(0));
  g.call('lifePay_', { amount: bal + 1, cat: '其他', force: true }); g.nextRequest();
  assert.throws(() => g.call('undoLife_', 2027), /先在信封頁刪除/);
});

test('生活備用：同一筆支付送兩次（逾時重送）只記一筆；不同編號照常記兩筆', () => {
  for (let i = 0; i < N; i++) {
    const R = rng(9700 + i), { g, wb } = fresh(9700 + i);
    g.call('setupLife_', 2027, 4000); g.nextRequest();
    const amt = R.int(1, 3000), rids = Array.from({ length: R.int(1, 3) }, (_, k) => 'lp' + i + '-' + k);
    let sends = 0;
    rids.forEach(rid => { for (let t = 0, n = R.int(1, 3); t < n; t++) { g.nextRequest(); g.call('api', 't', 'lifePay', { amount: amt, cat: '其他', rid }); sends++; } });
    assert.equal(g.call('readLog_', 2027).filter(l => l.type === '生活備用').length, rids.length, '送了 ' + sends + ' 次');
    assert.equal(row67(wb)[2], amt * rids.length);
  }
});
