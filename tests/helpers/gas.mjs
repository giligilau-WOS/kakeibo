// 把 Code_單一檔案版.gs 載入 node:vm，並提供 Apps Script 服務的最小假實作。
// 絕不連網：SpreadsheetApp.openById 只會回傳記憶體裡的假試算表。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = new vm.Script(readFileSync(process.env.KAKEIBO_GS || join(root, 'Code_單一檔案版.gs'), 'utf8'), { filename: 'Code_單一檔案版.gs' });

// ---------- A1 表示法 ----------
function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function parseA1(a1) {
  const m = String(a1).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('假試算表不支援的範圍：' + a1);
  const r1 = +m[2], c1 = colNum(m[1]);
  const r2 = m[3] ? +m[4] : r1, c2 = m[3] ? colNum(m[3]) : c1;
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

// ---------- 假工作表 ----------
export class FakeSheet {
  constructor(name, book) { this.name = name; this.book = book; this.cells = new Map(); this.notes = new Map(); }
  key(r, c) { return r + ',' + c; }
  cell(r, c) { return this.cells.get(this.key(r, c)) || { v: '', f: '' }; }
  put(r, c, cell) { if (cell.v === '' && !cell.f) this.cells.delete(this.key(r, c)); else this.cells.set(this.key(r, c), cell); }
  // 測試用：直接讀寫
  val(r, c) { return this.cell(r, c).v; }
  set(r, c, v) { this.put(r, c, { v, f: '' }); return this; }
  getName() { return this.name; }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getRange(a, b, c, d) {
    const [r, col, nr, nc] = typeof a === 'string' ? parseA1(a) : [a, b, c || 1, d || 1];
    return new FakeRange(this, r, col, nr, nc);
  }
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, i) => this.put(r, i + 1, { v, f: '' })); return this; }
  deleteRow(row) {
    const next = new Map();
    for (const [k, v] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (r === row) continue;
      next.set((r > row ? r - 1 : r) + ',' + c, v);
    }
    this.cells = next;
  }
  setFrozenRows() { return this; }
  // 在第 row 列之前插入一列：第 row 列以後全部往下移（假實作不會改寫公式字串裡的參照）
  insertRowBefore(row) {
    const next = new Map();
    for (const [k, v] of this.cells) { const [r, c] = k.split(',').map(Number); next.set((r >= row ? r + 1 : r) + ',' + c, v); }
    this.cells = next; return this;
  }
}
class FakeRange {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() { this.sh.book.beforeRead(this.sh, this); const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.cell(this.r + i, this.c + j).v); out.push(row); } return out; }
  getValue() { return this.getValues()[0][0]; }
  getFormula() { return this.sh.cell(this.r, this.c).f || ''; }
  setValue(v) { this.each((r, c) => this.sh.put(r, c, { v: v === null || v === undefined ? '' : v, f: '' })); this.sh.book.afterWrite(this.sh); return this; }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(row => row.length !== this.nc)) throw new Error('setValues 尺寸不符（Apps Script 也會報錯）');
    this.each((r, c, i, j) => this.sh.put(r, c, { v: vals[i][j], f: '' })); this.sh.book.afterWrite(this.sh); return this;
  }
  // 假實作不計算公式：公式存起來，值保持原樣
  setFormula(f) { this.each((r, c) => this.sh.put(r, c, { v: this.sh.cell(r, c).v, f })); return this; }
  clearContent() { this.each((r, c) => this.sh.put(r, c, { v: '', f: '' })); this.sh.book.afterWrite(this.sh); return this; }
  setNote(n) { this.sh.notes.set(this.r + ',' + this.c, n); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setNumberFormat() { return this; } setDataValidation() { return this; }
}
export class FakeBook {
  constructor(id) { this.id = id; this.sheets = new Map(); this.readHooks = []; }
  sheet(name) { if (!this.sheets.has(name)) this.sheets.set(name, new FakeSheet(name, this)); return this.sheets.get(name); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { return this.sheet(name); }
  getName() { return '假試算表 ' + this.id; }
  beforeRead(sh, rg) { this.readHooks.forEach(h => h(sh, rg)); }
  afterWrite() {}
}

// ---------- Utilities.formatDate（依指定時區）----------
function formatDate(d, tz, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(d.getTime())).map(x => [x.type, x.value]));
  const map = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, H: String(+p.hour), M: String(+p.month), d: String(+p.day) };
  return fmt.replace(/yyyy|MM|dd|HH|mm|H|M|d/g, t => map[t]);
}

/**
 * 載入後端。
 * @param {object} o
 * @param {string} o.now   假的「現在」，ISO 字串（預設 2026-11-18 10:00 台北）
 * @param {object} o.props Script Properties 初始值
 * @param {(g)=>void} o.setup 載入後用來布置假試算表
 */
export function loadGas(o = {}) {
  let now = Date.parse(o.now || '2026-11-18T10:00:00+08:00');
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }
  const props = new Map(Object.entries(o.props || {}));
  const books = new Map();
  const cacheStore = new Map();
  const ctx = {
    Date: FakeDate, Math, JSON, Intl, console,
    Logger: { log() {} },
    SpreadsheetApp: {
      openById(id) { if (!books.has(id)) books.set(id, new FakeBook(id)); return books.get(id); },
      flush() {},
      newDataValidation() { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: k => { props.delete(k); }
    }) },
    CacheService: { getScriptCache: () => ({
      get: k => (cacheStore.has(k) ? cacheStore.get(k) : null),
      put: (k, v) => { cacheStore.set(k, v); }
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate, getUuid: () => randomUUID() },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    HtmlService: {}, DriveApp: {}, ScriptApp: {}
  };
  vm.createContext(ctx);
  SCRIPT.runInContext(ctx);
  const g = {
    ctx, props, books,
    /** 取得 .gs 頂層的 const（CONFIG、PREPAID…）或函式 */
    get: name => vm.runInContext(name, ctx),
    call: (fn, ...args) => ctx[fn](...args),
    setNow: iso => { now = Date.parse(iso); },
    /** 某年度的假試算表 */
    book: y => ctx.SpreadsheetApp.openById(vm.runInContext('CONFIG', ctx).files[y]),
    /** 清掉同一請求內的記憶，模擬下一個 HTTP 請求 */
    nextRequest: () => vm.runInContext('Object.keys(_memo).forEach(function (k) { delete _memo[k]; }); _ver = null;', ctx)
  };
  if (o.setup) o.setup(g);
  return g;
}

// ---------- 可重現的亂數 ----------
export function rng(seed) {
  // 先打散種子並丟掉前幾個輸出：xorshift 用小種子起頭時，前幾個數字會非常接近 0，
  // 曾經造成 pick() 幾乎永遠選到第一個選項、讓測試形同沒測（見測試有效性檢查）。
  let s = Math.imul(seed >>> 0, 2654435761) >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < 16; i++) next();
  const r = {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p,
    // 金額：含 0 附近、大金額等邊界
    amount: () => r.pick([1, 499, 500, 501, 999, 1000]) * (r.bool(0.2) ? 1 : 0) || r.int(1, r.bool(0.1) ? 2000000 : 5000)
  };
  return r;
}
export const RUNS = 500;
