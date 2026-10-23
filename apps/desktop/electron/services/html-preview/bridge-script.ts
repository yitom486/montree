import { HTML_PREVIEW_BRIDGE_CHANNEL } from '../../../contracts/html-preview'

/**
 * 注入到预览页 `<head>` 最前面的桥接脚本（纯 ES5 字符串，不经打包转换）。
 * 页面与应用不同源，宿主无法直接操作页面 DOM，缩放/锚点/链接拦截/阅读快照/选区都经 postMessage 往返：
 * - 宿主 → 页面：`zoom`、`anchor`（只认 `window.parent` 发来的消息）
 * - 页面 → 宿主：`link`（拦截非锚点链接交给宿主裁决）、`snapshot`（隐藏节点标 hidden、去脚本样式后的正文 HTML
 *   与视口可见文本）、`viewport`、`selection`
 * window 捕获阶段先于页面自身监听器注册，页面脚本不能抢先吞掉链接点击。
 */
export const HTML_PREVIEW_BRIDGE_SCRIPT = `(function () {
  if (window.parent === window) return;
  var CHANNEL = ${JSON.stringify(HTML_PREVIEW_BRIDGE_CHANNEL)};
  var zoom = 100;
  var snapshotTimer = 0;
  var viewportTimer = 0;
  var selectionTimer = 0;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1 };
  function post(message) {
    message.channel = CHANNEL;
    try { window.parent.postMessage(message, '*'); } catch (e) {}
  }
  function scrollToAnchor(id) {
    try {
      var target = document.getElementById(id) || document.getElementsByName(id)[0];
      if (target) target.scrollIntoView({ block: 'start' });
    } catch (e) {}
  }
  function applyZoom() {
    if (document.body) document.body.style.zoom = zoom + '%';
    scheduleViewport();
  }
  function snapshotHtml() {
    var body = document.body;
    if (!body) return '';
    var clone = body.cloneNode(true);
    var live = body.getElementsByTagName('*');
    var copies = clone.getElementsByTagName('*');
    var count = Math.min(live.length, copies.length, 50000);
    for (var i = 0; i < count; i++) {
      var element = live[i];
      var copy = copies[i];
      if (SKIP_TAGS[element.tagName]) continue;
      var style = null;
      try { style = window.getComputedStyle(element); } catch (e) {}
      if (style && style.display === 'none') copy.setAttribute('hidden', '');
      else if (style && style.visibility === 'hidden') copy.setAttribute('style', 'visibility:hidden');
      if (element.tagName === 'IMG' && element.currentSrc) copy.setAttribute('src', element.currentSrc);
    }
    var drop = clone.querySelectorAll('script,style,template,noscript');
    for (var j = 0; j < drop.length; j++) drop[j].parentNode.removeChild(drop[j]);
    return clone.innerHTML;
  }
  function viewportText() {
    var body = document.body;
    if (!body) return '';
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    var height = window.innerHeight;
    var width = window.innerWidth;
    var lines = [];
    var visited = 0;
    while (walker.nextNode() && visited++ < 20000) {
      var node = walker.currentNode;
      var element = node.parentElement;
      var text = (node.textContent || '').trim();
      if (!element || !text || element.closest('button,script,style,textarea,select,noscript,template')) continue;
      var range = document.createRange();
      range.selectNodeContents(node);
      var rects = range.getClientRects();
      var visible = false;
      for (var k = 0; k < rects.length; k++) {
        var rect = rects[k];
        if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width) { visible = true; break; }
      }
      if (visible && window.getComputedStyle(element).visibility !== 'hidden') lines.push(text);
    }
    return lines.join('\\n');
  }
  function sendSnapshot() {
    snapshotTimer = 0;
    try { post({ type: 'snapshot', html: snapshotHtml(), viewport: viewportText() }); } catch (e) {}
  }
  function scheduleSnapshot(delay) {
    if (delay === 0) {
      if (snapshotTimer) clearTimeout(snapshotTimer);
      snapshotTimer = setTimeout(sendSnapshot, 0);
    } else if (!snapshotTimer) {
      snapshotTimer = setTimeout(sendSnapshot, delay);
    }
  }
  function scheduleViewport() {
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(function () {
      viewportTimer = 0;
      try { post({ type: 'viewport', viewport: viewportText() }); } catch (e) {}
    }, 150);
  }
  function selectionText() {
    var selection = window.getSelection();
    return selection ? selection.toString() : '';
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.type === 'zoom' && typeof data.zoom === 'number') { zoom = data.zoom; applyZoom(); }
    else if (data.type === 'anchor' && typeof data.id === 'string') scrollToAnchor(data.id);
  });
  window.addEventListener('click', function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest('a[href]') : null;
    if (!anchor) return;
    var href = (anchor.getAttribute('href') || '').trim();
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    post({ type: 'link', href: href });
  }, true);
  window.addEventListener('mouseup', function () {
    post({ type: 'selection', text: selectionText(), commit: true });
  }, true);
  document.addEventListener('selectionchange', function () {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(function () {
      selectionTimer = 0;
      post({ type: 'selection', text: selectionText(), commit: false });
    }, 120);
  });
  window.addEventListener('scroll', scheduleViewport, true);
  window.addEventListener('resize', scheduleViewport);
  window.addEventListener('load', function () { scheduleSnapshot(0); });
  function start() {
    if (document.body) {
      new MutationObserver(function () { scheduleSnapshot(800); }).observe(document.body, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'],
      });
    }
    scheduleSnapshot(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();`

/** 把桥接脚本插到 `<head>` 开头；没有 head 时退到 `<html>`/doctype 之后，保证不把文档挤进怪异模式。 */
export function injectHtmlPreviewBridge(html: string): string {
  const tag = `<script data-montree-bridge>${HTML_PREVIEW_BRIDGE_SCRIPT}</script>`
  const anchor = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html)
  if (!anchor) return tag + html
  const end = anchor.index + anchor[0].length
  return html.slice(0, end) + tag + html.slice(end)
}
