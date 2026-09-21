// ==UserScript==
// @name          B站助手
// @name:en       Bilibili Assistant
// @namespace     tamper-monkey-compilations
// @version       1.1.0
// @description   在 B 站空间页 / 合集页 / 系列页一键导出全部视频链接。支持 UP 主全部投稿、新版合集、旧版系列，可复制或导出 txt / csv。
// @author        lexuan
// @match         https://space.bilibili.com/*
// @connect       api.bilibili.com
// @connect       www.bilibili.com
// @grant         GM_xmlhttpRequest
// @grant         GM_setClipboard
// @run-at        document-idle
// @noframes
// @license       MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ==================================================================
   * 0. 基础工具
   * ================================================================*/
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const API = 'https://api.bilibili.com';

  /* ---------- 内联 MD5（wbi 签名用） ---------- */
  function md5(s) {
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function add(a, b) { return (a + b) | 0; }
    function cmn(q, a, b, x, s2, t) { return add(rol(add(add(a, q), add(x, t)), s2), b); }
    function ff(a, b, c, d, x, s2, t) { return cmn((b & c) | (~b & d), a, b, x, s2, t); }
    function gg(a, b, c, d, x, s2, t) { return cmn((b & d) | (c & ~d), a, b, x, s2, t); }
    function hh(a, b, c, d, x, s2, t) { return cmn(b ^ c ^ d, a, b, x, s2, t); }
    function ii(a, b, c, d, x, s2, t) { return cmn(c ^ (b | ~d), a, b, x, s2, t); }
    function tb(str) {
      const n = str.length, bl = new Array((((n + 8) >> 6) + 1) * 16).fill(0);
      let i;
      for (i = 0; i < n; i++) bl[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
      bl[i >> 2] |= 0x80 << ((i % 4) * 8);
      bl[(((n + 8) >> 6) + 1) * 16 - 2] = n * 8;
      return bl;
    }
    function hx(n) {
      let s2 = '';
      for (let i = 0; i < 4; i++) s2 += ((n >> (i * 8 + 4)) & 15).toString(16) + ((n >> (i * 8)) & 15).toString(16);
      return s2;
    }
    s = unescape(encodeURIComponent(s));
    const x = tb(s);
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const oa = a, ob = b, oc = c, od = d;
      a = ff(a, b, c, d, x[i], 7, -680876936);        d = ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = ff(c, d, a, b, x[i + 2], 17, 606105819);    b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = ff(a, b, c, d, x[i + 4], 7, -176418897);    d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = ff(c, d, a, b, x[i + 6], 17, -1473231341);  b = ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = ff(a, b, c, d, x[i + 8], 7, 1770035416);    d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = ff(c, d, a, b, x[i + 10], 17, -42063);      b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = ff(a, b, c, d, x[i + 12], 7, 1804603682);   d = ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
      a = gg(a, b, c, d, x[i + 1], 5, -165796510);    d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = gg(c, d, a, b, x[i + 11], 14, 643717713);   b = gg(b, c, d, a, x[i], 20, -373897302);
      a = gg(a, b, c, d, x[i + 5], 5, -701558691);    d = gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = gg(c, d, a, b, x[i + 15], 14, -660478335);  b = gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = gg(a, b, c, d, x[i + 9], 5, 568446438);     d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = gg(c, d, a, b, x[i + 3], 14, -187363961);   b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = gg(a, b, c, d, x[i + 13], 5, -1444681467);  d = gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = gg(c, d, a, b, x[i + 7], 14, 1735328473);   b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
      a = hh(a, b, c, d, x[i + 5], 4, -378558);       d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = hh(c, d, a, b, x[i + 11], 16, 1839030562);  b = hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = hh(a, b, c, d, x[i + 1], 4, -1530992060);   d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = hh(c, d, a, b, x[i + 7], 16, -155497632);   b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = hh(a, b, c, d, x[i + 13], 4, 681279174);    d = hh(d, a, b, c, x[i], 11, -358537222);
      c = hh(c, d, a, b, x[i + 3], 16, -722521979);   b = hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = hh(a, b, c, d, x[i + 9], 4, -640364487);    d = hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = hh(c, d, a, b, x[i + 15], 16, 530742520);   b = hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = ii(a, b, c, d, x[i], 6, -198630844);        d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = ii(a, b, c, d, x[i + 12], 6, 1700485571);   d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = ii(c, d, a, b, x[i + 10], 15, -1051523);    b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = ii(a, b, c, d, x[i + 8], 6, 1873313359);    d = ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = ii(c, d, a, b, x[i + 6], 15, -1560198380);  b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = ii(a, b, c, d, x[i + 4], 6, -145523070);    d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = ii(c, d, a, b, x[i + 2], 15, 718787259);    b = ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
    }
    return hx(a) + hx(b) + hx(c) + hx(d);
  }

  /* ---------- 请求封装：优先 GM_xmlhttpRequest，回退 fetch ---------- */
  function request(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 20000,
          headers: { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com' },
          onload: r => {
            try { resolve(JSON.parse(r.responseText)); }
            catch (e) { reject(new Error('响应不是合法 JSON')); }
          },
          onerror: () => reject(new Error('网络请求失败')),
          ontimeout: () => reject(new Error('请求超时')),
        });
      });
    }
    return fetch(url, { credentials: 'include' }).then(r => r.json());
  }

  const qs = o => Object.keys(o).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`).join('&');
  const api = (path, params) => request(`${API}${path}?${typeof params === 'string' ? params : qs(params)}`);

  /* ==================================================================
   * 1. wbi 签名
   * ================================================================*/
  const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52];

  async function getWbiKeys() {
    const d = await api('/x/web-interface/nav', {});
    if (!d || !d.data || !d.data.wbi_img) throw new Error('拿不到 wbi 密钥，请刷新页面重试');
    const img = d.data.wbi_img.img_url.split('/').pop().split('.')[0];
    const sub = d.data.wbi_img.sub_url.split('/').pop().split('.')[0];
    return { img, sub };
  }

  function sign(params, keys) {
    const orig = keys.img + keys.sub;
    const mixin = MIXIN.map(i => orig[i]).join('').slice(0, 32);
    const p = Object.assign({}, params, { wts: Math.round(Date.now() / 1000) });
    const q = Object.keys(p).sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ''))}`)
      .join('&');
    return q + '&w_rid=' + md5(q + mixin);
  }

  /* ==================================================================
   * 2. 抓取逻辑
   * ================================================================*/

  /** 合集列表 + 系列列表 */
  async function fetchCollectionList(mid, onProgress) {
    const seasons = [], series = [];
    for (let page = 1; page <= 50; page++) {
      const d = await api('/x/polymer/web-space/seasons_series_list',
        { mid, page_num: page, page_size: 20 });
      if (!d || d.code !== 0) throw new Error(`合集列表返回 code=${d && d.code} ${(d && d.message) || ''}`);
      const il = (d.data && d.data.items_lists) || {};
      const s1 = il.seasons_list || [], s2 = il.series_list || [];
      s1.forEach(it => {
        const m = it.meta || {};
        seasons.push({ kind: 'season', id: m.season_id, title: m.title || m.name || '', total: m.total || 0 });
      });
      s2.forEach(it => {
        const m = it.meta || {};
        series.push({ kind: 'series', id: m.series_id, title: m.name || m.title || '', total: m.total || 0 });
      });
      if (onProgress) onProgress(seasons.length + series.length, null, `列表第 ${page} 页`);
      if (s1.length < 20 && s2.length < 20) break;
      await sleep(400);
    }
    return { seasons, series };
  }

  /** 新版合集内的全部视频 */
  async function fetchSeason(mid, sid, onProgress) {
    const items = [];
    for (let pn = 1; pn <= 500; pn++) {
      const d = await api('/x/polymer/web-space/seasons_archives_list',
        { mid, season_id: sid, sort_reverse: 'false', page_num: pn, page_size: 30 });
      if (!d || d.code !== 0) throw new Error(`合集接口返回 code=${d && d.code} ${(d && d.message) || ''}`);
      const arch = (d.data && d.data.archives) || [];
      arch.forEach(a => items.push({ bvid: a.bvid, title: a.title, duration: a.duration, pubdate: a.pubdate }));
      const total = d.data && d.data.page && d.data.page.total;
      if (onProgress) onProgress(items.length, total, `第 ${pn} 页`);
      if (!arch.length || (total && items.length >= total)) break;
      await sleep(500);
    }
    return items;
  }

  /** 旧版系列内的全部视频 */
  async function fetchSeries(mid, seid, onProgress) {
    const items = [];
    for (let pn = 1; pn <= 500; pn++) {
      const d = await api('/x/series/archives',
        { mid, series_id: seid, only_normal: 'true', sort: 'desc', pn, ps: 30 });
      if (!d || d.code !== 0) throw new Error(`系列接口返回 code=${d && d.code} ${(d && d.message) || ''}`);
      const arch = (d.data && d.data.archives) || [];
      arch.forEach(a => items.push({ bvid: a.bvid, title: a.title, duration: a.duration, pubdate: a.pubdate }));
      const pg = d.data && d.data.page;
      const total = pg && typeof pg === 'object' ? pg.total : pg;
      if (onProgress) onProgress(items.length, total, `第 ${pn} 页`);
      if (!arch.length || (total && items.length >= total)) break;
      await sleep(500);
    }
    return items;
  }

  /** UP 主全部投稿（需要登录态） */
  async function fetchUp(mid, onProgress) {
    const keys = await getWbiKeys();
    const items = [];
    for (let pn = 1; pn <= 500; pn++) {
      const q = sign({
        mid, ps: 30, pn, tid: 0, keyword: '', order: 'pubdate',
        platform: 'web', web_location: 1550101, order_avoided: 'true',
      }, keys);
      const d = await api('/x/space/wbi/arc/search', q);
      if (!d || d.code !== 0) {
        const code = d && d.code;
        if (code === -352 || code === -412 || code === -799) {
          throw new Error(`被风控拦截（code=${code}）。请确认浏览器已登录 B 站，或换个页面重试。`);
        }
        throw new Error(`投稿接口返回 code=${code} ${(d && d.message) || ''}`);
      }
      const vlist = (d.data && d.data.list && d.data.list.vlist) || [];
      vlist.forEach(v => items.push({ bvid: v.bvid, title: v.title, duration: null, pubdate: v.created }));
      const total = d.data && d.data.page && d.data.page.count;
      if (onProgress) onProgress(items.length, total, `第 ${pn} 页`);
      if (!vlist.length || (total && items.length >= total)) break;
      await sleep(700);
    }
    return items;
  }

  /* ==================================================================
   * 3. 页面识别 + 导出工具
   * ================================================================*/
  function parsePage() {
    const href = location.href;
    const mid = (href.match(/space\.bilibili\.com\/(\d+)/) || [])[1];
    const sid = (href.match(/\bsid=(\d+)/) || [])[1];
    const seid = (href.match(/\/lists\/(\d+)/) || [])[1];
    let type = 'unknown';
    if (sid && mid) type = 'season';
    else if (seid && mid) type = 'series';
    else if (mid) type = 'up';
    return { href, mid, sid, seid, type };
  }

  function toLinks(items) {
    const seen = new Set(), out = [];
    items.forEach(it => {
      const u = `https://www.bilibili.com/video/${it.bvid}`;
      if (!seen.has(u)) { seen.add(u); out.push(u); }
    });
    return out;
  }

  function toCsv(items) {
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = 'bvid,标题,时长(秒),发布时间,链接';
    const rows = items.map(it => [
      esc(it.bvid), esc(it.title), esc(it.duration), esc(it.pubdate),
      esc(`https://www.bilibili.com/video/${it.bvid}`),
    ].join(','));
    return '\uFEFF' + [head].concat(rows).join('\n');
  }

  function download(content, filename, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function copyText(text) {
    return new Promise((resolve, reject) => {
      if (typeof GM_setClipboard === 'function') {
        try { GM_setClipboard(text, 'text'); return resolve(); } catch (e) { /* 继续回退 */ }
      }
      navigator.clipboard.writeText(text).then(resolve, reject);
    });
  }

  /* ==================================================================
   * 4. UI
   * ================================================================*/
  const state = {
    page: null,
    items: [],
    running: false,
    collections: null,
    label: '',
  };

  const STYLE = `
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{position:fixed;right:20px;bottom:20px;z-index:2147483647}
  .launcher{display:inline-block;padding:8px 14px;border-radius:18px;background:#00aeec;color:#fff;font-size:13px;line-height:1.2;cursor:pointer;user-select:none;box-shadow:0 2px 10px rgba(0,0,0,.18)}
  .launcher:hover{background:#0095d0}
  .panel{width:322px;background:#fff;border:1px solid #e3e5e7;border-radius:12px;box-shadow:0 6px 28px rgba(0,0,0,.16);overflow:hidden}
  .head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f6f7f8;border-bottom:1px solid #e3e5e7;cursor:move;user-select:none}
  .head b{font-size:13px;font-weight:500;color:#18191c}
  .fold{font-size:13px;color:#9499a0;cursor:pointer;padding:0 4px;line-height:1}
  .fold:hover{color:#18191c}
  .body{padding:12px;display:flex;flex-direction:column;gap:10px}
  .info{font-size:12px;line-height:1.6;color:#61666d;background:#f6f7f8;border-radius:8px;padding:8px 10px;word-break:break-all}
  .info em{font-style:normal;color:#18191c;font-weight:500}
  .row{display:flex;gap:8px}
  button{flex:1;padding:8px 10px;border-radius:8px;border:1px solid #e3e5e7;background:#fff;color:#18191c;font-size:13px;cursor:pointer;transition:.15s}
  button:hover:not(:disabled){border-color:#00aeec;color:#00aeec}
  button:disabled{opacity:.5;cursor:not-allowed}
  button.primary{background:#00aeec;border-color:#00aeec;color:#fff}
  button.primary:hover:not(:disabled){background:#0095d0;border-color:#0095d0;color:#fff}
  .status{font-size:12px;line-height:1.6;color:#61666d;min-height:0}
  .status.err{color:#f56c6c}
  .status.ok{color:#2fac5f}
  .list{max-height:190px;overflow:auto;border:1px solid #e3e5e7;border-radius:8px}
  .list:empty{display:none}
  .item{display:flex;align-items:center;gap:8px;padding:7px 9px;font-size:12px;border-bottom:1px solid #f1f2f3}
  .item:last-child{border-bottom:none}
  .item span{flex:1;color:#18191c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .item small{color:#9499a0;flex:none}
  .item button{flex:none;padding:3px 9px;font-size:12px;border-radius:6px}
  .bar{height:3px;border-radius:2px;background:#e3e5e7;overflow:hidden}
  .bar>i{display:block;height:100%;width:0;background:#00aeec;transition:width .25s}
  `;

  let ui = null;

  function initUI() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:0;bottom:0;z-index:2147483647;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    const st = document.createElement('style');
    st.textContent = STYLE;
    root.appendChild(st);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="launcher" id="launcher">B站助手</div>
      <div class="panel" id="panel" hidden>
        <div class="head" id="head"><b>B站助手</b><span class="fold" id="fold">收起</span></div>
        <div class="body">
          <div class="info" id="info">正在识别当前页面…</div>
          <div class="row" id="rowMain">
            <button class="primary" id="btnRun">开始导出</button>
            <button id="btnCols" hidden>列出合集</button>
          </div>
          <div class="bar" id="bar" hidden><i></i></div>
          <div class="status" id="status"></div>
          <div class="list" id="list"></div>
          <div class="row" id="rowOut" hidden>
            <button id="btnCopy">复制链接</button>
            <button id="btnTxt">下载 TXT</button>
            <button id="btnCsv">下载 CSV</button>
          </div>
        </div>
      </div>`;
    root.appendChild(wrap);

    ui = {
      wrap,
      launcher: root.querySelector('#launcher'),
      panel: root.querySelector('#panel'),
      head: root.querySelector('#head'),
      fold: root.querySelector('#fold'),
      info: root.querySelector('#info'),
      rowMain: root.querySelector('#rowMain'),
      btnRun: root.querySelector('#btnRun'),
      btnCols: root.querySelector('#btnCols'),
      bar: root.querySelector('#bar'),
      barInner: root.querySelector('#bar > i'),
      status: root.querySelector('#status'),
      list: root.querySelector('#list'),
      rowOut: root.querySelector('#rowOut'),
      btnCopy: root.querySelector('#btnCopy'),
      btnTxt: root.querySelector('#btnTxt'),
      btnCsv: root.querySelector('#btnCsv'),
      root,
    };

    /* --- 折叠 / 展开 --- */
    ui.launcher.onclick = () => { ui.panel.hidden = false; ui.launcher.style.display = 'none'; };
    ui.fold.onclick = () => { ui.panel.hidden = true; ui.launcher.style.display = 'inline-block'; };

    /* --- 面板拖拽 --- */
    let dragging = false, dx = 0, dy = 0;
    ui.head.addEventListener('mousedown', e => {
      if (e.target === ui.fold) return;
      const r = ui.panel.getBoundingClientRect();
      dragging = true; dx = e.clientX - r.left; dy = e.clientY - r.top;
      ui.wrap.style.right = 'auto'; ui.wrap.style.bottom = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = ui.panel.offsetWidth || 322, h = ui.panel.offsetHeight || 200;
      const x = Math.min(Math.max(e.clientX - dx, 4), window.innerWidth - w - 4);
      const y = Math.min(Math.max(e.clientY - dy, 4), window.innerHeight - h - 4);
      ui.wrap.style.left = x + 'px';
      ui.wrap.style.top = y + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    /* --- 按钮绑定 --- */
    ui.btnRun.onclick = onRun;
    ui.btnCols.onclick = onListCollections;
    ui.btnCopy.onclick = onCopy;
    ui.btnTxt.onclick = () => doDownload('txt');
    ui.btnCsv.onclick = () => doDownload('csv');

    refreshPage();
    setInterval(() => {
      if (location.href !== (state.page && state.page.href)) {
        state.page = null;
        state.items = [];
        state.collections = null;
        refreshPage();
      }
    }, 800);
  }

  function setStatus(text, cls) {
    if (!ui) return;
    ui.status.textContent = text || '';
    ui.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function setBusy(busy) {
    state.running = busy;
    if (!ui) return;
    ui.btnRun.disabled = busy;
    ui.btnCols.disabled = busy;
    ui.btnRun.textContent = busy ? '导出中…' : '开始导出';
    ui.bar.hidden = !busy;
    if (!busy) ui.barInner.style.width = '0';
  }

  function setProgress(cur, total, note) {
    if (!ui) return;
    const pct = total ? Math.min(100, Math.round(cur / total * 100)) : 30;
    ui.barInner.style.width = pct + '%';
    setStatus(`${note ? note + '　' : ''}已获取 ${cur}${total ? ' / ' + total : ''} 条`);
  }

  function refreshPage() {
    const page = parsePage();
    state.page = page;
    if (!ui) return;
    if (page.type === 'unknown') {
      ui.info.innerHTML = '当前页面无法识别。<br>请在 UP 主空间页、合集页或系列页使用。';
      ui.btnRun.disabled = true;
      ui.btnCols.hidden = true;
      return;
    }
    ui.btnRun.disabled = false;
    ui.rowOut.hidden = true;
    ui.list.innerHTML = '';
    setStatus('');
    const map = {
      season: () => `当前页面：<em>合集</em>（mid=${page.mid}, sid=${page.sid}）`,
      series: () => `当前页面：<em>系列</em>（mid=${page.mid}, series=${page.seid}）`,
      up: () => `当前页面：<em>UP 主空间</em>（mid=${page.mid}）<br>可导出全部投稿，或先列出合集再挑着导。`,
    };
    ui.info.innerHTML = map[page.type]();
    ui.btnCols.hidden = page.type !== 'up';
  }

  async function onRun() {
    const page = state.page;
    if (!page || page.type === 'unknown' || state.running) return;
    setBusy(true);
    ui.rowOut.hidden = true;
    ui.list.innerHTML = '';
    state.items = [];
    try {
      if (page.type === 'season') {
        state.items = await fetchSeason(page.mid, page.sid, setProgress);
        state.label = `collection_${page.sid}`;
      } else if (page.type === 'series') {
        state.items = await fetchSeries(page.mid, page.seid, setProgress);
        state.label = `series_${page.seid}`;
      } else {
        state.items = await fetchUp(page.mid, setProgress);
        state.label = `up_${page.mid}`;
      }
      const n = toLinks(state.items).length;
      setStatus(`完成，共 ${n} 条视频链接。`, 'ok');
      ui.barInner.style.width = '100%';
      ui.rowOut.hidden = n === 0;
    } catch (e) {
      setStatus(e.message || String(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  async function onListCollections() {
    const page = state.page;
    if (!page || page.type !== 'up' || state.running) return;
    setBusy(true);
    ui.list.innerHTML = '';
    setStatus('正在获取合集列表…');
    try {
      const { seasons, series } = await fetchCollectionList(page.mid, setProgress);
      state.collections = seasons.concat(series);
      setStatus(`共 ${seasons.length} 个合集、${series.length} 个系列。`, 'ok');
      renderCollections();
    } catch (e) {
      setStatus(e.message || String(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  function renderCollections() {
    ui.list.innerHTML = '';
    state.collections.forEach(c => {
      const div = document.createElement('div');
      div.className = 'item';
      const s = document.createElement('span');
      s.textContent = c.title || `（未命名 ${c.kind} ${c.id}）`;
      s.title = s.textContent;
      const small = document.createElement('small');
      small.textContent = c.total;
      const btn = document.createElement('button');
      btn.textContent = '导出';
      btn.onclick = async () => {
        if (state.running) return;
        setBusy(true);
        setStatus(`正在导出「${c.title || c.id}」…`);
        try {
          state.items = c.kind === 'season'
            ? await fetchSeason(state.page.mid, c.id, setProgress)
            : await fetchSeries(state.page.mid, c.id, setProgress);
          state.label = `${c.kind}_${c.id}`;
          const n = toLinks(state.items).length;
          setStatus(`「${c.title || c.id}」完成，共 ${n} 条。`, 'ok');
          ui.rowOut.hidden = n === 0;
        } catch (e) {
          setStatus(e.message || String(e), 'err');
        } finally {
          setBusy(false);
        }
      };
      div.appendChild(s);
      div.appendChild(small);
      div.appendChild(btn);
      ui.list.appendChild(div);
    });
  }

  async function onCopy() {
    const text = toLinks(state.items).join('\n');
    try {
      await copyText(text);
      setStatus(`已复制 ${toLinks(state.items).length} 条链接到剪贴板。`, 'ok');
    } catch (e) {
      setStatus('复制失败，请改用「下载 TXT」。', 'err');
    }
  }

  function doDownload(kind) {
    const links = toLinks(state.items);
    if (!links.length) return;
    if (kind === 'txt') {
      download(links.join('\n'), `${state.label}_links.txt`, 'text/plain;charset=utf-8');
    } else {
      download(toCsv(state.items), `${state.label}_detail.csv`, 'text/csv;charset=utf-8');
    }
    setStatus(`已下载 ${links.length} 条链接。`, 'ok');
  }

  /* ==================================================================
   * 5. 启动
   * ================================================================*/
  if (typeof window !== 'undefined') {
    window.__BILI_LINKS_CORE__ = {
      md5, sign, getWbiKeys,
      fetchCollectionList, fetchSeason, fetchSeries, fetchUp,
      parsePage, toLinks, toCsv,
    };
  }
  if (!globalThis.__BILI_LINKS_NO_UI__) {
    try { initUI(); }
    catch (e) { console.error('[B站助手] UI 初始化失败：', e); }
  }
})();
