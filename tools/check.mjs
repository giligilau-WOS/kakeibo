// 家計簿 低成本檢查（Cheap Checks）：不需安裝任何套件，只要 Node 18 以上。
// 用法：node tools/check.mjs
// 檢查項目：
//   1. Apps Script 後端（*.gs）語法
//   2. index.html 內所有 <script> 的語法
//   3. 機密外洩掃描：部署網址、密碼 k、Token 不可出現在 repo 中
//   4. 版本號：改了 .gs／index.html 就要調高 BACKEND_VERSION／APP_VERSION；前端需要的後端版本不能比 repo 的後端新
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'kakeibo-check-'));
let failed = 0;

function syntax(label, code) {
  const f = join(tmp, label.replace(/[^\w.-]/g, '_') + '.js');
  writeFileSync(f, code);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('✔ 語法', label);
  } catch (e) {
    failed++;
    console.log('✘ 語法', label + '\n' + String(e.stderr || e.message).replace(f, label));
  }
}

// 1. 後端 .gs（根目錄）
const gsFiles = readdirSync(root).filter(n => n.endsWith('.gs'));
for (const f of gsFiles) syntax(f, readFileSync(join(root, f), 'utf8'));

// 2. index.html 的 <script>
const html = readFileSync(join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
syntax('index.html <script>×' + scripts.length, scripts.join('\n;\n'));

// 3. 機密外洩掃描（kid-demo.html 屬另一專案「學習面板」，不在家計簿的檢查範圍）
const SECRET = [
  [/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/, 'Apps Script 部署網址'],
  [/[?&]k=[A-Za-z0-9]{16,}/, '網址中的密碼 k'],
  [/setProperty\(\s*['"]TOKEN['"]\s*,\s*['"][A-Za-z0-9]{8,}['"]/, '寫死的 TOKEN'],
];
const tracked = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n')
  .filter(f => /\.(gs|js|mjs|html|json|md)$/.test(f) && f !== 'kid-demo.html');
for (const f of tracked) {
  const text = readFileSync(join(root, f), 'utf8');
  for (const [re, what] of SECRET) {
    const m = text.match(re);
    if (m) { failed++; console.log(`✘ 機密 ${f}：疑似${what}「${m[0].slice(0, 40)}…」`); }
  }
}
// 4. 版本號：改了檔案就要更新版本號，否則手機不會提示更新、也看不出後端是不是舊的
//    （事故：後端修好了卻沒部署，手機連到舊後端，花時間查了一輪）
const verOf = (text, name) => { const m = String(text).match(new RegExp(name + " = '([^']+)'")); return m ? m[1] : null; };
const GS = gsFiles[0], gsText = gsFiles.length ? readFileSync(join(root, GS), 'utf8') : '';
const backendV = verOf(gsText, 'BACKEND_VERSION'), appV = verOf(html, 'APP_VERSION'), needV = verOf(html, 'NEED_BACKEND');
if (!backendV || !appV || !needV) { failed++; console.log('✘ 版本號：找不到 BACKEND_VERSION／APP_VERSION／NEED_BACKEND'); }
else if (needV > backendV) { failed++; console.log(`✘ 版本號：前端需要後端 ${needV}，但 ${GS} 只有 ${backendV}（App 會一直提醒後端太舊）`); }
else {
  let base = null;
  for (const ref of ['origin/main', 'main']) { try { execFileSync('git', ['-C', root, 'rev-parse', '--verify', '-q', ref], { stdio: 'pipe' }); base = ref; break; } catch (e) {} }
  if (!base) console.log('－ 版本號：找不到 main 分支，略過「有改檔案就要升版本」的檢查');
  else {
    const show = f => { try { return execFileSync('git', ['-C', root, 'show', base + ':' + f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch (e) { return null; } };
    for (const [file, name, now] of [[GS, 'BACKEND_VERSION', backendV], ['index.html', 'APP_VERSION', appV]]) {
      const before = show(file), cur = readFileSync(join(root, file), 'utf8');
      if (before === null || before === cur) continue;
      const was = verOf(before, name);
      if (was && now <= was) { failed++; console.log(`✘ 版本號：${file} 和 ${base} 不同，但 ${name} 沒有調高（${base}：${was}，現在：${now}）`); }
    }
    console.log(`✔ 版本號 前端 ${appV}／後端 ${backendV}／前端需要後端 ≥ ${needV}`);
  }
}
console.log(failed ? `\n${failed} 項未通過` : '\n全部通過');
process.exit(failed ? 1 : 0);
