// 假的 2026 年家計簿試算表（金額全部虛構）。
// 只布置 App 會讀到的儲存格；月表上方摘要用簡化的「重算」模擬試算表公式：
//   各科目 現金＝支付方式為「現金」、刷卡＝其他（信用卡、一卡通）；
//   「一卡通儲值」不屬於任何科目，所以不進科目合計（依記帳規則：儲值只算轉帳）。
// 這是假設，不是試算表真正的公式；真實公式的行為只能請使用者在手機上確認。
import { rng } from '../helpers/gas.mjs';

export const CATS = ['奉獻', '食物', '教育', '油料', '娛樂', '其他'];
export const TRAVEL_FULL = '國旅專款(不扣日常預算)';
const FIRST = 16, LAST = 515;

// 模擬試算表的「預算≤可支配現金」自動刪減（簡化版，不是真正的公式）：
// 可支配現金＝基本額＋台銀第 37 列（信封調用）當月的值；計畫（第 7 列）超過時依序刪減：
// 教育 → 娛樂、其他刪到下限 → 食物刪到下限 → 食物、油料、娛樂、其他按比例再縮。奉獻不動。
function cutBudgets(plan, cash, floors) {
  const b = plan.slice(), total = () => b.reduce((s, x) => s + x, 0);
  let over = total() - cash;
  const take = (i, floor) => { if (over <= 0) return; const t = Math.min(over, Math.max(0, b[i] - floor)); b[i] -= t; over -= t; };
  take(2, 0); take(4, floors.娛樂); take(5, floors.其他); take(1, floors.食物);
  if (over > 0) {
    const idx = [1, 3, 4, 5], base = idx.reduce((s, i) => s + b[i], 0);
    if (base > 0) { const k = Math.min(1, over / base); idx.forEach(i => { b[i] = Math.round(b[i] * (1 - k)); }); }
  }
  return b;
}

function recalcMonth(sh) {
  const sum = (pred) => { let s = 0; for (let r = FIRST; r <= LAST; r++) { const amt = sh.val(r, 14); if (amt === '' || amt === null) continue; if (pred(sh.val(r, 12), sh.val(r, 16))) s += Number(amt) || 0; } return s; };
  let cash = 0, card = 0;
  CATS.forEach((c, i) => {
    const a = sum((cat, pay) => cat === c && pay === '現金'), b = sum((cat, pay) => cat === c && pay !== '現金');
    sh.set(9, 2 + i, a).set(10, 2 + i, b).set(11, 2 + i, a + b); cash += a; card += b;
  });
  const budget = CATS.reduce((s, c, i) => s + (Number(sh.val(8, 2 + i)) || 0), 0);
  sh.set(8, 8, budget).set(9, 8, cash).set(10, 8, card).set(11, 8, cash + card).set(12, 8, budget - cash - card);
  const tc = sum((cat, pay) => cat === TRAVEL_FULL && pay === '現金'), tk = sum((cat, pay) => cat === TRAVEL_FULL && pay !== '現金');
  sh.set(13, 14, tc).set(13, 15, tk).set(13, 13, tc + tk);
  const cardBill = sum((cat, pay) => pay !== '現金' && pay !== '一卡通');
  sh.set(2, 12, cardBill).set(3, 16, Math.max(0, cardBill - (Number(sh.val(4, 14)) || 0))).set(3, 18, 0);
}

