/******************************************************************
 * 家計簿 App — 單一檔案版
 * 只要這一個 .gs 檔，不需要另外建立 Index HTML 檔。
 * 資料來源：Google 雲端上的年度家計簿試算表
 * 功能：記帳、今日看板、圖表、紀錄、滿月盤點、iPhone 捷徑 API
 ******************************************************************/

// ===== 1. 設定（第一次使用請填這裡）=====
const CONFIG = {
  // 各年度試算表的 ID（網址 /d/ 和 /edit 中間那一長串）
  files: {
    2026: '1tWZZFbAPQFo4cLdhJERZOyo9YAb1WrDMTttPH3iof0Q',
    2027: '14xirGoqVaL3cJqS5XeLV4CAYODZJzoNPicZUKDdRnJE'
  },
  // （選填）舊格式的年度，只用來畫「去年同期」曲線。2025 年是每日表格式。
  oldGridFiles: {
    2025: '14Lm0d28aZ4NJL3jSswkTluh-H5n45jbCIWUGEoGhyRQ'
  },
  emergencyTarget: 150000,   // 緊急備用金目標
  flagRatio: 1.8,            // 高於同項目近 3 個月平均幾倍要標示檢討
  ledgerFirst: 16,
  ledgerLast: 515,           // 每月最多 500 筆
  cardLabel: '聯邦信用卡',   // 寫入試算表時「信用卡」使用的名稱
  // 發薪日分配的特殊調整：2026/11 的卡費有 10,000 已於 10 月由台銀直接代繳
  allocAdjust: {},
  timezone: 'Asia/Taipei'
};

// 各年度檔案的差異（儲存格位置）
const PROFILE = {
  2026: {
    emergency: null,
    pool: null,
    check: null,
    cardDue: { type: 'month', cell: 'E2' },
    monthly: {
      type: 'old', firstCol: 4, totalRow: 12, incomeRow: 19, expenseRow: 40, netRow: 60,
      accounts: [
        { key: 'post', label: '郵局日常戶', row: 4, kind: '活存' },
        { key: 'pp', label: '郵局公教優存', row: 5, kind: '定存' },
        { key: 'tw', label: '台灣銀行（B帳戶＋房貸帳戶）', row: 6, kind: '活存' },
        { key: 'sino', label: '永豐金', row: 7, kind: '活存' },
        { key: 'yuanta', label: '元大銀行交割戶', row: 8, kind: '活存' },
        { key: 'etf', label: '股票／ETF 市值', row: 9, kind: '投資' },
        { key: 'gold', label: '黃金（台灣銀行）', row: 10, kind: '投資' },
        { key: 'ins', label: '儲蓄險（解約金）', row: 11, kind: '保險' }
      ]
    }
  },
  2027: {
    emergency: { sheet: '總表', row: 18, firstCol: 3 },
    pool: { sheet: '永豐銀行準備金定期定額', row: 64, firstCol: 2 },
    check: { sheet: '總表', row: 50, firstCol: 3 },
    cardDue: { type: 'sheet', sheet: '卡費', row: 15, firstCol: 2 },
    monthly: {
      type: 'new', firstCol: 6, totalRow: 14, changeRow: 15, incomeRow: 21, expenseRow: 33, netRow: 39,
      accounts: [
        { key: 'post', label: '郵局日常戶', row: 4, inputRow: 45, kind: '活存' },
        { key: 'pp', label: '郵局公教優存', row: 5, inputRow: 46, kind: '定存' },
        { key: 'tw', label: '台銀預扣戶', row: 6, inputRow: 47, kind: '活存' },
        { key: 'sino', label: '永豐活存（稅保＋日常平衡金）', row: 7, inputRow: 48, kind: '活存' },
        { key: 'fd', label: '永豐定存（緊急備用金）', row: 8, inputRow: 49, kind: '定存' },
        { key: 'yuanta', label: '元大交割戶', row: 9, inputRow: 50, kind: '活存' },
        { key: 'etf', label: '股票／ETF 市值', row: 10, kind: '投資' },
        { key: 'ins', label: '儲蓄險（解約金）', row: 11, kind: '保險' },
        { key: 'other', label: '其他資產', row: 12, kind: '其他' },
        { key: 'home', label: '自宅（頭期款＋已還本金）', row: 13, kind: '不動產' }
      ]
    }
  }
};

const CATS = ['奉獻', '食物', '教育', '油料', '娛樂', '其他'];
const TRAVEL_FULL = '國旅專款(不扣日常預算)';

// 財務經文（和合本）。可自行增減。
const VERSES = [
  ['你要詳細知道你羊群的景況，留心料理你的牛群。', '箴言 27:23'],
  ['智慧人家中積蓄寶物膏油；愚昧人隨得來隨吞下。', '箴言 21:20'],
  ['殷勤籌劃的，足致豐裕；行事急躁的，都必缺乏。', '箴言 21:5'],
  ['不勞而得之財必然消耗；勤勞積蓄的，必見加增。', '箴言 13:11'],
  ['富戶管轄窮人；欠債的是債主的僕人。', '箴言 22:7'],
  ['你要以財物和一切初熟的土產尊榮耶和華。', '箴言 3:9'],
  ['人在最小的事上忠心，在大事上也忠心；在最小的事上不義，在大事上也不義。', '路加福音 16:10'],
  ['你們哪一個要蓋一座樓，不先坐下算計花費，能蓋成不能呢？', '路加福音 14:28'],
  ['我並不是因缺乏說這話；我無論在甚麼景況都可以知足，這是我已經學會了。', '腓立比書 4:11'],
  ['我的神必照他榮耀的豐富，在基督耶穌裏，使你們一切所需用的都充足。', '腓立比書 4:19'],
  ['你們存心不可貪愛錢財，要以自己所有的為足；因為主曾說：我總不撇下你，也不丟棄你。', '希伯來書 13:5'],
  ['然而，敬虔加上知足的心便是大利了。', '提摩太前書 6:6'],
  ['因為你的財寶在哪裏，你的心也在那裏。', '馬太福音 6:21'],
  ['你們要先求他的國和他的義，這些東西都要加給你們了。', '馬太福音 6:33'],
  ['貪愛銀子的，不因得銀子知足；貪愛豐富的，也不因得利益知足。這也是虛空。', '傳道書 5:10'],
  ['各人要隨本心所酌定的，不要作難，不要勉強，因為捐得樂意的人是神所喜愛的。', '哥林多後書 9:7']
];
const TITHE_VERSE = ['萬軍之耶和華說：你們要將當納的十分之一全然送入倉庫，使我家有糧，以此試試我，是否為你們敞開天上的窗戶，傾福與你們，甚至無處可容。', '瑪拉基書 3:10'];

// ===== 2. 第一次設定：產生密碼 =====
function setup() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('TOKEN', token);
  }
  Logger.log('你的 App 密碼（k）是：' + token);
  Logger.log('部署後的網址請加上 ?k=' + token + ' 使用');
  return token;
}

function checkToken_(k) {
  const t = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!t || String(k || '') !== t) throw new Error('密碼錯誤或尚未執行 setup()');
}

// ===== 3. 網頁與捷徑入口 =====
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    checkToken_(p.k);
  } catch (err) {
    return ContentService.createTextOutput('未授權：網址缺少正確的 k 參數。');
  }
  if (p.action) return handleShortcut_(p);
  if (p.api) return jsonOut_(function () { return api(p.k, p.api, p.args ? JSON.parse(p.args) : {}); });
  const t = HtmlService.createTemplate(APP_HTML);
  t.token = p.k;
  return t.evaluate()
    .setTitle('家計簿')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

// 獨立網頁版（放在 GitHub Pages 等處）用的 JSON 入口
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  return jsonOut_(function () { return api(body.k, body.method, body.args || {}); });
}
function jsonOut_(fn) {
  let out;
  try { out = { ok: true, data: fn() }; } catch (err) { out = { ok: false, error: String(err && err.message ? err.message : err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handleShortcut_(p) {
  let msg;
  if (p.action === 'add') {
    const r = addEntry_({
      date: p.date || todayStr_(), cat: p.cat, item: p.item,
      amount: p.amt, pay: p.pay || '現金', note: p.note || ''
    });
    msg = r.message;
  } else if (p.action === 'summary') {
    const d = getDashboard_(todayStr_());
    msg = '本月還能花 $' + fmt_(d.left) + '｜今天可用 $' + fmt_(d.perDay);
    if (d.tips.length) msg += '\n' + d.tips[0].text;
  } else if (p.action === 'check') {
    msg = dailyCheck_();
  } else {
    msg = '未知的動作';
  }
  return ContentService.createTextOutput(msg);
}

// 網頁呼叫的統一入口
function api(k, method, args) {
  checkToken_(k);
  args = args || {};
  switch (method) {
    case 'form': return getFormData_();
    case 'init': return { form: getFormData_(), dashboard: getDashboard_(todayStr_()) };
    case 'refresh': bumpVer_(); return { form: getFormData_(), dashboard: getDashboard_(todayStr_()) };
    case 'add': return addEntry_(args);
    case 'update': return updateEntry_(args);
    case 'delete': return deleteEntry_(args);
    case 'dashboard': return getDashboard_(args.date || todayStr_());
    case 'month': return getMonth_(args.y, args.m);
    case 'category': return getCategory_(args.y, args.m, args.cat);
    case 'records': return getRecords_(args.y, args.m);
    case 'monthly': return getMonthly_(args.y, args.m);
    case 'saveMonthly': return saveMonthly_(args);
    case 'circle': return setCircled_(args.y, args.m);
    case 'trend': return getTrend_(args.y, args.m);
    case 'catMore': return getCategoryMore_(args.y, args.m, args.cat);
    case 'allocDone': return setAllocDone_(args.y, args.m, args.done !== false);
    case 'debtDone': return setDebtDone_(args.y, args.row);
    case 'prepaid': return getPrepaid_(args.y, args.m);
    case 'payPrepaid': return recordPrepaid_(args);
    case 'deleteLog': return deleteLog_(args.y, args.row);
    case 'transfer': return transferBudget_(args);
    case 'transfers': return transfersFor_(+args.y, +args.m);
    case 'bill': return getBill_(args.y, args.m);
    case 'setBill': return setBill_(args);
    case 'tax': return getTax_(args.y);
    case 'goals': return getGoals_(args.y, args.m);
    default: throw new Error('未知的功能：' + method);
  }
}

// ===== 4. 共用工具 =====
const _ssCache = {};
function ss_(y) {
  const id = CONFIG.files[y];
  if (!id || id.indexOf('請貼上') === 0) return null;
  if (!_ssCache[y]) _ssCache[y] = SpreadsheetApp.openById(id);
  return _ssCache[y];
}
function monthSheet_(y, m) {
  const s = ss_(y);
  if (!s) throw new Error(y + ' 年的試算表尚未設定');
  const sh = s.getSheetByName(y + '年' + m + '月');
  if (!sh) throw new Error('找不到工作表：' + y + '年' + m + '月');
  return sh;
}
function addDaysStr_(s, k) { const p = parseDate_(s), d = new Date(p.y, p.m - 1, p.d + k); return Utilities.formatDate(d, CONFIG.timezone, 'yyyy-MM-dd'); }
function todayStr_() { return Utilities.formatDate(new Date(), CONFIG.timezone, 'yyyy-MM-dd'); }
function parseDate_(s) { const a = String(s).split('-'); return { y: +a[0], m: +a[1], d: +a[2] }; }
function daysIn_(y, m) { return new Date(y, m, 0).getDate(); }
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function fmt_(n) { return Math.round(num_(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function catFull_(c) { return c === '國旅' ? TRAVEL_FULL : c; }
function catShort_(c) { return c === TRAVEL_FULL ? '國旅' : c; }
function payShort_(p) { return p === '現金' ? '現金' : '信用卡'; }
function prevMonth_(y, m) { return m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 }; }
function nextMonth_(y, m) { return m === 12 ? { y: y + 1, m: 1 } : { y: y, m: m + 1 }; }
function dateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.timezone, 'yyyy-MM-dd');
  return String(v || '').trim();
}

// ===== 4-1. 加速：同一次請求內記憶 + 跨請求暫存（CacheService）=====
const _memo = {};
let _ver = null;
function dataVer_() {
  if (_ver === null) _ver = PropertiesService.getScriptProperties().getProperty('DATA_VER') || '1';
  return _ver;
}
function bumpVer_() {
  _ver = String(Date.now());
  PropertiesService.getScriptProperties().setProperty('DATA_VER', _ver);
  Object.keys(_memo).forEach(function (k) { delete _memo[k]; });
}
// ttl 秒；本月與未來月份短一點，過去月份長一點
function ttlFor_(y, m) {
  const t = parseDate_(todayStr_());
  return (y > t.y || (y === t.y && m >= t.m)) ? 120 : 1800;
}
function cached_(key, ttl, fn) {
  if (key in _memo) return _memo[key];
  const ck = 'v' + dataVer_() + ':' + key;
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache) {
    const hit = cache.get(ck);
    if (hit) { try { _memo[key] = JSON.parse(hit); return _memo[key]; } catch (e) {} }
  }
  const val = fn();
  _memo[key] = val;
  if (cache && val !== undefined) {
    try { const s = JSON.stringify(val); if (s.length < 95000) cache.put(ck, s, ttl); } catch (e) {}
  }
  return val;
}

// 讀取一個月的流水帳
function readLedger_(y, m) {
  if (!ss_(y)) return [];
  return cached_('L' + y + '-' + m, ttlFor_(y, m), function () { return readLedgerRaw_(y, m); });
}
function readLedgerRaw_(y, m) {
  const sh = monthSheet_(y, m);
  const n = CONFIG.ledgerLast - CONFIG.ledgerFirst + 1;
  const vals = sh.getRange(CONFIG.ledgerFirst, 11, n, 7).getValues(); // K:Q
  const out = [];
  vals.forEach(function (r, i) {
    if (r[3] === '' || r[3] === null) return;
    out.push({
      row: CONFIG.ledgerFirst + i,
      date: dateText_(r[0]), cat: catShort_(String(r[1] || '')), item: String(r[2] || ''),
      amount: num_(r[3]), period: String(r[4] || ''), pay: payShort_(String(r[5] || '')),
      note: String(r[6] || '')
    });
  });
  return out;
}

// 舊格式（2025 每日表）每日各科目金額
function readOldGrid_(y, m) {
  const id = CONFIG.oldGridFiles[y];
  if (!id) return null;
  return cached_('G' + y + '-' + m, 21600, function () { return readOldGridRaw_(y, m, id); });
}
function readOldGridRaw_(y, m, id) {
  const sh = SpreadsheetApp.openById(id).getSheetByName(y + '年' + m + '月');
  if (!sh) return null;
  const vals = sh.getRange(1, 1, 60, 7).getValues();
  const out = [];
  vals.forEach(function (r) {
    if (r[0] instanceof Date && r[0].getMonth() + 1 === m) {
      CATS.forEach(function (c, j) {
        const a = num_(r[j + 1]);
        if (a) out.push({ date: Utilities.formatDate(r[0], CONFIG.timezone, 'yyyy-MM-dd'), cat: c, amount: a });
      });
    }
  });
  return out;
}

// 每日累計曲線（不含國旅）
function dailyCum_(y, m, cat) {
  let rows = ss_(y) ? readLedger_(y, m) : readOldGrid_(y, m);
  if (!rows) return null;
  const days = daysIn_(y, m), daily = new Array(days + 1).fill(0);
  rows.forEach(function (r) {
    if (r.cat === '國旅' || (cat && r.cat !== cat)) return;
    const d = parseInt(String(r.date).slice(8, 10), 10);
    if (d >= 1 && d <= days) daily[d] += r.amount;
  });
  const cum = []; let s = 0;
  for (let d = 1; d <= days; d++) { s += daily[d]; cum.push(Math.round(s)); }
  return cum;
}

// 讀月表上方摘要區
function readTop_(y, m) {
  return cached_('T' + y + '-' + m, ttlFor_(y, m), function () { return readTopRaw_(y, m); });
}
function readTopRaw_(y, m) {
  const sh = monthSheet_(y, m);
  const v = sh.getRange(1, 1, 14, 18).getValues();
  const g = function (r, c) { return v[r - 1][c - 1]; };
  const cats = CATS.map(function (name, i) {
    const c = 2 + i;
    return { name: name, budget: num_(g(8, c)), cash: num_(g(9, c)), card: num_(g(10, c)), total: num_(g(11, c)) };
  });
  cats.push({ name: '國旅', budget: 0, cash: num_(g(13, 14)), card: num_(g(13, 15)), total: num_(g(13, 13)), travel: true });
  safe_(function () {
    transfersFor_(y, m).forEach(function (t) {
      cats.forEach(function (c) { if (c.name === t.acct) c.budget -= t.amount; if (c.name === t.target) c.budget += t.amount; });
    });
  });
  return {
    disposable: num_(g(4, 2)), plan: num_(g(7, 8)), budget: num_(g(8, 8)),
    cash: num_(g(9, 8)), card: num_(g(10, 8)), spent: num_(g(11, 8)), left: num_(g(12, 8)),
    perDaySheet: num_(g(4, 5)), cardBillCell: num_(g(2, 5)), light: String(g(4, 9) || ''),
    cardTotal: num_(g(2, 12)), cardThis: num_(g(2, 14)), cardNext: num_(g(2, 16)),
    toCircle: num_(g(3, 16)), circled: num_(g(4, 14)), recordedTo: num_(g(2, 18)), incomplete: num_(g(3, 18)),
    tithe: num_(g(8, 2)), cats: cats
  };
}

function timeProgress_(y, m, todayS) {
  const t = parseDate_(todayS), days = daysIn_(y, m);
  if (t.y > y || (t.y === y && t.m > m)) return { day: days, days: days, ratio: 1, daysLeft: 0 };
  if (t.y < y || (t.y === y && t.m < m)) return { day: 0, days: days, ratio: 0, daysLeft: days };
  return { day: t.d, days: days, ratio: t.d / days, daysLeft: days - t.d + 1 };
}

function pace_(cat, total, budget, time) {
  if (!budget) return total > 0 ? 'over' : 'ok';
  const p = total / budget;
  if (cat === '奉獻' && p >= 0.999) return 'done';
  if (p > 1 || p >= 0.9) return 'over';
  if (p > time + 0.05) return 'fast';
  return 'ok';
}

function rowValue_(y, spec, m) {
  if (!spec) return null;
  const s = ss_(y); if (!s) return null;
  const row = cached_('R' + y + ':' + spec.sheet + ':' + spec.row, 120, function () {
    return s.getSheetByName(spec.sheet).getRange(spec.row, spec.firstCol, 1, 12).getValues()[0].map(function (v) { return v instanceof Date ? '' : v; });
  });
  return row[m - 1];
}

// ===== 5. 記帳 =====
function getFormData_() {
  const t = parseDate_(todayStr_());
  const items = {};
  CATS.concat(['國旅']).forEach(function (c) { items[c] = []; });
  // 選單裡的建議項目
  const s = ss_(t.y);
  if (s) {
    const menu = s.getSheetByName('選單').getRange('A2:B41').getValues();
    menu.forEach(function (r) {
      const it = String(r[0] || '').trim(), c = catShort_(String(r[1] || '').trim());
      if (it && items[c] && items[c].indexOf(it) < 0) items[c].push(it);
    });
  }
  // 最近兩個月常用項目排前面
  const freq = {};
  const pm = prevMonth_(t.y, t.m);
  [[t.y, t.m], [pm.y, pm.m]].forEach(function (ym) {
    if (!ss_(ym[0])) return;
    readLedger_(ym[0], ym[1]).forEach(function (r) {
      if (!r.item || r.item === '舊帳轉入' || r.note.indexOf('帳單補登') >= 0 || !items[r.cat]) return;
      const key = r.cat + '|' + r.item; freq[key] = (freq[key] || 0) + 1;
    });
  });
  Object.keys(items).forEach(function (c) {
    const recent = Object.keys(freq).filter(function (k) { return k.indexOf(c + '|') === 0; })
      .sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 6)
      .map(function (k) { return k.split('|')[1]; });
    const merged = recent.concat(items[c].filter(function (x) { return recent.indexOf(x) < 0; }));
    items[c] = merged.slice(0, 10);
  });
  // 快速記帳範本：近兩個月重複出現的「科目＋項目＋支付方式＋金額」組合
  const combo = {}; let last = null;
  [[pm.y, pm.m], [t.y, t.m]].forEach(function (ym) {
    if (!ss_(ym[0])) return;
    readLedger_(ym[0], ym[1]).forEach(function (r) {
      if (!r.item || r.item === '舊帳轉入' || r.note.indexOf('帳單補登') >= 0 || r.cat === '國旅') return;
      const k = [r.cat, r.item, r.pay, r.amount].join('|'); combo[k] = (combo[k] || 0) + 1;
      if (!last || r.date > last.date || (r.date === last.date && r.row > last.row)) last = r;
    });
  });
  const quick = Object.keys(combo).filter(function (k) { return combo[k] >= 2; }).sort(function (a, b) { return combo[b] - combo[a]; }).slice(0, 6)
    .map(function (k) { const p = k.split('|'); return { cat: p[0], item: p[1], pay: p[2], amount: +p[3], n: combo[k] }; });
  return { today: todayStr_(), cats: CATS.concat(['國旅']), items: items, years: Object.keys(CONFIG.files), quick: quick,
           last: last ? { cat: last.cat, item: last.item, pay: last.pay, amount: last.amount } : null,
           prepaidItems: prepaidItems_(t.y).map(function (it) { return { key: it.key, acct: it.acct, name: it.name, plan: it.plan, months: it.months, dueDay: it.dueDay }; }) };
}

function addEntry_(a) {
  const date = String(a.date || todayStr_()).slice(0, 10);
  const amt = Math.round(num_(String(a.amount).replace(/,/g, '')));
  const cat = String(a.cat || '').trim(), item = String(a.item || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式錯誤');
  if (!amt) throw new Error('請輸入金額');
  if (CATS.concat(['國旅']).indexOf(cat) < 0) throw new Error('科目錯誤：' + cat);
  const d = parseDate_(date);
  const pay = (a.pay === '信用卡' || a.pay === CONFIG.cardLabel) ? CONFIG.cardLabel : '現金';
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = monthSheet_(d.y, d.m);
    const n = CONFIG.ledgerLast - CONFIG.ledgerFirst + 1;
    const kn = sh.getRange(CONFIG.ledgerFirst, 11, n, 4).getValues();
    let idx = -1, used = 0;
    for (let i = 0; i < n; i++) {
      const empty = kn[i][0] === '' && kn[i][3] === '';
      if (!empty) used++;
      else if (idx < 0) idx = i;
    }
    if (idx < 0) throw new Error('本月流水帳已滿 500 筆');
    const row = CONFIG.ledgerFirst + idx;
    sh.getRange(row, 11, 1, 4).setValues([[date, catFull_(cat), item || cat, amt]]);
    sh.getRange(row, 16, 1, 2).setValues([[pay, String(a.note || '')]]);
    SpreadsheetApp.flush();
    bumpVer_();
    const top = readTop_(d.y, d.m);
    const p = payShort_(pay);
    return {
      ok: true, row: row, used: used + 1,
      left: top.left,
      message: '已記錄 ' + d.m + '/' + d.d + '（' + p + '）' + (item || cat) + ' $' + fmt_(amt) + '｜本月還能花 $' + fmt_(top.left),
      warnFull: used + 1 >= 480
    };
  } finally { lock.releaseLock(); }
}

function updateEntry_(a) {
  const sh = monthSheet_(a.y, a.m);
  const row = +a.row;
  if (row < CONFIG.ledgerFirst || row > CONFIG.ledgerLast) throw new Error('列號錯誤');
  const d = parseDate_(a.date);
  if (d.y !== +a.y || d.m !== +a.m) {           // 換到別的月份：刪掉原本、新增到新月份
    deleteEntry_(a);
    return addEntry_(a);
  }
  const pay = a.pay === '信用卡' ? CONFIG.cardLabel : '現金';
  sh.getRange(row, 11, 1, 4).setValues([[a.date, catFull_(a.cat), a.item, Math.round(num_(a.amount))]]);
  sh.getRange(row, 16, 1, 2).setValues([[pay, a.note || '']]);
  bumpVer_();
  return { ok: true, message: '已更新' };
}

function deleteEntry_(a) {
  const sh = monthSheet_(a.y, a.m);
  const row = +a.row;
  if (row < CONFIG.ledgerFirst || row > CONFIG.ledgerLast) throw new Error('列號錯誤');
  sh.getRange(row, 11, 1, 4).clearContent();     // K:N（O 欄公式保留）
  sh.getRange(row, 16, 1, 2).clearContent();     // P:Q
  bumpVer_();
  return { ok: true, message: '已刪除' };
}

function setCircled_(y, m) {
  const top = readTop_(y, m);
  monthSheet_(y, m).getRange('N4').setValue(top.cardTotal);
  bumpVer_();
  return { ok: true, message: '已記錄圈存 $' + fmt_(top.cardTotal) };
}

// ===== 6. 今日看板 =====
function verseFor_(todayS, titheAmt) {
  const t = parseDate_(todayS), dt = new Date(t.y, t.m - 1, t.d);
  if (dt.getDay() === 0 && t.d <= 7) {
    return { text: TITHE_VERSE[0], ref: TITHE_VERSE[1] + '（和合本）｜什一奉獻提醒',
             tithe: '今天是本月第一個主日，記得什一奉獻 $' + fmt_(titheAmt) };
  }
  const start = new Date(t.y, 0, 1);
  const doy = Math.floor((dt - start) / 86400000);
  const v = VERSES[doy % VERSES.length];
  return { text: v[0], ref: v[1] + '（和合本）｜今日經文', tithe: '' };
}

function getDashboard_(todayS) {
  const t = parseDate_(todayS);
  const top = readTop_(t.y, t.m);
  const time = timeProgress_(t.y, t.m, todayS);
  const spendRatio = top.budget ? top.spent / top.budget : 0;
  const perDay = time.daysLeft ? Math.max(0, Math.round(top.left / time.daysLeft)) : 0;
  const ledger = readLedger_(t.y, t.m);
  const todayRows = ledger.filter(function (r) { return r.date === todayS; });
  const todayCount = todayRows.length;
  const todayBy = {}; let todayAll = 0;
  todayRows.forEach(function (r) { todayBy[r.cat] = (todayBy[r.cat] || 0) + r.amount; if (r.cat !== '國旅') todayAll += r.amount; });
  const dl = Math.max(1, time.daysLeft);
  const dayAllowance = Math.max(0, Math.round((top.budget - (top.spent - todayAll)) / dl));
  const tips = [];
  // 1 花費速度
  if (spendRatio > time.ratio + 0.05) {
    tips.push({ level: 'warn', text: '花費 ' + Math.round(spendRatio * 100) + '% 已超前時間進度 ' + Math.round(time.ratio * 100) + '%，接下來每天控制在 $' + fmt_(perDay) + ' 以內。' });
  } else {
    tips.push({ level: 'ok', text: '花費 ' + Math.round(spendRatio * 100) + '%，沒有超過時間進度 ' + Math.round(time.ratio * 100) + '%，做得很好！' });
  }
  // 2 最需要注意的科目
  const risky = top.cats.filter(function (c) { return !c.travel && c.name !== '奉獻' && c.budget > 0; })
    .map(function (c) { return { c: c, p: c.total / c.budget, s: pace_(c.name, c.total, c.budget, time.ratio) }; })
    .filter(function (x) { return x.s === 'fast' || x.s === 'over'; })
    .sort(function (a, b) { return b.p - a.p; });
  if (risky.length) {
    const x = risky[0], rem = Math.max(0, x.c.budget - x.c.total);
    tips.push({ level: 'warn', text: x.c.name + '已用 ' + Math.round(x.p * 100) + '%，剩 $' + fmt_(rem) +
      (time.daysLeft ? '，每天約 $' + fmt_(rem / time.daysLeft) : '') + '。' });
  }
  // 3 圈存
  if (top.toCircle > 0) tips.push({ level: 'info', action: 'circle', text: '本月刷卡還有 $' + fmt_(top.toCircle) + ' 尚未圈存，記得轉到待繳戶。' });
  // 4 卡費扣款
  if (t.d <= 6) {
    const due = PROFILE[t.y] && PROFILE[t.y].cardDue.type === 'sheet' ? num_(rowValue_(t.y, PROFILE[t.y].cardDue, t.m)) : top.cardBillCell;
    if (due) tips.push({ level: 'info', text: (t.d === 6 ? '今天' : '6 號') + '扣卡費 $' + fmt_(due) + '，請確認待繳戶餘額足夠。' });
  }
  // 5 今天還沒記帳 / 月底盤點
  const hour = +Utilities.formatDate(new Date(), CONFIG.timezone, 'H');
  if (!todayCount && hour >= 18) tips.push({ level: 'info', text: '今天還沒記帳，記好每一筆就是好的開始。' });
  if (time.daysLeft && time.daysLeft <= 2) tips.push({ level: 'info', text: '月底快到了，記得到「資產」頁做滿月盤點。' });
  const prepaid = safe_(function () { return getPrepaid_(t.y, t.m); });
  if (prepaid) {
    prepaid.due.filter(function (x) { return x.status === 'overdue'; }).forEach(function (x) { tips.unshift({ level: 'warn', text: '預扣繳費逾期：' + x.name + ' $' + fmt_(x.planned) + '（期限 ' + x.dueDate.slice(5).replace('-', '/') + '，' + x.acct + '）' }); });
    const soon = prepaid.due.filter(function (x) { return x.status === 'soon'; });
    if (soon.length) tips.push({ level: 'info', text: '即將到期：' + soon.map(function (x) { return x.name + ' $' + fmt_(x.planned) + '（' + x.dueDate.slice(5).replace('-', '/') + '）'; }).join('、') });
  }
  if (t.m === 5) tips.push({ level: 'info', text: '5 月報稅季：到「資產」頁查看去年度的報稅資料彙整。' });
  const debts = getDebts_(t.y);
  debts.slice().reverse().forEach(function (dbt) { tips.unshift({ level: 'warn', action: 'debt', row: dbt.row, y: t.y, text: '待回補缺口：' + dbt.name + ' $' + fmt_(dbt.amount) + '。補上後請按「已補上」。' }); });
  if (top.incomplete > 0) tips.push({ level: 'warn', text: '有 ' + top.incomplete + ' 筆流水帳資料不完整，請到紀錄頁補齊。' });

  // 緊急備用金 / 可投資金額
  const prof = PROFILE[t.y] || {};
  const emergency = prof.emergency ? num_(rowValue_(t.y, prof.emergency, t.m)) : 0;
  const poolEnd = prof.pool ? num_(rowValue_(t.y, prof.pool, 12)) : 0;
  const spare = Math.max(0, Math.round(poolEnd - top.budget));
  const target = CONFIG.emergencyTarget;
  const invest = emergency >= target
    ? { mode: 'invest', amount: spare, text: '緊急備用金已補滿，目前可投資金額 $' + fmt_(spare) + '（建議存入元大，有餘額才存）。' }
    : { mode: 'emergency', current: emergency, target: target, shortfall: target - emergency, canTopUp: spare,
        text: '緊急備用金還差 $' + fmt_(target - emergency) + '，補滿 ' + fmt_(target) + ' 後才會顯示可投資金額。' };
  const check = prof.check ? String(rowValue_(t.y, prof.check, t.m) || '') : '';
  const payday = t.d <= 5 ? safe_(function () { return getAllocation_(t.y, t.m); }) : null;
  const pmd = prevMonth_(t.y, t.m);
  const sameAt = function (arr) { return arr && arr.length ? arr[Math.min(t.d, arr.length) - 1] : null; };
  const cmp = { prev: sameAt(safe_(function () { return dailyCum_(pmd.y, pmd.m); })), last: sameAt(safe_(function () { return dailyCum_(t.y - 1, t.m); })), prevLabel: pmd.m + '月', lastLabel: (t.y - 1) + '/' + t.m };

  return {
    y: t.y, m: t.m, d: t.d, weekday: '日一二三四五六'.charAt(new Date(t.y, t.m - 1, t.d).getDay()),
    left: Math.round(top.left), perDay: perDay, todaySpent: todayAll, dayAllowance: dayAllowance, todayLeft: dayAllowance - todayAll, budget: top.budget, spent: top.spent, cardSpent: top.card,
    count: ledger.length, spendRatio: spendRatio, timeRatio: time.ratio, daysLeft: time.daysLeft,
    status: top.left < 0 ? 'over' : (spendRatio > time.ratio + 0.05 ? 'fast' : 'ok'),
    tips: tips.slice(0, 5 + debts.length), debts: debts, verse: verseFor_(todayS, top.tithe), invest: invest, check: check, payday: payday, cmp: cmp,
    cats: top.cats.map(function (c) {
      const td = todayBy[c.name] || 0, allow = Math.max(0, Math.round((c.budget - (c.total - td)) / dl));
      return { name: c.name, budget: c.budget, cash: c.cash, card: c.card, total: c.total, today: td, allowance: allow, todayLeft: allow - td,
               pace: pace_(c.name, c.total, c.budget, time.ratio), travel: !!c.travel };
    }),
    prepaid: prepaid
  };
}

// ===== 6-0. 待回補缺口（選單 G18:J 起）=====
function getDebts_(y) {
  return safe_(function () {
    const s = ss_(y); if (!s) return [];
    const sh = s.getSheetByName('選單');
    if (String(sh.getRange('G16').getValue()).indexOf('待回補缺口') < 0) return [];
    const v = sh.getRange(18, 7, 13, 4).getValues();
    const today = todayStr_().slice(0, 7);
    const out = [];
    v.forEach(function (r, i) {
      const name = String(r[0] || '').trim(), amt = num_(r[1]);
      const start = r[2] instanceof Date ? Utilities.formatDate(r[2], CONFIG.timezone, 'yyyy-MM') : String(r[2] || '').slice(0, 7);
      const done = r[3] instanceof Date ? Utilities.formatDate(r[3], CONFIG.timezone, 'yyyy-MM-dd') : String(r[3] || '').trim();
      if (name && amt > 0 && !done && (!start || start <= today)) out.push({ row: 18 + i, name: name, amount: amt, start: start });
    });
    return out;
  }) || [];
}
function setDebtDone_(y, row) {
  const sh = ss_(+y).getSheetByName('選單');
  row = +row; if (row < 18 || row > 30) throw new Error('列號錯誤');
  sh.getRange(row, 10).setValue(todayStr_());
  bumpVer_();
  return { ok: true, message: '已記錄補上，之後不再提醒' };
}

// ===== 6-1. 發薪日分配 =====
function allocKey_(y, m) { return 'ALLOC_' + y + '_' + m; }
function allocDoneAt_(y, m) { return PropertiesService.getScriptProperties().getProperty(allocKey_(y, m)); }
function setAllocDone_(y, m, done) {
  const props = PropertiesService.getScriptProperties();
  if (done) props.setProperty(allocKey_(y, m), Utilities.formatDate(new Date(), CONFIG.timezone, 'M/d HH:mm'));
  else props.deleteProperty(allocKey_(y, m));
  return getAllocation_(+y, +m);
}
function getAllocation_(y, m) {
  y = +y; m = +m;
  const sh = monthSheet_(y, m);
  const v = sh.getRange('A1:I4').getValues();
  const salary = num_(v[0][1]), toTW = num_(v[1][3]), toCard = num_(v[1][4]), f2 = num_(v[1][5]),
        g2 = num_(v[1][6]), h2 = num_(v[1][7]), spendable = num_(v[3][1]);
  let refill = num_(v[2][1]);
  const list = [];
  const adj = (CONFIG.allocAdjust || {})[y + '-' + m] || {};
  const prepaid = num_(adj.cardPaidByTW);
  const salaryRow = y >= 2027 ? 3 : 4;
  const pay = num_(ss_(y).getSheetByName('收入').getRange(salaryRow, 1 + m).getValue());
  const add = function (from, to, amount, note) { amount = Math.round(amount); if (amount > 0) list.push({ from: from, to: to, amount: amount, note: note || '' }); };
  let toSino = 0, sinoNote = '', twRefill = 0;
  add('郵局日常戶', '台銀 B 帳戶', toTW, '房貸、電費等預扣');
  add('郵局日常戶', '信用卡待繳戶', toCard - prepaid, prepaid ? '6 號扣卡費（帳單 $' + fmt_(toCard) + '，其中 $' + fmt_(prepaid) + ' 已由台銀代繳）' : (y >= 2027 ? '6 號扣款（訂閱、分期等固定費用）' : '6 號扣卡費（上期帳單）'));
  if (y >= 2027) {
    const tcol = 3 + m - 1, tsh = ss_(y).getSheetByName('總表');
    const post = num_(tsh.getRange(9, tcol).getValue()), emer = num_(tsh.getRange(10, tcol).getValue());
    add('郵局日常戶', '郵局公教優存', post, '定海神針');
    add('郵局日常戶', '永豐定存', emer, '緊急備用金');
    add('郵局日常戶', '元大交割戶', g2, '投資');
    toSino = h2; sinoNote = '平滑中心＋0050 定期定額';
  } else {
    // 2026：回補分成永豐、郵局優存、台銀三個來源
    const col = 1 + m;
    const sinoRefill = num_(ss_(y).getSheetByName('永豐銀行準備金定期定額').getRange(10, col).getValue());
    const postRefill = num_(ss_(y).getSheetByName('郵局優存帳戶').getRange(9, col).getValue());
    twRefill = num_(ss_(y).getSheetByName('台銀帳戶(預扣及攤平)').getRange(37, col).getValue());
    const postNet = f2 - postRefill;
    if (postNet > 0) add('郵局日常戶', '郵局公教優存', postNet, '定海神針' + (postRefill ? '（已扣掉本月從優存回補的 $' + fmt_(postRefill) + '）' : ''));
    else if (postNet < 0) add('郵局公教優存', '郵局日常戶', -postNet, '優存回補');
    else if (postRefill) list.push({ from: '郵局公教優存', to: '郵局日常戶', amount: 0, note: '本月存入 $' + fmt_(f2) + ' 與回補 $' + fmt_(postRefill) + ' 互抵，不用轉帳' });
    toSino = g2; sinoNote = '0050 定期定額';
    refill = sinoRefill;
  }
  // 永豐：存入與回補互抵，只轉一次
  const net = refill - toSino;
  if (refill > 0 && net > 0) {
    add('永豐', '郵局日常戶', net, '回補 $' + fmt_(refill) + '，已扣掉要留在永豐的 ' + sinoNote + ' $' + fmt_(toSino) + '，只要轉這一筆');
  } else if (toSino - refill > 0) {
    add('郵局日常戶', '永豐', toSino - refill, sinoNote + (refill ? '（已扣掉回補 $' + fmt_(refill) + '）' : ''));
  }
  if (twRefill > 0) add('台銀 B 帳戶', '郵局日常戶', twRefill, '台銀回補日常戶');
  return { debts: getDebts_(y), y: y, m: m, salary: pay || salary, spendable: spendable, refill: refill, list: list, done: allocDoneAt_(y, m) || '' };
}

// ===== 6-2. 圖表額外資料 =====
function monthExtra_(y, m, cutoff) {
  const rows = readLedger_(y, m), days = daysIn_(y, m);
  const cash = new Array(days).fill(0), card = new Array(days).fill(0), items = {};
  rows.forEach(function (r) {
    if (r.cat === '國旅') return;
    const d = parseInt(String(r.date).slice(8, 10), 10);
    if (d < 1 || d > days) return;
    if (r.pay === '現金') cash[d - 1] += r.amount; else card[d - 1] += r.amount;
    if (r.item && r.item !== '舊帳轉入' && r.cat !== '奉獻') {
      const k = r.item;
      items[k] = items[k] || { item: k, cat: r.cat, amount: 0, count: 0 };
      items[k].amount += r.amount; items[k].count += 1;
    }
  });
  const weekday = weekdayAvg_(y, m, cutoff) || [0, 0, 0, 0, 0, 0, 0];
  const weekdayLast = weekdayAvg_(y - 1, m, cutoff);
  const top = Object.keys(items).map(function (k) { return items[k]; })
    .sort(function (a, b) { return b.amount - a.amount; }).slice(0, 10);
  const pm = prevMonth_(y, m), ip = itemTotals_(pm.y, pm.m) || {};
  top.forEach(function (t) { t.prev = Math.round(ip[t.item] || 0); });
  return { daily: { cash: cash.map(Math.round), card: card.map(Math.round) }, items: top, weekday: weekday, weekdayLast: weekdayLast };
}

// 近 12 個月趨勢
function getTrend_(y, m) {
  y = +y; m = +m;
  const out = [];
  let ym = { y: y, m: m };
  for (let k = 0; k < 12; k++) {
    const cur = ym;
    const row = safe_(function () {
      if (ss_(cur.y)) {
        const t = readTop_(cur.y, cur.m);
        return { y: cur.y, m: cur.m, budget: t.budget, cash: t.cash, card: t.card, spent: t.spent };
      }
      const g = readOldGrid_(cur.y, cur.m);
      if (!g) return null;
      const s = g.reduce(function (a, r) { return a + r.amount; }, 0);
      return { y: cur.y, m: cur.m, budget: 0, cash: s, card: 0, spent: s };
    });
    const r0 = row || { y: cur.y, m: cur.m, budget: 0, cash: 0, card: 0, spent: 0, none: true };
    const ly = monthSpent_(cur.y - 1, cur.m); r0.ly = ly ? ly.spent : null;
    out.unshift(r0);
    ym = prevMonth_(ym.y, ym.m);
  }
  return out;
}

// ===== 6-3. 比較資料（上月、去年同期）=====
// 舊格式年度的滿月記帳（只讀，做去年比較用）
const LEGACY_MONTHLY = {
  2025: { firstCol: 4, totalRow: 11, incomeRow: 18, expenseRow: 38, netRow: 57, liquidRows: [4, 5, 6] }
};
function yearSeries_(y) {
  return cached_('Y' + y, 600, function () { return yearSeriesRaw_(y); });
}
function yearSeriesRaw_(y) {
  return safe_(function () {
    let sh, spec;
    if (ss_(y) && PROFILE[y]) {
      sh = ss_(y).getSheetByName('滿月記帳'); spec = PROFILE[y].monthly;
      spec = { firstCol: spec.firstCol, totalRow: spec.totalRow, incomeRow: spec.incomeRow, expenseRow: spec.expenseRow, netRow: spec.netRow,
               liquidRows: spec.accounts.filter(function (a) { return a.kind === '活存' || a.kind === '定存'; }).map(function (a) { return a.row; }) };
    } else if (CONFIG.oldGridFiles[y] && LEGACY_MONTHLY[y]) {
      sh = SpreadsheetApp.openById(CONFIG.oldGridFiles[y]).getSheetByName('滿月記帳'); spec = LEGACY_MONTHLY[y];
    } else return null;
    const last = Math.max(spec.totalRow, spec.incomeRow, spec.expenseRow, spec.netRow);
    const v = sh.getRange(1, 1, last, spec.firstCol + 12).getValues();
    const row = function (r) { const a = []; for (let i = 1; i <= 12; i++) a.push(num_(v[r - 1][spec.firstCol + i - 2])); return a; };
    const liquid = []; for (let i = 1; i <= 12; i++) liquid.push(spec.liquidRows.reduce(function (s, r) { return s + num_(v[r - 1][spec.firstCol + i - 2]); }, 0));
    return { y: y, total: row(spec.totalRow), income: row(spec.incomeRow), expense: row(spec.expenseRow), net: row(spec.netRow), liquid: liquid };
  });
}
// 某月各科目合計
function catTotals_(y, m) {
  return safe_(function () {
    const o = {};
    if (ss_(y)) { readTop_(y, m).cats.forEach(function (c) { o[c.name] = c.total; }); return o; }
    const g = readOldGrid_(y, m); if (!g) return null;
    g.forEach(function (r) { o[r.cat] = (o[r.cat] || 0) + r.amount; });
    return o;
  });
}
// 某月總花費（趨勢圖用）
function monthSpent_(y, m) {
  return safe_(function () {
    if (ss_(y)) { const t = readTop_(y, m); return { budget: t.budget, cash: t.cash, card: t.card, spent: t.spent }; }
    const g = readOldGrid_(y, m); if (!g) return null;
    const s = g.reduce(function (a, r) { return a + r.amount; }, 0);
    return { budget: 0, cash: s, card: 0, spent: s };
  });
}
// 某月各項目合計
function itemTotals_(y, m) {
  return safe_(function () {
    if (!ss_(y)) return null;
    const o = {};
    readLedger_(y, m).forEach(function (r) { if (r.item) o[r.item] = (o[r.item] || 0) + r.amount; });
    return o;
  });
}
// 星期分布（指定年份、截止月與天數）
function weekdayAvg_(y, m, cutoff) {
  const sum = [0, 0, 0, 0, 0, 0, 0], occ = [0, 0, 0, 0, 0, 0, 0];
  let ym = { y: y, m: m }, any = false;
  for (let k = 0; k < 3; k++) {
    const lim = k === 0 ? (cutoff || 0) : daysIn_(ym.y, ym.m);
    const cur = ym;
    const lr = safe_(function () { return ss_(cur.y) ? readLedger_(cur.y, cur.m) : readOldGrid_(cur.y, cur.m); });
    if (lr) {
      any = true;
      for (let d = 1; d <= lim; d++) occ[new Date(cur.y, cur.m - 1, d).getDay()]++;
      lr.forEach(function (r) {
        if (r.cat === '奉獻' || r.cat === '國旅') return;
        const d = parseInt(String(r.date).slice(8, 10), 10);
        if (d >= 1 && d <= lim) sum[new Date(cur.y, cur.m - 1, d).getDay()] += r.amount;
      });
    }
    ym = prevMonth_(ym.y, ym.m);
  }
  return any ? sum.map(function (s, i) { return occ[i] ? Math.round(s / occ[i]) : 0; }) : null;
}

// ===== 7. 圖表 =====
function getMonth_(y, m) {
  y = +y; m = +m;
  const top = readTop_(y, m);
  const time = timeProgress_(y, m, todayStr_());
  const pm = prevMonth_(y, m);
  const cur = dailyCum_(y, m), prev = safe_(function () { return dailyCum_(pm.y, pm.m); }),
        last = safe_(function () { return dailyCum_(y - 1, m); });
  const cutoff = time.ratio >= 1 ? cur.length : time.day;
  const curShown = cur.slice(0, Math.max(cutoff, 0));
  const extra = monthExtra_(y, m, cutoff);
  const same = function (arr) { return arr && cutoff ? arr[Math.min(cutoff, arr.length) - 1] : null; };
  return {
    y: y, m: m, budget: top.budget, spent: top.spent, cash: top.cash, card: top.card,
    spendRatio: top.budget ? top.spent / top.budget : 0, timeRatio: time.ratio,
    status: top.left < 0 ? 'over' : (top.budget && top.spent / top.budget > time.ratio + 0.05 ? 'fast' : 'ok'),
    curves: { cur: curShown, prev: prev, last: last, prevLabel: pm.m + '月', lastLabel: (y - 1) + '/' + m },
    sameDay: { day: cutoff, prev: same(prev), last: same(last) },
    daily: extra.daily, items: extra.items, weekday: extra.weekday, weekdayLast: extra.weekdayLast,
    catsPrev: catTotals_(pm.y, pm.m), catsLast: catTotals_(y - 1, m),
    cats: top.cats.filter(function (c) { return c.budget > 0 || c.total > 0; }).map(function (c) {
      return { name: c.name, budget: c.budget, cash: c.cash, card: c.card, total: c.total, pace: pace_(c.name, c.total, c.budget, time.ratio), travel: !!c.travel };
    })
  };
}

function safe_(fn) { try { return fn(); } catch (e) { return null; } }

function getCategory_(y, m, cat) {
  y = +y; m = +m;
  const top = readTop_(y, m);
  const time = timeProgress_(y, m, todayStr_());
  const c = top.cats.filter(function (x) { return x.name === cat; })[0];
  if (!c) throw new Error('找不到科目：' + cat);
  const entries = readLedger_(y, m).filter(function (r) { return r.cat === cat; })
    .sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : b.row - a.row); });
  // 近 3 個月同項目平均
  const hist = {};
  let ym = { y: y, m: m };
  for (let i = 0; i < 3; i++) {
    ym = prevMonth_(ym.y, ym.m);
    if (!ss_(ym.y)) continue;
    safe_(function () {
      readLedger_(ym.y, ym.m).forEach(function (r) {
        if (r.cat !== cat || !r.item || r.item === '舊帳轉入') return;
        (hist[r.item] = hist[r.item] || []).push(r.amount);
      });
    });
  }
  entries.forEach(function (r) {
    const h = hist[r.item];
    if (h && h.length >= 2) {
      const avg = h.reduce(function (s, x) { return s + x; }, 0) / h.length;
      if (r.amount > avg * CONFIG.flagRatio) {
        r.flag = '高於「' + r.item + '」近 3 個月平均 $' + fmt_(avg) + '，約 ' + (r.amount / avg).toFixed(1) + ' 倍';
      }
    }
  });
  const pm = prevMonth_(y, m);
  const cur = dailyCum_(y, m, cat);
  const cutoff = time.ratio >= 1 ? cur.length : time.day;
  const order = top.cats.filter(function (x) { return x.budget > 0 || x.total > 0; }).map(function (x) { return x.name; });
  const days = daysIn_(y, m), dc = new Array(days).fill(0), dk = new Array(days).fill(0), items = {};
  entries.forEach(function (r) {
    const dd = parseInt(String(r.date).slice(8, 10), 10);
    if (dd >= 1 && dd <= days) { if (r.pay === '現金') dc[dd - 1] += r.amount; else dk[dd - 1] += r.amount; }
    const k = r.item || cat; items[k] = items[k] || { item: k, amount: 0, count: 0, prev: 0 }; items[k].amount += r.amount; items[k].count++;
  });
  safe_(function () { if (ss_(pm.y)) readLedger_(pm.y, pm.m).forEach(function (r) { if (r.cat !== cat) return; const k = r.item || cat; items[k] = items[k] || { item: k, amount: 0, count: 0, prev: 0 }; items[k].prev += r.amount; }); });
  const itemList = Object.keys(items).map(function (k) { return items[k]; }).sort(function (a, b) { return b.amount - a.amount || b.prev - a.prev; });
  return {
    y: y, m: m, cat: cat, order: order,
    budget: c.budget, cash: c.cash, card: c.card, total: c.total,
    pace: pace_(cat, c.total, c.budget, time.ratio), daysLeft: time.daysLeft,
    curves: { cur: cur.slice(0, Math.max(cutoff, 0)), prev: safe_(function () { return dailyCum_(pm.y, pm.m, cat); }),
              last: safe_(function () { return dailyCum_(y - 1, m, cat); }), prevLabel: pm.m + '月', lastLabel: (y - 1) + '/' + m },
    flagged: entries.filter(function (r) { return r.flag; }), entries: entries,
    daily: { cash: dc.map(Math.round), card: dk.map(Math.round) }, items: itemList
  };
}

