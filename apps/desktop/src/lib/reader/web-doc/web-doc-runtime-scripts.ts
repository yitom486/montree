/** 可信内联脚本的唯一来源，保持纯文本模块供 CSP/XSS 校验复用。 */
export function buildWebDocTabsRuntimeScript(): string {  return `<script>(function(){
  function activate(tab){
    var root=tab.closest('.web-doc-tabs');
    if(!root)return;
    var index=tab.getAttribute('data-tab-index');
    if(index==null)return;
    root.querySelectorAll('.web-doc-tabs-tab').forEach(function(btn){
      btn.setAttribute('aria-selected', btn.getAttribute('data-tab-index')===index ? 'true' : 'false');
    });
    root.querySelectorAll('.web-doc-tabs-panel').forEach(function(panel){
      if(panel.getAttribute('data-tab-index')===index){
        panel.removeAttribute('hidden');
        panel.style.removeProperty('display');
      }else{
        panel.setAttribute('hidden','');
        panel.style.setProperty('display','none','important');
      }
    });
  }
  document.addEventListener('click',function(event){
    var t=event.target;
    if(!t||!t.closest)return;
    var tab=t.closest('.web-doc-tabs-tab');
    if(!tab)return;
    event.preventDefault();
    activate(tab);
  },true);
})();</script>`
}

