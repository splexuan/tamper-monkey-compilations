// ==UserScript==
// @name          一刻相册增强：网盘式丝滑操作
// @namespace     tamper-monkey-compilations
// @version       1.5.0
// @description   给一刻相册网页版加上网盘级体验：顶部集中操作栏、单击即选/双击预览、Ctrl/Shift 多选、拖拽框选、Ctrl+A 全选、拖拽上传到当前相册、无时间线文件网格、图片/视频完整缩略图、点击预览遮罩关闭、快速切换相册、小图密集模式、带确认的智能批量下载、自动加载更多、界面精简。
// @author        lexuan
// @match         https://photo.baidu.com/*
// @grant         none
// @run-at        document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 配置 ================= */
  const CFG = {
    batchCount: 95,          // 智能下载每批数量（官方上限 100，留余量）
    batchDelay: 2500,        // 每批间隔 ms
    clickToSelect: true,     // 网盘模式：单击=选中，双击=预览（false 时保持官方单击预览）
    hideAds: true,           // 隐藏会员推广横幅等干扰元素
    compactView: false,      // 小图密集模式
    driveView: true,         // 相册详情：隐藏日期时间线，显示为连续文件网格
  };

  // 从 localStorage 恢复用户设置
  try {
    const saved = JSON.parse(localStorage.getItem('yakeEnhanceCfg') || '{}');
    Object.assign(CFG, saved);
    if (CFG.listView !== undefined) { CFG.compactView = CFG.listView; delete CFG.listView; } // 旧版迁移
  } catch (e) {}

  function saveCfg() {
    localStorage.setItem('yakeEnhanceCfg', JSON.stringify(CFG));
  }

  /* ================= 工具 ================= */
  const log = (...a) => console.log('%c[一刻增强]', 'color:#f59e0b;font-weight:bold', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 相册 DOM 命名不太稳定，这里做多套选择器兜底
  const SEL = {
    photoItem: () => document.querySelectorAll('.photo-item'),
    checkBtn: (item) => item.querySelector('.check-btn'),
    downloadBtn: () =>
      document.querySelector('.yk-icon-datuxiazai') ||
      document.querySelector('[class*="datuxiazai"]') ||
      findBtnByText('下载'),
    loadMoreBtn: () =>
      [...document.querySelectorAll('button, .btn, [class*="more"], [class*="load"]')]
        .find((el) => /加载更多|更多/.test(el.textContent || '') && el.offsetParent),
  };

  function findBtnByText(text) {
    return [...document.querySelectorAll('button, [class*="btn"]')]
      .filter((el) => el.offsetParent && (el.textContent || '').trim() === text)
      .pop();
  }

  const isPhotoItem = (el) =>
    el && el.classList && (el.classList.contains('photo-item') ||
      el.closest('.photo-item'));

  const isSelected = (item) => item.classList.contains('photo-checked');

  /* ================= 核心：选择逻辑 ================= */
  let lastAnchor = null; // Shift 范围选择的锚点

  function toggleSelect(item, on = !isSelected(item)) {
    const btn = SEL.checkBtn(item);
    const want = on;
    if (isSelected(item) !== want && btn) btn.click();
  }

  function setSelectAll(on) {
    SEL.photoItem().forEach((it) => toggleSelect(it, on));
    if (on) toast(`已选中 ${SEL.photoItem().length} 张`);
  }

  function invertSelect() {
    SEL.photoItem().forEach((it) => toggleSelect(it));
  }

  function selectRange(from, to) {
    const items = [...SEL.photoItem()];
    const i = items.indexOf(from), j = items.indexOf(to);
    if (i < 0 || j < 0) return;
    const [s, e] = i < j ? [i, j] : [j, i];
    for (let k = s; k <= e; k++) toggleSelect(items[k], true);
  }

  /* ================= 网盘模式：单击选中 / 双击预览 ================= */
  function installClickMode() {
    document.addEventListener('click', (ev) => {
      if (!CFG.clickToSelect) return;
      const item = ev.target.closest('.photo-item');
      if (!item) return;

      // 点的是角上的 check-btn，交给默认逻辑
      if (ev.target.closest('.check-btn')) return;
      // 点的是浮层里的操作图标（预览/下载/收藏等），不拦截
      if (ev.target.closest('[class*="icon"], [class*="btn"], [class*="mask"] a')) return;

      ev.preventDefault();
      ev.stopPropagation();

      if (ev.shiftKey && lastAnchor) {
        selectRange(lastAnchor, item);
      } else if (ev.ctrlKey || ev.metaKey) {
        toggleSelect(item);
        lastAnchor = item;
      } else {
        // 普通单击：清除其他，只选它（网盘习惯）
        SEL.photoItem().forEach((it) => { if (it !== item && isSelected(it)) toggleSelect(it, false); });
        toggleSelect(item, true);
        lastAnchor = item;
      }
    }, true);

    document.addEventListener('dblclick', (ev) => {
      if (!CFG.clickToSelect) return;
      const item = ev.target.closest('.photo-item');
      if (!item) return;
      // 双击打开预览：模拟官方单击行为——直接点击图片区域
      const img = item.querySelector('img');
      if (img) {
        ev.preventDefault();
        ev.stopPropagation();
        // 临时关掉网盘模式再触发原生 click，让官方预览接管
        CFG.clickToSelect = false;
        img.click();
        setTimeout(() => { CFG.clickToSelect = true; }, 100);
      }
    }, true);
  }

  /* ================= 预览：点击遮罩关闭 ================= */
  function installPreviewBackdropClose() {
    document.addEventListener('click', (ev) => {
      const preview = ev.target.closest && ev.target.closest('.yk-preview');
      if (!preview) return;

      // 操作栏、详情栏、翻页、关闭按钮和媒体控件保持原有交互。
      if (ev.target.closest([
        '.yk-preview__closeBtn', '.leftBtn', '.rightBtn',
        '.yk-preview__operate', '.preview-operate', '.yk-preview__info',
        'button', 'a', 'input', 'textarea', 'select', 'video', '[role="button"]',
      ].join(','))) return;

      // 预览图片的外层会铺满整个遮罩，因此不能只判断事件 target；
      // 用实际可见媒体的边界判断，点在图片/视频本体上不关闭。
      const media = [...preview.querySelectorAll('.yk-preview__image img, .yk-preview__video video, .yk-preview__video .video-js')]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 80 && rect.height > 80 &&
            style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
        });
      const onMedia = media.some((el) => {
        const rect = el.getBoundingClientRect();
        return ev.clientX >= rect.left && ev.clientX <= rect.right &&
          ev.clientY >= rect.top && ev.clientY <= rect.bottom;
      });
      if (onMedia) return;

      const closeBtn = preview.querySelector('.yk-preview__closeBtn');
      if (!closeBtn) return;
      ev.preventDefault();
      ev.stopPropagation();
      closeBtn.click();
    }, true);
  }

  /* ================= 拖拽框选（橡皮筋） ================= */
  function installRubberBand() {
    let box = null, sx = 0, sy = 0, active = false;

    document.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      // 只在照片容器空白处起框
      const grid = ev.target.closest('.photo-list, .date-list, [class*="photo-container"]');
      if (!grid || isPhotoItem(ev.target)) return;
      // 点在按钮/滚动条上不起框
      if (ev.target.closest('button, input, a, [class*="header"], [class*="toolbar"]')) return;

      active = true;
      sx = ev.clientX; sy = ev.clientY;
      box = document.createElement('div');
      box.id = 'yake-rubber-band';
      document.body.appendChild(box);
    }, true);

    document.addEventListener('mousemove', (ev) => {
      if (!active || !box) return;
      const x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY);
      const w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
      Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', display: 'block' });

      const rect = { l: x, t: y, r: x + w, b: y + h };
      SEL.photoItem().forEach((it) => {
        const r = it.getBoundingClientRect();
        const hit = !(r.right < rect.l || r.left > rect.r || r.bottom < rect.t || r.top > rect.b);
        if (hit && !isSelected(it)) toggleSelect(it, true);
      });
    });

    document.addEventListener('mouseup', () => {
      if (box) { box.remove(); box = null; }
      active = false;
    });
  }

  /* ================= 键盘快捷键 ================= */
  function installHotkeys() {
    document.addEventListener('keydown', (ev) => {
      const tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || ev.target.isContentEditable) return;

      // Ctrl/Cmd + A 全选本页
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') {
        const inGrid = SEL.photoItem().length > 0;
        if (!inGrid) return;
        ev.preventDefault();
        setSelectAll(true);
      }
      // Esc：取消全选
      if (ev.key === 'Escape') {
        const anySelected = [...SEL.photoItem()].some(isSelected);
        if (anySelected) setSelectAll(false);
      }
    });
  }

  /* ================= 智能批量下载（绕过 100 张限制） ================= */
  let downloading = false;

  async function smartBatchDownload() {
    if (downloading) { downloading = false; toast('⏹ 已停止批量下载'); updateBar(); return; }
    const loadedCount = SEL.photoItem().length;
    if (!loadedCount) { toast('⚠️ 当前页面没有可下载的照片'); return; }
    const confirmed = await confirmAction({
      title: '确认开始智能批量下载？',
      message: `当前已加载 ${loadedCount} 个文件，将按每批最多 ${CFG.batchCount} 个连续触发浏览器下载。下载过程中可能出现多个下载任务。`,
      confirmText: '开始下载',
    });
    if (!confirmed) return;

    downloading = true;
    updateBar();
    toast(`🚀 开始智能批量下载，每批 ${CFG.batchCount} 张`);

    let batch = 0;
    const processed = new Set();
    while (downloading) {
      // 先清空当前选择
      const selected = [...SEL.photoItem()].filter(isSelected);
      selected.forEach((it) => toggleSelect(it, false));
      await sleep(600);

      const items = [...SEL.photoItem()]
        .filter((it) => !processed.has(it))
        .slice(0, CFG.batchCount);
      if (items.length === 0) {
        toast(`✅ 本页 ${processed.size} 个文件已全部处理完`);
        break;
      }

      items.forEach((it) => toggleSelect(it, true));
      await sleep(1200);

      const dlBtn = SEL.downloadBtn();
      if (!dlBtn) { toast('❌ 找不到下载按钮，请手动处理'); break; }
      items.forEach((it) => processed.add(it));
      batch++;
      dlBtn.click();
      toast(`📦 第 ${batch} 批（${items.length} 张）已触发下载…`);
      // 等本批下载流程走完（官方下载有弹窗/进度，给足时间）
      await sleep(CFG.batchDelay + 4000);
    }
    downloading = false;
    updateBar();
  }

  /* ================= 自动加载更多（无限滚动） ================= */
  function installAutoLoad() {
    window.addEventListener('scroll', debounce(() => {
      const btn = SEL.loadMoreBtn();
      if (btn && window.innerHeight + window.scrollY > document.body.scrollHeight - 400) {
        btn.click();
      }
    }, 300));
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* ================= 界面：精简 + 悬浮工具条 ================= */
  function injectStyles() {
    const css = `
      /* 框选矩形 */
      #yake-rubber-band {
        position: fixed; z-index: 99999; display: none; pointer-events: none;
        background: rgba(245, 158, 11, .12);
        border: 1px solid rgba(245, 158, 11, .8);
        border-radius: 4px;
      }
      /* 顶部增强工具条：跟随页面布局，不遮挡照片 */
      #yake-bar {
        position: relative; z-index: 2;
        display: flex; flex-direction: row; flex-wrap: wrap;
        align-items: center; gap: 8px;
        width: 100%; min-height: 48px; box-sizing: border-box;
        margin: 0; padding: 4px 0 8px;
        background: #fff;
        font-family: system-ui, sans-serif;
      }
      #yake-bar button {
        min-height: 36px; box-sizing: border-box;
        border: 1px solid #dbe3f2; border-radius: 9px; cursor: pointer;
        padding: 8px 13px; font-size: 13px; font-weight: 600;
        background: #f7f9ff; color: #334155;
        box-shadow: none;
        transition: border-color .18s, background .18s, color .18s;
        white-space: nowrap;
      }
      #yake-bar button:hover { border-color: #8eafff; background: #eef3ff; color: #2459d3; }
      #yake-bar button:focus-visible {
        outline: 3px solid rgba(59, 117, 255, .28); outline-offset: 2px;
      }
      #yake-bar .primary { background: #f59e0b; color: #fff; }
      #yake-bar .primary:hover { border-color: #d97706; background: #d97706; color: #fff; }
      #yake-bar .danger { background: #ef4444; color: #fff; }
      #yake-bar button.off { opacity: .55; }
      /* toast */
      #yake-toast {
        position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%);
        z-index: 99999; background: rgba(31,41,55,.92); color: #fff;
        padding: 10px 20px; border-radius: 10px; font-size: 14px;
        font-family: system-ui, sans-serif; pointer-events: none;
        opacity: 0; transition: opacity .25s;
      }
      #yake-toast.show { opacity: 1; }
      /* 二次确认弹窗 */
      #yake-confirm-mask {
        position: fixed; inset: 0; z-index: 100000;
        display: flex; align-items: center; justify-content: center;
        padding: 20px; box-sizing: border-box;
        background: rgba(17, 24, 39, .45);
        font-family: system-ui, sans-serif;
      }
      #yake-confirm-dialog {
        width: min(420px, calc(100vw - 40px));
        box-sizing: border-box; padding: 24px;
        border-radius: 14px; background: #fff; color: #111827;
        box-shadow: 0 20px 60px rgba(0, 0, 0, .24);
      }
      #yake-confirm-title { margin: 0 0 10px; font-size: 18px; line-height: 1.4; }
      #yake-confirm-message { margin: 0; color: #4b5563; font-size: 14px; line-height: 1.65; }
      #yake-confirm-actions {
        display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px;
      }
      #yake-confirm-actions button {
        min-width: 88px; min-height: 44px; padding: 0 16px;
        border: 1px solid #d1d5db; border-radius: 9px;
        background: #fff; color: #374151; cursor: pointer;
        font-size: 14px; font-weight: 600;
      }
      #yake-confirm-actions button:hover { background: #f3f4f6; }
      #yake-confirm-actions .confirm {
        border-color: #f59e0b; background: #f59e0b; color: #fff;
      }
      #yake-confirm-actions .confirm:hover { background: #d97706; }
      #yake-confirm-actions button:focus-visible {
        outline: 3px solid rgba(59, 130, 246, .45); outline-offset: 2px;
      }
      /* 顶部快速切换相册 */
      #yake-album-switcher {
        display: inline-flex; align-items: center; gap: 8px;
        min-width: 0; margin-left: 20px;
        color: #6b7280; font: 13px/1 system-ui, sans-serif;
      }
      #yake-album-switcher label { white-space: nowrap; }
      #yake-album-switcher select {
        width: clamp(150px, 18vw, 240px); height: 36px;
        box-sizing: border-box; padding: 0 34px 0 12px;
        border: 1px solid #dbe3f2; border-radius: 9px;
        background: #fff; color: #1f2937; cursor: pointer;
        font: 13px/1 system-ui, sans-serif;
        text-overflow: ellipsis;
      }
      #yake-album-switcher select:hover { border-color: #8eafff; }
      #yake-album-switcher select:focus-visible,
      #yake-album-switcher button:focus-visible {
        outline: 3px solid rgba(59, 117, 255, .28); outline-offset: 2px;
      }
      #yake-album-switcher button {
        display: inline-grid; place-items: center;
        width: 36px; height: 36px; padding: 0;
        border: 1px solid #dbe3f2; border-radius: 9px;
        background: #fff; color: #3b75ff; cursor: pointer;
        font-size: 18px; line-height: 1;
      }
      #yake-album-switcher button:hover { background: #f4f7ff; border-color: #8eafff; }
      #yake-album-switcher select:disabled,
      #yake-album-switcher button:disabled { cursor: wait; opacity: .65; }
      /* 选中态强化 */
      .photo-item.photo-checked { outline: 2px solid #f59e0b; outline-offset: -2px; border-radius: 6px; }
      /* 会员推广横幅隐藏（可配置） */
      body.yake-hide-ads [class*="banner"], body.yake-hide-ads [class*="advert"],
      body.yake-hide-ads [class*="vip-promote"], body.yake-hide-ads [class*="open-vip"] { display: none !important; }

      /* ===== 拖拽上传覆盖层 ===== */
      #yake-drop-overlay {
        position: fixed; inset: 0; z-index: 99997; display: none;
        background: rgba(245, 158, 11, .15);
        border: 4px dashed #f59e0b; border-radius: 16px;
        align-items: center; justify-content: center; pointer-events: none;
        backdrop-filter: blur(2px);
      }
      #yake-drop-overlay.show { display: flex; }
      #yake-drop-overlay .tip {
        background: #f59e0b; color: #fff; padding: 18px 36px;
        border-radius: 14px; font-size: 20px; font-weight: 700;
        font-family: system-ui, sans-serif;
        box-shadow: 0 12px 40px rgba(245,158,11,.45);
      }

      /* ===== 小图密集模式 ===== */
      body.yake-compact .photo-list,
      body.yake-compact [class*="photo-container"] {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)) !important;
        gap: 8px !important;
      }
      body.yake-compact .photo-item {
        position: relative;
        display: flex !important; flex-direction: column;
        width: 100% !important; max-width: 100% !important;
        height: auto !important; min-height: 0 !important;
        margin: 0 !important; padding: 0 !important;
        border-radius: 8px; overflow: hidden;
        background: #f3f4f6;
        transition: box-shadow .15s, transform .15s;
      }
      body.yake-compact .photo-item:hover {
        box-shadow: 0 4px 14px rgba(0,0,0,.16); transform: translateY(-2px);
      }
      body.yake-compact .photo-item > img:not(.yake-fit-image),
      body.yake-compact .photo-item .img-container > img:not(.yake-fit-image) {
        width: 100% !important; height: 104px !important; max-width: none !important;
        object-fit: contain !important; border-radius: 8px 8px 0 0 !important;
        margin: 0 !important; display: block;
        background: #f3f4f6 !important;
      }
      body.yake-compact .photo-item .img-container,
      body.yake-compact .photo-item > .img {
        width: 100% !important;
        height: 104px !important;
        background-size: contain !important;
        background-position: center !important;
        background-repeat: no-repeat !important;
        background-color: #f3f4f6 !important;
      }
      body.yake-compact .photo-item .yake-name {
        width: 100%; box-sizing: border-box;
        text-align: center; font-size: 11px; color: #6b7280;
        line-height: 18px; height: 18px; padding: 0 4px;
        font-family: system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        background: #fff;
      }
      body.yake-compact .yake-filetype { display: none !important; }

      /* ===== 相册详情：无时间线的网盘式文件视图 =====
         官方结构为 date-list > date-item > (time + photo-list > photo-item)。
         display:contents 在不移动节点的前提下把照片扁平到同一个网格，避免破坏 Vue 的事件和懒加载。 */
      body.yake-drive-view .date-list {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)) !important;
        gap: 16px 12px !important;
        align-items: start !important;
        padding: 4px 0 28px !important;
      }
      body.yake-drive-view .date-list > .date-item,
      body.yake-drive-view .date-list > .date-item > .photo-list {
        display: contents !important;
      }
      body.yake-drive-view .date-list > .date-item > .time {
        display: none !important;
      }
      body.yake-drive-view .date-list .photo-item {
        position: relative !important;
        display: flex !important;
        flex-direction: column !important;
        width: 100% !important;
        height: auto !important;
        min-width: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
        border-radius: 8px !important;
        background: #f3f4f6 !important;
        box-shadow: 0 0 0 1px rgba(17, 24, 39, .08) !important;
        transition: box-shadow .15s, transform .15s !important;
      }
      body.yake-drive-view .date-list .photo-item:hover {
        box-shadow: 0 6px 18px rgba(17, 24, 39, .16) !important;
        transform: translateY(-2px);
      }
      body.yake-drive-view .date-list .photo-item .img-container,
      body.yake-drive-view .date-list .photo-item > .img {
        display: block !important;
        width: 100% !important;
        height: auto !important;
        aspect-ratio: 1 / 1 !important;
        margin: 0 !important;
        background-size: contain !important;
        background-position: center !important;
        background-repeat: no-repeat !important;
        background-color: #f3f4f6 !important;
      }
      body.yake-drive-view .date-list .photo-item .error-content,
      body.yake-drive-view .date-list .photo-item .error-content img {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
        background: #f3f4f6 !important;
      }
      /* 原站用 background:cover，且会在懒加载时重写行内样式。
         叠一层真实 img，确保竖图/横图始终完整显示，空白处用中性色填充。 */
      body.yake-drive-view .date-list .photo-item .img-container,
      body.yake-compact .photo-item .img-container { position: relative !important; overflow: hidden !important; }
      body.yake-drive-view .photo-item img.yake-fit-image,
      body.yake-compact .photo-item img.yake-fit-image {
        position: absolute !important; inset: 0 !important; z-index: 0 !important;
        display: block !important; width: 100% !important; height: 100% !important;
        max-width: none !important; margin: 0 !important;
        object-fit: contain !important; object-position: center !important;
        border-radius: 0 !important; background: #f3f4f6 !important;
        pointer-events: none !important; user-select: none !important;
      }
      /* 视频时长内的播放图标不能套用缩略图尺寸；视频封面用深色留白更自然。 */
      body.yake-drive-view .photo-item:has(> .video-duration) .img-container,
      body.yake-compact .photo-item:has(> .video-duration) .img-container,
      body.yake-drive-view .photo-item:has(> .video-duration) img.yake-fit-image,
      body.yake-compact .photo-item:has(> .video-duration) img.yake-fit-image {
        background-color: #111827 !important;
      }
      body.yake-drive-view .photo-item > .video-duration,
      body.yake-compact .photo-item > .video-duration {
        position: absolute !important; z-index: 4 !important;
        top: auto !important; left: 6px !important; right: auto !important;
        width: auto !important; min-width: 0 !important; height: 22px !important;
        box-sizing: border-box !important; padding: 0 7px !important;
        display: inline-flex !important; align-items: center !important; gap: 4px !important;
        border-radius: 999px !important; background: rgba(17, 24, 39, .82) !important;
        color: #fff !important; pointer-events: none !important;
      }
      body.yake-drive-view:not(.yake-compact) .photo-item > .video-duration { bottom: 36px !important; }
      body.yake-drive-view.yake-compact .photo-item > .video-duration { bottom: 30px !important; }
      body.yake-compact:not(.yake-drive-view) .photo-item > .video-duration { bottom: 24px !important; }
      body.yake-drive-view .photo-item > .video-duration img.start,
      body.yake-compact .photo-item > .video-duration img.start {
        position: static !important; inset: auto !important; flex: 0 0 auto !important;
        display: block !important; width: 11px !important; height: 12px !important;
        max-width: 11px !important; margin: 0 !important; padding: 0 !important;
        object-fit: contain !important; background: transparent !important;
      }
      body.yake-drive-view .photo-item > .video-duration .duration,
      body.yake-compact .photo-item > .video-duration .duration {
        width: auto !important; min-width: 0 !important; line-height: 22px !important;
        color: #fff !important; font-size: 11px !important;
      }
      body.yake-drive-view .date-list .photo-item .yake-name {
        display: block;
        width: 100%; height: 30px; line-height: 30px;
        box-sizing: border-box; padding: 0 8px;
        color: #4b5563; background: #fff;
        font: 12px/30px system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        text-align: left;
      }
      body.yake-drive-view.yake-compact .date-list {
        grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)) !important;
        gap: 8px !important;
      }
      body.yake-drive-view.yake-compact .date-list .photo-item .yake-name {
        height: 24px; line-height: 24px; font-size: 11px;
      }
      @media (prefers-reduced-motion: reduce) {
        #yake-bar button,
        body.yake-drive-view .date-list .photo-item { transition: none !important; }
      }
      @media (max-width: 900px) {
        #yake-album-switcher { margin-left: 12px; }
        #yake-album-switcher label { display: none; }
        #yake-album-switcher select { width: min(38vw, 180px); }
      }
      @media (max-width: 1100px) {
        #yake-bar { gap: 6px; }
        #yake-bar button { padding: 7px 10px; font-size: 12px; }
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function toast(msg) {
    let t = document.getElementById('yake-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'yake-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function confirmAction({ title, message, confirmText = '确定' }) {
    if (document.getElementById('yake-confirm-mask')) return Promise.resolve(false);
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const mask = document.createElement('div');
      mask.id = 'yake-confirm-mask';
      mask.innerHTML = `
        <div id="yake-confirm-dialog" role="dialog" aria-modal="true"
             aria-labelledby="yake-confirm-title" aria-describedby="yake-confirm-message">
          <h2 id="yake-confirm-title"></h2>
          <p id="yake-confirm-message"></p>
          <div id="yake-confirm-actions">
            <button type="button" data-confirm-act="cancel">取消</button>
            <button type="button" class="confirm" data-confirm-act="ok"></button>
          </div>
        </div>`;
      mask.querySelector('#yake-confirm-title').textContent = title;
      mask.querySelector('#yake-confirm-message').textContent = message;
      mask.querySelector('[data-confirm-act="ok"]').textContent = confirmText;
      document.body.appendChild(mask);

      const cancelBtn = mask.querySelector('[data-confirm-act="cancel"]');
      const okBtn = mask.querySelector('[data-confirm-act="ok"]');
      const focusables = [cancelBtn, okBtn];
      const finish = (result) => {
        document.removeEventListener('keydown', onKeyDown, true);
        mask.remove();
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        resolve(result);
      };
      const onKeyDown = (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(false);
        } else if (ev.key === 'Tab') {
          const index = focusables.indexOf(document.activeElement);
          const next = ev.shiftKey
            ? (index <= 0 ? focusables.length - 1 : index - 1)
            : (index >= focusables.length - 1 ? 0 : index + 1);
          ev.preventDefault();
          focusables[next].focus();
        }
      };
      cancelBtn.addEventListener('click', () => finish(false), { once: true });
      okBtn.addEventListener('click', () => finish(true), { once: true });
      mask.addEventListener('click', (ev) => {
        if (ev.target === mask) finish(false);
      });
      document.addEventListener('keydown', onKeyDown, true);
      cancelBtn.focus();
    });
  }

  function placeBarAtTop(bar) {
    const top = document.querySelector('.global-top');
    const nativeBar = top && top.querySelector(':scope > .handleBar');
    if (!top || !nativeBar) return false;
    if (nativeBar.nextElementSibling !== bar) nativeBar.after(bar);
    return true;
  }

  function buildBar() {
    const existing = document.getElementById('yake-bar');
    if (existing) {
      placeBarAtTop(existing);
      return;
    }
    const bar = document.createElement('div');
    bar.id = 'yake-bar';
    bar.innerHTML = `
      <button data-act="download" class="primary">🚀 智能批量下载</button>
      <button data-act="all">☑️ 全选本页</button>
      <button data-act="invert">🔄 反选</button>
      <button data-act="clear">☐ 清除选择</button>
      <button data-act="drive"></button>
      <button data-act="compact"></button>
      <button data-act="mode"></button>
    `;
    bar.addEventListener('click', (ev) => {
      const act = ev.target.dataset && ev.target.dataset.act;
      if (!act) return;
      if (act === 'all') setSelectAll(true);
      if (act === 'invert') invertSelect();
      if (act === 'clear') setSelectAll(false);
      if (act === 'drive') {
        CFG.driveView = !CFG.driveView;
        saveCfg();
        applyDriveView();
        toast(CFG.driveView ? '🗂️ 已隐藏时间线，切换为文件网格' : '🕒 已恢复按日期分组');
      }
      if (act === 'compact') {
        CFG.compactView = !CFG.compactView;
        saveCfg();
        applyCompactMode();
        toast(CFG.compactView ? '🔍 已切换为小图模式' : '🔲 已切换为标准网格');
      }
      if (act === 'download') smartBatchDownload();
      if (act === 'mode') {
        CFG.clickToSelect = !CFG.clickToSelect;
        saveCfg();
        toast(CFG.clickToSelect ? '✅ 网盘模式：单击选中 / 双击预览' : '↩️ 已恢复官方模式：单击预览');
        updateBar();
      }
    });
    if (!placeBarAtTop(bar)) document.body.appendChild(bar);
    updateBar();
  }

  function updateBar() {
    const btn = document.querySelector('#yake-bar [data-act="download"]');
    if (btn) {
      btn.textContent = downloading ? '⏹ 停止下载' : '🚀 智能批量下载';
      btn.classList.toggle('danger', downloading);
    }
    const modeBtn = document.querySelector('#yake-bar [data-act="mode"]');
    if (modeBtn) {
      modeBtn.textContent = CFG.clickToSelect ? '🖱️ 网盘模式：开' : '🖱️ 网盘模式：关';
      modeBtn.classList.toggle('off', !CFG.clickToSelect);
    }
    const compactBtn = document.querySelector('#yake-bar [data-act="compact"]');
    if (compactBtn) {
      compactBtn.textContent = CFG.compactView ? '🔲 标准视图' : '🔍 小图模式';
    }
    const driveBtn = document.querySelector('#yake-bar [data-act="drive"]');
    if (driveBtn) {
      driveBtn.textContent = CFG.driveView ? '🕒 恢复时间线' : '🗂️ 隐藏时间线';
      driveBtn.classList.toggle('off', !CFG.driveView);
    }
    document.body.classList.toggle('yake-hide-ads', CFG.hideAds);
  }

  /* ================= 拖拽上传 ================= */
  let dragDepth = 0;

  function installDragUpload() {
    const overlay = document.createElement('div');
    overlay.id = 'yake-drop-overlay';
    overlay.innerHTML = '<div class="tip">📥 松开鼠标，上传到一刻相册</div>';
    document.body.appendChild(overlay);

    document.addEventListener('dragenter', (ev) => {
      if (![...ev.dataTransfer?.types || []].some((t) => t === 'Files')) return;
      dragDepth++;
      overlay.classList.add('show');
    });
    document.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) overlay.classList.remove('show');
    });
    document.addEventListener('dragover', (ev) => {
      if (overlay.classList.contains('show')) ev.preventDefault(); // 允许 drop
    }, true);
    document.addEventListener('drop', (ev) => {
      dragDepth = 0;
      overlay.classList.remove('show');
      const files = [...(ev.dataTransfer?.files || [])];
      if (files.length === 0) return;
      // 只拦截文件拖入页面；阻止官网自己的 drop 监听重复提交同一批文件。
      ev.preventDefault();
      ev.stopImmediatePropagation();
      uploadFiles(files);
    }, true);
  }

  function findUploadInput() {
    // 官方真正处理上传的是页头的 uploader（data-v-343641cc）。
    // 相册详情里的“上传照片”菜单只负责发 headerUpload 事件，本身没有 input。
    return document.querySelector(
      '.yk-header__upload .yike-upload-container .yk-uploader .file input[type="file"]'
    ) || document.querySelector(
      '.yike-upload-container .yk-uploader .file input[type="file"]:not([webkitdirectory])'
    ) || [...document.querySelectorAll('input[type="file"]')]
      .find((inp) => !inp.hasAttribute('webkitdirectory')) || null;
  }

  function getCurrentAlbumId() {
    const m = location.pathname.match(/\/photo\/web\/album\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function getYakeStore() {
    return window.globalVue && window.globalVue.$store;
  }

  async function bindUploadToCurrentAlbum() {
    const albumId = getCurrentAlbumId();
    const store = getYakeStore();

    // 离开相册详情后清除已经完成的旧相册目标，避免 SPA 路由切换后误加回旧相册。
    if (!albumId) {
      if (store) {
        const up = store.state.upload || {};
        const busy = (up.curUploadFileList || []).length > 0 &&
          up.successFileCount !== up.totalUploadCount;
        if (!busy) store.commit('upload/setUploadAlbumInfo', {});
      }
      return { ok: true, albumId: '' };
    }

    // 相册详情接口是异步的：等官方把 albumId + tid 写入 imglist.currentAlbumInfo。
    for (let i = 0; i < 40; i++) {
      const liveStore = getYakeStore();
      const info = liveStore && liveStore.state.imglist &&
        liveStore.state.imglist.currentAlbumInfo;
      if (info && String(info.albumId) === String(albumId) && info.tid) {
        const up = liveStore.state.upload || {};
        const oldId = up.uploadAlbumInfo && up.uploadAlbumInfo.albumId;
        const busy = (up.curUploadFileList || []).length > 0 &&
          up.successFileCount !== up.totalUploadCount;

        if (oldId && String(oldId) !== String(albumId) && busy) {
          return { ok: false, reason: 'busy', albumId };
        }
        // 与官方 uploader.uploadHandle 相同的关键状态链：先重置已完成队列，再绑定当前相册。
        if (String(oldId || '') !== String(albumId) && !busy) {
          liveStore.commit('upload/cancelAllUpload');
        }
        liveStore.commit('upload/setUploadAlbumInfo', {
          albumId: info.albumId,
          tid: info.tid,
        });
        const bound = liveStore.state.upload.uploadAlbumInfo || {};
        return {
          ok: String(bound.albumId) === String(albumId) && !!bound.tid,
          albumId,
        };
      }
      await sleep(50);
    }
    return { ok: false, reason: 'album-not-ready', albumId };
  }

  async function uploadFiles(files) {
    const media = files.filter((f) =>
      /^(image|video)\//.test(f.type) ||
      /\.(cr2|nef|dng|arw|rw2|cr3|raf|jpe?g|png|gif|webp|bmp|heic|heif|tiff?|avif|svgz?|ico|cur|mp4|mov|m4v|avi|3gp|mkv|webm|flv|mts|m2ts)$/i.test(f.name)
    );
    if (media.length === 0) { toast('⚠️ 只支持图片 / 视频文件'); return; }

    const target = await bindUploadToCurrentAlbum();
    if (!target.ok) {
      if (target.reason === 'busy') {
        toast('⚠️ 另一个相册仍在上传，请等待完成后再拖入');
      } else {
        toast('⚠️ 当前相册信息尚未就绪，请刷新页面后重试');
      }
      log('未提交文件：无法安全绑定当前相册', target);
      return;
    }

    let input = findUploadInput();
    if (!input) {
      toast('⚠️ 官方上传组件尚未就绪，请刷新页面后重试');
      return;
    }

    try {
      const dt = new DataTransfer();
      media.forEach((f) => dt.items.add(f));
      // 走原生 files setter，随后只触发官方实际监听的 change 事件。
      // 不再用 defineProperty 覆盖实例属性，避免 Vue 读到陈旧 FileList。
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (setter) setter.call(input, dt.files);
      else input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      toast(target.albumId
        ? `📤 已自动上传 ${media.length} 个文件到当前相册`
        : `📤 已提交 ${media.length} 个文件到上传队列`);
      log('上传文件：', media.map((f) => f.name), '目标相册：', target.albumId || '全部照片');
    } catch (err) {
      log('上传注入失败：', err);
      toast('❌ 上传注入失败，请改用官方「上传」按钮');
    }
  }

  /* ================= 小图密集模式 ================= */
  const FILE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?|avif|svgz?|ico|cur|cr2|nef|dng|arw|rw2|cr3|raf|mp4|mov|m4v|avi|3gp|mkv|webm|flv|mts|m2ts)$/i;

  function getCurrentAlbumFilesFromVue() {
    const root = window.globalVue;
    if (!root) return [];
    const albumId = getCurrentAlbumId();
    const queue = [root];
    const seen = new Set();
    while (queue.length) {
      const vm = queue.shift();
      if (!vm || seen.has(vm)) continue;
      seen.add(vm);
      if (Array.isArray(vm.allList) && vm.allList.length &&
          (!albumId || String(vm.albumId || '') === String(albumId))) {
        return vm.allList;
      }
      if (Array.isArray(vm.$children)) queue.push(...vm.$children);
    }
    return [];
  }

  function fileNameFromMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    for (const key of ['server_filename', 'filename', 'file_name', 'name']) {
      const value = meta[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    for (const key of ['path', 'server_path', 'local_path']) {
      const value = meta[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      const name = value.replace(/\\/g, '/').split('/').pop();
      if (name) return name;
    }
    return null;
  }

  function extractFileName(item, index, albumFiles) {
    const img = item.querySelector('img');
    // 1) 官方列表数据中的原始文件名（相册页通常不会把它渲染到 DOM）
    const metaName = fileNameFromMeta(albumFiles[index]);
    if (metaName) return metaName;
    // 2) DOM 的 alt / title / data-* 属性
    for (const attr of ['alt', 'title', 'data-name', 'data-filename']) {
      const v = (img && img.getAttribute(attr)) || item.getAttribute(attr) ||
        item.querySelector(`[${attr}]`)?.getAttribute(attr);
      if (v && v.trim() && !/^\d+$/.test(v.trim())) return v.trim();
    }
    // 3) 从图片或 background-image URL 提取带扩展名的文件名
    try {
      const bg = item.querySelector('.img-container, .img');
      const bgUrl = bg && getComputedStyle(bg).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
      const url = (img && (img.currentSrc || img.src)) || bgUrl || '';
      const path = decodeURIComponent(new URL(url).pathname);
      const name = path.split('/').pop();
      if (name && FILE_EXT_RE.test(name)) return name;
      // 4) URL 查询参数里找 filename 类字段
      const qs = new URL(url).searchParams;
      for (const key of ['filename', 'fileName', 'name', 'fn']) {
        const v = qs.get(key);
        if (v) return decodeURIComponent(v);
      }
    } catch (e) {}
    return null;
  }

  function decorateCompactNames() {
    if (!CFG.compactView && !CFG.driveView) return;
    const albumFiles = getCurrentAlbumFilesFromVue();
    SEL.photoItem().forEach((item, i) => {
      const name = extractFileName(item, i, albumFiles) ||
        `${item.querySelector('[class*="video"], [class*="duration"]') ? '视频' : '图片'} ${String(i + 1).padStart(3, '0')}`;
      let tag = item.querySelector('.yake-name');
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'yake-name';
        item.appendChild(tag);
      }
      if (tag.textContent !== name) tag.textContent = name;
      if (tag.title !== name) tag.title = name;
    });
  }

  function getBackgroundImageUrl(el) {
    if (!el) return '';
    const raw = el.style.backgroundImage || getComputedStyle(el).backgroundImage || '';
    const match = raw.match(/url\(["']?(.*?)["']?\)/);
    return match ? match[1] : '';
  }

  function fitThumbnails() {
    const enabled = CFG.compactView || (CFG.driveView && !!getCurrentAlbumId());
    if (!enabled) {
      document.querySelectorAll('.yake-fit-image').forEach((img) => img.remove());
      return;
    }

    SEL.photoItem().forEach((item) => {
      const box = item.querySelector('.img-container, .img');
      if (!box) return;
      const url = getBackgroundImageUrl(box);

      // 原站会把 cover 写进行内 background；这里双保险纠正长属性。
      const style = getComputedStyle(box);
      if (style.backgroundSize !== 'contain') {
        box.style.setProperty('background-size', 'contain', 'important');
      }
      if (style.backgroundPosition !== '50% 50%' && style.backgroundPosition !== 'center') {
        box.style.setProperty('background-position', 'center', 'important');
      }
      if (style.backgroundRepeat !== 'no-repeat') {
        box.style.setProperty('background-repeat', 'no-repeat', 'important');
      }

      // background 的行内重写在部分浏览器中仍会短暂覆盖尺寸。
      // 使用相同源的真实 img 覆盖，object-fit:contain 可保证没有任何裁剪。
      if (!url) return;
      let img = box.querySelector(':scope > .yake-fit-image');
      if (!img) {
        img = document.createElement('img');
        img.className = 'yake-fit-image';
        img.alt = '';
        img.draggable = false;
        img.setAttribute('aria-hidden', 'true');
        box.appendChild(img);
      }
      if (img.getAttribute('src') !== url) img.src = url;
    });
  }

  function applyCompactMode() {
    document.body.classList.toggle('yake-compact', !!CFG.compactView);
    if (CFG.compactView || CFG.driveView) decorateCompactNames();
    fitThumbnails();
  }

  function applyDriveView() {
    const enabled = !!CFG.driveView && !!getCurrentAlbumId();
    document.body.classList.toggle('yake-drive-view', enabled);
    if (enabled) decorateCompactNames();
    fitThumbnails();
  }

  /* ================= 顶部快速切换相册 ================= */
  let albumCache = [];
  let albumCacheAt = 0;
  let albumRequest = null;

  async function fetchAlbumList(force = false) {
    const fresh = albumCache.length && Date.now() - albumCacheAt < 5 * 60 * 1000;
    if (!force && fresh) return albumCache;
    if (!force && albumRequest) return albumRequest;

    albumRequest = (async () => {
      const mainState = getYakeStore()?.state?.main;
      const storeList = mainState?.albumList;
      // 只有官网缓存明确已经翻到末页时才直接复用，避免快速切换只出现前 30 个相册。
      if (!force && Array.isArray(storeList) && storeList.length && mainState.albumHasMore === false) {
        albumCache = storeList.filter((album) => album && album.album_type !== 2);
        albumCacheAt = Date.now();
        return albumCache;
      }

      const list = [];
      let cursor = '';
      let hasMore = true;
      let page = 0;
      while (hasMore && page < 50) {
        const qs = new URLSearchParams({
          limit: '30',
          need_amount: '1',
          need_member: '1',
          field: localStorage.getItem('albumSortType') || 'mtime',
        });
        if (cursor) qs.set('cursor', cursor);
        const response = await fetch(`/youai/album/v1/list?${qs}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`相册列表请求失败：HTTP ${response.status}`);
        const json = await response.json();
        const data = json && json.data && Array.isArray(json.data.list) ? json.data : json;
        if (!data || Number(data.errno || 0) !== 0 || !Array.isArray(data.list)) {
          throw new Error((data && (data.show_msg || data.errmsg)) || '相册列表格式异常');
        }
        list.push(...data.list.filter((album) => album && album.album_type !== 2));
        cursor = data.cursor || '';
        hasMore = Number(data.has_more) !== 0 && !!cursor;
        page++;
      }

      albumCache = [...new Map(list.map((album) => [String(album.album_id), album])).values()];
      albumCacheAt = Date.now();
      return albumCache;
    })().finally(() => { albumRequest = null; });

    return albumRequest;
  }

  function renderAlbumOptions(select, albums) {
    const currentId = getCurrentAlbumId();
    const fragment = document.createDocumentFragment();
    albums.forEach((album) => {
      const option = document.createElement('option');
      option.value = String(album.album_id);
      option.textContent = `${Number(album.album_type) === 1 ? '🔒 ' : ''}${album.title || '未命名相册'}`;
      fragment.appendChild(option);
    });
    select.replaceChildren(fragment);

    if (currentId && !albums.some((album) => String(album.album_id) === currentId)) {
      const currentTitle = document.querySelector('.album-title > div:last-child')?.textContent?.trim() || '当前相册';
      const option = document.createElement('option');
      option.value = currentId;
      option.textContent = currentTitle;
      select.prepend(option);
    }
    select.value = currentId;
    select.disabled = albums.length === 0;
    select.title = albums.length ? `共 ${albums.length} 个相册，可输入首字快速定位` : '没有可切换的相册';
  }

  async function loadAlbumSwitcher(force = false) {
    const switcher = document.getElementById('yake-album-switcher');
    const select = switcher?.querySelector('select');
    const refresh = switcher?.querySelector('button');
    if (!switcher || !select || !refresh) return;
    select.disabled = true;
    refresh.disabled = true;
    if (!select.options.length || force) {
      select.replaceChildren(new Option('正在读取相册…', ''));
    }
    try {
      renderAlbumOptions(select, await fetchAlbumList(force));
    } catch (err) {
      log('读取相册列表失败：', err);
      select.replaceChildren(new Option('相册列表读取失败', ''));
      select.disabled = true;
      toast('⚠️ 相册列表读取失败，请点刷新重试');
    } finally {
      refresh.disabled = false;
    }
  }

  function mountAlbumSwitcher() {
    const currentId = getCurrentAlbumId();
    const old = document.getElementById('yake-album-switcher');
    if (!currentId) {
      if (old) old.remove();
      return;
    }
    if (old) {
      const select = old.querySelector('select');
      if (select && [...select.options].some((option) => option.value === currentId)) {
        select.value = currentId;
      }
      return;
    }

    const host = document.querySelector('.album-box');
    if (!host) return;
    const switcher = document.createElement('div');
    switcher.id = 'yake-album-switcher';
    switcher.innerHTML = `
      <label for="yake-album-select">快速切换</label>
      <select id="yake-album-select" aria-label="快速切换相册" disabled></select>
      <button type="button" title="刷新相册列表" aria-label="刷新相册列表">↻</button>`;
    host.appendChild(switcher);

    const select = switcher.querySelector('select');
    select.addEventListener('change', () => {
      const albumId = select.value;
      if (!albumId || albumId === getCurrentAlbumId()) return;
      const target = `/photo/web/album/${encodeURIComponent(albumId)}`;
      const router = window.globalVue && window.globalVue.$router;
      if (router && typeof router.push === 'function') router.push(target);
      else location.assign(target);
    });
    switcher.querySelector('button').addEventListener('click', () => loadAlbumSwitcher(true));
    loadAlbumSwitcher();
  }

  /* ================= SPA 路由适配 ================= */
  function init() {
    injectStyles();
    installClickMode();
    installPreviewBackdropClose();
    installRubberBand();
    installHotkeys();
    installAutoLoad();
    installDragUpload();
    applyCompactMode();
    applyDriveView();
    mountAlbumSwitcher();
    // SPA 页面切换后工具条可能被清掉，用 observer 兜底
    const obs = new MutationObserver(debounce(() => {
      buildBar();
      applyDriveView();
      if (CFG.compactView || CFG.driveView) decorateCompactNames();
      fitThumbnails();
      mountAlbumSwitcher();
      updateBar();
    }, 250));
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    buildBar();
    log('已加载 v1.5.0 — 全部增强功能已迁移到页面顶部操作栏');
  }

  init();
})();