// ===== 7-1. 科目明細的進階分析（切換到時才載入）=====
const SIZE_BUCKETS = [[0, 100, '100以下'], [100, 300, '100–300'], [300, 500, '300–500'], [500, 1000, '500–1千'], [1000, 3000, '1千–3千'], [3000, 1e12, '3千以上']];
function bucketOf_(a) { for (let i = 0; i < SIZE_BUCKETS.length; i++) if (a >= SIZE_BUCKETS[i][0] && a < SIZE_BUCKETS[i][1]) return i; return SIZE_BUCKETS.length - 1; }
function getCategoryMore_(y, m, cat) {
  y = +y; m = +m;
  const time = timeProgress_(y, m, todayStr_());
  const cutoff = time.ratio >= 1 ? daysIn_(y, m) : time.day;
  const col = CATS.indexOf(cat);
  const months = [];
  let ym = { y: y, m: m };
  const ledgers = {};
  for (let k = 0; k < 12; k++) {
    const cur = ym;
    const row = { y: cur.y, m: cur.m, total: 0, cash: 0, card: 0, budget: 0, count: 0, avg: 0, ly: null, none: true };
    safe_(function () {
      if (ss_(cur.y)) {
        const t = readTop_(cur.y, cur.m), c = t.cats.filter(function (x) { return x.name === cat; })[0];
        if (c) { row.total = c.total; row.cash = c.cash; row.card = c.card; row.budget = c.budget; row.none = false; }
        const lr = readLedger_(cur.y, cur.m).filter(function (r) { return r.cat === cat; });
        ledgers[cur.y + '-' + cur.m] = lr;
        const real = lr.filter(function (r) { return r.item !== '舊帳轉入'; });
        row.count = real.length; row.avg = real.length ? Math.round(real.reduce(function (s, r) { return s + r.amount; }, 0) / real.length) : 0;
      } else {
        const g = readOldGrid_(cur.y, cur.m);
        if (g) { row.total = g.filter(function (r) { return r.cat === cat; }).reduce(function (s, r) { return s + r.amount; }, 0); row.cash = row.total; row.none = false; }
      }
    });
    const lt = catTotals_(cur.y - 1, cur.m); row.ly = lt ? Math.round(lt[cat] || 0) : null;
    months.unshift(row);
    ym = prevMonth_(ym.y, ym.m);
  }
  // 單筆金額分布：本月 vs 前 3 個月平均
  const curRows = (ledgers[y + '-' + m] || []).filter(function (r) { return r.item !== '舊帳轉入'; });
  const dist = SIZE_BUCKETS.map(function (b) { return { label: b[2], count: 0, amount: 0, prev: 0 }; });
  curRows.forEach(function (r) { const i = bucketOf_(r.amount); dist[i].count++; dist[i].amount += r.amount; });
  let pm = { y: y, m: m }, nPrev = 0;
  for (let k = 0; k < 3; k++) {
    pm = prevMonth_(pm.y, pm.m);
    const lr = ledgers[pm.y + '-' + pm.m];
    if (!lr) continue;
    const real = lr.filter(function (r) { return r.item !== '舊帳轉入'; });
    if (!real.length) continue;
    nPrev++;
    real.forEach(function (r) { dist[bucketOf_(r.amount)].prev++; });
  }
  dist.forEach(function (b) { b.prev = nPrev ? Math.round(b.prev / nPrev * 10) / 10 : null; });
  // 星期分布：近 3 個月 vs 去年同期
  const wk = function (yy, mm, lim0) {
    const sum = [0, 0, 0, 0, 0, 0, 0], occ = [0, 0, 0, 0, 0, 0, 0];
    let q = { y: yy, m: mm }, any = false;
    for (let k = 0; k < 3; k++) {
      const lim = k === 0 ? lim0 : daysIn_(q.y, q.m), cq = q;
      const lr = ledgers[cq.y + '-' + cq.m] || safe_(function () { return ss_(cq.y) ? readLedger_(cq.y, cq.m) : readOldGrid_(cq.y, cq.m); });
      if (lr) {
        any = true;
        for (let d = 1; d <= lim; d++) occ[new Date(cq.y, cq.m - 1, d).getDay()]++;
        lr.forEach(function (r) { if (r.cat !== cat) return; const d = parseInt(String(r.date).slice(8, 10), 10); if (d >= 1 && d <= lim) sum[new Date(cq.y, cq.m - 1, d).getDay()] += r.amount; });
      }
      q = prevMonth_(q.y, q.m);
    }
    return any ? sum.map(function (s, i) { return occ[i] ? Math.round(s / occ[i]) : 0; }) : null;
  };
  return { y: y, m: m, cat: cat, months: months, dist: dist, distPrevMonths: nPrev, weekday: wk(y, m, cutoff), weekdayLast: wk(y - 1, m, cutoff) };
}

// ===== 15. 預扣帳戶繳費、預算調撥、信用卡對帳（共用《App紀錄》表）=====
const EVERY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], EVEN = [2, 4, 6, 8, 10, 12];
const PREPAID = {
  2026: [
    { acct: '台銀', sheet: '台銀帳戶(預扣及攤平)', firstCol: 2, items: [
      [11, '房貸', EVERY, 20], [13, '保險費（季繳）', [2, 4, 6, 10]], [12, '產險保費', [6]], [14, '女兒意外險', [5]],
      [15, '大白車險', [4]], [16, '綜所稅', [5]], [17, '房屋稅', [4]], [18, '地價稅', [10]],
      [19, '大白牌照稅', [3]], [20, '小白牌照稅', [3]], [21, '機車燃料費', [2]], [22, '大白燃料費', [6]], [23, '小白燃料費', [6]],
      [24, '小布丁夏令營', [6]], [26, '小布丁鋼琴', EVERY], [35, '小布丁畫畫課', EVEN], [25, '小布丁英語', EVERY],
      [27, '小布丁學費', [3, 9]], [28, '小布丁社團費', [3, 9]], [29, '電費', EVEN], [31, '自來水費', EVEN],
      [30, '電信費', EVERY], [32, '瓦斯費', EVEN], [33, '營養午餐', [4, 10]]] }
  ],
  2027: [
    { acct: '台銀', sheet: '台銀帳戶_預扣及攤平', firstCol: 2, items: [[7, '房貸', EVERY, 20], [8, '電費', EVEN]] },
    { acct: '永豐', sheet: '永豐銀行準備金定期定額', firstCol: 2, items: [
      [10, '保險費（季繳）', [2, 4, 6, 10]], [11, '女兒意外險', [5]], [12, '大白車險', [4]], [13, '產險保費', [6]],
      [14, '綜所稅', [5]], [15, '房屋稅', [4]], [16, '地價稅', [10]], [17, '大白牌照稅', [3]], [18, '小白牌照稅', [3]],
      [19, '機車燃料費', [2]], [20, '大白燃料費', [6]], [21, '小白燃料費', [6]], [22, '小布丁夏令營／寒假營', [6, 11]],
      [24, '小布丁鋼琴', EVERY], [27, '小布丁畫畫課', EVEN], [23, '小布丁英語', EVERY], [25, '小布丁學費', [3, 9]],
      [26, '小布丁社團費', [3, 9]], [30, '自來水費', EVEN], [29, '電信費', EVERY], [31, '瓦斯費', EVEN],
      [28, '營養午餐', [4, 10]], [32, '汽車保養維修', [4, 10]]] }
  ]
};
const TRACK_START = { 2026: 11 };   // 這個月份以前的攤平表是歷史實際數，不移動
const LOG_HEAD = ['記錄時間', '類型', '日期', '月份', '項目／科目', '金額', '帳戶／來源', '目標／列號', '原計畫', '備註', '資料'];
function logSheet_(y) {
  const s = ss_(y); if (!s) throw new Error(y + ' 年的試算表尚未設定');
  let sh = s.getSheetByName('App紀錄');
  if (!sh) {
    sh = s.insertSheet('App紀錄');
    sh.getRange(1, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold').setBackground('#EBDEF0');
    sh.setFrozenRows(1);
  }
  return sh;
}
function readLog_(y) {
  if (!ss_(y)) return [];
  return cached_('LOG' + y, 300, function () {
    const s = ss_(y), sh = s.getSheetByName('App紀錄');
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, LOG_HEAD.length).getValues().map(function (r, i) {
      return { row: i + 2, type: String(r[1] || ''), date: dateText_(r[2]), m: num_(r[3]), name: String(r[4] || ''), amount: num_(r[5]),
               acct: String(r[6] || ''), target: String(r[7] || ''), planned: r[8] === '' ? null : num_(r[8]), note: String(r[9] || ''), data: String(r[10] || '') };
    }).filter(function (r) { return r.type; });
  });
}
function appendLog_(y, rec) {
  const sh = logSheet_(y);
  sh.appendRow([new Date(), rec.type, rec.date || todayStr_(), rec.m || '', rec.name || '', rec.amount || 0, rec.acct || '', rec.target || '', rec.planned == null ? '' : rec.planned, rec.note || '', rec.data || '']);
  bumpVer_();
}
function deleteLog_(y, row) {
  const sh = logSheet_(+y); row = +row;
  if (row < 2 || row > sh.getLastRow()) throw new Error('紀錄不存在');
  const r = readLog_(+y).filter(function (x) { return x.row === row; })[0];
  if (r && r.type === '繳費' && r.data) {   // 還原攤平表
    const d = JSON.parse(r.data), sh2 = ss_(+y).getSheetByName(d.sheet);
    restoreCell_(sh2, d.row, d.colM, d.prevM);
    if (d.colMM && d.colMM !== d.colM) restoreCell_(sh2, d.row, d.colMM, d.prevMM);
  }
  sh.deleteRow(row);
  bumpVer_();
  return { ok: true, message: '已刪除紀錄' };
}
function restoreCell_(sh, row, col, prev) {
  const r = sh.getRange(row, col);
  if (prev && prev.f) r.setFormula(prev.f); else r.setValue(prev && prev.v !== undefined ? prev.v : '');
}

// ---- 預扣繳費 ----
function prepaidItems_(y) {
  const out = [];
  (PREPAID[y] || []).forEach(function (a) {
    const vals = safe_(function () { return cached_('PP' + y + a.sheet, ttlFor_(y, 12), function () {
      return ss_(y).getSheetByName(a.sheet).getRange(1, 1, 60, a.firstCol + 12).getValues().map(function (r) { return r.map(function (x) { return x instanceof Date ? '' : x; }); });
    }); }) || [];
    a.items.forEach(function (it) {
      const row = it[0], plan = [];
      for (let m = 1; m <= 12; m++) plan.push(num_((vals[row - 1] || [])[a.firstCol + m - 2]));
      out.push({ key: a.acct + ':' + row, acct: a.acct, sheet: a.sheet, firstCol: a.firstCol, row: row, name: it[1], months: it[2], dueDay: it[3] || 0, plan: plan });
    });
  });
  return out;
}
function dueDate_(y, m, dueDay) { const d = dueDay || daysIn_(y, m); return y + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(d, daysIn_(y, m))).padStart(2, '0'); }
function getPrepaid_(y, m) {
  y = +y; m = +m;
  const items = prepaidItems_(y), log = readLog_(y).filter(function (r) { return r.type === '繳費'; }), today = todayStr_();
  const list = items.map(function (it) {
    const paid = log.filter(function (r) { return r.target === it.key && r.m === m; });
    const due = it.months.indexOf(m) >= 0;
    let planned = it.plan[m - 1], est = false;
    if (!planned) { const nz = it.plan.filter(function (x) { return x > 0; }); if (nz.length) { planned = Math.round(nz.reduce(function (a, b) { return a + b; }, 0) / nz.length); est = true; } }
    const paidAmt = paid.reduce(function (s, r) { return s + r.amount; }, 0);
    const dd = dueDate_(y, m, it.dueDay);
    const status = paid.length ? 'paid' : (!due ? 'none' : (today > dd ? 'overdue' : (today >= dueDate_(y, m, Math.max(1, (it.dueDay || daysIn_(y, m)) - 5)) ? 'soon' : 'todo')));
    return { key: it.key, acct: it.acct, name: it.name, due: due, dueDate: dd, planned: planned, est: est, paid: paidAmt,
             paidDate: paid.length ? paid[paid.length - 1].date : '', logRows: paid.map(function (r) { return r.row; }), status: status };
  });
  const shown = list.filter(function (x) { return x.due || x.paid; });
  return { y: y, m: m, items: list, due: shown,
           totalPlanned: shown.filter(function (x) { return x.due; }).reduce(function (s, x) { return s + x.planned; }, 0),
           totalPaid: shown.reduce(function (s, x) { return s + x.paid; }, 0),
           unpaid: shown.filter(function (x) { return x.due && !x.paid; }).length,
           overdue: shown.filter(function (x) { return x.status === 'overdue'; }).length };
}
function cellState_(r) { const f = r.getFormula(); return f ? { f: f } : { v: r.getValue() }; }
function recordPrepaid_(a) {
  const date = String(a.date || todayStr_()).slice(0, 10), d = parseDate_(date);
  const y = d.y, m = +a.m || d.m, amt = Math.round(num_(String(a.amount).replace(/,/g, '')));
  if (!amt) throw new Error('請輸入金額');
  const it = prepaidItems_(y).filter(function (x) { return x.key === a.key; })[0];
  if (!it) throw new Error('找不到這個預扣項目');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = ss_(y).getSheetByName(it.sheet), colM = it.firstCol + m - 1;
    // 找出原本排定的月份（本月沒排、但別的月份有排且尚未繳）
    const paidMonths = readLog_(y).filter(function (r) { return r.type === '繳費' && r.target === it.key; }).map(function (r) { return r.data ? JSON.parse(r.data).mm : r.m; });
    let mm = m;
    if (!it.plan[m - 1]) {
      let best = null;
      const start = TRACK_START[y] || 1;
      it.plan.forEach(function (v, i) { const mo = i + 1; if (v > 0 && mo !== m && mo >= start && paidMonths.indexOf(mo) < 0 && (best === null || Math.abs(mo - m) < Math.abs(best - m))) best = mo; });
      if (best !== null && Math.abs(best - m) <= 3) mm = best;
    }
    const colMM = it.firstCol + mm - 1;
    const prevM = cellState_(sh.getRange(it.row, colM)), prevMM = colMM !== colM ? cellState_(sh.getRange(it.row, colMM)) : null;
    const planned = it.plan[mm - 1];
    if (colMM !== colM) sh.getRange(it.row, colMM).setValue(0);
    const already = readLog_(y).filter(function (r) { return r.type === '繳費' && r.target === it.key && r.m === m; }).reduce(function (s, r) { return s + r.amount; }, 0);
    sh.getRange(it.row, colM).setValue(already + amt);
    appendLog_(y, { type: '繳費', date: date, m: m, name: it.name, amount: amt, acct: it.acct, target: it.key, planned: planned || null, note: a.note || '',
      data: JSON.stringify({ sheet: it.sheet, row: it.row, colM: colM, colMM: colMM, mm: mm, prevM: prevM, prevMM: prevMM }) });
    const nz = it.plan.filter(function (x) { return x > 0; }), est = nz.length ? Math.round(nz.reduce(function (s2, x) { return s2 + x; }, 0) / nz.length) : 0;
    const diff = planned ? amt - planned : null;
    return { ok: true, message: '已記錄繳費：' + it.name + ' $' + fmt_(amt) + '（' + it.acct + '，' + d.m + '/' + d.d + '）' + (diff ? '｜比計畫' + (diff > 0 ? '多 $' : '少 $') + fmt_(Math.abs(diff)) : (!planned && est ? '｜本月原無計畫金額（平常約 $' + fmt_(est) + '）' : '')) + (mm !== m ? '｜已把 ' + mm + ' 月的計畫移到 ' + m + ' 月' : '') };
  } finally { lock.releaseLock(); }
}