/** 布置 2026 年假試算表。回傳方便測試用的資訊。 */
export function buildWorkbook2026(g, opt = {}) {
  const R = rng(opt.seed || 20261118);
  const book = g.book(2026);
  // 月表
  const months = opt.months || [9, 10, 11, 12];
  for (const m of months) {
    const sh = book.sheet('2026年' + m + '月');
    const budgets = opt.budgets || [3000, 12000, 2000, 3000, 2500, 3500];
    budgets.forEach((b, i) => sh.set(8, 2 + i, b));
    sh.set(4, 2, 30000).set(2, 5, 8000).set(4, 14, 0);
    if (opt.cut) {   // 開啟自動刪減模擬：第 7 列＝計畫，第 8 列由可支配現金算出
      budgets.forEach((b, i) => sh.set(7, 2 + i, b));
      sh.set(7, 8, budgets.reduce((s, x) => s + x, 0));
      book.readHooks.push((s, rg) => {
        if (s !== sh || rg.r > 14) return;
        const tw = book.getSheetByName('台銀帳戶(預扣及攤平)'), cash = opt.cut.base + (Number(tw && tw.val(37, 1 + m)) || 0);
        sh.set(4, 2, cash);
        cutBudgets(budgets, cash, opt.cut.floors || { 食物: 0, 娛樂: 0, 其他: 0 }).forEach((b, i) => sh.set(8, 2 + i, b));
      });
    }
    if (opt.ledger !== false && m <= 11) {
      const n = m === 11 ? 6 : 12, lastDay = m === 11 ? 17 : 28;
      for (let i = 0; i < n; i++) {
        const r = FIRST + i, d = R.int(1, lastDay);
        sh.set(r, 11, '2026-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'))
          .set(r, 12, R.pick(['食物', '食物', '油料', '娛樂', '其他'])).set(r, 13, R.pick(['午餐', '全聯', '加油', '早餐', '停車']))
          .set(r, 14, R.int(30, 900)).set(r, 16, R.pick(['現金', '現金', '聯邦信用卡'])).set(r, 17, '');
      }
    }
    book.readHooks.push((s, rg) => { if (s === sh && rg.r <= 14) recalcMonth(sh); });
  }
  // 選單
  const menu = book.sheet('選單');
  [['午餐', '食物'], ['全聯', '食物'], ['早餐', '食物'], ['加油', '油料'], ['電影', '娛樂'], ['停車', '其他'], ['主日奉獻', '奉獻'], ['書', '教育']]
    .forEach((x, i) => menu.set(2 + i, 1, x[0]).set(2 + i, 2, x[1]));
  ['現金', '聯邦信用卡'].forEach((p, i) => menu.set(2 + i, 3, p));
  // 台銀預扣表：計畫（付款）在 B:M，預存分配在 Q:AB（列號 −6）
  const tw = book.sheet('台銀帳戶(預扣及攤平)');
  const PREPAID = g.get('PREPAID')[2026][0];
  PREPAID.items.forEach(([row, , months, ]) => {
    const amt = R.int(5, 60) * 100;
    for (let m = 1; m <= 12; m++) {
      if (months.indexOf(m) >= 0) tw.set(row, 1 + m, amt);
      tw.set(row - 6, 16 + m, Math.ceil(amt * months.length / 12 / 100) * 100 + 200);   // 每月多存一點，信封才有可調用的餘額
    }
    tw.set(row, 1, PREPAID.items.find(x => x[0] === row)[1]);
  });
  for (let m = 1; m <= 12; m++) { tw.set(4, 16 + m, 60000); tw.set(7, 1 + m, 80000 + m * 1000); tw.set(37, 1 + m, 0); }
  buildCardSheets(g);
  // 其他會被讀到的表
  book.sheet('收入'); book.sheet('總表'); book.sheet('滿月記帳'); book.sheet('永豐銀行準備金定期定額'); book.sheet('郵局優存帳戶');
  // 一卡通、試算表升級旗標（ensureSchema2_ 只跑一次；測試裡視為已升級）
  g.props.set('SCHEMA2_2026', '2026-11-01 00:00');
  if (opt.ecard !== false) g.props.set('ECARD', JSON.stringify({ bal: 320, date: '2026-11-01', seen: [] }));
  return { book, tw, month: m => book.getSheetByName('2026年' + m + '月') };
}

// 「卡費」表：版面（標題文字、列的相對位置）照真實試算表，訂閱名稱與金額是虛構的
export const SUBS_2026 = [['影音A', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 90]], ['影音B', Array(12).fill(630)], ['雲端C', Array(12).fill(300)],
  ['停用D', Array(12).fill(0)], ['工具E', [0, 600, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], ['AI F', Array(12).fill(650)]];
export const SUBS_2027 = [['影音B', Array(12).fill(630)], ['雲端C', Array(12).fill(300)], ['AI F', Array(12).fill(650)],
  ['電視G', [0, 0, 0, 850, 0, 0, 0, 0, 0, 850, 0, 0]], ['購物 分期（3期）', [1496, 1496, 1496, 0, 0, 0, 0, 0, 0, 0, 0, 0]]];
export function buildCardSheets(g) {
  const a = g.book(2026).sheet('卡費');
  a.set(1, 1, '注意事項').set(4, 1, '前期帳單金額').set(5, 1, '聯邦預留繳款').set(6, 1, '月份');
  for (let m = 1; m <= 12; m++) { a.set(6, 1 + m, m + '月'); a.put(5, 1 + m, { v: 0, f: '=SUM(' + 'BCDEFGHIJKLM'[m - 1] + '7:' + 'BCDEFGHIJKLM'[m - 1] + String(8 + SUBS_2026.length) + ')' }); }
  SUBS_2026.forEach(([n, v], i) => { const r = 7 + i; a.set(r, 1, n); v.forEach((x, k) => { if (x) a.set(r, 2 + k, x); }); a.put(r, 14, { v: 0, f: '=SUM(B' + r + ':M' + r + ')' }); });
  const r0 = 7 + SUBS_2026.length;
  a.set(r0, 1, '非固定消費').set(r0 + 1, 1, '還款').set(r0 + 3, 1, '剩餘欠款');
  const b = g.book(2027).sheet('卡費');
  b.set(1, 1, '【聯邦信用卡帳單與各月刷卡自動連動總表】').set(3, 1, '項目 / 月份').set(4, 1, '① 聯邦固定數位訂閱小計(月初預扣)');
  SUBS_2027.forEach(([n, v], i) => { const r = 5 + i; b.set(r, 1, (i === SUBS_2027.length - 1 ? '   └─ ' : '   ├─ ') + n); v.forEach((x, k) => b.set(r, 2 + k, x)); b.put(r, 14, { v: 0, f: '=SUM(B' + r + ':M' + r + ')' }); });
  const r1 = 5 + SUBS_2027.length;
  b.set(r1, 1, '【自動連動：各月非固定刷卡與22日結帳分流】').set(r1 + 1, 1, '② 本月6日實際出帳應繳之非固定刷卡').set(r1 + 2, 1, '★ 本月6日聯邦卡應繳帳單總額 (①+②)');
  for (let m = 1; m <= 12; m++) b.set(r1 + 2, 1 + m, 10000 + m);   // 帳單總額：用來確認插入列後仍讀得到
  return { a, b };
}
