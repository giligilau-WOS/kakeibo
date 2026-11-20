// 假的 GitHub contents API 與 Apps Script API（只在記憶體裡，不連網）。
// 用法：const f = fakeGoogle({...}); g.ctx.UrlFetchApp = f.UrlFetchApp; g.ctx.ScriptApp = f.ScriptApp;
export function fakeGoogle(o) {
  const state = {
    apiEnabled: o.apiEnabled !== false,
    github: Object.assign({}, o.github),            // 路徑 → 內容（沒有就回 404）
    githubStatus: o.githubStatus || {},             // 路徑 → 強制回傳的 HTTP 狀態（API 與 raw 都適用）
    apiRateLimited: !!o.apiRateLimited,              // GitHub API 次數用完（403）
    githubCalls: [],
    files: (o.files || []).map(f => Object.assign({ lastModifyUser: { email: 'owner' }, updateTime: '2026-11-20T00:00:00Z' }, f)),
    versions: (o.versions || [1, 2, 3]).map(n => ({ versionNumber: n })),
    deployments: o.deployments || [
      { deploymentId: 'HEAD-ID', deploymentConfig: { scriptId: 'SID', manifestFileName: 'appsscript' }, entryPoints: [{ entryPointType: 'WEB_APP' }] },
      { deploymentId: 'D1', deploymentConfig: { scriptId: 'SID', versionNumber: 3, manifestFileName: 'appsscript', description: '' }, entryPoints: [{ entryPointType: 'WEB_APP' }] }
    ]
  };
  const writes = [];   // 會改變狀態的呼叫
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const UrlFetchApp = {
    fetch(url, opt) {
      opt = opt || {};
      const method = String(opt.method || 'get').toLowerCase();
      let m = url.match(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)\?ref=main$/);
      if (m) {
        const path = decodeURIComponent(m[1]);
        state.githubCalls.push('api:' + path);
        if (state.apiRateLimited) return resp(403, '{"message":"API rate limit exceeded"}');
        if (state.githubStatus[path]) return resp(state.githubStatus[path], '<html>error</html>');
        return path in state.github ? resp(200, state.github[path]) : resp(404, '{"message":"Not Found"}');
      }
      m = url.match(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\/([^?]+)\?t=\d+$/);
      if (m) {
        const path = decodeURIComponent(m[1]);
        state.githubCalls.push('raw:' + path);
        if (state.githubStatus[path]) return resp(state.githubStatus[path], '<html>error</html>');
        return path in state.github ? resp(200, state.github[path]) : resp(404, '404: Not Found');
      }
      m = url.match(/^https:\/\/script\.googleapis\.com\/v1\/projects\/SID(\/.*)$/);
      if (!m) throw new Error('假網路：不允許連到 ' + url);
      if (!state.apiEnabled) return resp(403, '{"error":{"message":"Apps Script API has not been used in project 123 before or it is disabled."}}');
      if (!/^Bearer TOKEN$/.test((opt.headers || {}).Authorization || '')) return resp(401, 'no auth');
      const path = m[1], body = opt.payload ? JSON.parse(opt.payload) : null;
      if (method !== 'get') writes.push({ method, path, body });
      if (path === '/content' && method === 'get') return resp(200, { scriptId: 'SID', files: state.files.map(f => Object.assign({}, f)) });
      if (path === '/content' && method === 'put') {
        // 真的 API：整個專案以送來的檔案為準（沒送的檔案會被刪掉）
        state.files = body.files.map(f => ({ name: f.name, type: f.type, source: f.source }));
        return resp(200, { scriptId: 'SID', files: state.files });
      }
      if (path === '/versions' && method === 'get') return resp(200, { versions: state.versions });
      if (path === '/versions' && method === 'post') {
        const n = Math.max(0, ...state.versions.map(v => v.versionNumber)) + 1;
        const v = { versionNumber: n, description: body.description, files: state.files.map(f => Object.assign({}, f)) };
        state.versions.push(v); return resp(200, v);
      }
      if (path === '/deployments' && method === 'get') return resp(200, { deployments: state.deployments });
      m = path.match(/^\/deployments\/(.+)$/);
      if (m && method === 'put') {
        const d = state.deployments.find(x => x.deploymentId === m[1]);
        if (!d) return resp(404, 'no deployment');
        if (!state.versions.some(v => v.versionNumber === body.deploymentConfig.versionNumber)) return resp(400, 'no such version');
        d.deploymentConfig = Object.assign({}, d.deploymentConfig, body.deploymentConfig);
        return resp(200, d);
      }
      return resp(400, '假 API 不支援：' + method + ' ' + path);
    }
  };
  const ScriptApp = { getScriptId: () => 'SID', getOAuthToken: () => 'TOKEN' };
  return { state, writes, UrlFetchApp, ScriptApp, deployed: (id = 'D1') => state.deployments.find(d => d.deploymentId === id) };
}
export const withVer = (code, v) => code.replace(/const BACKEND_VERSION = '[^']+';/, "const BACKEND_VERSION = '" + v + "';");