// ---- 預算調撥（只影響 App 顯示的科目預算，總預算不變）----
function transfersFor_(y, m) { return readLog_(y).filter(function (r) { return r.type === '調撥' && r.m === m; }); }
function transferBudget_(a) {
  const y = +a.y, m = +a.m, amt = Math.round(num_(a.amount));
  if (!amt || amt < 0) throw new Error('請輸入調撥金額');
  if (a.from === a.to) throw new Error('請選擇不同的科目');
  if (CATS.indexOf(a.from) < 0 || CATS.indexOf(a.to) < 0) throw new Error('科目錯誤');
  appendLog_(y, { type: '調撥', date: todayStr_(), m: m, name: a.from, amount: amt, acct: a.from, target: a.to, note: a.note || '' });
  return { ok: true, message: '已從「' + a.from + '」調撥 $' + fmt_(amt) + ' 到「' + a.to + '」' };
}

// ---- 信用卡帳單對帳（帳單 P 月 6 日扣款＝P-1 月 1～22 日＋P-2 月 23 日以後）----
function getBill_(y, m) {
  y = +y; m = +m;
  const p1 = prevMonth_(y, m), p2 = prevMonth_(p1.y, p1.m);
  const pick = function (ym, cond) { return safe_(function () { return readLedger_(ym.y, ym.m).filter(function (r) { return r.pay === '信用卡' && cond(parseInt(r.date.slice(8, 10), 10)); }); }) || []; };
  const rows = pick(p2, function (dd) { return dd > 22; }).concat(pick(p1, function (dd) { return dd <= 22; }))
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  let recorded = rows.reduce(function (s, r) { return s + r.amount; }, 0), fixed = 0;
  if (y >= 2027) fixed = num_(safe_(function () { return readTop_(y, m).cardBillCell; }));
  recorded += fixed;
  const logs = readLog_(y).filter(function (r) { return r.type === '帳單' && r.m === m; });
  const bill = logs.length ? logs[logs.length - 1] : null;
  return { y: y, m: m, from: p2.y + '-' + String(p2.m).padStart(2, '0') + '-23', to: p1.y + '-' + String(p1.m).padStart(2, '0') + '-22',
           rows: rows, fixed: fixed, recorded: recorded, bill: bill ? bill.amount : null, billRow: bill ? bill.row : null, diff: bill ? bill.amount - recorded : null };
}
function setBill_(a) {
  appendLog_(+a.y, { type: '帳單', date: todayStr_(), m: +a.m, name: (+a.m) + '月6日帳單', amount: Math.round(num_(a.amount)), acct: '信用卡', note: a.note || '' });
  return getBill_(a.y, a.m);
}

// ---- 報稅資料彙整 ----
function getTax_(y) {
  y = +y;
  let tithe = 0;
  for (let m = 1; m <= 12; m++) safe_(function () { tithe += readLedger_(y, m).filter(function (r) { return r.cat === '奉獻'; }).reduce(function (s, r) { return s + r.amount; }, 0); });
  const items = prepaidItems_(y);
  const sumRow = function (re) { return items.filter(function (it) { return re.test(it.name); }).reduce(function (s, it) { return s + it.plan.reduce(function (a, b) { return a + b; }, 0); }, 0); };
  return { y: y, tithe: tithe, insurance: sumRow(/保險|意外險/), mortgage: sumRow(/房貸/), houseTax: sumRow(/房屋稅|地價稅/), tuition: sumRow(/學費/) };
}

// ---- 財務目標 ----
function getGoals_(y, m) {
  y = +y; m = +m;
  const out = { y: y, m: m, emergency: null, dawho: null, etf: null };
  if (y >= 2027) safe_(function () {
    const s = ss_(y), t = s.getSheetByName('總表'), yf = s.getSheetByName('永豐銀行準備金定期定額'), mf = s.getSheetByName('滿月記帳');
    const em = t.getRange(18, 3, 1, 12).getValues()[0].map(num_), dw = yf.getRange(8, 2, 1, 12).getValues()[0].map(num_), e50 = yf.getRange(33, 2, 1, 12).getValues()[0].map(num_);
    const fdActual = num_(mf.getRange(49, 5 + m).getValue()), etfMv = num_(mf.getRange(10, 5 + m).getValue());
    const cur = fdActual || em[m - 1];
    out.emergency = { current: cur, target: CONFIG.emergencyTarget, yearEnd: em[11], actual: !!fdActual };
    out.dawho = { current: dw[m - 1], low: 100000, high: 300000, yearEnd: dw[11] };
    out.etf = { invested: e50.slice(0, m).reduce(function (a, b) { return a + b; }, 0), yearPlan: e50.reduce(function (a, b) { return a + b; }, 0), market: etfMv };
  });
  return out;
}

// ---- 自動備份 ----
function 立即備份() {
  let folder; const it = DriveApp.getFoldersByName('家計簿備份');
  folder = it.hasNext() ? it.next() : DriveApp.createFolder('家計簿備份');
  const stamp = Utilities.formatDate(new Date(), CONFIG.timezone, 'yyyyMMdd-HHmm');
  Object.keys(CONFIG.files).forEach(function (y) {
    const f = DriveApp.getFileById(CONFIG.files[y]);
    f.makeCopy(y + '年家計簿_備份_' + stamp, folder);
    // 每個年度只保留最新 8 份
    const files = [], fi = folder.searchFiles('title contains "' + y + '年家計簿_備份_"');
    while (fi.hasNext()) files.push(fi.next());
    files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    files.slice(8).forEach(function (x) { x.setTrashed(true); });
  });
  Logger.log('備份完成：雲端硬碟「家計簿備份」資料夾（' + stamp + '）');
}
function 設定每週自動備份() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === '立即備份') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('立即備份').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  立即備份();
  Logger.log('已設定：每週日凌晨 3 點自動備份，並已先備份一次。');
}

// ===== 8. 紀錄 =====
function getRecords_(y, m) {
  y = +y; m = +m;
  const rows = readLedger_(y, m).sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : b.row - a.row); });
  const total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
  return { y: y, m: m, rows: rows, total: total, capacity: CONFIG.ledgerLast - CONFIG.ledgerFirst + 1 };
}

// ===== 9. 滿月盤點 =====
function getMonthly_(y, m) {
  y = +y; m = +m;
  const prof = PROFILE[y];
  if (!prof) throw new Error(y + ' 年沒有滿月記帳設定');
  const sh = ss_(y).getSheetByName('滿月記帳');
  const mp = prof.monthly, col = mp.firstCol + m - 1;
  const lastRow = Math.max.apply(null, mp.accounts.map(function (a) { return a.inputRow || a.row; }).concat([mp.totalRow, mp.incomeRow, mp.expenseRow, mp.netRow]));
  const v = sh.getRange(1, 1, lastRow, mp.firstCol + 12).getValues();
  const accounts = mp.accounts.map(function (a) {
    const prevVal = m > 1 || mp.type === 'new' ? num_(v[a.row - 1][col - 2]) : 0;
    const cur = a.inputRow ? v[a.inputRow - 1][col - 1] : v[a.row - 1][col - 1];
    const book = a.inputRow ? num_(v[a.row - 1][col - 1]) : null;
    return { key: a.key, label: a.label, kind: a.kind, prev: prevVal, value: cur === '' ? '' : num_(cur), book: book, auto: !!a.inputRow };
  });
  const history = [];
  for (let i = 1; i <= 12; i++) history.push(num_(v[mp.totalRow - 1][mp.firstCol + i - 2]));
  const prevTotal = m > 1 ? history[m - 2] : (mp.type === 'new' ? num_(v[mp.totalRow - 1][mp.firstCol - 2]) : 0);
  // 每月序列（給資產頁圖表）
  const cell = function (row, i) { return num_(v[row - 1][mp.firstCol + i - 2]); };
  const series = { income: [], expense: [], net: [], liquid: [], emergency: null, pool: null, reserve: null };
  for (let i = 1; i <= m; i++) {
    series.income.push(cell(mp.incomeRow, i)); series.expense.push(cell(mp.expenseRow, i)); series.net.push(cell(mp.netRow, i));
    series.liquid.push(mp.accounts.reduce(function (s, a) { return (a.kind === '活存' || a.kind === '定存') ? s + cell(a.row, i) : s; }, 0));
  }
  if (prof.emergency) {
    const tsh = ss_(y).getSheetByName(prof.emergency.sheet), psh = ss_(y).getSheetByName(prof.pool.sheet);
    series.emergency = tsh.getRange(prof.emergency.row, prof.emergency.firstCol, 1, m).getValues()[0].map(num_);
    series.pool = psh.getRange(prof.pool.row, prof.pool.firstCol, 1, m).getValues()[0].map(num_);
    series.reserve = psh.getRange(prof.pool.row + 1, prof.pool.firstCol, 1, m).getValues()[0].map(num_);
  }
  const yearStart = mp.type === 'new' ? num_(v[mp.totalRow - 1][mp.firstCol - 2]) : 0;
  return { y: y, m: m, accounts: accounts, history: history.slice(0, m), prevTotal: prevTotal, yearStart: yearStart, series: series, target: CONFIG.emergencyTarget, lastYear: yearSeries_(y - 1) };
}

function saveMonthly_(a) {
  const y = +a.y, m = +a.m, prof = PROFILE[y];
  const sh = ss_(y).getSheetByName('滿月記帳');
  const col = prof.monthly.firstCol + m - 1;
  prof.monthly.accounts.forEach(function (acc) {
    if (!(acc.key in a.values)) return;
    const raw = a.values[acc.key];
    const val = raw === '' || raw === null ? '' : Math.round(num_(String(raw).replace(/,/g, '')));
    sh.getRange(acc.inputRow || acc.row, col).setValue(val);
  });
  SpreadsheetApp.flush();
  bumpVer_();
  return getMonthly_(y, m);
}

// ===== 10. 每日提醒（給 iPhone 捷徑的晚間自動化）=====
function dailyCheck_() {
  const s = todayStr_(), t = parseDate_(s);
  const msgs = [];
  const d = getDashboard_(s);
  const todayCount = readLedger_(t.y, t.m).filter(function (r) { return r.date === s; }).length;
  if (!todayCount) msgs.push('今天還沒記帳喔！');
  const dt = new Date(t.y, t.m - 1, t.d);
  const tomorrow = new Date(t.y, t.m - 1, t.d + 1);
  if (dt.getDay() === 0) {
    const tc = d.tips.filter(function (x) { return x.action === 'circle'; })[0];
    if (tc) msgs.push(tc.text);
  }
  if (tomorrow.getDay() === 0 && tomorrow.getDate() <= 7) msgs.push('明天是本月第一個主日，記得準備什一奉獻。');
  if (t.d === 5) msgs.push('明天 6 號扣卡費，請確認待繳戶餘額。');
  safe_(function () {
    const pp = getPrepaid_(t.y, t.m), tmr = addDaysStr_(s, 1);
    pp.due.forEach(function (x) {
      if (x.status === 'overdue') msgs.push('預扣繳費逾期：' + x.name + ' $' + fmt_(x.planned));
      else if (!x.paid && (x.dueDate === tmr || x.dueDate === s)) msgs.push((x.dueDate === s ? '今天' : '明天') + '到期：' + x.name + ' $' + fmt_(x.planned) + '（' + x.acct + '）');
    });
  });
  getDebts_(t.y).forEach(function (dbt) { if (dt.getDay() === 0 || t.d <= 6) msgs.push('待回補缺口：' + dbt.name + ' $' + fmt_(dbt.amount) + '，補上後請在 App 按「已補上」。'); });
  if (t.d <= 5 && !allocDoneAt_(t.y, t.m)) msgs.push('本月薪資分配還沒完成，請到 App「今日」頁查看各帳戶要轉多少。');
  if (d.daysLeft === 1) msgs.push('今天是月底，記得做滿月盤點。');
  msgs.push('本月還能花 $' + fmt_(d.left) + '｜明天可用約 $' + fmt_(d.daysLeft > 1 ? d.left / (d.daysLeft - 1) : d.left));
  return msgs.join('\n');
}

// ===== 12. 一次性修正：2026 年回補計算與預算連動（執行一次即可）=====
function 修正2026年回補與預算() {
  const ss = SpreadsheetApp.openById(CONFIG.files[2026]);
  const E = [
    ["收入", "B2", "=SUM(B4:B10)"],
    ["收入", "B11", "='總表'!C8"],
    ["總表", "C8", "='永豐銀行準備金定期定額'!B10+'郵局優存帳戶'!B9+'台銀帳戶(預扣及攤平)'!B37"],
    ["收入", "C2", "=SUM(C4:C10)"],
    ["收入", "C11", "='總表'!D8"],
    ["總表", "D8", "='永豐銀行準備金定期定額'!C10+'郵局優存帳戶'!C9+'台銀帳戶(預扣及攤平)'!C37"],
    ["收入", "D2", "=SUM(D4:D10)"],
    ["收入", "D11", "='總表'!E8"],
    ["總表", "E8", "='永豐銀行準備金定期定額'!D10+'郵局優存帳戶'!D9+'台銀帳戶(預扣及攤平)'!D37"],
    ["收入", "E2", "=SUM(E4:E10)"],
    ["收入", "E11", "='總表'!F8"],
    ["總表", "F8", "='永豐銀行準備金定期定額'!E10+'郵局優存帳戶'!E9+'台銀帳戶(預扣及攤平)'!E37"],
    ["收入", "F2", "=SUM(F4:F10)"],
    ["收入", "F11", "='總表'!G8"],
    ["總表", "G8", "='永豐銀行準備金定期定額'!F10+'郵局優存帳戶'!F9+'台銀帳戶(預扣及攤平)'!F37"],
    ["收入", "G2", "=SUM(G4:G10)"],
    ["收入", "G11", "='總表'!H8"],
    ["總表", "H8", "='永豐銀行準備金定期定額'!G10+'郵局優存帳戶'!G9+'台銀帳戶(預扣及攤平)'!G37"],
    ["收入", "H2", "=SUM(H4:H10)"],
    ["收入", "H11", "='總表'!I8"],
    ["總表", "I8", "='永豐銀行準備金定期定額'!H10+'郵局優存帳戶'!H9+'台銀帳戶(預扣及攤平)'!H37"],
    ["收入", "I2", "=SUM(I4:I10)"],
    ["收入", "I11", "='總表'!J8"],
    ["總表", "J8", "='永豐銀行準備金定期定額'!I10+'郵局優存帳戶'!I9+'台銀帳戶(預扣及攤平)'!I37"],
    ["收入", "J2", "=SUM(J4:J10)"],
    ["收入", "J11", "='總表'!K8"],
    ["總表", "K8", "='永豐銀行準備金定期定額'!J10+'郵局優存帳戶'!J9+'台銀帳戶(預扣及攤平)'!J37"],
    ["收入", "K2", "=SUM(K4:K10)"],
    ["收入", "K11", "='總表'!L8"],
    ["總表", "L8", "='永豐銀行準備金定期定額'!K10+'郵局優存帳戶'!K9+'台銀帳戶(預扣及攤平)'!K37"],
    ["收入", "L2", "=SUM(L4:L10)"],
    ["收入", "L11", "='總表'!M8"],
    ["總表", "M8", "='永豐銀行準備金定期定額'!L10+'郵局優存帳戶'!L9+'台銀帳戶(預扣及攤平)'!L37"],
    ["收入", "M2", "=SUM(M4:M10)"],
    ["收入", "M11", "='總表'!N8"],
    ["總表", "N8", "='永豐銀行準備金定期定額'!M10+'郵局優存帳戶'!M9+'台銀帳戶(預扣及攤平)'!M37"],
    ["收入", "A11", "內部回補（台銀／永豐／優存轉入日常戶，僅供參考，不計入收入；已計入各月「資金調度」）"],
    ["總表", "B8", " 準備金回補（永豐＋郵局優存＋台銀轉入日常戶）"],
    ["永豐銀行準備金定期定額", "L8", "=L10"],
    ["永豐銀行準備金定期定額", "M8", "=M10"],
    ["2026年11月", "E2", "='卡費'!L5-'台銀帳戶(預扣及攤平)'!K36"],
    ["總表", "M7", "='卡費'!L5-'台銀帳戶(預扣及攤平)'!K36"],
    ["2026年1月", "X11", "食物（下限後）"],
    ["2026年1月", "X12", "油料"],
    ["2026年1月", "X13", "娛樂（下限後）"],
    ["2026年1月", "X14", "其他（下限後）"],
    ["2026年1月", "X15", "仍超出可支配現金"],
    ["2026年1月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年1月", "Y12", "=E7"],
    ["2026年1月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年1月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年1月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年1月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年1月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年1月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年1月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年1月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年2月", "X11", "食物（下限後）"],
    ["2026年2月", "X12", "油料"],
    ["2026年2月", "X13", "娛樂（下限後）"],
    ["2026年2月", "X14", "其他（下限後）"],
    ["2026年2月", "X15", "仍超出可支配現金"],
    ["2026年2月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年2月", "Y12", "=E7"],
    ["2026年2月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年2月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年2月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年2月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年2月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年2月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年2月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年2月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年3月", "X11", "食物（下限後）"],
    ["2026年3月", "X12", "油料"],
    ["2026年3月", "X13", "娛樂（下限後）"],
    ["2026年3月", "X14", "其他（下限後）"],
    ["2026年3月", "X15", "仍超出可支配現金"],
    ["2026年3月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年3月", "Y12", "=E7"],
    ["2026年3月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年3月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年3月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年3月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年3月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年3月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年3月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年3月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年4月", "X11", "食物（下限後）"],
    ["2026年4月", "X12", "油料"],
    ["2026年4月", "X13", "娛樂（下限後）"],
    ["2026年4月", "X14", "其他（下限後）"],
    ["2026年4月", "X15", "仍超出可支配現金"],
    ["2026年4月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年4月", "Y12", "=E7"],
    ["2026年4月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年4月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年4月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年4月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年4月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年4月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年4月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年4月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年5月", "X11", "食物（下限後）"],
    ["2026年5月", "X12", "油料"],
    ["2026年5月", "X13", "娛樂（下限後）"],
    ["2026年5月", "X14", "其他（下限後）"],
    ["2026年5月", "X15", "仍超出可支配現金"],
    ["2026年5月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年5月", "Y12", "=E7"],
    ["2026年5月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年5月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年5月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年5月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年5月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年5月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年5月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年5月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年6月", "X11", "食物（下限後）"],
    ["2026年6月", "X12", "油料"],
    ["2026年6月", "X13", "娛樂（下限後）"],
    ["2026年6月", "X14", "其他（下限後）"],
    ["2026年6月", "X15", "仍超出可支配現金"],
    ["2026年6月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年6月", "Y12", "=E7"],
    ["2026年6月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年6月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年6月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年6月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年6月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年6月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年6月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年6月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年7月", "X11", "食物（下限後）"],
    ["2026年7月", "X12", "油料"],
    ["2026年7月", "X13", "娛樂（下限後）"],
    ["2026年7月", "X14", "其他（下限後）"],
    ["2026年7月", "X15", "仍超出可支配現金"],
    ["2026年7月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年7月", "Y12", "=E7"],
    ["2026年7月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年7月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年7月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年7月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年7月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年7月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年7月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年7月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年8月", "X11", "食物（下限後）"],
    ["2026年8月", "X12", "油料"],
    ["2026年8月", "X13", "娛樂（下限後）"],
    ["2026年8月", "X14", "其他（下限後）"],
    ["2026年8月", "X15", "仍超出可支配現金"],
    ["2026年8月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年8月", "Y12", "=E7"],
    ["2026年8月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年8月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年8月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年8月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年8月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年8月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年8月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年8月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年9月", "X11", "食物（下限後）"],
    ["2026年9月", "X12", "油料"],
    ["2026年9月", "X13", "娛樂（下限後）"],
    ["2026年9月", "X14", "其他（下限後）"],
    ["2026年9月", "X15", "仍超出可支配現金"],
    ["2026年9月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年9月", "Y12", "=E7"],
    ["2026年9月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年9月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年9月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年9月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年9月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年9月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年9月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年9月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年10月", "X11", "食物（下限後）"],
    ["2026年10月", "X12", "油料"],
    ["2026年10月", "X13", "娛樂（下限後）"],
    ["2026年10月", "X14", "其他（下限後）"],
    ["2026年10月", "X15", "仍超出可支配現金"],
    ["2026年10月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年10月", "Y12", "=E7"],
    ["2026年10月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年10月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年10月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年10月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年10月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年10月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年10月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年10月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年11月", "X11", "食物（下限後）"],
    ["2026年11月", "X12", "油料"],
    ["2026年11月", "X13", "娛樂（下限後）"],
    ["2026年11月", "X14", "其他（下限後）"],
    ["2026年11月", "X15", "仍超出可支配現金"],
    ["2026年11月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年11月", "Y12", "=E7"],
    ["2026年11月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年11月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年11月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年11月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年11月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年11月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年11月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年11月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2026年12月", "X11", "食物（下限後）"],
    ["2026年12月", "X12", "油料"],
    ["2026年12月", "X13", "娛樂（下限後）"],
    ["2026年12月", "X14", "其他（下限後）"],
    ["2026年12月", "X15", "仍超出可支配現金"],
    ["2026年12月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2026年12月", "Y12", "=E7"],
    ["2026年12月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2026年12月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2026年12月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2026年12月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2026年12月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2026年12月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2026年12月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2026年12月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"]
  ];
  E.forEach(function (e) {
    const sh = ss.getSheetByName(e[0]); if (!sh) throw new Error('找不到工作表：' + e[0]);
    const r = sh.getRange(e[1]);
    if (String(e[2]).charAt(0) === '=') r.setFormula(e[2]); else r.setValue(e[2]);
  });
  ss.getSheetByName('2026年11月').getRange('E2').setNote('11/6 帳單 21,345，其中 10,000 已於 10/30 由台銀直接代繳（台銀頁 10 月第 36 列），這裡只扣剩下的 11,345。');
  SpreadsheetApp.flush();
  bumpVer_();
  const n = ss.getSheetByName('2026年11月');
  Logger.log('完成！11 月可支配現金 = ' + Math.round(n.getRange('B4').getValue()) + '，實際預算 = ' + Math.round(n.getRange('H8').getValue()));
}

// ===== 13. 一次性調整：12 月台銀回補＋2027 年連動（執行一次即可）=====
function 套用12月台銀回補與2027年調整() {
  const s26 = SpreadsheetApp.openById(CONFIG.files[2026]);
  s26.getSheetByName('永豐銀行準備金定期定額').getRange('M10').setValue(5069).setNote('12 月永豐回補用到剛好 0（11 月底餘額 5,069）。');
  s26.getSheetByName('台銀帳戶(預扣及攤平)').getRange('M37').setValue(8476).setNote('12 月從台銀 B 帳戶轉入日常戶補足預算 25,000；2027 年 1 月起 App 提醒補回。');
  const s27 = SpreadsheetApp.openById(CONFIG.files[2027]);
  const E = [
    ["2027年1月", "X11", "食物（下限後）"],
    ["2027年1月", "X12", "油料"],
    ["2027年1月", "X13", "娛樂（下限後）"],
    ["2027年1月", "X14", "其他（下限後）"],
    ["2027年1月", "X15", "仍超出可支配現金"],
    ["2027年1月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年1月", "Y12", "=E7"],
    ["2027年1月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年1月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年1月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年1月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年1月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年1月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年1月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年1月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年2月", "X11", "食物（下限後）"],
    ["2027年2月", "X12", "油料"],
    ["2027年2月", "X13", "娛樂（下限後）"],
    ["2027年2月", "X14", "其他（下限後）"],
    ["2027年2月", "X15", "仍超出可支配現金"],
    ["2027年2月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年2月", "Y12", "=E7"],
    ["2027年2月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年2月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年2月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年2月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年2月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年2月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年2月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年2月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年3月", "X11", "食物（下限後）"],
    ["2027年3月", "X12", "油料"],
    ["2027年3月", "X13", "娛樂（下限後）"],
    ["2027年3月", "X14", "其他（下限後）"],
    ["2027年3月", "X15", "仍超出可支配現金"],
    ["2027年3月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年3月", "Y12", "=E7"],
    ["2027年3月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年3月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年3月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年3月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年3月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年3月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年3月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年3月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年4月", "X11", "食物（下限後）"],
    ["2027年4月", "X12", "油料"],
    ["2027年4月", "X13", "娛樂（下限後）"],
    ["2027年4月", "X14", "其他（下限後）"],
    ["2027年4月", "X15", "仍超出可支配現金"],
    ["2027年4月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年4月", "Y12", "=E7"],
    ["2027年4月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年4月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年4月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年4月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年4月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年4月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年4月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年4月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年5月", "X11", "食物（下限後）"],
    ["2027年5月", "X12", "油料"],
    ["2027年5月", "X13", "娛樂（下限後）"],
    ["2027年5月", "X14", "其他（下限後）"],
    ["2027年5月", "X15", "仍超出可支配現金"],
    ["2027年5月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年5月", "Y12", "=E7"],
    ["2027年5月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年5月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年5月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年5月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年5月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年5月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年5月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年5月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年6月", "X11", "食物（下限後）"],
    ["2027年6月", "X12", "油料"],
    ["2027年6月", "X13", "娛樂（下限後）"],
    ["2027年6月", "X14", "其他（下限後）"],
    ["2027年6月", "X15", "仍超出可支配現金"],
    ["2027年6月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年6月", "Y12", "=E7"],
    ["2027年6月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年6月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年6月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年6月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年6月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年6月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年6月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年6月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年7月", "X11", "食物（下限後）"],
    ["2027年7月", "X12", "油料"],
    ["2027年7月", "X13", "娛樂（下限後）"],
    ["2027年7月", "X14", "其他（下限後）"],
    ["2027年7月", "X15", "仍超出可支配現金"],
    ["2027年7月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年7月", "Y12", "=E7"],
    ["2027年7月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年7月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年7月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年7月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年7月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年7月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年7月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年7月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年8月", "X11", "食物（下限後）"],
    ["2027年8月", "X12", "油料"],
    ["2027年8月", "X13", "娛樂（下限後）"],
    ["2027年8月", "X14", "其他（下限後）"],
    ["2027年8月", "X15", "仍超出可支配現金"],
    ["2027年8月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年8月", "Y12", "=E7"],
    ["2027年8月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年8月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年8月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年8月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年8月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年8月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年8月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年8月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年9月", "X11", "食物（下限後）"],
    ["2027年9月", "X12", "油料"],
    ["2027年9月", "X13", "娛樂（下限後）"],
    ["2027年9月", "X14", "其他（下限後）"],
    ["2027年9月", "X15", "仍超出可支配現金"],
    ["2027年9月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年9月", "Y12", "=E7"],
    ["2027年9月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年9月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年9月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年9月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年9月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年9月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年9月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年9月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年10月", "X11", "食物（下限後）"],
    ["2027年10月", "X12", "油料"],
    ["2027年10月", "X13", "娛樂（下限後）"],
    ["2027年10月", "X14", "其他（下限後）"],
    ["2027年10月", "X15", "仍超出可支配現金"],
    ["2027年10月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年10月", "Y12", "=E7"],
    ["2027年10月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年10月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年10月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年10月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年10月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年10月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年10月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年10月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年11月", "X11", "食物（下限後）"],
    ["2027年11月", "X12", "油料"],
    ["2027年11月", "X13", "娛樂（下限後）"],
    ["2027年11月", "X14", "其他（下限後）"],
    ["2027年11月", "X15", "仍超出可支配現金"],
    ["2027年11月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年11月", "Y12", "=E7"],
    ["2027年11月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年11月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年11月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年11月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年11月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年11月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年11月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年11月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["2027年12月", "X11", "食物（下限後）"],
    ["2027年12月", "X12", "油料"],
    ["2027年12月", "X13", "娛樂（下限後）"],
    ["2027年12月", "X14", "其他（下限後）"],
    ["2027年12月", "X15", "仍超出可支配現金"],
    ["2027年12月", "Y11", "=ROUND(C7-MIN(Y10,MAX(0,C7-'選單'!$H$2)),0)"],
    ["2027年12月", "Y12", "=E7"],
    ["2027年12月", "Y13", "=ROUND(F7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,F7-'選單'!$H$3)/Y9,0),0)"],
    ["2027年12月", "Y14", "=ROUND(G7-IF(Y9>0,MIN(Y8,Y9)*MAX(0,G7-'選單'!$H$4)/Y9,0),0)"],
    ["2027年12月", "Y15", "=MAX(0,B8+D8+SUM(Y11:Y14)-$B$4)"],
    ["2027年12月", "C8", "=MAX(0,ROUND(Y11-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y11/SUM($Y$11:$Y$14),0),0))"],
    ["2027年12月", "E8", "=MAX(0,ROUND(Y12-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y12/SUM($Y$11:$Y$14),0),0))"],
    ["2027年12月", "F8", "=MAX(0,ROUND(Y13-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y13/SUM($Y$11:$Y$14),0),0))"],
    ["2027年12月", "G8", "=MAX(0,ROUND(Y14-IF(SUM($Y$11:$Y$14)>0,$Y$15*Y14/SUM($Y$11:$Y$14),0),0))"],
    ["2027年12月", "I8", "預算一定≤可支配現金：先刪教育→娛樂/其他刪到下限→食物刪到下限→仍不足時，食物/油料/娛樂/其他依比例縮減（奉獻不動）"],
    ["選單", "H8", 31],
    ["選單", "H12", 40054],
    ["選單", "H9", 78000],
    ["郵局優存帳戶", "B4", 3147],
    ["選單", "G8", "① 2026年底郵局日常戶結餘（實際，年底請再核對）"],
    ["選單", "G12", "① 2026年底轉入永豐（永豐0＋台銀42,054−留2,000＝40,054，年底請再核對）"],
    ["選單", "G16", "待回補缺口（App 從開始月份起每天提醒，按「已補上」即停止）"],
    ["選單", "G17", "項目"],
    ["選單", "H17", "金額"],
    ["選單", "I17", "開始提醒"],
    ["選單", "J17", "已補上日期"],
    ["選單", "G18", "2026/12 向台銀 B 帳戶借用補 12 月生活費（2 月獎金入帳時隨永豐存入補回稅保專款）"],
    ["選單", "H18", 8476],
    ["選單", "I18", "2027-01"],
    ["選單", "J18", ""]
  ];
  E.forEach(function (e) {
    const sh = s27.getSheetByName(e[0]); if (!sh) throw new Error('找不到工作表：' + e[0]);
    const r = sh.getRange(e[1]);
    if (String(e[2]).charAt(0) === '=') r.setFormula(e[2]); else r.setValue(e[2]);
  });
  const menu = s27.getSheetByName('選單');
  menu.getRange('I18').setNumberFormat('@').setValue('2027-01');
  menu.getRange('G16:J16').setFontWeight('bold');
  menu.getRange('G17:J17').setFontWeight('bold').setBackground('#EBDEF0');
  SpreadsheetApp.flush();
  bumpVer_();
  const d26 = s26.getSheetByName('2026年12月'), t27 = s27.getSheetByName('總表');
  Logger.log('完成！2026 年 12 月可支配現金 = ' + Math.round(d26.getRange('B4').getValue()) + '；2027 年緊急備用金 2 月鎖入 = ' + t27.getRange('D10').getValue() + '；2027 驗算：' + t27.getRange('O50').getValue());
}

// ===== 14. 檢查 App 連到哪兩份試算表 =====
function 檢查連線的試算表() {
  [2026, 2027].forEach(function (y) {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.files[y]);
      Logger.log(y + ' 年：「' + ss.getName() + '」');
      Logger.log('   網址：' + ss.getUrl());
      if (y === 2026) {
        const n = ss.getSheetByName('2026年11月');
        Logger.log('   11月 可支配現金 B4 = ' + Math.round(n.getRange('B4').getValue()) + '，實際預算 H8 = ' + Math.round(n.getRange('H8').getValue()) + '，E2 公式 = ' + n.getRange('E2').getFormula());
        Logger.log('   收入 A11 = ' + ss.getSheetByName('收入').getRange('A11').getValue());
      } else {
        const m = ss.getSheetByName('選單');
        Logger.log('   選單 H8 = ' + m.getRange('H8').getValue() + '，H12 = ' + m.getRange('H12').getValue() + '，H9 = ' + m.getRange('H9').getValue() + '，G16 = ' + m.getRange('G16').getValue());
      }
    } catch (e) { Logger.log(y + ' 年：打不開（' + e.message + '）'); }
  });
  Logger.log('請比對上面的網址，和你平常打開的試算表網址是否相同（/d/ 後面那一串）。');
}