export function buildWebDocPlaygroundRuntimeScript(): string {
  return `<script>(function(){
  function createRunnerDoc(code) {
    var rawJson = JSON.stringify(code).replace(/</g, '\\\\u003c');
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>' +
      '* { box-sizing: border-box; }' +
      'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 1.25rem; background: #ffffff; color: #111827; line-height: 1.5; }' +
      '@media (prefers-color-scheme: dark) { body { background: #18181b; color: #f4f4f5; } }' +
      'button { display: inline-block; padding: 0.5rem 1rem; margin: 0.25rem 0.5rem 0.25rem 0; font-size: 0.95rem; font-weight: 500; border-radius: 0.375rem; border: 1px solid #d1d5db; background: #f3f4f6; color: #111827; cursor: pointer; transition: background 0.15s; }' +
      'button:hover { background: #e5e7eb; }' +
      'button:active { background: #d1d5db; }' +
      '@media (prefers-color-scheme: dark) { button { background: #27272a; color: #f4f4f5; border-color: #3f3f46; } button:hover { background: #3f3f46; } button:active { background: #52525b; } }' +
      'h1 { font-size: 1.35rem; margin-top: 0; margin-bottom: 0.75rem; font-weight: 600; }' +
      'ul { padding-left: 1.5rem; margin: 0.5rem 0; }' +
      'li { margin: 0.25rem 0; }' +
      'img { max-width: 100%; border-radius: 0.5rem; }' +
      '.square { background: #fff; border: 1px solid #999; float: left; font-size: 24px; font-weight: bold; line-height: 34px; height: 34px; margin-right: -1px; margin-top: -1px; padding: 0; text-align: center; width: 34px; }' +
      '@media (prefers-color-scheme: dark) { .square { background: #27272a; border-color: #52525b; color: #fff; } }' +
      '.status { margin-bottom: 10px; font-weight: 600; }' +
      '.board-row:after { clear: both; content: ""; display: table; }' +
      '@keyframes spin { to { transform: rotate(360deg); } }' +
      '</style>' +
      '</head><body><div id="root">' +
      '<div id="runner-loading" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:160px;color:#71717a;font-size:0.88rem;gap:0.75rem;">' +
      '<div style="width:24px;height:24px;border:2px solid #a1a1aa;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
      '<span>正在准备组件运行环境…</span>' +
      '</div></div>' +
      '<script>' +
      'var rawSource = ' + rawJson + '; ' +
      'function loadScript(src) { ' +
      '  return new Promise(function(resolve, reject) { ' +
      '    var s = document.createElement("script"); ' +
      '    s.src = src; ' +
      '    s.onload = resolve; ' +
      '    s.onerror = reject; ' +
      '    document.head.appendChild(s); ' +
      '  }); ' +
      '} ' +
      'function showError(msg) { ' +
      '  var root = document.getElementById("root"); ' +
      '  if (root) { ' +
      '    root.innerHTML = "<div style=\\\\\"padding:1rem;color:#ef4444;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:0.5rem;font-size:0.85rem;line-height:1.4;\\\\\">" + ' +
      '      "<div style=\\\\\"font-weight:600;margin-bottom:0.25rem;\\\\\">⚠️ 运行提示</div>" + ' +
      '      "<div>" + (msg || "网络连接受阻，无法加载在线 React 运行时") + "</div>" + ' +
      '      "<div style=\\\\\"margin-top:0.5rem;\\\\\"><button type=\\\\\"button\\\\\" onclick=\\\\\"startLoading()\\\\\" style=\\\\\"padding:0.2rem 0.6rem;font-size:0.8rem;cursor:pointer;\\\\\">重新尝试</button></div>" + ' +
      '      "</div>"; ' +
      '  } ' +
      '} ' +
      'function renderComponent() { ' +
      '  try { ' +
      '    var clean = rawSource.replace(/import\\\\s+[\\\\s\\\\S]*?\\\\s+from\\\\s+[\\\'\"][^\\\'\"]+[\\\'\"];?/g, ""); ' +
      '    var match = clean.match(/export\\\\s+default\\\\s+function\\\\s+([A-Za-z0-9_]+)/) || ' +
      '                clean.match(/export\\\\s+default\\\\s+class\\\\s+([A-Za-z0-9_]+)/) || ' +
      '                clean.match(/export\\\\s+default\\\\s+([A-Za-z0-9_]+)/) || ' +
      '                clean.match(/function\\\\s+([A-Z][A-Za-z0-9_]+)/); ' +
      '    var rootName = match ? match[1] : "MyApp"; ' +
      '    clean = clean.replace(/export\\\\s+default\\\\s+function\\\\s+([A-Za-z0-9_]+)/g, "function $1"); ' +
      '    clean = clean.replace(/export\\\\s+default\\\\s+class\\\\s+([A-Za-z0-9_]+)/g, "class $1"); ' +
      '    clean = clean.replace(/export\\\\s+default\\\\s+[A-Za-z0-9_]+;?/g, ""); ' +
      '    clean = clean.replace(/export\\\\s+/g, ""); ' +
      '    var wrapped = "(function(){\\\\n" + ' +
      '      "var useState = React.useState;\\\\n" + ' +
      '      "var useEffect = React.useEffect;\\\\n" + ' +
      '      "var useRef = React.useRef;\\\\n" + ' +
      '      "var useMemo = React.useMemo;\\\\n" + ' +
      '      "var useCallback = React.useCallback;\\\\n" + ' +
      '      clean + "\\\\n" + ' +
      '      "var __Target = typeof " + rootName + " !== \\\\\"undefined\\\\\" ? " + rootName + " : " + ' +
      '      "(typeof MyApp !== \\\\\"undefined\\\\\" ? MyApp : (typeof App !== \\\\\"undefined\\\\\" ? App : (typeof Square !== \\\\\"undefined\\\\\" ? Square : null)));\\\\n" + ' +
      '      "if (__Target) {\\\\n" + ' +
      '      "  var root = document.getElementById(\\\\\"root\\\\\");\\\\n" + ' +
      '      "  root.innerHTML = \\\\\"\\\\\";\\\\n" + ' +
      '      "  ReactDOM.createRoot(root).render(React.createElement(__Target));\\\\n" + ' +
      '      "}\\\\n" + ' +
      '      "})();"; ' +
      '    var compiled = Babel.transform(wrapped, { presets: ["react"] }).code; ' +
      '    eval(compiled); ' +
      '  } catch (err) { ' +
      '    showError(err.message || String(err)); ' +
      '  } ' +
      '} ' +
      'function startLoading() { ' +
      '  var root = document.getElementById("root"); ' +
      '  if (root) { ' +
      '    root.innerHTML = "<div style=\\\\\"display:flex;flex-direction:column;align-items:center;justify-content:center;height:160px;color:#71717a;font-size:0.88rem;gap:0.75rem;\\\\\">" + ' +
      '      "<div style=\\\\\"width:24px;height:24px;border:2px solid #a1a1aa;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;\\\\\"></div>" + ' +
      '      "<span>正在连接运行时资源…</span></div>"; ' +
      '  } ' +
      '  if (window.React && window.ReactDOM && window.Babel) { ' +
      '    renderComponent(); ' +
      '    return; ' +
      '  } ' +
      '  loadScript("https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js") ' +
      '    .then(function() { ' +
      '      return loadScript("https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"); ' +
      '    }) ' +
      '    .then(function() { ' +
      '      return loadScript("https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.7/babel.min.js"); ' +
      '    }) ' +
      '    .then(function() { ' +
      '      renderComponent(); ' +
      '    }) ' +
      '    .catch(function(e) { ' +
      '      showError("无法从 CDN 下载 React / Babel 运行时（请检查网络连接）"); ' +
      '    }); ' +
      '} ' +
      'startLoading(); ' +
      '<' + '/script></body></html>';
  }

  function runPlayground(pg, btn) {
    var sourceEl = pg.querySelector('.web-doc-playground-source');
    var iframe = pg.querySelector('.web-doc-playground-iframe');
    if (!sourceEl || !iframe) return;
    var code = sourceEl.textContent || '';
    if (!code) return;
    /* 写 srcdoc 前重设沙箱：只给脚本不给同源，示例代码碰不到阅读器与应用窗口 */
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = createRunnerDoc(code);
    if (btn) {
      btn.textContent = '⚡ 重新运行';
      btn.setAttribute('title', '重新运行沙箱示例');
    }
  }

  /* 示例代码来自网页，只在用户点击后运行，不随页面加载自动执行 */
  document.addEventListener('click', function(e) {
    var btn = e.target && e.target.closest ? e.target.closest('.web-doc-playground-run-btn') : null;
    if (!btn) return;
    var pg = btn.closest('.web-doc-playground');
    if (pg) runPlayground(pg, btn);
  });
})();</script>`
}