// ===== 11. App 畫面（內嵌，不需要另外的 HTML 檔）=====
const APP_HTML = String.raw`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<base target="_top">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<script>(function(){try{var t=localStorage.getItem('kakeiboTheme');if(!t){t=(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();</script>
<style>
:root{--bg:#F3F5F8;--card:#FFFFFF;--ink:#1B2430;--sub:#5B6675;--line:#E4E8EE;--blue:#2458C6;--blueSoft:#E6EDFB;--blueInk:#1A3F8F;
--red:#B42318;--redSoft:#FBE9E7;--redInk:#8A1C12;--green:#1E7A4C;--greenSoft:#E3F4EA;--amber:#C77700;--amberSoft:#FFF4D6;--amberInk:#7A4B00;
--orange:#D9822B;--gray:#8A94A3;--main:#2458C6;--soft:#E6EDFB;--tint:#1A3F8F;
--chip:#EEF1F5;--line2:var(--line2);--toast:#1B2430;--toastInk:#FFFFFF;--overSoft:#FDE8E6;--greenInk:#145A37;--onMain:#FFFFFF;--cardC:#EAB308;--cardInk:#8A5A00;--cardOn:#1B2430;color-scheme:light}
html[data-theme="dark"]{color-scheme:dark;--bg:#0F1419;--card:#1A2129;--ink:#E6EAF0;--sub:#9AA5B4;--line:#2A323D;--line2:#3A4452;--chip:#252D37;
--blue:#5B8DEF;--blueSoft:#1D2C4A;--blueInk:#A9C2F7;--red:#E5675C;--redSoft:#3B2220;--redInk:#F4ADA5;--green:#35A26A;--greenSoft:#17332A;--greenInk:#8FE0B5;
--amber:#E0A030;--amberSoft:#3A2E14;--amberInk:#F2C46D;--orange:#E59A50;--gray:#7D8796;--main:#5B8DEF;--soft:#1D2C4A;--tint:#A9C2F7;
--toast:#E6EAF0;--toastInk:#0F1419;--overSoft:#3B2220;--onMain:#0B1016;--cardC:#F2C230;--cardInk:#F6D77A;--cardOn:#0B1016}
html[data-theme="dark"] svg text[fill="#1B2430"]{fill:var(--ink)}
html[data-theme="dark"] svg text[fill="#5B6675"]{fill:var(--sub)}
html[data-theme="dark"] svg text[fill="#7A4B00"]{fill:var(--amberInk)}
html[data-theme="dark"] svg line[stroke="#EEF1F5"],html[data-theme="dark"] svg line[stroke="#E4E8EE"]{stroke:var(--line)}
html[data-theme="dark"] svg [stroke="#fff"]{stroke:var(--card)}
html[data-theme="dark"] svg circle[fill="#fff"]{fill:var(--card)}
html[data-theme="dark"] svg [fill="#2458C6"]{fill:#5B8DEF} html[data-theme="dark"] svg [stroke="#2458C6"]{stroke:#5B8DEF}
html[data-theme="dark"] svg [fill="#B42318"]{fill:#E5675C} html[data-theme="dark"] svg [fill="#EAB308"]{fill:#F2C230} html[data-theme="dark"] svg [stroke="#B42318"]{stroke:#E5675C}
html[data-theme="dark"] svg [fill="#1E7A4C"]{fill:#35A26A} html[data-theme="dark"] svg [stroke="#1E7A4C"]{stroke:#35A26A}
html[data-theme="dark"] svg [fill="#C77700"]{fill:#E0A030} html[data-theme="dark"] svg [stroke="#C77700"]{stroke:#E0A030}
html[data-theme="dark"] svg [stroke="#1B2430"]{stroke:var(--ink)}
html[data-theme="dark"] svg [fill="#B8C0CC"]{fill:#56606E} html[data-theme="dark"] svg [stroke="#B8C0CC"]{stroke:#6A7482}
html[data-theme="dark"] svg [stroke="#8A94A3"]{stroke:#7D8796} html[data-theme="dark"] svg [fill="#8A94A3"]{fill:#7D8796}
html[data-theme="dark"] .legend b[style*="#1B2430"]{background:var(--ink)!important}
html[data-theme="dark"] .legend b[style*="#2458C6"]{background:#5B8DEF!important}
html[data-theme="dark"] .legend b[style*="#B42318"]{background:#E5675C!important}
html[data-theme="dark"] .legend b[style*="#EAB308"]{background:#F2C230!important}
html[data-theme="dark"] .legend b[style*="#1E7A4C"]{background:#35A26A!important}
html,body,.card,.chip,nav#nav,.list,.chartbox,aside#v-entry,#modal .box,.keys button,input,select{transition:background-color .2s,color .2s,border-color .2s}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;background:var(--bg);color:var(--ink);font-family:'Noto Sans TC','PingFang TC',system-ui,sans-serif;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
button{font-family:inherit;font-size:inherit;color:inherit}
input,select,textarea{font-family:inherit;font-size:16px!important;color:inherit}
button{cursor:pointer}
.app{height:100%;height:var(--app-h,100%);display:flex;flex-direction:column}
main{flex:1;min-width:0;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;order:1}
.app.entry-mode main{display:none}
aside#v-entry{order:2}
aside#v-entry.active{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch}
.view{display:none;padding:16px;padding-top:calc(14px + env(safe-area-inset-top));width:100%;max-width:100%;overflow-x:hidden}
.view.active{display:block}
h1{font-size:22px;margin:0}
.sub{color:var(--sub);font-size:13px}
.card{background:var(--card);border-radius:18px;padding:14px 16px;margin-bottom:12px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.col{display:flex;flex-direction:column;gap:4px}
.big{font-size:30px;font-weight:700}
.mid{font-size:24px;font-weight:700}
.chip{height:44px;padding:0 14px;border-radius:22px;border:1px solid var(--line2);background:var(--card);white-space:nowrap;flex-shrink:0}
.chip.on{border:none;background:var(--main,var(--blue));color:var(--onMain);font-weight:700}
.tag{font-size:12px;font-weight:700;padding:4px 10px;border-radius:12px;white-space:nowrap}
.ok{color:var(--green)} .okbg{background:var(--greenSoft)}
.fast{color:var(--amberInk)} .fastbg{background:var(--amberSoft)}
.over{color:var(--red)} .overbg{background:var(--overSoft)}
.done{color:var(--sub)} .donebg{background:var(--chip)}
.bar{height:10px;border-radius:5px;background:var(--line);display:flex;overflow:hidden}
.bar i{display:block;height:100%}
.bar .c{background:var(--blue)} .bar .k{background:var(--cardC)}
.grid2,.grid3{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}
.grid2>*,.grid3>*{min-width:0}
.card{min-width:0;max-width:100%}
.items{max-width:100%;min-width:0;scrollbar-width:none}
.items::-webkit-scrollbar{display:none}
.chartbox{width:100%}
svg{max-width:100%}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--sub)}
.legend span{display:flex;align-items:center;gap:4px}
.legend b{display:inline-block;width:14px;height:3px}
.navbtn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:none;background:none;color:var(--sub);font-size:11px;min-height:56px}
.navbtn.on{color:var(--blue);font-weight:700}
nav#nav{order:3;flex-shrink:0;background:var(--card);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(5,1fr);padding-bottom:env(safe-area-inset-bottom);z-index:5}
.iconbtn{width:44px;height:44px;border-radius:22px;border:1px solid var(--line2);background:var(--card);display:flex;align-items:center;justify-content:center}
.list{background:var(--card);border-radius:16px;overflow:hidden;margin-bottom:12px}
.li{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--chip)}
.li:last-child{border-bottom:none}
.flag{background:var(--overSoft)}
.amt-c{color:var(--blue);font-weight:700} .amt-k{color:var(--cardInk);font-weight:700}
.tip{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5;margin-top:10px}
.loading{color:var(--sub);text-align:center;padding:40px 0}
#toast{position:fixed;left:16px;right:16px;top:calc(12px + env(safe-area-inset-top));background:var(--toast);color:var(--toastInk);border-radius:14px;padding:12px 16px;font-size:15px;display:none;z-index:20}
#modal{position:fixed;inset:0;background:rgba(27,36,48,.4);display:none;align-items:flex-start;justify-content:center;padding-top:60px;z-index:15}
#modal .box{background:var(--card);border-radius:20px;padding:16px;width:min(380px,92vw);display:flex;flex-direction:column;gap:12px;max-height:85vh;overflow:auto}
input.f,select.f{height:44px;border-radius:12px;border:1px solid var(--line2);padding:0 12px;width:100%;background:var(--card)}
/* 記帳 */
.entry{--main:var(--blue);--soft:var(--blueSoft);--tint:var(--blueInk);--fillC:#C9D8F6;--pendC:#A9C1F2;--overC:#E58A80;--overP:#F4BDB6}
.entry.pre-mode{--main:var(--green);--soft:var(--greenSoft);--tint:var(--greenInk);--onMain:#FFFFFF}
html[data-theme="dark"] .entry.pre-mode{--onMain:#0B1016}
.seg.preb.on{border:none;background:var(--green);color:var(--onMain);font-weight:700}
html[data-theme="dark"] .seg.preb.on{color:#0B1016}
.ppgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.chip.pp{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:0 12px;font-size:13px;text-align:left;min-width:0}
.chip.pp span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip.pp em{font-style:normal;font-size:12px;opacity:.85;flex-shrink:0}
.chip.pp.due{border-color:var(--green)}
.chip.pp.late{border:2px solid var(--red)}
.chip.pp.late em{color:var(--red);font-weight:700}
.chip.pp.paid{opacity:.6}
.chip.pp.on{opacity:1}
.qbar{display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--amberSoft);color:var(--amberInk);border-radius:12px;padding:8px 12px;margin-bottom:10px;font-size:13px;font-weight:500}
.entry.card-mode{--main:var(--cardC);--soft:#FEF6D8;--tint:#7A5300;--fillC:#FBE3A0;--pendC:#F6D27A;--overC:#B42318;--overP:#F4BDB6;--onMain:var(--cardOn)}
html[data-theme="dark"] .entry{--fillC:#2A4373;--pendC:#314F8A;--overC:#E5675C;--overP:#6B2E29}
html[data-theme="dark"] .entry.card-mode{--soft:#3A3110;--tint:#F6D77A;--fillC:#5E4A12;--pendC:#735C16;--overC:#F4ADA5;--overP:#6B2E29}
.seg{height:48px;border-radius:14px;border:1px solid var(--line2);background:var(--card);color:var(--sub);font-size:16px}
.seg.cash.on{border:none;background:var(--blue);color:var(--onMain);font-weight:700}
.seg.cardb.on{border:none;background:var(--cardC);color:var(--cardOn);font-weight:700}
.amount{position:relative;overflow:hidden;background:var(--soft);border:2px solid var(--main);border-radius:18px;padding:10px 18px;margin:10px 0}
.amount>*{position:relative;z-index:1}
.amount .fill,.amount .pend{position:absolute;top:0;bottom:0;left:0;z-index:0;transition:width .25s}
.amount .fill{background:var(--fillC)}
.amount .fill.over{background:var(--overC);opacity:.45}
.amount .pend{background:var(--pendC);box-shadow:inset 2px 0 0 var(--main)}
.amount .pend.over{background:var(--overP);box-shadow:inset 2px 0 0 var(--red)}
.amount .tick{position:absolute;top:0;bottom:0;width:2px;background:var(--tint);opacity:.55;z-index:0}
.binfo{font-size:12px;color:var(--tint);line-height:1.5;margin-top:2px}
.binfo b{font-weight:700}
.binfo .warn{color:var(--red);font-weight:700}
.amount .v{font-size:40px;font-weight:700;color:var(--tint);text-align:right}
.keys{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
.keys button{height:48px;border-radius:14px;border:none;background:var(--card);font-size:22px}
.keys button.op{background:var(--soft);color:var(--tint);font-weight:700}
.keys button.eq{background:var(--main);color:var(--onMain);font-weight:700}
.keys button.w2{grid-column:span 2}
.expr{font-size:14px;color:var(--tint);text-align:right;min-height:18px;word-break:break-all}
.calcbox{--main:var(--green);--soft:var(--greenSoft);--tint:var(--greenInk)}
.calcbox .keys button{background:var(--bg)}
.calcbox .keys button.op{background:var(--soft)}
.calcbox .keys button.eq{background:var(--main)}
.calcbtn{width:40px;height:40px;border-radius:10px;border:1px solid var(--line2);background:var(--card);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.submit{width:100%;height:52px;border-radius:16px;border:none;background:var(--main);color:var(--onMain);font-size:17px;font-weight:700;margin-top:10px}
.cats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.cats .chip{padding:0}
.items{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}
.datebtn{height:44px;padding:0 14px;border-radius:22px;border:1px solid var(--line2);background:var(--card);font-size:14px}
.datebtn.past{border:2px solid var(--amber);background:var(--amberSoft);color:var(--amberInk);font-weight:700}
.lbl{font-size:12px;color:var(--sub);font-weight:500;margin:10px 0 6px}
@media (min-width:700px){
  .grid2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid3{grid-template-columns:repeat(3,minmax(0,1fr))}
  .view{padding:20px 24px}
}
@media (min-width:1000px){
  .app{display:grid;grid-template-columns:96px minmax(0,1fr) 360px;grid-template-rows:100%}
  .app.entry-mode main{display:block}
  nav#nav{order:0;height:100%;grid-template-columns:1fr;grid-auto-rows:72px;align-content:start;padding-top:20px;border-top:none;border-right:1px solid var(--line)}
  nav#nav .navbtn{font-size:12px;margin:0 12px;border-radius:16px}
  nav#nav .navbtn.on{background:var(--blueSoft)}
  nav#nav .nav-entry{display:none}
  aside#v-entry{display:block!important;height:100%;overflow-y:auto;background:var(--card);border-left:1px solid var(--line)}
  aside#v-entry .keys button{background:var(--bg)}
  .wide-only{display:block!important}
}
.wide-only{display:none}
.nav-theme{display:none}
@media (min-width:1000px){nav#nav .nav-theme{display:flex}}
.chartbox{position:relative;height:260px;overflow:hidden;touch-action:pan-y;border-radius:12px;background:var(--card)}
.chartbox.zoomed{touch-action:none;outline:2px solid var(--blueSoft)}
.zoomer{width:100%;height:100%;transform-origin:0 0;will-change:transform}
.zoomer svg{display:block}
.zoomctl{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
.zoomctl button{min-width:40px;height:32px;padding:0 10px;border-radius:16px;border:1px solid var(--line2);background:var(--card);font-size:15px;line-height:1;color:var(--sub)}
.ccap{min-height:58px;margin-top:8px}
.cdots{display:flex;justify-content:center;gap:5px;margin-top:6px}
.cdots i{display:block;width:6px;height:6px;border-radius:3px;background:#C9D0DA;transition:width .15s}
.cdots i.on{width:18px;background:var(--blue)}
.dim{opacity:.45;pointer-events:none;transition:opacity .15s}
</style>
</head>
<body>
<div class="app" id="app">
  <nav id="nav">
    <button class="navbtn nav-entry" data-view="entry"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>記帳</button>
    <button class="navbtn" data-view="today"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 11l8-7 8 7v9H4z"/></svg>今日</button>
    <button class="navbtn" data-view="charts"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>圖表</button>
    <button class="navbtn" data-view="records"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>紀錄</button>
    <button class="navbtn" data-view="assets"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16v12H4z"/><path d="M8 8V5h8v3M16 14h2"/></svg>資產</button>
      <button class="navbtn nav-theme" data-act="theme" aria-label="切換深色/淺色"><span class="ti" style="display:flex"></span>外觀</button>
  </nav>
  <main>
    <section class="view" id="v-today"></section>
    <section class="view" id="v-charts"></section>
    <section class="view" id="v-cat"></section>
    <section class="view" id="v-records"></section>
    <section class="view" id="v-assets"></section>
  </main>
  <aside class="view entry" id="v-entry"></aside>
</div>
<div id="toast"></div>
<div id="modal"><div class="box" id="modalBox"></div></div>

<script>
const TOKEN = <?!= JSON.stringify(token) ?>;
const S = { view: 'entry', form: null, dash: null, chartYM: null, catYM: null, cat: null, recYM: null, recFilter: '全部', recSearch: '', assetYM: null,
  e: { amt: '', cat: '食物', item: '', custom: false, customText: '', pay: '現金', date: null } };

// ---------- 工具 ----------
function call(method, args) {
  return new Promise(function (res, rej) {
    google.script.run.withSuccessHandler(res).withFailureHandler(function (e) { rej(e); }).api(TOKEN, method, args || {});
  });
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
function fmt(n) { return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function money(n) { return (n < 0 ? '−$' : '$') + fmt(Math.abs(n)); }
function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
function $(id) { return document.getElementById(id); }
function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._h); toast._h = setTimeout(function () { t.style.display = 'none'; }, ms || 2600); }
function err(e) { toast('發生錯誤：' + (e && e.message ? e.message : e), 4000); }
function ymAdd(ym, k) { let y = ym.y, m = ym.m + k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return { y: y, m: m }; }
function todayYM() { const d = S.form ? S.form.today : new Date().toISOString().slice(0, 10); return { y: +d.slice(0, 4), m: +d.slice(5, 7) }; }
function wk(dateStr) { const d = new Date(dateStr + 'T00:00:00'); return '日一二三四五六'.charAt(d.getDay()); }
function md(dateStr) { return (+dateStr.slice(5, 7)) + '/' + (+dateStr.slice(8, 10)); }
function addDays(dateStr, k) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const PACE = { ok: ['正常', 'ok'], fast: ['偏快', 'fast'], over: ['警戒', 'over'], done: ['已完成', 'done'] };
function bar(cash, card, base) {
  if (!base) base = Math.max(cash + card, 1);
  const c = Math.min(cash / base, 1) * 100, k = Math.min(card / base, Math.max(0, 1 - cash / base)) * 100;
  return '<div class="bar"><i class="c" style="width:' + c.toFixed(1) + '%"></i><i class="k" style="width:' + k.toFixed(1) + '%"></i></div>';
}
function splitText(cash, card) { const a = []; if (cash) a.push('現金 $' + fmt(cash)); if (card) a.push('刷卡 $' + fmt(card)); return a.join('｜') || '本月尚無花費'; }
function swipe(el, onLeft, onRight) {
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) { dx < 0 ? onLeft() : onRight(); }
    x0 = null;
  });
}
function niceMax(v) { if (v <= 0) return 1000; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * p; }
function lineChart(cv, budget, opts) {
  opts = opts || {};
  const W = 360, H = 190, X0 = 38, X1 = 350, Y0 = 160, Y1 = 16, days = 31;
  const all = [].concat(cv.cur || [], cv.prev || [], cv.last || [], [budget || 0]);
  const ymax = niceMax(Math.max.apply(null, all.concat([1])) * 1.05);
  const X = function (i) { return X0 + i / (days - 1) * (X1 - X0); }, Y = function (v) { return Y0 - v / ymax * (Y0 - Y1); };
  const pl = function (arr) { return arr.map(function (v, i) { return X(i).toFixed(0) + ',' + Y(v).toFixed(0); }).join(' '); };
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(opts.aria || '累計花費曲線') + '">';
  [0, 0.5, 1].forEach(function (f) { const yy = Y(ymax * f); s += '<line x1="' + X0 + '" y1="' + yy + '" x2="' + X1 + '" y2="' + yy + '" stroke="#EEF1F5"/><text x="0" y="' + (yy + 4) + '" font-size="10" fill="#5B6675">' + (ymax * f >= 10000 ? (ymax * f / 10000) + '萬' : fmt(ymax * f)) + '</text>'; });
  if (budget) s += '<polyline points="' + X0 + ',' + Y0 + ' ' + X(29).toFixed(0) + ',' + Y(budget).toFixed(0) + '" fill="none" stroke="#B8C0CC" stroke-width="2" stroke-dasharray="5 4"/>';
  if (cv.last && cv.last.length) s += '<polyline points="' + pl(cv.last) + '" fill="none" stroke="#8A94A3" stroke-width="2"/>';
  if (cv.prev && cv.prev.length) s += '<polyline points="' + pl(cv.prev) + '" fill="none" stroke="#D9822B" stroke-width="2"/>';
  if (cv.cur && cv.cur.length) {
    s += '<polyline points="' + pl(cv.cur) + '" fill="none" stroke="#2458C6" stroke-width="3.5" stroke-linejoin="round"/>';
    const i = cv.cur.length - 1, v = cv.cur[i];
    s += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="4.5" fill="#2458C6"/><text x="' + Math.min(X(i) + 8, 300) + '" y="' + (Y(v) - 8) + '" font-size="11" font-weight="700" fill="#1B2430">$' + fmt(v) + '</text>';
  }
  s += '<text x="' + (X0 - 4) + '" y="180" font-size="10" fill="#5B6675">1日</text><text x="' + (X(14) - 8) + '" y="180" font-size="10" fill="#5B6675">15日</text><text x="' + (X1 - 22) + '" y="180" font-size="10" fill="#5B6675">31日</text></svg>';
  return s;
}
function legend(cv, budget) {
  return '<div class="legend"><span><b style="background:#2458C6"></b>本月</span>' +
    (cv.prev ? '<span><b style="background:#D9822B"></b>上月（' + esc(cv.prevLabel) + '）</span>' : '') +
    (cv.last ? '<span><b style="background:#8A94A3"></b>去年同期（' + esc(cv.lastLabel) + '）</span>' : '') +
    (budget ? '<span><b style="height:0;border-top:2px dashed #B8C0CC"></b>預算 $' + fmt(budget) + '</span>' : '') + '</div>';
}
const ICON = {
  warn: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C77700" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  ok: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1E7A4C" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><path d="M5 12l5 5 9-10"/></svg>',
  info: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2458C6" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>',
  book: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1E7A4C" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M12 7v6M9 10h6"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
};
function monthHeader(ym, prefix, sub) {
  return '<div class="row" style="margin-bottom:12px"><button class="iconbtn" data-act="' + prefix + '-prev" aria-label="上個月">' + ICON.left + '</button>' +
    '<div class="col" style="align-items:center"><h1>' + ym.y + '年' + ym.m + '月</h1><span class="sub">' + (sub || '按左右按鈕切換月份') + '</span></div>' +
    '<button class="iconbtn" data-act="' + prefix + '-next" aria-label="下個月">' + ICON.right + '</button></div>';
}

// ---------- 計算機 ----------
const OPS = '+−×÷';
function evalExpr(str) {
  const src = String(str || '').replace(/,/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  if (!src) return 0;
  if (!/^[0-9+\-*/().]+$/.test(src)) return NaN;
  let i = 0;
  function num() {
    const st = i; while (i < src.length && /[0-9.]/.test(src[i])) i++;
    if (st === i) throw 0; const v = parseFloat(src.slice(st, i)); if (isNaN(v)) throw 0; return v;
  }
  function factor() {
    if (src[i] === '-') { i++; return -factor(); }
    if (src[i] === '(') { i++; const v = expr(); if (src[i] !== ')') throw 0; i++; return v; }
    return num();
  }
  function term() { let v = factor(); while (src[i] === '*' || src[i] === '/') { const o = src[i++]; const r = factor(); v = o === '*' ? v * r : v / r; } return v; }
  function expr() { let v = term(); while (src[i] === '+' || src[i] === '-') { const o = src[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  try { const v = expr(); if (i !== src.length || !isFinite(v)) return NaN; return Math.round(v * 100) / 100; } catch (e) { return NaN; }
}
function hasOp(x) { return /[+−×÷]/.test(String(x).slice(1)); }
function pressKey(expr, k) {
  expr = String(expr || '');
  if (k === 'C') return '';
  if (k === '⌫') return expr.slice(0, -1);
  if (k === '=') { const v = evalExpr(expr); return isNaN(v) ? expr : String(Math.round(v)); }
  if (OPS.indexOf(k) >= 0) {
    if (!expr) return k === '−' ? '−' : '';
    if (OPS.indexOf(expr.slice(-1)) >= 0) return expr.slice(0, -1) + k;
    return expr + k;
  }
  return (expr + k).replace(/(^|[+−×÷])0+(?=\d)/g, '$1').slice(0, 30);
}
function keypadHTML(act) {
  const rows = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '00', '0', '⌫', '+'];
  return '<div class="keys">' + rows.map(function (k) {
    return '<button data-act="' + act + '" data-v="' + k + '" class="' + (OPS.indexOf(k) >= 0 ? 'op' : '') + '"' + (k === '⌫' ? ' aria-label="刪除"' : '') + '>' + k + '</button>';
  }).join('') + '<button data-act="' + act + '" data-v="C" class="w2 op">C 清除</button><button data-act="' + act + '" data-v="=" class="w2 eq">＝ 計算</button></div>';
}
function exprDisplay(expr) {
  const v = evalExpr(expr);
  return { big: !expr ? '0' : (isNaN(v) ? '…' : fmt(v)), small: hasOp(expr) ? expr + ' =' : '' };
}

// ---------- 本機暫存（開啟時先顯示上次資料）----------
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
S.monthCache = {}; S.recCache = {}; S.assetCache = {};
function fresh(entry, ms) { return entry && (Date.now() - entry.t) < ms; }
function prefetch() {
  const ym = todayYM(), key = ym.y + '-' + ym.m;
  if (!S.monthCache[key]) call('month', ym).then(function (d) { S.monthCache[key] = { t: Date.now(), d: d }; }).catch(function () {});
  if (!S.recCache[key]) call('records', ym).then(function (d) { S.recCache[key] = { t: Date.now(), d: d }; }).catch(function () {});
}
function clearCaches() { S.monthCache = {}; S.recCache = {}; S.assetCache = {}; S.trendCache = {}; S.catMoreCache = {}; }

// ---------- 深色模式 ----------
const MOON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const SUN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
function curTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
function themeIcon() { return curTheme() === 'dark' ? SUN : MOON; }
function themeLabel() { return curTheme() === 'dark' ? '切換成淺色' : '切換成深色'; }
function applyTheme(t, save) {
  document.documentElement.setAttribute('data-theme', t);
  if (save) { try { localStorage.setItem('kakeiboTheme', t); } catch (e) {} }
  const mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.setAttribute('content', t === 'dark' ? '#0F1419' : '#F3F5F8');
  document.querySelectorAll('[data-act="theme"]').forEach(function (b) { b.setAttribute('aria-label', themeLabel()); const ic = b.querySelector('.ti'); if (ic) ic.innerHTML = themeIcon(); });
}
function themeBtn(size) { return '<button class="iconbtn" data-act="theme" aria-label="' + themeLabel() + '" style="width:' + size + 'px;height:' + size + 'px;flex-shrink:0"><span class="ti" style="display:flex">' + themeIcon() + '</span></button>'; }
document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('[data-act="theme"]')) { applyTheme(curTheme() === 'dark' ? 'light' : 'dark', true); toast(curTheme() === 'dark' ? '已切換成深色' : '已切換成淺色', 1200); }
});
try {
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (ev) {
    let saved = null; try { saved = localStorage.getItem('kakeiboTheme'); } catch (e) {}
    if (!saved) applyTheme(ev.matches ? 'dark' : 'light', false);
  });
} catch (e) {}
applyTheme(curTheme(), false);

// ---------- 導覽 ----------
function resetScroll() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const m = document.querySelector('main'); if (m) { m.scrollTop = 0; m.scrollLeft = 0; }
  const a = $('v-entry'); if (a) { a.scrollTop = 0; a.scrollLeft = 0; }
  document.querySelectorAll('.view').forEach(function (v) { v.scrollLeft = 0; });
  window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
}
// 不允許內容區左右偏移
(function () { const m = document.querySelector('main'); if (m) m.addEventListener('scroll', function () { if (m.scrollLeft) m.scrollLeft = 0; }); })();
// 轉向（橫↔直）後重新貼合螢幕高度並歸位
function fitViewport() {
  const h = (window.visualViewport && window.visualViewport.scale === 1 ? window.visualViewport.height : window.innerHeight);
  document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
  const m = document.querySelector('main'); if (m) m.scrollLeft = 0;
}
fitViewport();
window.addEventListener('resize', fitViewport);
window.addEventListener('orientationchange', function () { fitViewport(); setTimeout(fitViewport, 250); setTimeout(fitViewport, 700); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { clearTimeout(fitViewport._t); fitViewport._t = setTimeout(fitViewport, 120); });
// 鍵盤收起後讓畫面歸位（iPhone）
document.addEventListener('focusout', function () { setTimeout(function () { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }, 60); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (window.visualViewport.height >= window.innerHeight - 1) window.scrollTo(0, 0); });
function show(view) {
  S.view = view;
  document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
  const target = view === 'cat' ? 'v-cat' : 'v-' + view;
  $(target).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(function (b) { b.classList.toggle('on', b.dataset.view === (view === 'cat' ? 'charts' : view)); });
  document.getElementById('app').classList.toggle('entry-mode', view === 'entry');
  resetScroll();
  if (view === 'today') loadToday();
  if (view === 'charts') loadCharts();
  if (view === 'records') loadRecords();
  if (view === 'assets') loadAssets();
}
$('nav').addEventListener('click', function (e) { const b = e.target.closest('.navbtn'); if (b && b.dataset.view) show(b.dataset.view); });

// ---------- 記帳 ----------
function catBudgetInfo() {
  const d = S.dash, E = S.e;
  if (!d || !d.cats) return null;
  const sameMonth = +E.date.slice(0, 4) === d.y && +E.date.slice(5, 7) === d.m;
  if (!sameMonth) return { other: true };
  const c = d.cats.filter(function (x) { return x.name === E.cat; })[0];
  if (!c) return null;
  const v = evalExpr(E.amt), add = isNaN(v) ? 0 : Math.max(0, v);
  const isToday = S.form && E.date === S.form.today;
  const rem = c.budget - c.total, after = rem - add;
  const todayLeft = (c.allowance != null ? c.allowance : 0) - (c.today || 0);
  const daysAfter = Math.max(1, (d.daysLeft || 1) - 1);
  return { c: c, add: add, rem: rem, after: after, isToday: isToday,
           allowance: c.allowance || 0, today: c.today || 0, todayLeft: todayLeft, todayAfter: todayLeft - (isToday ? add : 0),
           nextAllowance: Math.max(0, rem - (isToday ? add : 0)) / daysAfter,
           usedPct: c.budget ? Math.min(100, c.total / c.budget * 100) : 0,
           newPct: c.budget ? Math.min(100, (c.total + add) / c.budget * 100) : 0, time: d.timeRatio * 100 };
}
// ---- 預扣帳戶 ----
S.ppCache = {};
function ppFor(dateStr, cb) {
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7), key = y + '-' + m;
  if (S.dash && S.dash.prepaid && S.dash.y === y && S.dash.m === m) return S.dash.prepaid;
  if (S.ppCache[key]) return S.ppCache[key];
  if (cb && !S.ppLoading) { S.ppLoading = true; call('prepaid', { y: y, m: m }).then(function (p) { S.ppCache[key] = p; S.ppLoading = false; cb(); }).catch(function (e) { S.ppLoading = false; err(e); }); }
  return null;
}
const PP_ICON = { paid: '✓', overdue: '!', soon: '•', todo: '', none: '' };
function renderEntry() {
  const f = S.form, E = S.e, el = $('v-entry');
  if (!f) { el.innerHTML = '<div class="loading">載入中…</div>'; return; }
  const pre = E.pay === '預扣';
  el.classList.toggle('card-mode', E.pay === '信用卡');
  el.classList.toggle('pre-mode', pre);
  const isToday = E.date === f.today;
  const leftTxt = S.dash ? '$' + fmt(S.dash.left) : '…';
  let h = '';
  if (S.queue && S.queue.length) h += '<div class="qbar">' + S.queue.length + ' 筆離線記帳等待上傳<button class="chip" data-act="flush" style="height:32px">立即上傳</button></div>';
  h += '<div class="row"><div class="col"><span class="sub">' + (S.dash ? S.dash.y + '年' + S.dash.m + '月｜' : '') + '本月還能花</span><span style="font-size:20px;font-weight:700">' + leftTxt + '</span></div>' +
    '<div style="display:flex;gap:6px;align-items:center">' + themeBtn(40) + '<button class="datebtn ' + (isToday ? '' : 'past') + '" data-act="date">' + (isToday ? '今天 ' : '補記 ') + md(E.date) + '（' + wk(E.date) + '）</button></div></div>';
  h += '<div class="grid3" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:12px;gap:8px">' +
    '<button class="seg cash ' + (E.pay === '現金' ? 'on' : '') + '" data-act="pay" data-v="現金">現金</button>' +
    '<button class="seg cardb ' + (E.pay === '信用卡' ? 'on' : '') + '" data-act="pay" data-v="信用卡">信用卡</button>' +
    '<button class="seg preb ' + (pre ? 'on' : '') + '" data-act="pay" data-v="預扣">預扣帳戶</button></div>';
  if (pre) return renderPrepaidEntry(el, h);
  const items = f.items[E.cat] || [];
  const bi = catBudgetInfo();
  let bar = '', info = '';
  if (bi && bi.other) info = '<div class="binfo">補記其他月份，不顯示本月科目進度</div>';
  else if (bi && bi.c.travel) info = '<div class="binfo">' + esc(E.cat) + '：國旅專款不扣日常預算｜本月已用 <b>$' + fmt(bi.c.total) + '</b></div>';
  else if (bi && !bi.c.budget) info = '<div class="binfo">' + esc(E.cat) + '：本月沒有編列預算｜已用 <b>$' + fmt(bi.c.total) + '</b></div>';
  else if (bi) {
    bar = '<i class="fill' + (bi.rem < 0 || bi.after < 0 ? ' over' : '') + '" style="width:' + bi.usedPct.toFixed(1) + '%"></i>' +
      (bi.add ? '<i class="pend' + (bi.after < 0 ? ' over' : '') + '" style="left:' + bi.usedPct.toFixed(1) + '%;width:' + Math.max(0, bi.newPct - bi.usedPct).toFixed(1) + '%"></i>' : '') +
      '<i class="tick" style="left:' + Math.min(99.5, bi.time).toFixed(1) + '%"></i>';
    info = '<div class="binfo">' + esc(E.cat) + '｜今日額度 <b>$' + fmt(bi.allowance) + '</b>｜今天已花 <b>$' + fmt(bi.today) + '</b>｜' +
        (bi.todayLeft >= 0 ? '今天還剩 <b>$' + fmt(bi.todayLeft) + '</b>' : '<span class="warn">今天已超出 $' + fmt(-bi.todayLeft) + '</span>') + '</div>' +
      '<div class="binfo">本月已用 <b>$' + fmt(bi.c.total) + '</b>（' + Math.round(bi.c.total / bi.c.budget * 100) + '%）｜' +
        (bi.rem >= 0 ? '本月剩 <b>$' + fmt(bi.rem) + '</b>' : '<span class="warn">本月已超支 $' + fmt(-bi.rem) + '</span>') + '</div>';
    if (bi.add) {
      info += '<div class="binfo">' + (bi.after < 0 ? '<span class="warn">記完後本月將超出預算 $' + fmt(-bi.after) + '</span>' :
        (bi.isToday ? (bi.todayAfter >= 0 ? '記完後今天還剩 <b>$' + fmt(bi.todayAfter) + '</b>' : '<span class="warn">記完後今天超出 $' + fmt(-bi.todayAfter) + '</span>，明天起每日額度約 <b>$' + fmt(bi.nextAllowance) + '</b>') : '記完後本月剩 <b>$' + fmt(bi.after) + '</b>')) + '</div>';
    } else if (bi.todayLeft < 0) info += '<div class="binfo">明天起每日額度約 <b>$' + fmt(bi.nextAllowance) + '</b></div>';
  }
  h += '<div class="amount">' + bar + '<div style="font-size:12px;font-weight:500;color:var(--tint)">' + (E.pay === '現金' ? '計入：現金實支' : '計入：刷卡實支（' + (+E.date.slice(8, 10) <= 22 ? '本期帳單，次月 6 日扣款' : '下期帳單，下下月 6 日扣款') + '）') + '</div>' + info + '<div class="expr">' + esc(exprDisplay(E.amt).small) + '</div><div class="v">$' + exprDisplay(E.amt).big + '</div></div>';
  // 快速記帳範本
  const q = [];
  if (f.last) q.push({ t: '↺ 再記一次：' + f.last.item + ' $' + fmt(f.last.amount), d: f.last });
  (f.quick || []).forEach(function (x) { if (!f.last || x.cat + x.item + x.pay + x.amount !== f.last.cat + f.last.item + f.last.pay + f.last.amount) q.push({ t: x.item + ' $' + fmt(x.amount) + (x.pay === '信用卡' ? '・卡' : ''), d: x }); });
  if (q.length) h += '<div class="lbl">快速記帳</div><div class="items">' + q.map(function (x, i) { return '<button class="chip qk" data-act="quick" data-i="' + i + '" style="height:38px;font-size:13px">' + esc(x.t) + '</button>'; }).join('') + '</div>';
  S.quickList = q;
  h += '<div class="lbl">科目</div><div class="cats">' + f.cats.map(function (c) { return '<button class="chip ' + (E.cat === c ? 'on' : '') + '" data-act="cat" data-v="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
  h += '<div class="lbl">消費項目</div>';
  if (E.custom) {
    h += '<div class="row"><input class="f" id="customItem" placeholder="輸入項目，例如：修鞋" value="' + esc(E.customText) + '" style="border:2px solid var(--main);border-radius:22px"><button class="chip" data-act="nocustom">常用</button></div>';
  } else {
    h += '<div class="items"><button class="chip" data-act="custom" style="border:1px dashed var(--main);color:var(--tint)">＋自行輸入</button>' +
      items.map(function (it) { return '<button class="chip ' + (E.item === it ? 'on' : '') + '" data-act="item" data-v="' + esc(it) + '">' + esc(it) + '</button>'; }).join('') + '</div>';
  }
  h += keypadHTML('key');
  h += '<input class="f" id="note" placeholder="備註（選填）" style="margin-top:10px" value="' + esc(E.note || '') + '">';
  h += '<button class="submit" data-act="submit">記一筆（' + E.pay + '）</button>';
  el.innerHTML = h;
}
function renderPrepaidEntry(el, h) {
  const E = S.e, pp = ppFor(E.date, renderEntry);
  if (!pp) { el.innerHTML = h + '<div class="loading">讀取預扣項目…</div>'; return; }
  const list = pp.items.slice().sort(function (a, b) { const r = function (x) { return x.due && !x.paid ? 0 : (x.due ? 1 : 2); }; return r(a) - r(b); });
  if (!E.ppKey || !list.some(function (x) { return x.key === E.ppKey; })) E.ppKey = (list[0] || {}).key;
  const it = list.filter(function (x) { return x.key === E.ppKey; })[0];
  if (it && !E.amt && !E.ppTouched && it.due && !it.paid && it.planned) E.amt = String(it.planned);
  let info = '';
  if (it) {
    const st = it.paid ? '<b>已繳 $' + fmt(it.paid) + '（' + md(it.paidDate) + '）</b>' : (it.status === 'overdue' ? '<span class="warn">已逾期</span>' : (it.due ? '未繳' : '本月不用繳'));
    info = '<div class="binfo">' + esc(it.acct) + '｜' + esc(it.name) + '｜本月應繳 <b>$' + fmt(it.planned) + '</b>' + (it.est ? '（估計）' : '') + '</div>' +
      '<div class="binfo">' + (it.due ? '期限 ' + md(it.dueDate) + '｜' : '') + st + '</div>';
    const v = evalExpr(E.amt);
    if (!isNaN(v) && v && it.planned && Math.round(v) !== it.planned) info += '<div class="binfo">' + (v > it.planned ? '比計畫多 <b>$' + fmt(v - it.planned) + '</b>' : '比計畫少 <b>$' + fmt(it.planned - v) + '</b>') + '</div>';
  }
  h += '<div class="amount"><div style="font-size:12px;font-weight:500;color:var(--tint)">計入：預扣帳戶繳費（不扣生活預算）</div>' + info + '<div class="expr">' + esc(exprDisplay(E.amt).small) + '</div><div class="v">$' + exprDisplay(E.amt).big + '</div></div>';
  h += '<div class="lbl">預扣項目（' + pp.m + '月：應繳 ' + pp.due.filter(function (x) { return x.due; }).length + ' 項，未繳 ' + pp.unpaid + ' 項）</div><div class="ppgrid">' +
    list.map(function (x) {
      const cls = x.paid ? 'paid' : (x.status === 'overdue' ? 'late' : (x.due ? 'due' : ''));
      return '<button class="chip pp ' + cls + (x.key === E.ppKey ? ' on' : '') + '" data-act="pp" data-v="' + esc(x.key) + '"><span>' + esc(x.name) + '</span>' + (x.paid ? '<em>✓</em>' : (x.due ? '<em>' + (x.status === 'overdue' ? '!' : '$' + fmt(x.planned)) + '</em>' : '')) + '</button>';
    }).join('') + '</div>';
  h += keypadHTML('key');
  h += '<input class="f" id="note" placeholder="備註（選填）" style="margin-top:10px" value="' + esc(E.note || '') + '">';
  h += '<button class="submit" data-act="submit">記一筆繳費（' + esc(it ? it.acct : '預扣帳戶') + '）</button>';
  el.innerHTML = h;
}
$('v-entry').addEventListener('click', function (e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const E = S.e, a = b.dataset.act, v = b.dataset.v;
  const keepNote = function () { const n = $('note'); if (n) E.note = n.value; const c = $('customItem'); if (c) E.customText = c.value; };
  keepNote();
  if (a === 'pay') { if ((v === '預扣') !== (E.pay === '預扣')) { E.amt = ''; E.ppTouched = false; } E.pay = v; }
  else if (a === 'cat') { E.cat = v; E.item = (S.form.items[v] || [])[0] || v; E.custom = false; }
  else if (a === 'item') E.item = v;
  else if (a === 'custom') E.custom = true;
  else if (a === 'nocustom') E.custom = false;
  else if (a === 'key') { E.amt = pressKey(E.amt, v); E.ppTouched = true; }
  else if (a === 'pp') { E.ppKey = v; E.amt = ''; E.ppTouched = false; }
  else if (a === 'quick') { const q = S.quickList[+b.dataset.i].d; E.cat = q.cat; E.item = q.item; E.pay = q.pay; E.amt = String(q.amount); E.custom = (S.form.items[q.cat] || []).indexOf(q.item) < 0; E.customText = E.custom ? q.item : ''; toast('已帶入：' + q.item + ' $' + fmt(q.amount) + '，確認後按「記一筆」', 1800); }
  else if (a === 'flush') return flushQueue(true);
  else if (a === 'date') return openDatePicker();
  else if (a === 'submit') return submitEntry();
  renderEntry();
});
document.addEventListener('keydown', function (e) {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || $('modal').style.display === 'flex') return;
  const entryVisible = S.view === 'entry' || window.innerWidth >= 1000;
  if (!entryVisible || !S.form) return;
  const map = { '+': '+', '-': '−', '*': '×', '/': '÷', 'Backspace': '⌫', 'Escape': 'C', '=': '=' };
  const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
  if (e.key === 'Enter') { e.preventDefault(); return submitEntry(); }
  if (!k) return;
  e.preventDefault(); S.e.amt = pressKey(S.e.amt, k); S.e.ppTouched = true; renderEntry();
});
// ---- 離線暫存 ----
S.queue = lsGet('kakeiboQueue') || [];
function isNetErr(e) { const m = String(e && e.message ? e.message : e); return (typeof navigator !== 'undefined' && navigator.onLine === false) || /network|fetch|load failed|連線失敗|Failed|timed? ?out/i.test(m); }
function flushQueue(manual) {
  if (!S.queue.length || S.flushing) return;
  S.flushing = true;
  const next = function () {
    if (!S.queue.length) { S.flushing = false; lsSet('kakeiboQueue', S.queue); clearCaches(); S.dashStale = true; loadToday(true); renderEntry(); toast('離線記帳已全部上傳'); return; }
    const it = S.queue[0];
    call(it.method, it.args).then(function () { S.queue.shift(); lsSet('kakeiboQueue', S.queue); next(); })
      .catch(function (e) { S.flushing = false; if (manual) err(e); renderEntry(); });
  };
  next();
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', function () { flushQueue(false); });

function openDatePicker() {
  const f = S.form, E = S.e;
  const chips = [[0, '今天'], [-1, '昨天'], [-2, '前天']].map(function (x) { const d = addDays(f.today, x[0]); return '<button class="chip ' + (E.date === d ? 'on' : '') + '" style="--main:var(--toast);--onMain:var(--toastInk)" data-d="' + d + '">' + x[1] + ' ' + md(d) + '</button>'; }).join('');
  openModal('<b style="font-size:16px">這筆要記在哪一天？</b><div class="row" style="flex-wrap:wrap;justify-content:flex-start">' + chips + '</div>' +
    '<label class="sub">選其他日期<input type="date" class="f" id="pickDate" value="' + E.date + '" max="' + f.today + '" style="margin-top:6px"></label>' +
    '<button class="submit" style="background:var(--toast);color:var(--toastInk)" data-close="1">完成</button>');
  $('modalBox').onclick = function (e) {
    const c = e.target.closest('[data-d]'); if (c) { E.date = c.dataset.d; closeModal(); renderEntry(); }
    if (e.target.closest('[data-close]')) { const v = $('pickDate').value; if (v) E.date = v; closeModal(); renderEntry(); }
  };
}
function afterWrite() {
  clearCaches(); S.ppCache = {}; S.dashStale = true;
  call('dashboard', {}).then(function (d) { S.dash = d; S.dashStale = false; lsSet('kakeiboLast', { form: S.form, dash: d }); renderEntry(); if (S.view === 'today' || window.innerWidth >= 1000) renderToday(); }).catch(function () {});
}
function submitEntry() {
  const E = S.e;
  const val = evalExpr(E.amt);
  if (isNaN(val)) return toast('算式有誤，請檢查');
  const amt = Math.round(val);
  if (amt <= 0) return toast('請先輸入金額');
  const btn = document.querySelector('#v-entry .submit');
  if (E.pay === '預扣') {
    if (!E.ppKey) return toast('請先選擇預扣項目');
    btn.disabled = true; btn.textContent = '記錄中…';
    const args = { key: E.ppKey, amount: amt, date: E.date, note: E.note || '' };
    call('payPrepaid', args).then(function (r) { toast(r.message, 3600); E.amt = ''; E.note = ''; E.ppTouched = false; afterWrite(); renderEntry(); })
      .catch(function (e) {
        if (isNetErr(e)) { S.queue.push({ method: 'payPrepaid', args: args, t: Date.now() }); lsSet('kakeiboQueue', S.queue); toast('目前離線，已暫存，連線後自動上傳', 3000); E.amt = ''; E.note = ''; }
        else err(e);
        renderEntry();
      });
    return;
  }
  const item = E.custom ? (E.customText || '').trim() : E.item;
  if (E.custom && !item) return toast('請輸入消費項目');
  btn.disabled = true; btn.textContent = '記錄中…';
  const args = { date: E.date, cat: E.cat, item: item, amount: amt, pay: E.pay, note: E.note || '' };
  const applyLocal = function () {
    if (!S.dash) return;
    const sm = +E.date.slice(0, 4) === S.dash.y && +E.date.slice(5, 7) === S.dash.m;
    if (!sm) return;
    const isT = S.form && E.date === S.form.today;
    S.dash.cats.forEach(function (c) { if (c.name === E.cat) { c.total += amt; if (E.pay === '現金') c.cash += amt; else c.card += amt; if (isT) { c.today = (c.today || 0) + amt; c.todayLeft = (c.allowance || 0) - c.today; } } });
    if (E.cat !== '國旅') { S.dash.spent += amt; S.dash.left -= amt; if (E.pay !== '現金') S.dash.cardSpent += amt; S.dash.count += 1; if (isT) { S.dash.todaySpent += amt; S.dash.todayLeft -= amt; } }
  };
  call('add', args).then(function (r) {
    toast(r.message + (r.warnFull ? '（本月已接近 500 筆上限）' : ''), 3200);
    applyLocal(); if (S.dash) S.dash.left = r.left;
    S.form.last = { cat: E.cat, item: item, pay: E.pay, amount: amt };
    E.amt = ''; E.note = ''; E.custom = false; E.customText = '';
    renderEntry(); afterWrite();
  }).catch(function (e) {
    if (isNetErr(e)) {
      S.queue.push({ method: 'add', args: args, t: Date.now() }); lsSet('kakeiboQueue', S.queue);
      applyLocal(); toast('目前離線，已暫存（共 ' + S.queue.length + ' 筆），連線後自動上傳', 3200);
      E.amt = ''; E.note = ''; E.custom = false; E.customText = '';
    } else err(e);
    renderEntry();
  });
}

// ---------- 今日 ----------
function loadToday(force) {
  if (S.dash && !force && !S.dashStale) return renderToday();
  if (!S.dash) $('v-today').innerHTML = '<div class="loading">載入中…</div>';
  call('dashboard', {}).then(function (d) { S.dash = d; S.dashStale = false; lsSet('kakeiboLast', { form: S.form, dash: d }); renderToday(); renderEntry(); }).catch(err);
}
function renderToday() {
  const d = S.dash, el = $('v-today');
  const st = d.status === 'over' ? ['over', 'overbg'] : d.status === 'fast' ? ['fast', 'fastbg'] : ['ok', 'okbg'];
  let h = '<div class="row" style="margin-bottom:12px"><div class="col"><span class="sub">' + d.m + '月' + d.d + '日（' + d.weekday + '）' + (S.offline ? '｜顯示上次資料，更新中…' : '') + '</span><h1>今日看板</h1></div>' +
    '<div style="display:flex;gap:6px">' + themeBtn(44) + '<button class="iconbtn" data-act="refresh" aria-label="重新整理"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></div>' +
    (d.check ? '<span class="tag ' + (d.check.indexOf('✅') === 0 ? 'ok okbg' : 'over overbg') + '">' + esc(d.check.indexOf('✅') === 0 ? '驗算通過' : '驗算待處理') + '</span>' : '') + '</div>';
  if (d.payday) {
    const p = d.payday;
    if (!p.done) {
      h += '<div class="card" style="border:2px solid var(--green)"><div class="row"><b style="font-size:16px">發薪日分配｜' + p.m + '月</b><span class="tag ok okbg">薪資 $' + fmt(p.salary) + '</span></div>' +
        '<div class="sub" style="font-size:12px;margin:4px 0 4px">薪資入帳後，依序完成以下轉帳：</div>' +
        p.list.map(function (x, i) {
          return '<div class="row" style="padding:10px 0;border-bottom:1px solid var(--chip);align-items:flex-start"><span class="tag" style="background:var(--chip);color:var(--ink)">' + (i + 1) + '</span>' +
            '<div class="col" style="flex:1;gap:2px"><span style="font-size:14px;font-weight:500">' + esc(x.from) + ' → ' + esc(x.to) + '</span><span class="sub" style="font-size:12px;line-height:1.4">' + esc(x.note) + '</span></div><b style="font-size:16px">$' + fmt(x.amount) + '</b></div>';
        }).join('') +
        (p.debts && p.debts.length ? '<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--amberSoft);color:var(--amberInk);font-size:13px;line-height:1.5"><b>別忘了補回缺口：</b>' + p.debts.map(function (x) { return esc(x.name) + ' $' + fmt(x.amount); }).join('；') + '。補上後在今日建議按「已補上」。</div>' : '') +
        '<div class="sub" style="font-size:13px;margin:10px 0 0">完成後，本月生活預算 $' + fmt(d.budget) + '</div>' +
        '<button class="submit" style="background:var(--green)" data-act="allocdone">我已完成分配</button></div>';
    } else {
      h += '<div class="card okbg row"><span class="ok" style="font-weight:700">✓ 已完成 ' + p.m + ' 月薪資分配（' + esc(p.done) + '）</span><button class="chip" data-act="allocundo" style="height:36px">取消</button></div>';
    }
  }
  h += '<div class="card" style="display:flex;gap:12px;align-items:flex-start">' + ICON.book + '<div class="col">' +
    (d.verse.tithe ? '<b class="ok" style="font-size:13px">' + esc(d.verse.tithe) + '</b>' : '') +
    '<span style="font-size:15px;line-height:1.6">「' + esc(d.verse.text) + '」</span><span class="sub" style="font-size:12px">' + esc(d.verse.ref) + '</span></div></div>';
  h += '<div class="grid3">';
  h += '<div class="card ' + st[1] + '"><div class="row"><span class="' + st[0] + '" style="font-size:14px;font-weight:500">本月還能花</span><span class="' + st[0] + '" style="font-size:12px">預算 $' + fmt(d.budget) + '</span></div>' +
    '<div class="big ' + st[0] + '">' + money(d.left) + '</div><div class="row ' + st[0] + '" style="font-size:12px;margin-bottom:6px"><span>花費進度 ' + Math.round(d.spendRatio * 100) + '%</span><span>時間進度 ' + Math.round(d.timeRatio * 100) + '%</span></div>' +
    '<div style="position:relative" class="' + st[0] + '"><div class="bar"><i style="width:' + Math.min(100, d.spendRatio * 100).toFixed(1) + '%;background:currentColor"></i></div><div style="position:absolute;left:' + (d.timeRatio * 100).toFixed(1) + '%;top:-3px;width:2px;height:16px;background:var(--ink)"></div></div></div>';
  const tl = d.todayLeft != null ? d.todayLeft : d.perDay;
  h += '<div class="card"><span class="sub">今天還能花</span><div class="mid" style="color:' + (tl < 0 ? 'var(--red)' : 'var(--blue)') + '">' + money(tl) + '</div>' +
    '<span class="sub" style="font-size:12px">今日額度 $' + fmt(d.dayAllowance != null ? d.dayAllowance : d.perDay) + '｜今天已花 $' + fmt(d.todaySpent || 0) + '｜剩 ' + d.daysLeft + ' 天</span></div>';
  h += '<div class="card"><span class="sub">本月已花</span><div class="mid">$' + fmt(d.spent) + '</div><span class="sub" style="font-size:12px">' + d.count + ' 筆｜刷卡 $' + fmt(d.cardSpent) + '</span>' + cmpLine(d.spent, d.cmp, true) + '</div>';
  h += '</div><div class="grid2"><div class="card"><b style="font-size:15px">今日建議</b>' + d.tips.map(function (t) {
    return '<div class="tip">' + (ICON[t.level] || ICON.info) + '<div class="col" style="flex:1"><span>' + esc(t.text) + '</span>' +
      (t.action === 'circle' ? '<button class="chip" data-act="circle" style="height:36px;align-self:flex-start;margin-top:4px">我已圈存</button>' : '') +
      (t.action === 'debt' ? '<button class="chip" data-act="debt" data-row="' + t.row + '" data-y="' + t.y + '" style="height:36px;align-self:flex-start;margin-top:4px">已補上</button>' : '') + '</div></div>';
  }).join('') + '</div>';
  const iv = d.invest;
  if (iv.mode === 'emergency') {
    h += '<div class="card"><div class="row"><b style="font-size:15px">可投資金額</b><span class="tag over overbg">先補緊急備用金</span></div>' +
      '<p style="font-size:14px;line-height:1.5;margin:8px 0">緊急備用金還差 <b class="over">$' + fmt(iv.shortfall) + '</b>，補滿 $' + fmt(iv.target) + ' 後才會顯示可投資金額。</p>' +
      bar(Math.min(iv.current, iv.target), 0, iv.target) + '<div class="row sub" style="font-size:12px;margin-top:6px"><span>目前 $' + fmt(iv.current) + '</span><span>本月可補入 $' + fmt(iv.canTopUp) + '</span><span>目標 $' + fmt(iv.target) + '</span></div></div>';
  } else {
    h += '<div class="card"><div class="row"><b style="font-size:15px">可投資金額</b><span class="tag ok okbg">緊急備用金已補滿</span></div><div class="big ok">$' + fmt(iv.amount) + '</div><span class="sub">' + esc(iv.text) + '</span></div>';
  }
  h += '</div>';
  if (d.prepaid && d.prepaid.due.length) {
    const pp = d.prepaid, paidN = pp.due.filter(function (x) { return x.paid; }).length;
    h += '<div class="card"><div class="row"><b style="font-size:15px">本月應繳（預扣帳戶）</b><span class="tag ' + (pp.overdue ? 'over overbg' : (pp.unpaid ? 'fast fastbg' : 'ok okbg')) + '">' + (pp.overdue ? pp.overdue + ' 項逾期' : (pp.unpaid ? '還有 ' + pp.unpaid + ' 項未繳' : '全部繳清')) + '</span></div>' +
      '<div style="margin:8px 0">' + bar(pp.totalPaid, 0, Math.max(pp.totalPlanned, pp.totalPaid)).replace('class="c"', 'class="c" style="background:var(--green)"') + '</div>' +
      '<div class="sub" style="font-size:12px;margin-bottom:6px">已繳 $' + fmt(pp.totalPaid) + ' ／ 應繳 $' + fmt(pp.totalPlanned) + '（' + paidN + '/' + pp.due.length + ' 項）</div>' +
      pp.due.map(function (x) {
        const st = x.paid ? '<span class="ok" style="font-size:12px">✓ ' + md(x.paidDate) + ' $' + fmt(x.paid) + '</span>' :
          '<button class="chip" data-act="paynow" data-key="' + esc(x.key) + '" style="height:34px;font-size:13px;' + (x.status === 'overdue' ? 'border:2px solid var(--red);color:var(--red)' : '') + '">' + (x.status === 'overdue' ? '逾期・去繳費' : '記錄繳費') + '</button>';
        return '<div class="row" style="padding:8px 0;border-top:1px solid var(--chip)"><div class="col" style="flex:1;min-width:0;gap:1px"><span style="font-size:14px;font-weight:500">' + esc(x.name) + '</span><span class="sub" style="font-size:11px">' + esc(x.acct) + '｜期限 ' + md(x.dueDate) + '｜應繳 $' + fmt(x.planned) + (x.est ? '（估）' : '') + '</span></div>' + st + '</div>';
      }).join('') + '</div>';
  }
  h += '<div class="card wide-only"><b style="font-size:15px">各科目快覽</b><div class="grid2" style="margin-top:10px">' + d.cats.filter(function (c) { return c.budget > 0; }).map(function (c) {
    const p = PACE[c.pace]; return '<div class="col"><div class="row" style="font-size:13px"><span>' + esc(c.name) + '</span><b class="' + p[1] + '">' + pct(c.total, c.budget) + '%</b></div>' + bar(c.cash, c.card, c.budget) + '</div>';
  }).join('') + '</div></div>';
  el.innerHTML = h;
}
$('v-today').addEventListener('click', function (e) {
  const pn = e.target.closest('[data-act="paynow"]');
  if (pn) { S.e.pay = '預扣'; S.e.ppKey = pn.dataset.key; S.e.amt = ''; S.e.ppTouched = false; S.e.date = S.form.today; show('entry'); renderEntry(); return; }
  const rf = e.target.closest('[data-act="refresh"]');
  if (rf) {
    rf.disabled = true; toast('重新讀取試算表…', 1500);
    call('refresh', {}).then(function (r) { clearCaches(); S.form = r.form; S.dash = r.dashboard; lsSet('kakeiboLast', { form: r.form, dash: r.dashboard }); renderToday(); renderEntry(); toast('已更新'); prefetch(); }).catch(err);
    return;
  }
  const al = e.target.closest('[data-act="allocdone"],[data-act="allocundo"]');
  if (al) {
    const done = al.dataset.act === 'allocdone';
    if (done && !confirm('確定已完成本月所有轉帳？')) return;
    al.disabled = true;
    call('allocDone', { y: S.dash.y, m: S.dash.m, done: done }).then(function (p) { S.dash.payday = p; toast(done ? '已記錄完成本月分配' : '已取消完成標記'); renderToday(); }).catch(err);
    return;
  }
  const db = e.target.closest('[data-act="debt"]');
  if (db) {
    if (!confirm('確定這筆缺口已經補上？之後就不會再提醒。')) return;
    db.disabled = true;
    call('debtDone', { y: +db.dataset.y, row: +db.dataset.row }).then(function (r) { toast(r.message); loadToday(true); }).catch(err);
    return;
  }
  const b = e.target.closest('[data-act="circle"]'); if (!b) return;
  b.disabled = true;
  call('circle', { y: S.dash.y, m: S.dash.m }).then(function (r) { toast(r.message); loadToday(true); }).catch(err);
});

// ---------- 圖表 ----------
function loadCharts() {
  if (!S.chartYM) S.chartYM = todayYM();
  const ym = S.chartYM, el = $('v-charts');
  const key = ym.y + '-' + ym.m, c = S.monthCache[key];
  if (c) { S.month = c.d; el.classList.remove('dim'); renderCharts(); if (fresh(c, 60000)) return; }
  else if (S.month && el.innerHTML) { el.classList.add('dim'); const h1 = el.querySelector('h1'); if (h1) h1.textContent = ym.y + '年' + ym.m + '月'; }
  else el.innerHTML = monthHeader(ym, 'ch') + '<div class="loading">載入中…</div>';
  call('month', ym).then(function (d) { S.monthCache[key] = { t: Date.now(), d: d }; if (d.y !== S.chartYM.y || d.m !== S.chartYM.m) return; el.classList.remove('dim'); S.month = d; renderCharts(); })
    .catch(function (e) { el.classList.remove('dim'); S.month = null; el.innerHTML = monthHeader(ym, 'ch') + '<div class="loading">此月份沒有資料</div>'; });
}
function renderCharts() {
  const d = S.month, el = $('v-charts');
  const st = d.status === 'over' ? ['over', 'overbg', '警戒'] : d.status === 'fast' ? ['fast', 'fastbg', '偏快'] : ['ok', 'okbg', '正常'];
  let h = monthHeader(d, 'ch');
  h += '<div class="grid2" style="align-items:start"><div><div class="card"><div class="row"><b style="font-size:15px">本月花費</b><span class="tag ' + st[0] + ' ' + st[1] + '">' + st[2] + '</span></div>' +
    '<div class="row" style="align-items:baseline;margin:6px 0"><span class="mid ' + st[0] + '">$' + fmt(d.spent) + '<span class="sub" style="font-size:13px;font-weight:400">　／ $' + fmt(d.budget) + '</span></span><span class="sub">花費 ' + Math.round(d.spendRatio * 100) + '%｜時間 ' + Math.round(d.timeRatio * 100) + '%</span></div>' +
    bar(d.cash, d.card, d.budget) + '<div class="sub" style="font-size:12px;margin-top:6px">' + splitText(d.cash, d.card) + '</div></div>';
  h += '<div class="card"><div class="items" style="margin-bottom:8px">' + CT.map(function (t, i) { return '<button class="chip ctab ' + (i === S.ct ? 'on' : '') + '" data-act="ct" data-v="' + i + '" style="height:36px">' + t.name + '</button>'; }).join('') + '</div>' +
    chartBoxHTML('chartbox') + '<div class="cdots" id="cdots"></div><div class="ccap" id="ccap"></div><div class="sub" style="font-size:11px;text-align:center">在圖上左右滑動切換圖表｜兩指縮放、拖曳移動｜點兩下還原</div></div>';
  h += '</div><div><div class="sub" style="margin:0 0 8px">各科目（點進去看明細）</div><div class="grid2">' + d.cats.map(function (c) {
    const p = PACE[c.pace];
    return '<button class="card" data-act="opencat" data-v="' + esc(c.name) + '" style="text-align:left;border:none;width:100%;display:flex;flex-direction:column;gap:8px">' +
      '<div class="row" style="width:100%"><b style="font-size:16px">' + esc(c.name) + '</b><span class="tag ' + p[1] + ' ' + p[1] + 'bg">' + (c.travel ? '不扣預算' : p[0]) + '</span></div>' +
      '<div class="row" style="width:100%;align-items:baseline"><span style="font-size:20px;font-weight:700" class="' + p[1] + '">$' + fmt(c.total) + (c.budget ? '<span class="sub" style="font-size:12px;font-weight:400"> ／ $' + fmt(c.budget) + '</span>' : '') + '</span>' +
      (c.budget ? '<b class="' + p[1] + '">' + pct(c.total, c.budget) + '%</b>' : '') + '</div><div style="width:100%">' + bar(c.cash, c.card, c.budget) + '</div><span class="sub" style="font-size:12px">' + splitText(c.cash, c.card) + '</span></button>';
  }).join('') + '</div></div></div>';
  el.innerHTML = h;
  $('chartbox').querySelector('.zoomer').id = 'zoomer';
  enableZoom($('chartbox'), function (dir) { S.ct = (S.ct + dir + CT.length) % CT.length; renderChartPane(); });
  renderChartPane();
}
$('v-charts').addEventListener('click', function (e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'ch-prev') { S.chartYM = ymAdd(S.chartYM, -1); loadCharts(); }
  if (b.dataset.act === 'ch-next') { S.chartYM = ymAdd(S.chartYM, 1); loadCharts(); }
  if (b.dataset.act === 'ct') { S.ct = +b.dataset.v; return renderChartPane(); }
  if (b.dataset.act === 'opencat') { S.catYM = S.chartYM; S.cat = b.dataset.v; show('cat'); loadCat(); }
});

// ---------- 比較工具 ----------
// 花費類：增加為紅、減少為綠；資產類（good=up）：增加為綠
function chg(cur, base, goodUp) {
  if (base == null || !isFinite(base) || base === 0 || !cur) return '';
  const p = Math.round((cur - base) / Math.abs(base) * 100);
  if (p === 0) return '<span class="done">持平</span>';
  const up = p > 0, good = goodUp ? up : !up;
  return '<span class="' + (good ? 'ok' : 'over') + '">' + (up ? '▲' : '▼') + Math.abs(p) + '%</span>';
}
function chgTxt(cur, base) { if (!base) return ''; const p = Math.round((cur - base) / Math.abs(base) * 100); return p === 0 ? '持平' : (p > 0 ? '▲' : '▼') + Math.abs(p) + '%'; }
function chgCol(cur, base, goodUp) { if (!base) return '#5B6675'; const up = cur > base; return (goodUp ? up : !up) ? '#1E7A4C' : '#B42318'; }
function cmpLine(cur, c, spend) {
  if (!c) return '';
  const a = [];
  if (c.prev != null) a.push('上月同期 $' + fmt(c.prev) + ' ' + chg(cur, c.prev, !spend));
  if (c.last != null) a.push('去年同期 $' + fmt(c.last) + ' ' + chg(cur, c.last, !spend));
  return a.length ? '<div class="sub" style="font-size:11px;margin-top:4px;line-height:1.5">' + a.join('<br>') + '</div>' : '';
}
function catCmp(d) {
  const cv = d.curves, n = cv.cur.length;
  const pick = function (arr) { return arr && arr.length ? arr[Math.min(Math.max(n, 1), arr.length) - 1] : null; };
  const full = function (arr) { return arr && arr.length ? arr[arr.length - 1] : null; };
  const rows = [], ended = !d.daysLeft;
  const one = function (lab, arr) { return ended ? lab + '全月 $' + fmt(full(arr)) + ' ' + chg(d.total, full(arr)) : lab + '同期 $' + fmt(pick(arr)) + ' ' + chg(d.total, pick(arr)) + '｜全月 $' + fmt(full(arr)); };
  if (cv.prev) rows.push(one('上月（' + esc(cv.prevLabel) + '）', cv.prev));
  if (cv.last) rows.push(one('去年（' + esc(cv.lastLabel) + '）', cv.last));
  return rows.length ? '<div class="sub" style="font-size:12px;margin-top:6px;line-height:1.6">' + rows.join('<br>') + '</div>' : '';
}

// ---------- 圖表類型（可左右滑動切換）----------
const CAT_COLOR = { '奉獻': '#6B4FA0', '食物': '#2458C6', '教育': '#0F8B8D', '油料': '#D9822B', '娛樂': '#C2185B', '其他': '#5B6675', '國旅': '#1E7A4C' };
const CT = [
  { key: 'cum', name: '累計曲線' }, { key: 'donut', name: '科目比例' }, { key: 'daily', name: '每日花費' },
  { key: 'trend', name: '12個月趨勢' }, { key: 'week', name: '星期分布' }, { key: 'rank', name: '項目排行' }
];
S.ct = 0; S.trendCache = {};
function svgOpen(label) { return '<svg viewBox="0 0 360 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(label) + '">'; }
function yAxis(ymax, X0, X1, Y0, Y1) {
  let s = '';
  [0, 0.5, 1].forEach(function (f) { const yy = Y0 - f * (Y0 - Y1); s += '<line x1="' + X0 + '" y1="' + yy + '" x2="' + X1 + '" y2="' + yy + '" stroke="#EEF1F5"/><text x="0" y="' + (yy + 4) + '" font-size="10" fill="#5B6675">' + (ymax * f >= 10000 ? (Math.round(ymax * f / 1000) / 10) + '萬' : fmt(ymax * f)) + '</text>'; });
  return s;
}
function chartCum(d) {
  return { svg: lineChart(d.curves, d.budget, { aria: '本月累計花費曲線', h: 260 }),
    cap: legend(d.curves, d.budget) + (d.sameDay.day ? '<div class="sub" style="font-size:12px;margin-top:4px">同一天比較（第 ' + d.sameDay.day + ' 天）：本月 $' + fmt(d.curves.cur[d.curves.cur.length - 1] || 0) + (d.sameDay.prev != null ? '｜上月 $' + fmt(d.sameDay.prev) : '') + (d.sameDay.last != null ? '｜去年同期 $' + fmt(d.sameDay.last) : '') + '</div>' : '') };
}
function arcPath(cx, cy, r, r2, a0, a1) {
  const p = function (rr, a) { return (cx + rr * Math.sin(a)).toFixed(2) + ',' + (cy - rr * Math.cos(a)).toFixed(2); };
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return 'M' + p(r, a0) + ' A' + r + ',' + r + ' 0 ' + big + ' 1 ' + p(r, a1) + ' L' + p(r2, a1) + ' A' + r2 + ',' + r2 + ' 0 ' + big + ' 0 ' + p(r2, a0) + ' Z';
}
function chartDonut(d) {
  const cats = d.cats.filter(function (c) { return c.total > 0; });
  const total = cats.reduce(function (s, c) { return s + c.total; }, 0);
  let s = svgOpen('各科目花費比例與上月、去年同期比較');
  if (!total) return { svg: s + '<text x="180" y="130" text-anchor="middle" fill="#5B6675" font-size="14">本月尚無花費</text></svg>', cap: '' };
  let a = 0; const cx = 82, cy = 130;
  cats.forEach(function (c) {
    const a1 = a + c.total / total * Math.PI * 2 - 0.0001;
    s += '<path d="' + arcPath(cx, cy, 78, 48, a, a1) + '" fill="' + (CAT_COLOR[c.name] || '#8A94A3') + '" stroke="#fff" stroke-width="2"/>';
    a = a1 + 0.0001;
  });
  const cash = cats.reduce(function (x, c) { return x + c.cash; }, 0), card = total - cash, ac = cash / total * Math.PI * 2;
  if (cash > 0) s += '<path d="' + arcPath(cx, cy, 45, 38, 0, Math.min(ac, Math.PI * 2 - 0.0001)) + '" fill="#2458C6"/>';
  if (card > 0) s += '<path d="' + arcPath(cx, cy, 45, 38, ac, Math.PI * 2 - 0.0001) + '" fill="#EAB308"/>';
  s += '<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="11" fill="#5B6675">合計</text><text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#1B2430">$' + fmt(total) + '</text>';
  const P = d.catsPrev || {}, L = d.catsLast || {}, gap = Math.min(34, 240 / cats.length);
  cats.forEach(function (c, i) {
    const y = 22 + i * gap;
    s += '<rect x="170" y="' + (y - 10) + '" width="11" height="11" rx="3" fill="' + (CAT_COLOR[c.name] || '#8A94A3') + '"/>' +
      '<text x="186" y="' + y + '" font-size="12" fill="#1B2430">' + esc(c.name) + ' ' + Math.round(c.total / total * 100) + '%  $' + fmt(c.total) + '</text>' +
      '<text x="186" y="' + (y + 13) + '" font-size="10" fill="#5B6675">上月 <tspan fill="' + chgCol(c.total, P[c.name]) + '">' + (P[c.name] ? chgTxt(c.total, P[c.name]) : '—') + '</tspan>｜去年 <tspan fill="' + chgCol(c.total, L[c.name]) + '">' + (L[c.name] ? chgTxt(c.total, L[c.name]) : '—') + '</tspan></text>';
  });
  const pt = Object.keys(P).reduce(function (x, k) { return x + (k === '國旅' ? 0 : P[k]); }, 0), lt = Object.keys(L).reduce(function (x, k) { return x + (k === '國旅' ? 0 : L[k]); }, 0);
  return { svg: s + '</svg>', cap: '<div class="legend"><span><b style="background:#2458C6;height:8px"></b>內圈藍：現金 $' + fmt(cash) + '</span><span><b style="background:#EAB308;height:8px"></b>內圈黃：刷卡 $' + fmt(card) + '</span></div>' +
    '<div class="sub" style="font-size:12px;margin-top:4px">全月比較：上月 $' + fmt(pt) + ' ' + chg(total, pt) + (lt ? '｜去年同月 $' + fmt(lt) + ' ' + chg(total, lt) : '') + '（▲紅＝花得比較多）</div>' };
}
function chartDaily(d) {
  const c = d.daily.cash, k = d.daily.card, n = c.length;
  const tot = c.map(function (v, i) { return v + k[i]; });
  const upto = d.sameDay.day || n, used = tot.slice(0, upto);
  const avg = used.length ? used.reduce(function (a, b) { return a + b; }, 0) / used.length : 0;
  const cv = d.curves, avgOf = function (arr) { return arr && arr.length ? arr[arr.length - 1] / arr.length : null; };
  const pavg = avgOf(cv.prev), lavg = avgOf(cv.last);
  const ymax = niceMax(Math.max.apply(null, tot.concat([avg, pavg || 0, lavg || 0, 100])) * 1.1);
  const X0 = 38, X1 = 352, Y0 = 228, Y1 = 14, bw = (X1 - X0) / 31;
  let s = svgOpen('每日花費長條圖，附上月與去年同期平均') + yAxis(ymax, X0, X1, Y0, Y1);
  let maxI = 0; tot.forEach(function (v, i) { if (v > tot[maxI]) maxI = i; });
  for (let i = 0; i < n; i++) {
    const x = X0 + i * bw + 1, hc = c[i] / ymax * (Y0 - Y1), hk = k[i] / ymax * (Y0 - Y1);
    if (hc) s += '<rect x="' + x.toFixed(1) + '" y="' + (Y0 - hc).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + hc.toFixed(1) + '" fill="#2458C6"/>';
    if (hk) s += '<rect x="' + x.toFixed(1) + '" y="' + (Y0 - hc - hk).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + hk.toFixed(1) + '" fill="#EAB308"/>';
  }
  const hline = function (v, col, dash) { if (!v) return ''; const y = Y0 - v / ymax * (Y0 - Y1); return '<line x1="' + X0 + '" y1="' + y + '" x2="' + X1 + '" y2="' + y + '" stroke="' + col + '" stroke-width="1.8" stroke-dasharray="' + dash + '"/>'; };
  s += hline(lavg, '#8A94A3', '2 3') + hline(pavg, '#D9822B', '6 3') + hline(avg, '#1B2430', '4 3');
  if (tot[maxI]) s += '<text x="' + Math.min(X0 + maxI * bw, 300) + '" y="' + (Y0 - tot[maxI] / ymax * (Y0 - Y1) - 6) + '" font-size="11" font-weight="700" fill="#1B2430">' + (maxI + 1) + '日 $' + fmt(tot[maxI]) + '</text>';
  s += '<text x="' + X0 + '" y="246" font-size="10" fill="#5B6675">1日</text><text x="' + (X0 + 14 * bw) + '" y="246" font-size="10" fill="#5B6675">15日</text><text x="' + (X1 - 22) + '" y="246" font-size="10" fill="#5B6675">31日</text></svg>';
  return { svg: s, cap: '<div class="legend"><span><b style="height:0;border-top:2px dashed #1B2430"></b>本月平均 $' + fmt(avg) + '</span>' +
    (pavg ? '<span><b style="height:0;border-top:2px dashed #D9822B"></b>上月平均 $' + fmt(pavg) + ' ' + chg(avg, pavg) + '</span>' : '') +
    (lavg ? '<span><b style="height:0;border-top:2px dotted #8A94A3"></b>去年同期平均 $' + fmt(lavg) + ' ' + chg(avg, lavg) + '</span>' : '') + '</div>' +
    '<div class="sub" style="font-size:12px;margin-top:4px">藍＝現金、黃＝刷卡。花最多的一天：' + (maxI + 1) + ' 日 $' + fmt(tot[maxI]) + '</div>' };
}
function chartTrend(rows) {
  const vals = rows.map(function (r) { return r.spent; }), buds = rows.map(function (r) { return r.budget; }), lys = rows.map(function (r) { return r.ly || 0; });
  const ymax = niceMax(Math.max.apply(null, vals.concat(buds, lys, [1000])) * 1.1);
  const X0 = 38, X1 = 352, Y0 = 228, Y1 = 14, bw = (X1 - X0) / 12;
  let s = svgOpen('近12個月花費趨勢，附去年同月') + yAxis(ymax, X0, X1, Y0, Y1);
  rows.forEach(function (r, i) {
    const x = X0 + i * bw + 3, w = bw - 6, hc = r.cash / ymax * (Y0 - Y1), hk = r.card / ymax * (Y0 - Y1);
    if (hc) s += '<rect x="' + x.toFixed(1) + '" y="' + (Y0 - hc).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hc.toFixed(1) + '" fill="#2458C6"/>';
    if (hk) s += '<rect x="' + x.toFixed(1) + '" y="' + (Y0 - hc - hk).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hk.toFixed(1) + '" fill="#EAB308"/>';
    if (r.budget) { const yb = Y0 - r.budget / ymax * (Y0 - Y1); s += '<line x1="' + (x - 2).toFixed(1) + '" y1="' + yb + '" x2="' + (x + w + 2).toFixed(1) + '" y2="' + yb + '" stroke="#1B2430" stroke-width="2.5"/>'; }
    s += '<text x="' + (x + w / 2).toFixed(1) + '" y="246" font-size="10" text-anchor="middle" fill="' + (i === rows.length - 1 ? '#1B2430' : '#5B6675') + '">' + r.m + '月</text>';
  });
  const pts = rows.map(function (r, i) { return r.ly ? (X0 + i * bw + bw / 2).toFixed(1) + ',' + (Y0 - r.ly / ymax * (Y0 - Y1)).toFixed(1) : null; });
  let seg = [];
  pts.concat([null]).forEach(function (p) { if (p) seg.push(p); else { if (seg.length > 1) s += '<polyline points="' + seg.join(' ') + '" fill="none" stroke="#8A94A3" stroke-width="2" stroke-dasharray="4 3"/>'; seg = []; } });
  pts.forEach(function (p) { if (p) { const q = p.split(','); s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3.5" fill="#fff" stroke="#8A94A3" stroke-width="2"/>'; } });
  const over = rows.filter(function (r) { return r.budget && r.spent > r.budget; }).length;
  const both = rows.filter(function (r) { return r.ly && r.spent; });
  const sumC = both.reduce(function (a, r) { return a + r.spent; }, 0), sumL = both.reduce(function (a, r) { return a + r.ly; }, 0);
  return { svg: s + '</svg>', cap: '<div class="legend"><span><b style="background:#2458C6;height:8px"></b>現金</span><span><b style="background:#EAB308;height:8px"></b>刷卡</span><span><b style="background:var(--ink)"></b>當月預算</span><span><b style="height:0;border-top:2px dashed #8A94A3"></b>去年同月</span></div>' +
    '<div class="sub" style="font-size:12px;margin-top:4px">近 12 個月有 ' + over + ' 個月超過預算。' + (both.length ? '有去年資料的 ' + both.length + ' 個月，合計比去年 ' + chg(sumC, sumL) + '。' : '') + '</div>' };
}
function chartWeek(d) {
  const names = ['日', '一', '二', '三', '四', '五', '六'], w = d.weekday, wl = d.weekdayLast;
  const ymax = niceMax(Math.max.apply(null, w.concat(wl || [], [100])) * 1.15);
  const X0 = 38, X1 = 352, Y0 = 228, Y1 = 14, bw = (X1 - X0) / 7;
  let mi = 0; w.forEach(function (v, i) { if (v > w[mi]) mi = i; });
  let s = svgOpen('星期花費分布，附去年同期') + yAxis(ymax, X0, X1, Y0, Y1);
  w.forEach(function (v, i) {
    const gw = bw - 10, cw = wl ? gw * 0.6 : gw, x = X0 + i * bw + 5, bh = v / ymax * (Y0 - Y1);
    s += '<rect x="' + x.toFixed(1) + '" y="' + (Y0 - bh).toFixed(1) + '" width="' + cw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="' + (i === mi ? '#C77700' : '#2458C6') + '"/>' +
      '<text x="' + (x + cw / 2).toFixed(1) + '" y="' + (Y0 - bh - 5).toFixed(1) + '" font-size="9" text-anchor="middle" fill="#1B2430">' + fmt(v) + '</text>';
    if (wl) { const lh = wl[i] / ymax * (Y0 - Y1); s += '<rect x="' + (x + cw + 1).toFixed(1) + '" y="' + (Y0 - lh).toFixed(1) + '" width="' + (gw - cw - 1).toFixed(1) + '" height="' + lh.toFixed(1) + '" rx="2" fill="#B8C0CC"/>'; }
    s += '<text x="' + (x + gw / 2).toFixed(1) + '" y="246" font-size="12" text-anchor="middle" fill="#5B6675">週' + names[i] + '</text>';
  });
  const tc = w.reduce(function (a, b) { return a + b; }, 0), tl = wl ? wl.reduce(function (a, b) { return a + b; }, 0) : 0;
  return { svg: s + '</svg>', cap: (wl ? '<div class="legend"><span><b style="background:#2458C6;height:8px"></b>近 3 個月</span><span><b style="background:#B8C0CC;height:8px"></b>去年同期 3 個月</span></div>' : '') +
    '<div class="sub" style="font-size:12px;margin-top:4px">平均每天花費（不含奉獻、國旅）。<b class="fast">週' + names[mi] + '</b>花最多。' + (tl ? '整體比去年同期 ' + chg(tc, tl) + '。' : '') + '</div>' };
}
function chartRank(d) {
  const it = d.items.slice(0, 8);
  let s = svgOpen('本月消費項目排行，附上月金額');
  if (!it.length) return { svg: s + '<text x="180" y="130" text-anchor="middle" fill="#5B6675" font-size="14">本月尚無可排行的項目</text></svg>', cap: '' };
  const max = Math.max.apply(null, it.map(function (r) { return Math.max(r.amount, r.prev || 0); })), X0 = 104, X1 = 250;
  it.forEach(function (r, i) {
    const y = 14 + i * 30, w = Math.max(3, r.amount / max * (X1 - X0)), wp = (r.prev || 0) / max * (X1 - X0);
    const name = r.item.length > 7 ? r.item.slice(0, 7) + '…' : r.item;
    s += '<text x="0" y="' + (y + 12) + '" font-size="12" fill="#1B2430">' + esc(name) + '</text>' +
      '<rect x="' + X0 + '" y="' + y + '" width="' + w.toFixed(1) + '" height="14" rx="4" fill="' + (CAT_COLOR[r.cat] || '#8A94A3') + '"/>' +
      (wp ? '<rect x="' + X0 + '" y="' + (y + 16) + '" width="' + wp.toFixed(1) + '" height="5" rx="2" fill="#B8C0CC"/>' : '') +
      '<text x="' + (X0 + Math.max(w, wp) + 5).toFixed(1) + '" y="' + (y + 11) + '" font-size="11" fill="#1B2430">$' + fmt(r.amount) + '</text>' +
      '<text x="' + (X0 + Math.max(w, wp) + 5).toFixed(1) + '" y="' + (y + 22) + '" font-size="9" fill="' + chgCol(r.amount, r.prev) + '">' + (r.prev ? '上月 $' + fmt(r.prev) + ' ' + chgTxt(r.amount, r.prev) : '上月無') + '</text>';
  });
  return { svg: s + '</svg>', cap: '<div class="legend"><span><b style="background:#2458C6;height:8px"></b>本月（顏色＝科目）</span><span><b style="background:#B8C0CC;height:5px"></b>上月同項目</span></div><div class="sub" style="font-size:12px;margin-top:4px">本月花費最多的項目（不含奉獻）。項目名稱記得一致，比較才準。</div>' };
}
function renderChartPane() {
  const d = S.month, t = CT[S.ct], z = $('zoomer'); if (!z) return;
  document.querySelectorAll('.ctab').forEach(function (b, i) { b.classList.toggle('on', i === S.ct); });
  $('cdots').innerHTML = CT.map(function (x, i) { return '<i class="' + (i === S.ct ? 'on' : '') + '"></i>'; }).join('');
  const box = $('chartbox'); if (box && box._zoom) box._zoom.reset();
  let r;
  if (t.key === 'trend') {
    const key = d.y + '-' + d.m;
    if (!S.trendCache[key]) {
      z.innerHTML = '<div class="loading" style="padding-top:110px">載入 12 個月資料…</div>'; $('ccap').innerHTML = '';
      call('trend', { y: d.y, m: d.m }).then(function (rows) { S.trendCache[key] = rows; if (CT[S.ct].key === 'trend' && S.month === d) renderChartPane(); }).catch(err);
      return;
    }
    r = chartTrend(S.trendCache[key]);
  } else if (t.key === 'cum') r = chartCum(d);
  else if (t.key === 'donut') r = chartDonut(d);
  else if (t.key === 'daily') r = chartDaily(d);
  else if (t.key === 'week') r = chartWeek(d);
  else r = chartRank(d);
  z.innerHTML = r.svg; $('ccap').innerHTML = r.cap;
}

// ---------- 縮放與拖曳 ----------
function enableZoom(box, onSwipe) {
  const z = box.querySelector('.zoomer');
  const st = { s: 1, x: 0, y: 0 };
  const apply = function () {
    const W = box.clientWidth, H = box.clientHeight;
    st.s = Math.min(4, Math.max(1, st.s));
    st.x = Math.min(0, Math.max(W - W * st.s, st.x)); st.y = Math.min(0, Math.max(H - H * st.s, st.y));
    z.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')';
    box.classList.toggle('zoomed', st.s > 1.01);
  };
  const zoomAt = function (factor, cx, cy) {
    const ns = Math.min(4, Math.max(1, st.s * factor)), k = ns / st.s;
    st.x = cx - (cx - st.x) * k; st.y = cy - (cy - st.y) * k; st.s = ns; apply();
  };
  box._zoom = { reset: function () { st.s = 1; st.x = 0; st.y = 0; apply(); } };
  let t0 = null, pinch = null, lastTap = 0;
  box.addEventListener('touchstart', function (e) {
    e.stopPropagation();
    const r = box.getBoundingClientRect();
    if (e.touches.length === 2) {
      const a = e.touches[0], b = e.touches[1];
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: st.s, cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top, x: st.x, y: st.y };
      t0 = null;
    } else if (e.touches.length === 1) {
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, sx: st.x, sy: st.y, moved: false };
    }
  }, { passive: true });
  box.addEventListener('touchmove', function (e) {
    e.stopPropagation();
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const a = e.touches[0], b = e.touches[1];
      const ns = Math.min(4, Math.max(1, pinch.s * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d)), k = ns / pinch.s;
      st.s = ns; st.x = pinch.cx - (pinch.cx - pinch.x) * k; st.y = pinch.cy - (pinch.cy - pinch.y) * k; apply();
    } else if (t0 && e.touches.length === 1) {
      const dx = e.touches[0].clientX - t0.x, dy = e.touches[0].clientY - t0.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) t0.moved = true;
      if (st.s > 1.01) { e.preventDefault(); st.x = t0.sx + dx; st.y = t0.sy + dy; apply(); }
      else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) e.preventDefault();
    }
  }, { passive: false });
  box.addEventListener('touchend', function (e) {
    e.stopPropagation();
    if (pinch) { if (e.touches.length < 2) pinch = null; return; }
    if (!t0) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    if (!t0.moved) {
      const now = Date.now();
      if (now - lastTap < 300) { box._zoom.reset(); lastTap = 0; } else lastTap = now;
    } else if (st.s <= 1.01 && onSwipe && Math.abs(dx) > 50 && Math.abs(dy) < 60) {
      onSwipe(dx < 0 ? 1 : -1);
    }
    t0 = null;
  });
  box.addEventListener('wheel', function (e) {
    e.preventDefault(); const r = box.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let md = null;
  box.addEventListener('mousedown', function (e) { if (st.s > 1.01) md = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y }; });
  box.addEventListener('mousemove', function (e) { if (md) { st.x = md.sx + e.clientX - md.x; st.y = md.sy + e.clientY - md.y; apply(); } });
  box.addEventListener('mouseup', function () { md = null; });
  box.addEventListener('mouseleave', function () { md = null; });
  const ctl = document.getElementById(box.id + '-z');
  if (ctl) ctl.addEventListener('click', function (e) {
    const b = e.target.closest('[data-z]'); if (!b) return;
    e.stopPropagation();
    const W = box.clientWidth / 2, H = box.clientHeight / 2;
    if (b.dataset.z === 'in') zoomAt(1.4, W, H);
    else if (b.dataset.z === 'out') zoomAt(1 / 1.4, W, H);
    else box._zoom.reset();
  });
  apply();
}
function chartBoxHTML(id) {
  return '<div class="chartbox" id="' + id + '"><div class="zoomer"></div></div>' +
    '<div class="zoomctl" id="' + id + '-z"><button data-z="in" aria-label="放大">＋</button><button data-z="out" aria-label="縮小">−</button><button data-z="reset" aria-label="還原">⟲ 還原</button></div>';
}

// ---------- 科目明細 ----------
// ---------- 科目明細圖表（可左右滑動切換）----------
const CCT = [
  { key: 'cum', name: '累計曲線' }, { key: 'items', name: '項目組成' }, { key: 'daily', name: '每日花費' },
  { key: 'trend', name: '12個月趨勢' }, { key: 'size', name: '單筆金額分布' }, { key: 'week', name: '星期分布' }, { key: 'freq', name: '筆數與客單價' }
];
const ITEM_COLORS = ['#2458C6', '#C77700', '#0F8B8D', '#C2185B', '#6B4FA0', '#1E7A4C', '#8A94A3'];
S.cct = 0; S.catMoreCache = {};
function cCum(d) { return { svg: lineChart(d.curves, d.budget, { aria: d.cat + '累計花費曲線' }).replace('width="100%"', 'width="100%" height="100%"'), cap: legend(d.curves, d.budget) }; }
function cItems(d) {
  const all = d.items.filter(function (r) { return r.amount > 0; });
  const total = all.reduce(function (s, r) { return s + r.amount; }, 0);
  let s = svgOpen(d.cat + '項目組成');
  if (!total) return { svg: s + '<text x="180" y="130" text-anchor="middle" fill="#5B6675" font-size="14">本月尚無花費</text></svg>', cap: '' };
  const top = all.slice(0, 6), rest = all.slice(6);
  if (rest.length) top.push({ item: '其他 ' + rest.length + ' 項', amount: rest.reduce(function (s, r) { return s + r.amount; }, 0), prev: rest.reduce(function (s, r) { return s + r.prev; }, 0), count: rest.reduce(function (s, r) { return s + r.count; }, 0) });
  let a = 0; const cx = 82, cy = 130;
  top.forEach(function (r, i) { const a1 = a + r.amount / total * Math.PI * 2 - 0.0001; s += '<path d="' + arcPath(cx, cy, 78, 46, a, a1) + '" fill="' + ITEM_COLORS[i % 7] + '" stroke="#fff" stroke-width="2"/>'; a = a1 + 0.0001; });
  s += '<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="11" fill="#5B6675">' + esc(d.cat) + '</text><text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#1B2430">$' + fmt(total) + '</text>';
  const gap = Math.min(34, 240 / top.length);
  top.forEach(function (r, i) {
    const y = 22 + i * gap, nm = r.item === '舊帳轉入' ? '舊帳（未分項目）' : r.item, name = nm.length > 8 ? nm.slice(0, 8) + '…' : nm;
    s += '<rect x="170" y="' + (y - 10) + '" width="11" height="11" rx="3" fill="' + ITEM_COLORS[i % 7] + '"/><text x="186" y="' + y + '" font-size="12" fill="#1B2430">' + esc(name) + ' ' + Math.round(r.amount / total * 100) + '%</text>' +
      '<text x="186" y="' + (y + 13) + '" font-size="10" fill="#5B6675">$' + fmt(r.amount) + '（' + r.count + '筆）｜上月 <tspan fill="' + chgCol(r.amount, r.prev) + '">' + (r.prev ? chgTxt(r.amount, r.prev) : '無') + '</tspan></text>';
  });
  return { svg: s + '</svg>', cap: '<div class="sub" style="font-size:12px">這個科目的錢花在哪些項目，以及和上月同項目比較（▲紅＝花得比較多）。</div>' };
}
function cDaily(d) {
  const r = chartDaily({ daily: d.daily, sameDay: { day: d.curves.cur.length }, curves: d.curves });
  return r;
}
function cTrend(x) {
  const rows = x.months;
  const ymax = niceMax(Math.max.apply(null, rows.map(function (r) { return Math.max(r.total, r.budget, r.ly || 0); }).concat([500])) * 1.1);
  const X0 = 38, X1 = 352, Y0 = 228, Y1 = 14, bw = (X1 - X0) / 12;
  let s = svgOpen(x.cat + '近12個月趨勢') + yAxis(ymax, X0, X1, Y0, Y1);
  rows.forEach(function (r, i) {
    const xx = X0 + i * bw + 3, w = bw - 6, hc = r.cash / ymax * (Y0 - Y1), hk = r.card / ymax * (Y0 - Y1);
    if (hc) s += '<rect x="' + xx.toFixed(1) + '" y="' + (Y0 - hc).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hc.toFixed(1) + '" fill="#2458C6"/>';
    if (hk) s += '<rect x="' + xx.toFixed(1) + '" y="' + (Y0 - hc - hk).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hk.toFixed(1) + '" fill="#EAB308"/>';
    if (r.budget) { const yb = Y0 - r.budget / ymax * (Y0 - Y1); s += '<line x1="' + (xx - 2).toFixed(1) + '" y1="' + yb + '" x2="' + (xx + w + 2).toFixed(1) + '" y2="' + yb + '" stroke="#1B2430" stroke-width="2.5"/>'; }
    if (r.ly) { const yl = Y0 - r.ly / ymax * (Y0 - Y1); s += '<circle cx="' + (xx + w / 2).toFixed(1) + '" cy="' + yl.toFixed(1) + '" r="3.5" fill="#fff" stroke="#8A94A3" stroke-width="2"/>'; }
    s += '<text x="' + (xx + w / 2).toFixed(1) + '" y="246" font-size="10" text-anchor="middle" fill="' + (i === 11 ? '#1B2430' : '#5B6675') + '">' + r.m + '月</text>';
  });
  const withB = rows.filter(function (r) { return r.budget && !r.none; }), over = withB.filter(function (r) { return r.total > r.budget; }).length;
  const avg = rows.filter(function (r) { return !r.none && r.total; });
  const mean = avg.length ? avg.reduce(function (a, r) { return a + r.total; }, 0) / avg.length : 0;
  return { svg: s + '</svg>', cap: '<div class="legend"><span><b style="background:#2458C6;height:8px"></b>現金</span><span><b style="background:#EAB308;height:8px"></b>刷卡</span><span><b style="background:var(--ink)"></b>預算</span><span><b style="height:0;border-top:2px solid #8A94A3;border-radius:4px;width:8px"></b>去年同月</span></div>' +
    '<div class="sub" style="font-size:12px;margin-top:4px">月平均 $' + fmt(mean) + '；有預算的 ' + withB.length + ' 個月中 ' + over + ' 個月超支。</div>' };
}
function cSize(x) {
  const ds = x.dist, mx = Math.max.apply(null, ds.map(function (b) { return Math.max(b.count, b.prev || 0); }).concat([1]));
  const ymax = Math.max(4, Math.ceil(mx * 1.2));
  const X0 = 30, X1 = 352, Y0 = 220, Y1 = 16, bw = (X1 - X0) / ds.length;
  let s = svgOpen(x.cat + '單筆金額分布');
  [0, Math.round(ymax / 2), ymax].forEach(function (v) { const yy = Y0 - v / ymax * (Y0 - Y1); s += '<line x1="' + X0 + '" y1="' + yy + '" x2="' + X1 + '" y2="' + yy + '" stroke="#EEF1F5"/><text x="0" y="' + (yy + 4) + '" font-size="10" fill="#5B6675">' + v + '筆</text>'; });
  ds.forEach(function (b, i) {
    const xx = X0 + i * bw + 6, w = (bw - 12) * 0.62, h = b.count / ymax * (Y0 - Y1);
    s += '<rect x="' + xx.toFixed(1) + '" y="' + (Y0 - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="#2458C6"/>' +
      (b.count ? '<text x="' + (xx + w / 2).toFixed(1) + '" y="' + (Y0 - h - 4).toFixed(1) + '" font-size="10" text-anchor="middle" fill="#1B2430">' + b.count + '</text>' : '');
    if (b.prev != null) { const hp = b.prev / ymax * (Y0 - Y1); s += '<rect x="' + (xx + w + 1).toFixed(1) + '" y="' + (Y0 - hp).toFixed(1) + '" width="' + ((bw - 12) * 0.38 - 1).toFixed(1) + '" height="' + hp.toFixed(1) + '" rx="2" fill="#B8C0CC"/>'; }
    s += '<text x="' + (X0 + i * bw + bw / 2).toFixed(1) + '" y="240" font-size="10" text-anchor="middle" fill="#5B6675">' + b.label + '</text>';
  });
  const tot = ds.reduce(function (a, b) { return a + b.amount; }, 0), big = ds.slice(3).reduce(function (a, b) { return a + b.amount; }, 0), small = ds.slice(0, 2).reduce(function (a, b) { return a + b.count; }, 0);
  return { svg: s + '</svg>', cap: '<div class="legend"><span><b style="background:#2458C6;height:8px"></b>本月筆數</span>' + (x.distPrevMonths ? '<span><b style="background:#B8C0CC;height:8px"></b>前 ' + x.distPrevMonths + ' 個月平均</span>' : '') + '</div>' +
    '<div class="sub" style="font-size:12px;margin-top:4px">' + (tot ? '500 元以上的大筆消費占金額 ' + Math.round(big / tot * 100) + '%；300 元以下的小額有 ' + small + ' 筆，積少成多也要留意。' : '本月尚無逐筆紀錄（舊帳轉入不列入）。') + '</div>' };
}
function cWeek(x) { return chartWeek({ weekday: x.weekday || [0, 0, 0, 0, 0, 0, 0], weekdayLast: x.weekdayLast }); }
function cFreq(x) {
  const rows = x.months.filter(function (r) { return r.count > 0 || r.avg > 0; });
  let s = svgOpen(x.cat + '每月筆數與平均單價');
  if (!rows.length) return { svg: s + '<text x="180" y="130" text-anchor="middle" fill="#5B6675" font-size="13">逐筆記帳累積後才會顯示（舊帳轉入不列入）</text></svg>', cap: '' };
  const cm = Math.max(4, Math.max.apply(null, rows.map(function (r) { return r.count; })) * 1.2), am = niceMax(Math.max.apply(null, rows.map(function (r) { return r.avg; })) * 1.2);
  const X0 = 34, X1 = 326, Y0 = 220, Y1 = 20, bw = (X1 - X0) / rows.length;
  s += '<text x="0" y="14" font-size="10" fill="#2458C6">筆數</text><text x="360" y="14" font-size="10" text-anchor="end" fill="#C77700">客單價</text>';
  [0, 0.5, 1].forEach(function (f) { const yy = Y0 - f * (Y0 - Y1); s += '<line x1="' + X0 + '" y1="' + yy + '" x2="' + X1 + '" y2="' + yy + '" stroke="#EEF1F5"/><text x="0" y="' + (yy + 4) + '" font-size="10" fill="#2458C6">' + Math.round(cm * f) + '</text><text x="360" y="' + (yy + 4) + '" font-size="10" text-anchor="end" fill="#C77700">' + fmt(am * f) + '</text>'; });
  const pts = [];
  rows.forEach(function (r, i) {
    const xx = X0 + i * bw + 5, w = bw - 10, h = r.count / cm * (Y0 - Y1);
    s += '<rect x="' + xx.toFixed(1) + '" y="' + (Y0 - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="#2458C6" opacity="0.85"/>' +
      '<text x="' + (xx + w / 2).toFixed(1) + '" y="240" font-size="10" text-anchor="middle" fill="#5B6675">' + r.m + '月</text>';
    pts.push((xx + w / 2).toFixed(1) + ',' + (Y0 - r.avg / am * (Y0 - Y1)).toFixed(1));
  });
  s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#C77700" stroke-width="2.5"/>' + pts.map(function (p) { const q = p.split(','); return '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3.5" fill="#C77700"/>'; }).join('');
  const last = rows[rows.length - 1], prev = rows.length > 1 ? rows[rows.length - 2] : null;
  return { svg: s + '</svg>', cap: '<div class="legend"><span><b style="background:#2458C6;height:8px"></b>每月筆數</span><span><b style="background:#C77700"></b>平均每筆金額</span></div>' +
    '<div class="sub" style="font-size:12px;margin-top:4px">' + last.m + ' 月 ' + last.count + ' 筆、平均 $' + fmt(last.avg) + (prev ? '；上個月 ' + prev.count + ' 筆、平均 $' + fmt(prev.avg) + '。筆數多是次數問題，客單價高是單價問題。' : '。') + '</div>' };
}
function renderCatPane() {
  const d = S.catData, t = CCT[S.cct], z = $('catzoomer'); if (!z) return;
  document.querySelectorAll('.cctab').forEach(function (b, i) { b.classList.toggle('on', i === S.cct); });
  $('ccdots').innerHTML = CCT.map(function (x, i) { return '<i class="' + (i === S.cct ? 'on' : '') + '"></i>'; }).join('');
  const box = $('catbox'); if (box && box._zoom) box._zoom.reset();
  let r;
  if (t.key === 'cum') r = cCum(d); else if (t.key === 'items') r = cItems(d); else if (t.key === 'daily') r = cDaily(d);
  else {
    const key = d.y + '-' + d.m + '-' + d.cat, x = S.catMoreCache[key];
    if (!x) {
      z.innerHTML = '<div class="loading" style="padding-top:110px">分析近 12 個月資料…</div>'; $('cccap').innerHTML = '';
      call('catMore', { y: d.y, m: d.m, cat: d.cat }).then(function (res) { S.catMoreCache[key] = res; if (S.catData === d && CCT[S.cct].key === t.key) renderCatPane(); }).catch(err);
      return;
    }
    r = t.key === 'trend' ? cTrend(x) : t.key === 'size' ? cSize(x) : t.key === 'week' ? cWeek(x) : cFreq(x);
  }
  z.innerHTML = r.svg; $('cccap').innerHTML = r.cap;
}

function loadCat() {
  const el = $('v-cat');
  if (S.catData && el.innerHTML) el.classList.add('dim'); else { const mm = document.querySelector('main'); if (mm) mm.scrollTop = 0; el.innerHTML = '<div class="loading">載入中…</div>'; }
  call('category', { y: S.catYM.y, m: S.catYM.m, cat: S.cat }).then(function (d) { el.classList.remove('dim'); S.catData = d; renderCat(); }).catch(function (e) { el.classList.remove('dim'); err(e); });
}
function catStep(k) {
  const d = S.catData; if (!d) return;
  const i = d.order.indexOf(d.cat), j = (i + k + d.order.length) % d.order.length;
  S.cat = d.order[j]; loadCat();
}
function entryRow(r, withFlag) {
  const cls = r.pay === '現金' ? 'amt-c' : 'amt-k';
  if (withFlag && r.flag) {
    return '<div class="li flag" style="flex-direction:column;align-items:stretch;gap:4px"><div class="row">' + ICON.warn.replace('#C77700', '#B42318') +
      '<div class="col" style="flex:1"><b style="color:var(--redInk)">' + esc(r.item) + '</b><span style="font-size:12px;color:var(--redInk)">' + md(r.date) + '・' + r.pay + '</span></div><b style="color:var(--red)">$' + fmt(r.amount) + '</b></div>' +
      '<span style="font-size:12px;color:var(--redInk);padding-left:32px">' + esc(r.flag) + '</span></div>';
  }
  return '<div class="li"><div class="col" style="flex:1;gap:1px"><span style="font-size:15px;font-weight:500">' + esc(r.item) + '</span><span class="sub" style="font-size:12px">' + md(r.date) + '・' + r.pay + (r.note ? '・' + esc(r.note) : '') + '</span></div><span class="' + cls + '">$' + fmt(r.amount) + '</span></div>';
}
function renderCat() {
  const d = S.catData, el = $('v-cat'), p = PACE[d.pace];
  const i = d.order.indexOf(d.cat), prev = d.order[(i - 1 + d.order.length) % d.order.length], next = d.order[(i + 1) % d.order.length];
  const rem = Math.max(0, d.budget - d.total);
  let h = '<button class="chip" data-act="back" style="border:none;background:none;padding:0;color:var(--blue)">‹ 圖表｜' + d.y + '年' + d.m + '月</button>' +
    '<div class="row" style="margin:6px 0 12px"><button class="chip" data-act="prev">‹ ' + esc(prev) + '</button><div class="col" style="align-items:center"><h1>' + esc(d.cat) + '</h1><span class="sub" style="font-size:12px">按左右按鈕切換科目</span></div><button class="chip" data-act="next">' + esc(next) + ' ›</button></div>';
  h += '<div class="grid2" style="align-items:start"><div><div class="card"><div class="row" style="align-items:baseline"><span class="mid ' + p[1] + '">$' + fmt(d.total) + (d.budget ? '<span class="sub" style="font-size:13px;font-weight:400">　／ $' + fmt(d.budget) + '</span>' : '') + '</span>' +
    (d.budget ? '<span class="tag ' + p[1] + ' ' + p[1] + 'bg">' + p[0] + ' ' + pct(d.total, d.budget) + '%</span>' : '') + '</div>' + bar(d.cash, d.card, d.budget) +
    '<div class="sub" style="font-size:12px;margin-top:6px">' + splitText(d.cash, d.card) + (d.budget ? '｜剩 $' + fmt(rem) + (d.daysLeft ? '，每天約 $' + fmt(rem / d.daysLeft) : '') : '') + '</div>' + catCmp(d) +
    (d.budget && d.cat !== '國旅' ? '<button class="chip" data-act="xfer" style="height:34px;margin-top:10px;font-size:13px">⇄ 調撥預算</button>' : '') + '<div id="xferList"></div></div>' +
    '<div class="card"><div class="items" style="margin-bottom:8px">' + CCT.map(function (t, i) { return '<button class="chip cctab ' + (i === S.cct ? 'on' : '') + '" data-act="cct" data-v="' + i + '" style="height:36px">' + t.name + '</button>'; }).join('') + '</div>' +
    chartBoxHTML('catbox') + '<div class="cdots" id="ccdots"></div><div class="ccap" id="cccap"></div><div class="sub" style="font-size:11px;text-align:center">在圖上左右滑動切換圖表｜兩指縮放、拖曳｜點兩下還原</div></div></div><div>';
  if (d.flagged.length) h += '<div class="row" style="margin:4px 0 8px"><b>需要檢討（' + d.flagged.length + ' 筆）</b><span class="sub" style="font-size:12px">與同項目近 3 個月平均比較</span></div><div class="list">' + d.flagged.map(function (r) { return entryRow(r, true); }).join('') + '</div>';
  h += '<b style="display:block;margin:4px 0 8px">全部明細（' + d.entries.length + ' 筆）</b><div class="list">' + (d.entries.length ? d.entries.map(function (r) { return entryRow(r, true); }).join('') : '<div class="li sub">本月尚無紀錄</div>') + '</div></div></div>';
  el.innerHTML = h;
  loadTransfers(d);
  const cb = $('catbox'); cb.querySelector('.zoomer').id = 'catzoomer';
  enableZoom(cb, function (dir) { S.cct = (S.cct + dir + CCT.length) % CCT.length; renderCatPane(); });
  renderCatPane();
}
$('v-cat').addEventListener('click', function (e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'back') show('charts');
  if (b.dataset.act === 'cct') { S.cct = +b.dataset.v; return renderCatPane(); }
  if (b.dataset.act === 'xfer') return openTransfer(S.catData);
  if (b.dataset.act === 'xfdel') { if (!confirm('刪除這筆調撥？')) return; return call('deleteLog', { y: S.catData.y, row: +b.dataset.row }).then(function (r) { toast(r.message); clearCaches(); afterWrite(); loadCat(); }).catch(err); }
  if (b.dataset.act === 'prev') catStep(-1);
  if (b.dataset.act === 'next') catStep(1);
});

// ---------- 紀錄 ----------
function loadRecords() {
  if (!S.recYM) S.recYM = todayYM();
  const key = S.recYM.y + '-' + S.recYM.m, c = S.recCache[key];
  if (c) { S.rec = c.d; renderRecords(); if (fresh(c, 30000)) return; }
  else $('v-records').innerHTML = monthHeader(S.recYM, 'rc', '') + '<div class="loading">載入中…</div>';
  call('records', S.recYM).then(function (d) { S.recCache[key] = { t: Date.now(), d: d }; if (d.y !== S.recYM.y || d.m !== S.recYM.m) return; S.rec = d; renderRecords(); }).catch(function () { $('v-records').innerHTML = monthHeader(S.recYM, 'rc', '') + '<div class="loading">此月份沒有資料</div>'; });
}
function renderRecords() {
  const d = S.rec, el = $('v-records');
  const q = S.recSearch.trim(), fl = S.recFilter;
  const rows = d.rows.filter(function (r) {
    if (fl === '只看信用卡' && r.pay !== '信用卡') return false;
    if (fl !== '全部' && fl !== '只看信用卡' && r.cat !== fl) return false;
    if (q && (r.item + r.note).indexOf(q) < 0) return false;
    return true;
  });
  let h = monthHeader(d, 'rc', '共 ' + d.rows.length + ' 筆｜$' + fmt(d.total)) +
    '<button class="chip" data-act="bill" style="width:100%;height:42px;margin-bottom:10px;border:1px solid var(--cardC);color:var(--cardInk);font-weight:700">信用卡帳單對帳</button>';
  h += '<input class="f" id="recSearch" type="search" placeholder="搜尋項目或備註" value="' + esc(q) + '" style="border-radius:22px;margin-bottom:10px">';
  h += '<div class="items" style="margin-bottom:12px">' + ['全部', '奉獻', '食物', '教育', '油料', '娛樂', '其他', '國旅', '只看信用卡'].map(function (c) { return '<button class="chip ' + (fl === c ? 'on' : '') + '" data-act="filter" data-v="' + c + '" style="height:36px">' + c + '</button>'; }).join('') + '</div>';
  const groups = {};
  rows.forEach(function (r) { (groups[r.date] = groups[r.date] || []).push(r); });
  Object.keys(groups).sort().reverse().forEach(function (day) {
    const sum = groups[day].reduce(function (s, r) { return s + r.amount; }, 0);
    h += '<div class="sub" style="font-size:12px;font-weight:500;margin:4px 0 6px">' + md(day) + '（' + wk(day) + '）　$' + fmt(sum) + '</div><div class="list">' +
      groups[day].map(function (r) {
        return '<button class="li" data-act="edit" data-row="' + r.row + '" style="width:100%;border-left:none;border-right:none;border-top:none;background:var(--card);text-align:left"><div class="col" style="flex:1;gap:1px"><span style="font-size:15px;font-weight:500">' + esc(r.item) + '</span><span class="sub" style="font-size:12px">' + esc(r.cat) + '・' + r.pay + (r.note ? '・' + esc(r.note) : '') + '</span></div><span class="' + (r.pay === '現金' ? 'amt-c' : 'amt-k') + '">$' + fmt(r.amount) + '</span></button>';
      }).join('') + '</div>';
  });
  if (!rows.length) h += '<div class="loading">沒有符合的紀錄</div>';
  h += '<div class="sub" style="text-align:center;font-size:12px;margin:8px 0">本月已用 ' + d.rows.length + ' ／ ' + d.capacity + ' 筆</div>';
  el.innerHTML = h;
  const s = $('recSearch'); s.oninput = function () { S.recSearch = s.value; clearTimeout(s._t); s._t = setTimeout(function () { renderRecords(); const n = $('recSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
}
$('v-records').addEventListener('click', function (e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'rc-prev') { S.recYM = ymAdd(S.recYM, -1); loadRecords(); }
  if (a === 'rc-next') { S.recYM = ymAdd(S.recYM, 1); loadRecords(); }
  if (a === 'filter') { S.recFilter = b.dataset.v; renderRecords(); }
  if (a === 'bill') openBill();
  if (a === 'edit') openEdit(S.rec.rows.filter(function (r) { return r.row === +b.dataset.row; })[0]);
});
function openEdit(r) {
  const cats = ['奉獻', '食物', '教育', '油料', '娛樂', '其他', '國旅'];
  openModal('<b style="font-size:16px">編輯紀錄</b>' +
    '<label class="sub">日期<input type="date" class="f" id="edDate" value="' + r.date + '"></label>' +
    '<label class="sub">科目<select class="f" id="edCat">' + cats.map(function (c) { return '<option ' + (c === r.cat ? 'selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
    '<label class="sub">項目<input class="f" id="edItem" value="' + esc(r.item) + '"></label>' +
    '<label class="sub">金額<input class="f" id="edAmt" inputmode="numeric" value="' + r.amount + '"></label>' +
    '<label class="sub">支付方式<select class="f" id="edPay"><option ' + (r.pay === '現金' ? 'selected' : '') + '>現金</option><option ' + (r.pay === '信用卡' ? 'selected' : '') + '>信用卡</option></select></label>' +
    '<label class="sub">備註<input class="f" id="edNote" value="' + esc(r.note) + '"></label>' +
    '<div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><button class="submit" style="background:var(--card);color:var(--red);border:1px solid var(--red)" data-ed="del">刪除</button><button class="submit" style="background:var(--blue)" data-ed="save">儲存</button></div>' +
    '<button class="chip" data-ed="cancel" style="align-self:center;border:none">取消</button>');
  $('modalBox').onclick = function (e) {
    const b = e.target.closest('[data-ed]'); if (!b) return;
    const base = { y: S.rec.y, m: S.rec.m, row: r.row };
    if (b.dataset.ed === 'cancel') return closeModal();
    if (b.dataset.ed === 'del') { if (!confirm('確定刪除這筆紀錄？')) return; call('delete', base).then(function () { closeModal(); toast('已刪除'); clearCaches(); loadRecords(); S.dashStale = true; }).catch(err); }
    if (b.dataset.ed === 'save') {
      call('update', Object.assign(base, { date: $('edDate').value, cat: $('edCat').value, item: $('edItem').value, amount: $('edAmt').value, pay: $('edPay').value, note: $('edNote').value }))
        .then(function () { closeModal(); toast('已更新'); clearCaches(); loadRecords(); S.dashStale = true; }).catch(err);
    }
  };
}

// ---------- 資產（滿月盤點）----------
function loadAssets() {
  if (!S.assetYM) { const t = todayYM(), dd = S.form ? +S.form.today.slice(8, 10) : 15; S.assetYM = dd <= 5 ? ymAdd(t, -1) : t; }
  $('v-assets').innerHTML = monthHeader(S.assetYM, 'as', '滿月記帳｜月底盤點') + '<div class="loading">載入中…</div>';
  call('monthly', S.assetYM).then(function (d) { S.asset = d; S.assetVals = {}; d.accounts.forEach(function (a) { S.assetVals[a.key] = a.value === '' ? '' : String(a.value); }); renderAssets(); })
    .catch(function () { $('v-assets').innerHTML = monthHeader(S.assetYM, 'as', '滿月記帳｜月底盤點') + '<div class="loading">此月份沒有資料</div>'; });
}
function assetCalc() {
  const d = S.asset; let total = 0, missing = 0;
  d.accounts.forEach(function (a) {
    const v = S.assetVals[a.key];
    if (v === '' || v == null) { if (a.auto) total += a.book || 0; else if (a.prev) missing++; }
    else total += Number(String(v).replace(/,/g, '')) || 0;
  });
  return { total: total, missing: missing, diff: total - d.prevTotal };
}
function assetChart(hist, curTotal, missing, lastYear) {
  const vals = hist.slice(0, -1).concat([missing ? null : curTotal]);
  const W = 360, X0 = 40, X1 = 350, Y0 = 150, Y1 = 16, n = Math.max(vals.length, 2);
  const ly = (lastYear || []).map(function (v) { return v > 0 ? v : null; });
  const ymax = niceMax(Math.max.apply(null, vals.filter(function (x) { return x != null; }).concat(ly.filter(function (x) { return x != null; }), [1])) * 1.1);
  const X = function (i) { return X0 + i / Math.max(11, n - 1) * (X1 - X0); }, Y = function (v) { return Y0 - v / ymax * (Y0 - Y1); };
  const pts = vals.map(function (v, i) { return v == null ? null : X(i).toFixed(0) + ',' + Y(v).toFixed(0); }).filter(Boolean).join(' ');
  let s = '<svg viewBox="0 0 ' + W + ' 175" width="100%" role="img" aria-label="每月資產總計走勢">';
  [0, 0.5, 1].forEach(function (f) { const yy = Y(ymax * f); s += '<line x1="' + X0 + '" y1="' + yy + '" x2="' + X1 + '" y2="' + yy + '" stroke="#EEF1F5"/><text x="0" y="' + (yy + 4) + '" font-size="10" fill="#5B6675">' + (ymax * f / 10000).toFixed(ymax * f % 10000 ? 1 : 0) + '萬</text>'; });
  const lyPts = ly.map(function (v, i) { return v == null ? null : X(i).toFixed(0) + ',' + Y(v).toFixed(0); }).filter(Boolean).join(' ');
  if (lyPts) s += '<polyline points="' + lyPts + '" fill="none" stroke="#8A94A3" stroke-width="2" stroke-dasharray="4 3"/>';
  s += '<polyline points="' + pts + '" fill="none" stroke="#1E7A4C" stroke-width="3" stroke-linejoin="round"/>';
  vals.forEach(function (v, i) { const last = i === vals.length - 1; const yv = v == null ? Y(vals[i - 1] || 0) : Y(v); s += '<circle cx="' + X(i) + '" cy="' + yv + '" r="' + (last ? 5 : 3) + '" fill="' + (v == null ? '#fff' : '#1E7A4C') + '" stroke="#1E7A4C" stroke-width="2"/>'; });
  s += '<text x="' + (X0 - 4) + '" y="170" font-size="10" fill="#5B6675">1月</text><text x="' + (X1 - 24) + '" y="170" font-size="10" fill="#5B6675">12月</text></svg>';
  return s;
}
// ---------- 資產頁圖表（可左右滑動切換）----------
const KIND_COLOR = { '活存': '#2458C6', '定存': '#0F8B8D', '投資': '#C77700', '保險': '#6B4FA0', '不動產': '#1E7A4C', '其他': '#8A94A3' };
const AT = [
  { key: 'trend', name: '資產走勢' }, { key: 'alloc', name: '資產配置' }, { key: 'change', name: '每月增減' },
  { key: 'flow', name: '收支與儲蓄率' }, { key: 'safety', name: '安全水位' }, { key: 'cover', name: '生活費可撐幾個月' }
];
S.act = 0;
function assetTypes() { return AT.filter(function (t) { return t.key !== 'safety' || (S.asset && S.asset.series && S.asset.series.emergency); }); }
function liveSeries() {
  const d = S.asset, c = assetCalc(), hist = d.history.slice();
  if (!c.missing) hist[hist.length - 1] = c.total;
  const liquid = d.series.liquid.slice();
  let lv = 0;
  d.accounts.forEach(function (a) {
    if (a.kind !== '活存' && a.kind !== '定存') return;
    const v = S.assetVals[a.key];
    lv += (v === '' || v == null) ? (a.auto ? (a.book || 0) : (a.prev || 0)) : (Number(v) || 0);
  });
  liquid[liquid.length - 1] = lv;
  return { total: hist, liquid: liquid, c: c };
}
function monthLabelsSvg(n, X0, X1, y) {
  let s = ''; const bw = (X1 - X0) / 12;
  for (let i = 0; i < n; i++) s += '<text x="' + (X0 + i * bw + bw / 2).toFixed(1) + '" y="' + y + '" font-size="10" text-anchor="middle" fill="#5B6675">' + (i + 1) + '月</text>';
  return s;
}
function aTrend() {
  const L = liveSeries(), d = S.asset, ly = d.lastYear ? d.lastYear.total : null;
  const lyNow = ly && ly[d.m - 1] > 0 ? ly[d.m - 1] : null;
  return { svg: assetChart(d.history, L.c.total, L.c.missing, ly).replace('width="100%"', 'width="100%" height="100%"'),
    cap: '<div class="legend"><span><b style="background:#1E7A4C"></b>' + d.y + ' 年</span>' + (ly ? '<span><b style="height:0;border-top:2px dashed #8A94A3"></b>' + (d.y - 1) + ' 年</span>' : '') + '</div>' +
      '<div class="sub" style="font-size:12px;margin-top:4px">' + (L.c.missing ? '本月還有項目未填，以空心點表示。' : '本月 $' + fmt(L.c.total) + '，比上月 ' + chg(L.c.total, d.prevTotal, true) + (lyNow ? '，比去年同月 $' + fmt(lyNow) + ' ' + chg(L.c.total, lyNow, true) : '') + '。') + '</div>' };
}
function aAlloc() {
  const d = S.asset, g = {}, gp = {};
  d.accounts.forEach(function (a) {
    const v = S.assetVals[a.key];
    const val = (v === '' || v == null) ? (a.auto ? (a.book || 0) : 0) : (Number(v) || 0);
    if (val > 0) g[a.kind] = (g[a.kind] || 0) + val;
    if (a.prev > 0) gp[a.kind] = (gp[a.kind] || 0) + a.prev;
  });
  const kinds = Object.keys(g).sort(function (x, y) { return g[y] - g[x]; });
  const total = kinds.reduce(function (s, k) { return s + g[k]; }, 0), ptotal = Object.keys(gp).reduce(function (s, k) { return s + gp[k]; }, 0);
  let s = svgOpen('資產配置與上月比較');
  if (!total) return { svg: s + '<text x="180" y="130" text-anchor="middle" fill="#5B6675" font-size="14">本月尚未輸入資產</text></svg>', cap: '' };
  let a = 0; const cx = 92, cy = 130;
  kinds.forEach(function (k) { const a1 = a + g[k] / total * Math.PI * 2 - 0.0001; s += '<path d="' + arcPath(cx, cy, 86, 52, a, a1) + '" fill="' + KIND_COLOR[k] + '" stroke="#fff" stroke-width="2"/>'; a = a1 + 0.0001; });
  if (ptotal) { let b = 0; Object.keys(gp).sort(function (x, y) { return gp[y] - gp[x]; }).forEach(function (k) { const b1 = b + gp[k] / ptotal * Math.PI * 2 - 0.0001; s += '<path d="' + arcPath(cx, cy, 48, 40, b, b1) + '" fill="' + KIND_COLOR[k] + '" opacity="0.55"/>'; b = b1 + 0.0001; }); }
  s += '<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="11" fill="#5B6675">資產總計</text><text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#1B2430">$' + fmt(total) + '</text>';
  kinds.forEach(function (k, i) {
    const y = 34 + i * 36, pp = ptotal ? Math.round((gp[k] || 0) / ptotal * 100) : null;
    s += '<rect x="196" y="' + (y - 10) + '" width="12" height="12" rx="3" fill="' + KIND_COLOR[k] + '"/><text x="214" y="' + y + '" font-size="12" fill="#1B2430">' + k + ' ' + Math.round(g[k] / total * 100) + '%  $' + fmt(g[k]) + '</text>' +
      '<text x="214" y="' + (y + 14) + '" font-size="10" fill="#5B6675">' + (pp != null ? '上月 ' + pp + '%｜金額 <tspan fill="' + chgCol(g[k], gp[k], true) + '">' + (gp[k] ? chgTxt(g[k], gp[k]) : '新增') + '</tspan>' : '') + '</text>';
  });
  const liquidPct = Math.round(((g['活存'] || 0) + (g['定存'] || 0)) / total * 100);
  return { svg: s + '</svg>', cap: '<div class="sub" style="font-size:12px">外圈＝本月，內圈淡色＝上月。可隨時動用的現金（活存＋定存）占 ' + liquidPct + '%' + (ptotal ? '；總資產比上月 ' + chg(total, ptotal, true) : '') + '。</div>' };
}
function aChange() {
  const L = liveSeries(), d = S.asset, tot = L.total;
  const ch = tot.map(function (v, i) { return i === 0 ? (d.yearStart ? v - d.yearStart : null) : v - tot[i - 1]; });
  if (L.c.missing) ch[ch.length - 1] = null;
  const lt = d.lastYear ? d.lastYear.total : null;
  const lch = lt ? lt.map(function (v, i) { return i === 0 || !v || !lt[i - 1] ? null : v - lt[i - 1]; }).slice(0, 12) : [];
  const vals = ch.filter(function (x) { return x != null; }), lvals = lch.filter(function (x) { return x != null; });
  const mx = niceMax(Math.max.apply(null, vals.concat(lvals).map(Math.abs).concat([1000])) * 1.1);
  const X0 = 44, X1 = 352, Ym = 120, H = 100, bw = (X1 - X0) / 12;
  let s = svgOpen('每月資產增減，附去年同月');
  s += '<line x1="' + X0 + '" y1="' + Ym + '" x2="' + X1 + '" y2="' + Ym + '" stroke="#8A94A3"/>' +
    '<text x="0" y="' + (Ym - H + 4) + '" font-size="10" fill="#5B6675">+' + (mx >= 10000 ? mx / 10000 + '萬' : fmt(mx)) + '</text><text x="0" y="' + (Ym + 4) + '" font-size="10" fill="#5B6675">0</text><text x="0" y="' + (Ym + H + 4) + '" font-size="10" fill="#5B6675">−' + (mx >= 10000 ? mx / 10000 + '萬' : fmt(mx)) + '</text>';
  for (let i = 0; i < 12; i++) {
    const x = X0 + i * bw + 3, w = (bw - 6) * 0.62, v = ch[i], lv = lch[i];
    if (v != null && i < ch.length) { const h = Math.abs(v) / mx * H; s += '<rect x="' + x.toFixed(1) + '" y="' + (v >= 0 ? Ym - h : Ym).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" rx="2" fill="' + (v >= 0 ? '#1E7A4C' : '#B42318') + '"/>'; }
    if (lv != null) { const h2 = Math.abs(lv) / mx * H; s += '<rect x="' + (x + w + 1).toFixed(1) + '" y="' + (lv >= 0 ? Ym - h2 : Ym).toFixed(1) + '" width="' + ((bw - 6) * 0.38 - 1).toFixed(1) + '" height="' + Math.max(h2, 1).toFixed(1) + '" rx="1" fill="#B8C0CC"/>'; }
  }
  s += monthLabelsSvg(12, X0, X1, 248) + '</svg>';
  const up = vals.filter(function (x) { return x > 0; }).length;
  return { svg: s, cap: '<div class="legend"><span><b style="background:#1E7A4C;height:8px"></b>增加</span><span><b style="background:#B42318;height:8px"></b>減少</span>' + (lvals.length ? '<span><b style="background:#B8C0CC;height:8px"></b>' + (d.y - 1) + ' 年同月</span>' : '') + '</div><div class="sub" style="font-size:12px;margin-top:4px">今年 ' + vals.length + ' 個月中有 ' + up + ' 個月資產增加。大額保費、稅金扣繳的月份減少是正常的。</div>' };
}
function aFlow() {
  const d = S.asset, inc = d.series.income, exp = d.series.expense, n = inc.length, ly = d.lastYear;
  const mx = niceMax(Math.max.apply(null, inc.concat(exp, [1000])) * 1.1);
  const X0 = 40, X1 = 352, Y0 = 212, Y1 = 44, bw = (X1 - X0) / 12;
  let s = svgOpen('每月收入、支出與儲蓄率，附去年同月儲蓄率') + yAxis(mx, X0, X1, Y0, Y1);
  s += '<text x="0" y="14" font-size="9" fill="#1B2430">今年</text>' + (ly ? '<text x="0" y="30" font-size="9" fill="#8A94A3">去年</text>' : '');
  for (let i = 0; i < 12; i++) {
    const x = X0 + i * bw + 3, w = (bw - 6) / 2;
    if (i < n) {
      const hi = inc[i] / mx * (Y0 - Y1), he = exp[i] / mx * (Y0 - Y1);
      s += '<rect x="' + x.toFixed(1) + '" y="' + (Y0 - hi).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hi.toFixed(1) + '" fill="#1E7A4C"/>' +
        '<rect x="' + (x + w).toFixed(1) + '" y="' + (Y0 - he).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + he.toFixed(1) + '" fill="#B42318"/>';
      if (inc[i]) { const r = Math.round((inc[i] - exp[i]) / inc[i] * 100); s += '<text x="' + (x + w).toFixed(1) + '" y="14" font-size="9" text-anchor="middle" fill="' + (r >= 0 ? '#1E7A4C' : '#B42318') + '">' + r + '%</text>'; }
    }
    if (ly && ly.income[i]) { const rl = Math.round((ly.income[i] - ly.expense[i]) / ly.income[i] * 100); s += '<text x="' + (x + w).toFixed(1) + '" y="30" font-size="9" text-anchor="middle" fill="#8A94A3">' + rl + '%</text>'; }
  }
  s += monthLabelsSvg(12, X0, X1, 230) + '</svg>';
  const sum = function (a, k) { return a.slice(0, k).reduce(function (x, y) { return x + y; }, 0); };
  const ti = sum(inc, n), te = sum(exp, n), rate = ti ? Math.round((ti - te) / ti * 100) : 0;
  let lyTxt = '';
  if (ly) { const li = sum(ly.income, n), le = sum(ly.expense, n); if (li) lyTxt = '；去年同期 ' + Math.round((li - le) / li * 100) + '%'; }
  return { svg: s, cap: '<div class="legend"><span><b style="background:#1E7A4C;height:8px"></b>收入</span><span><b style="background:#B42318;height:8px"></b>負債（當月支出）</span><span>上方＝儲蓄率（今年／去年）</span></div><div class="sub" style="font-size:12px;margin-top:4px">今年 1～' + n + ' 月累計儲蓄率 ' + rate + '%' + lyTxt + '（柴鼠定義：收入 − 負債）。未記帳月份以預算估計。</div>' };
}
function aSafety() {
  const d = S.asset, se = d.series, n = se.emergency.length;
  const all = se.emergency.concat(se.pool, se.reserve, [d.target]);
  const mx = niceMax(Math.max.apply(null, all) * 1.1), mn = Math.min(0, Math.min.apply(null, all));
  const X0 = 44, X1 = 352, Y0 = 220, Y1 = 16, bw = (X1 - X0) / 12;
  const Y = function (v) { return Y0 - (v - mn) / (mx - mn) * (Y0 - Y1); }, X = function (i) { return X0 + i * bw + bw / 2; };
  const pl = function (arr) { return arr.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' '); };
  let s = svgOpen('安全水位');
  [mn, 0, mx / 2, mx].filter(function (v, i, arr) { return arr.indexOf(v) === i && v >= mn; }).forEach(function (v) { s += '<line x1="' + X0 + '" y1="' + Y(v) + '" x2="' + X1 + '" y2="' + Y(v) + '" stroke="#EEF1F5"/><text x="0" y="' + (Y(v) + 4) + '" font-size="10" fill="#5B6675">' + (v === 0 ? '0' : (Math.round(v / 1000) / 10) + '萬') + '</text>'; });
  if (mn < 0) s += '<line x1="' + X0 + '" y1="' + Y(0) + '" x2="' + X1 + '" y2="' + Y(0) + '" stroke="#8A94A3"/>';
  s += '<line x1="' + X0 + '" y1="' + Y(d.target) + '" x2="' + X1 + '" y2="' + Y(d.target) + '" stroke="#0F8B8D" stroke-dasharray="5 4"/>';
  [['emergency', '#0F8B8D'], ['pool', '#2458C6'], ['reserve', '#C77700']].forEach(function (p) { s += '<polyline points="' + pl(se[p[0]]) + '" fill="none" stroke="' + p[1] + '" stroke-width="3" stroke-linejoin="round"/>'; });
  s += monthLabelsSvg(n, X0, X1, 246) + '</svg>';
  const em = se.emergency[n - 1];
  return { svg: s, cap: '<div class="legend"><span><b style="background:#0F8B8D"></b>緊急備用金</span><span><b style="height:0;border-top:2px dashed #0F8B8D"></b>目標 $' + fmt(d.target) + '</span><span><b style="background:#2458C6"></b>日常平衡金</span><span><b style="background:#C77700"></b>稅保專款</span></div><div class="sub" style="font-size:12px;margin-top:4px">緊急備用金 $' + fmt(em) + '，達成 ' + Math.round(em / d.target * 100) + '%。三條線都要保持在 0 以上。</div>' };
}
function aCover() {
  const d = S.asset, L = liveSeries(), exp = d.series.expense, liq = L.liquid, n = liq.length, ly = d.lastYear;
  const covOf = function (lq, ex) { return lq.map(function (v, i) { const w = ex.slice(Math.max(0, i - 2), i + 1).filter(function (x) { return x > 0; }); const avg = w.length ? w.reduce(function (a, b) { return a + b; }, 0) / w.length : 0; return avg && v > 0 ? v / avg : null; }); };
  const cov = covOf(liq, exp).map(function (v) { return v || 0; });
  const lcov = ly ? covOf(ly.liquid, ly.expense) : [];
  const mx = Math.max(7, Math.ceil(Math.max.apply(null, cov.concat(lcov.filter(function (x) { return x != null; }), [1])) + 1));
  const X0 = 36, X1 = 352, Y0 = 220, Y1 = 16, bw = (X1 - X0) / 12;
  const Y = function (v) { return Y0 - v / mx * (Y0 - Y1); };
  let s = svgOpen('流動資產可支撐幾個月生活費，附去年同月');
  [0, Math.round(mx / 2), mx].forEach(function (v) { s += '<line x1="' + X0 + '" y1="' + Y(v) + '" x2="' + X1 + '" y2="' + Y(v) + '" stroke="#EEF1F5"/><text x="0" y="' + (Y(v) + 4) + '" font-size="10" fill="#5B6675">' + v + '月</text>'; });
  [3, 6].forEach(function (g) { s += '<line x1="' + X0 + '" y1="' + Y(g) + '" x2="' + X1 + '" y2="' + Y(g) + '" stroke="' + (g === 3 ? '#C77700' : '#1E7A4C') + '" stroke-dasharray="5 4"/><text x="' + (X1 - 2) + '" y="' + (Y(g) - 4) + '" font-size="10" text-anchor="end" fill="' + (g === 3 ? '#7A4B00' : '#1E7A4C') + '">' + g + ' 個月</text>'; });
  cov.forEach(function (v, i) {
    const h = v / mx * (Y0 - Y1), x = X0 + i * bw + 5, w = bw - 10;
    s += '<rect x="' + x.toFixed(1) + '" y="' + (Y0 - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + (v >= 6 ? '#1E7A4C' : v >= 3 ? '#C77700' : '#B42318') + '"/>' +
      '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (Y0 - h - 4).toFixed(1) + '" font-size="9" text-anchor="middle" fill="#1B2430">' + v.toFixed(1) + '</text>';
  });
  lcov.forEach(function (v, i) { if (v == null) return; const x = X0 + i * bw + bw / 2; s += '<line x1="' + (x - 9) + '" y1="' + Y(v) + '" x2="' + (x + 9) + '" y2="' + Y(v) + '" stroke="#5B6675" stroke-width="2.5"/>'; });
  s += monthLabelsSvg(12, X0, X1, 246) + '</svg>';
  const last = cov[n - 1] || 0, lastLy = lcov[n - 1];
  return { svg: s, cap: (lcov.some(function (x) { return x != null; }) ? '<div class="legend"><span><b style="background:#5B6675"></b>' + (d.y - 1) + ' 年同月</span></div>' : '') +
    '<div class="sub" style="font-size:12px;margin-top:4px">活存＋定存，可以支撐 <b class="' + (last >= 6 ? 'ok' : last >= 3 ? 'fast' : 'over') + '">' + last.toFixed(1) + ' 個月</b>的生活支出' + (lastLy != null ? '（去年同月 ' + lastLy.toFixed(1) + ' 個月）' : '') + '。一般建議至少 3～6 個月。</div>' };
}
function renderAssetPane() {
  const types = assetTypes(); if (S.act >= types.length) S.act = 0;
  const t = types[S.act], z = $('assetzoomer'); if (!z) return;
  document.querySelectorAll('.atab').forEach(function (b, i) { b.classList.toggle('on', i === S.act); });
  $('adots').innerHTML = types.map(function (x, i) { return '<i class="' + (i === S.act ? 'on' : '') + '"></i>'; }).join('');
  const box = $('assetbox'); if (box && box._zoom) box._zoom.reset();
  const r = t.key === 'trend' ? aTrend() : t.key === 'alloc' ? aAlloc() : t.key === 'change' ? aChange() : t.key === 'flow' ? aFlow() : t.key === 'safety' ? aSafety() : aCover();
  z.innerHTML = r.svg; $('acap').innerHTML = r.cap;
}

function renderAssets() {
  const d = S.asset, c = assetCalc(), el = $('v-assets');
  let h = monthHeader(d, 'as', '滿月記帳｜月底盤點');
  h += '<div class="grid2" style="align-items:start"><div><div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
    '<div class="card"><span class="sub">本月資產總計</span><div class="mid">$' + fmt(c.total) + '</div><span style="font-size:12px;font-weight:500" class="' + (c.missing ? 'fast' : 'ok') + '">' + (c.missing ? '還有 ' + c.missing + ' 項未填' : '已填完整') + '</span></div>' +
    '<div class="card ' + (c.missing ? '' : (c.diff >= 0 ? 'okbg' : 'overbg')) + '"><span class="sub">本月資產增減</span><div class="mid ' + (c.missing ? 'done' : (c.diff >= 0 ? 'ok' : 'over')) + '">' + (c.missing ? '—' : (c.diff >= 0 ? '+' : '') + money(c.diff)) + '</div><span class="sub" style="font-size:12px">' + (c.missing ? '填完才計算' : '上月 $' + fmt(d.prevTotal)) + '</span></div></div>' +
    '<div class="card"><div class="items" style="margin-bottom:8px">' + assetTypes().map(function (t, i) { return '<button class="chip atab ' + (i === S.act ? 'on' : '') + '" data-act="at" data-v="' + i + '" style="height:36px">' + t.name + '</button>'; }).join('') + '</div>' +
    chartBoxHTML('assetbox') + '<div class="cdots" id="adots"></div><div class="ccap" id="acap"></div><div class="sub" style="font-size:11px;text-align:center">在圖上左右滑動切換圖表｜兩指縮放、拖曳移動｜點兩下還原</div></div></div>';
  h += '<div><div class="sub" style="font-size:12px;margin-bottom:8px">輸入各帳戶月底實際餘額（銀行 App 上看到的數字）</div><div class="list">' + d.accounts.map(function (a) {
    const v = S.assetVals[a.key], empty = v === '' || v == null;
    const ph = a.auto ? '帳面 ' + fmt(a.book) : '輸入金額';
    return '<label class="li"><div class="col" style="flex:1;min-width:0;gap:1px"><span style="font-size:14px;font-weight:500">' + esc(a.label) + '</span><span class="sub" style="font-size:11px">上月 $' + fmt(a.prev) + (a.auto ? '｜留白＝用帳面數' : '') + '</span></div>' +
      '<button class="calcbtn" data-act="calc" data-k="' + a.key + '" aria-label="用計算機輸入' + esc(a.label) + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E7A4C" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/></svg></button>' +
      '<input data-k="' + a.key + '" inputmode="decimal" placeholder="' + ph + '" value="' + esc(v == null ? '' : v) + '" style="width:120px;height:40px;border-radius:10px;text-align:right;padding:0 10px;font-size:16px;border:1px solid ' + (empty && !a.auto && a.prev ? '#C77700' : 'var(--line2)') + ';background:' + (empty && !a.auto && a.prev ? 'var(--amberSoft)' : 'var(--bg)') + '"></label>';
  }).join('') + '</div><div class="sub" style="font-size:12px;line-height:1.5;margin-bottom:10px">收入、負債由家計簿自動帶入，儲存後會一併算出淨值與儲蓄率。</div>' +
    '<button class="submit" style="background:var(--green)" data-act="savemonthly">儲存' + d.m + '月盤點</button></div></div>';
  h += '<div class="grid2" style="align-items:start;margin-top:4px"><div id="goalsBox"></div><div id="taxBox"></div></div>';
  el.innerHTML = h;
  const ab = $('assetbox'); ab.querySelector('.zoomer').id = 'assetzoomer';
  enableZoom(ab, function (dir) { const n = assetTypes().length; S.act = (S.act + dir + n) % n; renderAssetPane(); });
  renderAssetPane();
  renderGoalsTax(d.y, d.m);
  el.querySelectorAll('input[data-k]').forEach(function (inp) {
    inp.onchange = function () {
      const raw = inp.value.trim();
      if (raw === '') { S.assetVals[inp.dataset.k] = ''; return renderAssets(); }
      const v = evalExpr(raw.replace(/\*/g, '×').replace(/\//g, '÷'));
      if (isNaN(v)) { toast('算式有誤，請檢查'); return; }
      S.assetVals[inp.dataset.k] = String(Math.round(v)); renderAssets();
    };
  });
}
$('v-assets').addEventListener('click', function (e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'as-prev') { S.assetYM = ymAdd(S.assetYM, -1); loadAssets(); }
  if (a === 'as-next') { S.assetYM = ymAdd(S.assetYM, 1); loadAssets(); }
  if (a === 'calc') return openCalc(b.dataset.k);
  if (a === 'at') { S.act = +b.dataset.v; return renderAssetPane(); }
  if (a === 'taxy') { S.taxYear = +b.dataset.v; return renderGoalsTax(S.asset.y, S.asset.m); }
  if (a === 'savemonthly') {
    b.disabled = true; b.textContent = '儲存中…';
    call('saveMonthly', { y: S.asset.y, m: S.asset.m, values: S.assetVals }).then(function (d) { S.asset = d; toast('已儲存到' + d.m + '月滿月記帳'); renderAssets(); }).catch(function (e) { err(e); renderAssets(); });
  }
});

function openCalc(key) {
  const acc = S.asset.accounts.filter(function (x) { return x.key === key; })[0];
  let expr = S.assetVals[key] ? String(S.assetVals[key]) : '';
  const draw = function () {
    const d = exprDisplay(expr);
    $('modalBox').innerHTML = '<div class="calcbox"><div class="row"><b style="font-size:16px">' + esc(acc.label) + '</b><span class="sub" style="font-size:12px">上月 $' + fmt(acc.prev) + '</span></div>' +
      '<div class="amount" style="margin:10px 0 0"><div class="expr">' + esc(d.small) + '</div><div class="v">$' + d.big + '</div></div>' +
      '<div class="sub" style="font-size:12px;margin-top:6px">例：台銀 B 帳戶＋房貸帳戶，輸入 19550＋193</div>' + keypadHTML('ck') +
      '<div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);margin-top:10px"><button class="submit" style="background:var(--card);color:var(--ink);border:1px solid var(--line2);margin:0" data-act="ck-cancel">取消</button><button class="submit" style="margin:0" data-act="ck-ok">填入</button></div></div>';
  };
  openModal(''); draw();
  $('modalBox').onclick = function (e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'ck') { expr = pressKey(expr, b.dataset.v); return draw(); }
    if (b.dataset.act === 'ck-cancel') return closeModal();
    if (b.dataset.act === 'ck-ok') {
      const v = evalExpr(expr);
      if (expr !== '' && isNaN(v)) return toast('算式有誤，請檢查');
      S.assetVals[key] = expr === '' ? '' : String(Math.round(v));
      closeModal(); renderAssets();
    }
  };
}

// ---------- 預算調撥 ----------
function openTransfer(d) {
  const others = (S.dash && S.dash.y === d.y && S.dash.m === d.m ? S.dash.cats : []).filter(function (c) { return c.budget > 0 && !c.travel && c.name !== d.cat; }).map(function (c) { return c.name; });
  const opts = (others.length ? others : ['奉獻', '食物', '教育', '油料', '娛樂', '其他'].filter(function (c) { return c !== d.cat; }));
  openModal('<b style="font-size:16px">調撥預算｜' + d.y + '年' + d.m + '月</b>' +
    '<div class="sub" style="font-size:13px;line-height:1.5">把某個科目的預算移到另一個科目，本月總預算不變。試算表上的科目預算不會改，只有 App 顯示會調整。</div>' +
    '<label class="sub">從<select class="f" id="xfFrom">' + [d.cat].concat(opts).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
    '<label class="sub">調到<select class="f" id="xfTo">' + opts.concat([d.cat]).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
    '<label class="sub">金額<input class="f" id="xfAmt" inputmode="numeric" placeholder="例如 500"></label>' +
    '<label class="sub">原因（選填）<input class="f" id="xfNote" placeholder="例如：聚餐較多"></label>' +
    '<div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><button class="submit" style="background:var(--card);color:var(--ink);border:1px solid var(--line2);margin:0" data-x="cancel">取消</button><button class="submit" style="margin:0" data-x="ok">確定調撥</button></div>');
  $('modalBox').onclick = function (e) {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'cancel') return closeModal();
    const amt = evalExpr($('xfAmt').value.replace(/\*/g, '×').replace(/\//g, '÷'));
    if (isNaN(amt) || amt <= 0) return toast('請輸入金額');
    b.disabled = true;
    call('transfer', { y: d.y, m: d.m, from: $('xfFrom').value, to: $('xfTo').value, amount: Math.round(amt), note: $('xfNote').value }).then(function (r) {
      closeModal(); toast(r.message); clearCaches(); afterWrite(); loadCat();
    }).catch(function (er) { b.disabled = false; err(er); });
  };
}
function loadTransfers(d) {
  const box = $('xferList'); if (!box) return;
  call('transfers', { y: d.y, m: d.m }).then(function (list) {
    const mine = list.filter(function (t) { return t.acct === d.cat || t.target === d.cat; });
    if (!mine.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="sub" style="font-size:12px;margin:8px 0 4px">本月調撥紀錄</div>' + mine.map(function (t) {
      return '<div class="row" style="font-size:13px;padding:4px 0"><span>' + esc(t.acct) + ' → ' + esc(t.target) + ' <b>$' + fmt(t.amount) + '</b>' + (t.note ? '（' + esc(t.note) + '）' : '') + '</span><button class="chip" data-act="xfdel" data-row="' + t.row + '" style="height:30px;font-size:12px">刪除</button></div>';
    }).join('');
  }).catch(function () {});
}
// ---------- 信用卡帳單對帳 ----------
function openBill(ym) {
  if (!ym) { const t = todayYM(), dd = +S.form.today.slice(8, 10); ym = dd > 6 ? ymAdd(t, 1) : t; }
  openModal('<div class="loading">讀取帳單期間的刷卡紀錄…</div>');
  call('bill', ym).then(function (b) { renderBill(b); }).catch(function (e) { closeModal(); err(e); });
}
function renderBill(b) {
  const diffTxt = b.bill == null ? '' : (b.diff === 0 ? '<span class="ok"><b>完全吻合 ✓</b></span>' : (b.diff > 0 ? '<span class="over"><b>帳單比紀錄多 $' + fmt(b.diff) + '</b>，可能有漏記</span>' : '<span class="fast"><b>紀錄比帳單多 $' + fmt(-b.diff) + '</b>，可能有重複或尚未入帳</span>'));
  $('modalBox').innerHTML = '<div class="row"><button class="iconbtn" data-b="prev" aria-label="上一期">' + ICON.left + '</button><b style="font-size:16px">' + b.y + '年' + b.m + '月6日帳單</b><button class="iconbtn" data-b="next" aria-label="下一期">' + ICON.right + '</button></div>' +
    '<div class="sub" style="font-size:12px;text-align:center">消費期間 ' + md(b.from) + '～' + md(b.to) + '</div>' +
    '<div class="card" style="background:var(--bg);margin:0"><div class="row"><span>App 記錄的刷卡</span><b>$' + fmt(b.recorded) + '</b></div>' + (b.fixed ? '<div class="sub" style="font-size:12px">含固定訂閱／分期 $' + fmt(b.fixed) + '</div>' : '') +
    '<div class="row" style="margin-top:8px"><span>帳單金額</span><input class="f" id="billAmt" inputmode="numeric" style="width:140px;text-align:right" value="' + (b.bill == null ? '' : b.bill) + '" placeholder="輸入帳單金額"></div>' +
    (diffTxt ? '<div style="margin-top:8px;font-size:14px">' + diffTxt + '</div>' : '') + '</div>' +
    '<button class="submit" data-b="save" style="margin:0">儲存帳單金額並比對</button>' +
    '<div class="sub" style="font-size:12px">這期記錄的刷卡（' + b.rows.length + ' 筆）：</div>' +
    '<div class="list" style="margin:0;max-height:38vh;overflow:auto">' + (b.rows.length ? b.rows.map(function (r) { return '<div class="li" style="padding:8px 12px"><div class="col" style="flex:1;gap:1px"><span style="font-size:14px">' + esc(r.item) + '</span><span class="sub" style="font-size:11px">' + md(r.date) + '・' + esc(r.cat) + '</span></div><span class="amt-k">$' + fmt(r.amount) + '</span></div>'; }).join('') : '<div class="li sub">這期沒有刷卡紀錄</div>') + '</div>' +
    '<button class="chip" data-b="close" style="align-self:center">關閉</button>';
  $('modalBox').onclick = function (e) {
    const x = e.target.closest('[data-b]'); if (!x) return;
    const k = x.dataset.b;
    if (k === 'close') return closeModal();
    if (k === 'prev' || k === 'next') return openBill(ymAdd({ y: b.y, m: b.m }, k === 'prev' ? -1 : 1));
    if (k === 'save') {
      const v = evalExpr($('billAmt').value); if (isNaN(v) || v <= 0) return toast('請輸入帳單金額');
      x.disabled = true; call('setBill', { y: b.y, m: b.m, amount: Math.round(v) }).then(renderBill).catch(err);
    }
  };
}
// ---------- 財務目標・報稅資料 ----------
function renderGoalsTax(y, m) {
  const gb = $('goalsBox'), tb = $('taxBox'); if (!gb || !tb) return;
  call('goals', { y: y, m: m }).then(function (g) {
    let h = '<div class="card"><b style="font-size:15px">財務目標</b>';
    const prog = function (label, cur, target, note, color) {
      return '<div style="margin-top:12px"><div class="row" style="font-size:14px"><span>' + label + '</span><b>$' + fmt(cur) + ' ／ $' + fmt(target) + '</b></div>' +
        '<div class="bar" style="margin:6px 0"><i style="width:' + Math.min(100, cur / target * 100).toFixed(1) + '%;background:' + color + '"></i></div><div class="sub" style="font-size:12px">' + note + '</div></div>';
    };
    if (g.emergency) {
      const e = g.emergency, gap = Math.max(0, e.target - e.current);
      h += prog('緊急備用金', e.current, e.target, (gap ? '還差 $' + fmt(gap) + '；依目前計畫年底 $' + fmt(e.yearEnd) + (e.yearEnd < e.target ? '，明年要再補 $' + fmt(e.target - e.yearEnd) : '，今年可補滿') : '已補滿 ✓') + (e.actual ? '（依滿月盤點實際數）' : '（依計畫數）'), 'var(--green)');
      const dw = g.dawho, inBand = dw.current >= dw.low && dw.current <= dw.high;
      h += '<div style="margin-top:12px"><div class="row" style="font-size:14px"><span>永豐 DAWHO 總資產水位</span><b class="' + (inBand ? 'ok' : 'fast') + '">$' + fmt(dw.current) + '</b></div><div class="sub" style="font-size:12px">目標區間 10～30 萬：' + (dw.current < dw.low ? '低於下限' : (dw.current > dw.high ? '高於上限，多的可考慮轉投資' : '在區間內 ✓')) + '；依計畫年底 $' + fmt(dw.yearEnd) + '</div></div>';
      h += '<div style="margin-top:12px"><div class="row" style="font-size:14px"><span>0050 定期定額</span><b>累計投入 $' + fmt(g.etf.invested) + '</b></div><div class="sub" style="font-size:12px">今年計畫投入 $' + fmt(g.etf.yearPlan) + (g.etf.market ? '｜本月 ETF 市值 $' + fmt(g.etf.market) : '｜在滿月盤點填入 ETF 市值後會顯示') + '</div></div>';
    } else h += '<div class="sub" style="font-size:13px;margin-top:8px">緊急備用金、DAWHO 水位與 0050 目標從 2027 年開始追蹤（2 月獎金入帳時鎖入緊急備用金）。</div>';
    gb.innerHTML = h + '</div>';
  }).catch(function () { gb.innerHTML = ''; });
  const ty = S.taxYear || (+S.form.today.slice(5, 7) <= 6 ? +S.form.today.slice(0, 4) - 1 : +S.form.today.slice(0, 4));
  call('tax', { y: ty }).then(function (t) {
    tb.innerHTML = '<div class="card"><div class="row"><b style="font-size:15px">報稅資料彙整</b><div style="display:flex;gap:6px"><button class="chip" data-act="taxy" data-v="' + (ty - 1) + '" style="height:32px">‹</button><span style="align-self:center;font-weight:700">' + ty + ' 年度</span><button class="chip" data-act="taxy" data-v="' + (ty + 1) + '" style="height:32px">›</button></div></div>' +
      [['奉獻（捐贈）', t.tithe, '列舉扣除；需有教會開立的收據，上限為綜合所得總額 20%'],
       ['人身保險費', t.insurance, '列舉扣除；每位被保險人每年上限 24,000（健保費不受限）'],
       ['房貸繳款總額', t.mortgage, '自用住宅借款利息可列舉扣除（上限 30 萬，需扣除儲蓄投資特別扣除額）；利息金額請以銀行年度證明為準'],
       ['房屋稅＋地價稅', t.houseTax, '自用住宅的房屋稅、地價稅不可扣除，僅供核對'],
       ['小布丁學費', t.tuition, '幼兒學前特別扣除依年齡與所得資格而定，請以國稅局規定為準']].map(function (r) {
        return '<div style="padding:10px 0;border-top:1px solid var(--chip)"><div class="row"><span style="font-size:14px">' + r[0] + '</span><b>$' + fmt(r[1]) + '</b></div><div class="sub" style="font-size:11px;line-height:1.5">' + r[2] + '</div></div>';
      }).join('') + '<div class="sub" style="font-size:11px;margin-top:6px">金額來自 App 與試算表紀錄，僅供整理參考；實際扣除額以國稅局規定與正式憑證為準。</div></div>';
  }).catch(function () { tb.innerHTML = ''; });
}

// ---------- 視窗 ----------
function openModal(html) { $('modalBox').innerHTML = html; $('modal').style.display = 'flex'; }
function closeModal() { $('modal').style.display = 'none'; $('modalBox').onclick = null; }
$('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });

// ---------- 啟動 ----------
renderEntry();
(function boot() {
  const startView = window.innerWidth >= 1000 ? 'today' : 'entry';
  const last = lsGet('kakeiboLast');
  const applyForm = function (f) { S.form = f; if (!S.e.date || S.e.date < f.today) S.e.date = f.today; if (!S.e.item) S.e.item = (f.items[S.e.cat] || [])[0] || S.e.cat; };
  if (last && last.form && last.dash) { S.offline = true; applyForm(last.form); S.e.date = last.form.today; S.dash = last.dash; renderEntry(); show(startView); }
  call('init', {}).then(function (r) {
    S.offline = false; applyForm(r.form); S.e.date = r.form.today; S.dash = r.dashboard; S.dashStale = false;
    lsSet('kakeiboLast', { form: r.form, dash: r.dashboard });
    renderEntry();
    if (!last) show(startView); else if (S.view === 'today' || window.innerWidth >= 1000) renderToday();
    setTimeout(prefetch, 300);
    if (S.queue && S.queue.length) setTimeout(function () { flushQueue(false); }, 800);
  }).catch(err);
})();
</script>
</body>
</html>
`;
