// ==UserScript==
// @name          Twitter/X 文章助手
// @namespace     tamper-monkey-compilations
// @version       0.7.1
// @description   Twitter/X 文章代码块自动换行，并支持一键截图及导出内嵌图片的 Markdown。
// @author        Codex
// @match         https://x.com/*
// @match         https://twitter.com/*
// @require       https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @connect       pbs.twimg.com
// @grant         GM_addStyle
// @grant         GM_xmlhttpRequest
// @run-at        document-start
// ==/UserScript==

(function () {
  'use strict';

  const ARTICLE_SELECTORS = [
    '[data-testid="twitterArticleReadView"]',
    '[data-testid="twitterArticleRichTextView"]',
    '[data-testid="longformRichTextComponent"]',
    '[data-testid="articleBody"]',
    '[data-testid="ArticleBody"]',
  ];

  const ARTICLE_SELECTOR = ARTICLE_SELECTORS.join(',');
  const CODE_BLOCK_ATTRIBUTE = 'data-twitter-article-code-block';
  const SCROLLBOX_ATTRIBUTE = 'data-twitter-article-code-scrollbox';
  const SCREENSHOT_BUTTON_ATTRIBUTE = 'data-twitter-article-screenshot-button';
  const EXPORT_BUTTON_ATTRIBUTE = 'data-twitter-article-export-button';
  const SCREENSHOT_UI_ATTRIBUTE = 'data-twitter-article-assistant-ui';
  const CAPTURE_TARGET_ATTRIBUTE = 'data-twitter-article-capture-target';
  const VISIBLE_LIST_MARKER_ATTRIBUTE = 'data-twitter-article-visible-list-marker';
  const CAPTURE_SIDE_PADDING = 24;
  const PREFERRED_CAPTURE_SCALE = 2;
  const MAX_CAPTURE_SCALE = 2.5;
  const MAX_CANVAS_HEIGHT = 32000;
  const MAX_CANVAS_PIXELS = 24000000;

  let screenshotButton = null;
  let screenshotInProgress = false;
  let exportButton = null;
  let exportInProgress = false;
  let cachedTarget = null;
  let cachedHref = '';
  let refreshTimer = null;

  const css = `
    [${CODE_BLOCK_ATTRIBUTE}],
    [${CODE_BLOCK_ATTRIBUTE}] code {
      box-sizing: border-box !important;
      width: 100% !important;
      max-width: 100% !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }

    [${CODE_BLOCK_ATTRIBUTE}],
    [${SCROLLBOX_ATTRIBUTE}] {
      overflow: visible !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
      max-height: none !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    [${CODE_BLOCK_ATTRIBUTE}]::-webkit-scrollbar,
    [${SCROLLBOX_ATTRIBUTE}]::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }

    [${SCREENSHOT_BUTTON_ATTRIBUTE}],
    [${EXPORT_BUTTON_ATTRIBUTE}] {
      position: fixed !important;
      right: 24px !important;
      bottom: auto !important;
      z-index: 2147483647 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-height: 42px !important;
      padding: 0 16px !important;
      border: 0 !important;
      border-radius: 999px !important;
      color: #fff !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .24) !important;
      font: 700 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      cursor: pointer !important;
      user-select: none !important;
      transition: transform .15s ease, opacity .15s ease !important;
    }

    [${SCREENSHOT_BUTTON_ATTRIBUTE}] {
      top: 24px !important;
      background: rgb(29, 155, 240) !important;
    }

    [${EXPORT_BUTTON_ATTRIBUTE}] {
      top: 76px !important;
      background: rgb(15, 20, 25) !important;
    }

    [${SCREENSHOT_BUTTON_ATTRIBUTE}]:hover,
    [${EXPORT_BUTTON_ATTRIBUTE}]:hover {
      transform: translateY(-1px) !important;
    }

    [${SCREENSHOT_BUTTON_ATTRIBUTE}]:disabled,
    [${EXPORT_BUTTON_ATTRIBUTE}]:disabled {
      cursor: wait !important;
      opacity: .72 !important;
      transform: none !important;
    }

    @media (max-width: 700px) {
      [${SCREENSHOT_BUTTON_ATTRIBUTE}],
      [${EXPORT_BUTTON_ATTRIBUTE}] {
        right: 14px !important;
        bottom: auto !important;
      }

      [${SCREENSHOT_BUTTON_ATTRIBUTE}] { top: 14px !important; }
      [${EXPORT_BUTTON_ATTRIBUTE}] { top: 64px !important; }
    }
  `;

  function addStyle(styles) {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(styles);
      return;
    }

    const style = document.createElement('style');
    style.textContent = styles;
    (document.head || document.documentElement).appendChild(style);
  }

  function markCodeBlock(pre, articleRoot) {
    if (!(pre instanceof HTMLElement)) return;

    pre.setAttribute(CODE_BLOCK_ATTRIBUTE, '');

    // X 有时会把滚动设在 pre 外层的包装元素上。
    // 只检查代码块与文章根元素之间的少量父级，避免影响整篇文章的布局。
    let parent = pre.parentElement;
    let depth = 0;

    while (parent && parent !== articleRoot && depth < 3) {
      const style = getComputedStyle(parent);
      const hasScrollableOverflow = ['auto', 'scroll'].some(
        (value) => style.overflow === value || style.overflowX === value || style.overflowY === value,
      );

      if (hasScrollableOverflow) {
        parent.setAttribute(SCROLLBOX_ATTRIBUTE, '');
      }

      parent = parent.parentElement;
      depth += 1;
    }
  }

  function processArticle(articleRoot) {
    if (!(articleRoot instanceof HTMLElement)) return;

    articleRoot.querySelectorAll(`pre:not([${CODE_BLOCK_ATTRIBUTE}])`).forEach((pre) => {
      markCodeBlock(pre, articleRoot);
    });
  }

  function getScreenshotTarget() {
    const currentHref = window.location.href;

    if (cachedHref === currentHref && cachedTarget?.isConnected) {
      return cachedTarget;
    }

    cachedHref = currentHref;
    cachedTarget = null;

    const articleTarget = (
      document.querySelector('[data-testid="twitterArticleReadView"]') ||
      document.querySelector('[data-testid="twitterArticleRichTextView"]') ||
      document.querySelector('[data-testid="longformRichTextComponent"]')
    );

    if (articleTarget) {
      cachedTarget = articleTarget;
      return cachedTarget;
    }

    // 普通帖子和长推文使用 article[data-testid="tweet"]。
    // 只在帖子详情页启用，并用 URL 中的 status ID 匹配主帖，
    // 避免错误截取页面下方的回复或引用帖。
    const statusId = window.location.pathname.match(/\/status\/(\d+)/)?.[1];
    if (!statusId) return null;

    const statusLink = document.querySelector(
      `article[data-testid="tweet"] a[href*="/status/${statusId}"]`,
    );
    const matchedTweet = statusLink?.closest('article[data-testid="tweet"]');

    cachedTarget = matchedTweet || document.querySelector(
      '[data-testid="primaryColumn"] article[data-testid="tweet"]',
    );
    return cachedTarget;
  }

  function isArticleTarget(target) {
    return Boolean(
      target?.matches?.(
        '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]',
      ) || target?.querySelector?.('[data-testid="twitter-article-title"]'),
    );
  }

  function getDefaultButtonText(target = getScreenshotTarget()) {
    return isArticleTarget(target)
      ? '📸 截取文章长图'
      : '📸 截取帖子长图';
  }

  function setButtonState(text, disabled) {
    if (!screenshotButton) return;
    screenshotButton.textContent = text;
    screenshotButton.disabled = disabled;
  }

  function ensureScreenshotButton(target = getScreenshotTarget()) {

    if (!target) {
      if (screenshotButton && !screenshotInProgress) {
        screenshotButton.remove();
        screenshotButton = null;
      }
      return;
    }

    if (screenshotButton?.isConnected) {
      if (!screenshotInProgress) {
        screenshotButton.textContent = getDefaultButtonText(target);
        screenshotButton.title = isArticleTarget(target)
          ? '将文章部分保存为 PNG'
          : '将当前主帖保存为 PNG';
      }
      return;
    }

    screenshotButton = document.createElement('button');
    screenshotButton.type = 'button';
    screenshotButton.setAttribute(SCREENSHOT_BUTTON_ATTRIBUTE, '');
    screenshotButton.setAttribute(SCREENSHOT_UI_ATTRIBUTE, '');
    screenshotButton.textContent = getDefaultButtonText(target);
    screenshotButton.title = isArticleTarget(target)
      ? '将文章部分保存为 PNG'
      : '将当前主帖保存为 PNG';
    screenshotButton.addEventListener('click', captureArticle);
    document.body.appendChild(screenshotButton);
  }

  function getDefaultExportButtonText(target = getScreenshotTarget()) {
    return isArticleTarget(target)
      ? '📝 导出文章'
      : '📝 导出帖子';
  }

  function setExportButtonState(text, disabled) {
    if (!exportButton) return;
    exportButton.textContent = text;
    exportButton.disabled = disabled;
  }

  function ensureExportButton(target = getScreenshotTarget()) {
    if (!target) {
      if (exportButton && !exportInProgress) {
        exportButton.remove();
        exportButton = null;
      }
      return;
    }

    if (exportButton?.isConnected) {
      if (!exportInProgress) {
        exportButton.textContent = getDefaultExportButtonText(target);
        exportButton.title = isArticleTarget(target)
          ? '将文章导出为 Markdown 文件'
          : '将当前主帖导出为 Markdown 文件';
      }
      return;
    }

    exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.setAttribute(EXPORT_BUTTON_ATTRIBUTE, '');
    exportButton.setAttribute(SCREENSHOT_UI_ATTRIBUTE, '');
    exportButton.textContent = getDefaultExportButtonText(target);
    exportButton.title = isArticleTarget(target)
      ? '将文章导出为 Markdown 文件'
      : '将当前主帖导出为 Markdown 文件';
    exportButton.addEventListener('click', exportArticle);
    document.body.appendChild(exportButton);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function prepareImages(target) {
    const images = [...target.querySelectorAll('img')];

    for (const image of images) {
      image.loading = 'eager';
    }

    await Promise.all(
      images.map(async (image) => {
        if (image.complete && image.naturalWidth > 0) return;

        try {
          await Promise.race([image.decode(), wait(4000)]);
        } catch (_) {
          // 单张图片加载失败时仍继续截取其余内容。
        }
      }),
    );
  }

  function getBackgroundColor(element) {
    let current = element;

    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
        return color;
      }
      current = current.parentElement;
    }

    return getComputedStyle(document.body).color === 'rgb(231, 233, 234)'
      ? 'rgb(0, 0, 0)'
      : 'rgb(255, 255, 255)';
  }

  function sanitizeFileName(value) {
    return (value || 'x-article')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'x-article';
  }

  function escapeMarkdown(value) {
    return (value || '')
      .replace(/\\/g, '\\\\')
      .replace(/([`*_{}\[\]<>])/g, '\\$1');
  }

  function normalizeMarkdown(value) {
    return (value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function markdownUrl(value) {
    try {
      return new URL(value, window.location.href).href
        .replace(/ /g, '%20')
        .replace(/\)/g, '%29');
    } catch (_) {
      return value || '';
    }
  }

  function inlineToMarkdown(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tagName = node.tagName;
    if (['SCRIPT', 'STYLE', 'SVG', 'BUTTON'].includes(tagName)) return '';
    if (tagName === 'BR') return '\n';

    if (tagName === 'IMG') {
      const source = node.currentSrc || node.src;
      return source ? `![${escapeMarkdown(node.alt || '图片')}](${markdownUrl(source)})` : '';
    }

    const content = [...node.childNodes].map(inlineToMarkdown).join('');

    if (tagName === 'A') {
      const href = node.getAttribute('href');
      if (!href) return content;
      const label = normalizeMarkdown(content) || markdownUrl(href);
      return `[${label}](${markdownUrl(href)})`;
    }

    const fontWeight = node.style?.fontWeight;
    const isBold = tagName === 'B' || tagName === 'STRONG' || fontWeight === 'bold' || Number(fontWeight) >= 600;
    const isItalic = tagName === 'I' || tagName === 'EM' || node.style?.fontStyle === 'italic';
    let formatted = content;
    if (isBold && normalizeMarkdown(formatted)) formatted = `**${formatted}**`;
    if (isItalic && normalizeMarkdown(formatted)) formatted = `*${formatted}*`;
    return formatted;
  }

  function getDraftBlockContent(block) {
    return block.querySelector(':scope > .public-DraftStyleDefault-block') || block;
  }

  function exportListToMarkdown(list) {
    const ordered = list.tagName === 'OL';
    return [...list.children]
      .filter((item) => item.tagName === 'LI')
      .map((item, index) => {
        const content = normalizeMarkdown(inlineToMarkdown(getDraftBlockContent(item)));
        return content ? `${ordered ? `${index + 1}.` : '-'} ${content}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  function exportSectionToMarkdown(section) {
    const embeddedTweet = section.querySelector('[data-testid="simpleTweet"]');
    if (embeddedTweet) {
      const tweetText = normalizeMarkdown(
        inlineToMarkdown(embeddedTweet.querySelector('[data-testid="tweetText"]')),
      );
      const statusLink = [...embeddedTweet.querySelectorAll('a[href*="/status/"]')]
        .map((link) => link.href)
        .find(Boolean);
      const quote = tweetText
        ? tweetText.split('\n').map((line) => `> ${line}`).join('\n')
        : '> 嵌入帖子';
      return statusLink ? `${quote}\n>\n> [查看原帖](${markdownUrl(statusLink)})` : quote;
    }

    const images = [...section.querySelectorAll('a[href*="/media/"] img[src], img[data-testid="tweetPhoto"][src]')];
    const exportedImages = [];
    const seenSources = new Set();
    images.forEach((image) => {
      const source = image.currentSrc || image.src;
      if (!source || seenSources.has(source)) return;
      seenSources.add(source);
      exportedImages.push(`![${escapeMarkdown(image.alt || '文章图片')}](${markdownUrl(source)})`);
    });
    if (exportedImages.length) return exportedImages.join('\n\n');

    const mediaLink = section.querySelector('a[href*="/media/"]')?.href;
    if (section.querySelector('video') && mediaLink) {
      return `[视频](${markdownUrl(mediaLink)})`;
    }

    return '';
  }

  function exportRichTextToMarkdown(target) {
    const richText = target.matches?.('[data-testid="longformRichTextComponent"]')
      ? target
      : target.querySelector?.('[data-testid="longformRichTextComponent"]');
    if (!richText) return '';

    const contents = richText.querySelector('[data-contents="true"]') || richText;
    const parts = [];

    [...contents.children].forEach((block) => {
      const heading = block.matches?.('h1, h2, h3, h4, h5, h6')
        ? block
        : block.querySelector?.(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');

      if (heading) {
        const sourceLevel = Number(heading.tagName.slice(1)) || 1;
        const level = Math.min(sourceLevel + 1, 6);
        const text = normalizeMarkdown(inlineToMarkdown(getDraftBlockContent(heading)));
        if (text) parts.push(`${'#'.repeat(level)} ${text}`);
        return;
      }

      if (block.matches?.('ul, ol')) {
        const list = exportListToMarkdown(block);
        if (list) parts.push(list);
        return;
      }

      if (block.matches?.('section')) {
        const section = exportSectionToMarkdown(block);
        if (section) parts.push(section);
        return;
      }

      const codeBlock = block.matches?.('pre') ? block : block.querySelector?.(':scope > pre');
      if (codeBlock) {
        parts.push(`\`\`\`\n${codeBlock.textContent.trim()}\n\`\`\``);
        return;
      }

      const paragraph = normalizeMarkdown(inlineToMarkdown(getDraftBlockContent(block)));
      if (paragraph) parts.push(paragraph);
    });

    return parts.join('\n\n');
  }

  function exportPostToMarkdown(target) {
    const textRoot = target.querySelector?.('[data-testid="tweetText"]');
    const parts = [];
    const text = normalizeMarkdown(inlineToMarkdown(textRoot));
    if (text) parts.push(text);

    const images = [...target.querySelectorAll?.('[data-testid="tweetPhoto"] img[src]') || []];
    const seenSources = new Set();
    images.forEach((image) => {
      const source = image.currentSrc || image.src;
      if (!source || seenSources.has(source)) return;
      seenSources.add(source);
      parts.push(`![${escapeMarkdown(image.alt || '帖子图片')}](${markdownUrl(source)})`);
    });
    return parts.join('\n\n');
  }

  function getExportTitle(target) {
    const articleTitle = document.querySelector('[data-testid="twitter-article-title"]')?.textContent;
    const postText = target?.querySelector?.('[data-testid="tweetText"]')?.textContent;
    return normalizeMarkdown(articleTitle || postText || 'X 文章').slice(0, 120);
  }

  function buildExportFileName(target) {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    return `${sanitizeFileName(getExportTitle(target))}-${stamp}.md`;
  }

  function downloadTextFile(content, fileName) {
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('图片编码失败'));
      reader.readAsDataURL(blob);
    });
  }

  function requestImageBlob(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'blob',
          timeout: 30000,
          onload: (response) => {
            if (response.status >= 200 && response.status < 300 && response.response) {
              resolve(response.response);
              return;
            }
            reject(new Error(`图片请求失败：HTTP ${response.status}`));
          },
          onerror: () => reject(new Error('图片请求失败')),
          ontimeout: () => reject(new Error('图片请求超时')),
        });
      });
    }

    return fetch(url, { credentials: 'omit' }).then((response) => {
      if (!response.ok) throw new Error(`图片请求失败：HTTP ${response.status}`);
      return response.blob();
    });
  }

  async function embedMarkdownImages(markdown) {
    const imagePattern = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
    const imageUrls = [...new Set([...markdown.matchAll(imagePattern)].map((match) => match[1]))];
    if (!imageUrls.length) return { markdown, failed: [] };

    const replacements = new Map();
    const failed = [];
    const batchSize = 3;

    for (let start = 0; start < imageUrls.length; start += batchSize) {
      const batch = imageUrls.slice(start, start + batchSize);
      setExportButtonState(
        `处理图片 ${Math.min(start + batch.length, imageUrls.length)}/${imageUrls.length}…`,
        true,
      );

      await Promise.all(batch.map(async (url) => {
        try {
          const blob = await requestImageBlob(url);
          if (!blob.type.startsWith('image/')) {
            throw new Error(`返回内容不是图片：${blob.type || 'unknown'}`);
          }
          replacements.set(url, await blobToDataUrl(blob));
        } catch (error) {
          failed.push({ url, error });
          console.warn('[Twitter 文章助手] 图片内嵌失败：', url, error);
        }
      }));
    }

    let embeddedMarkdown = markdown;
    replacements.forEach((dataUrl, url) => {
      embeddedMarkdown = embeddedMarkdown.split(url).join(dataUrl);
    });
    return { markdown: embeddedMarkdown, failed };
  }

  async function exportArticle() {
    if (exportInProgress) return;
    const target = getScreenshotTarget();
    if (!target) {
      window.alert('未找到文章或帖子内容。');
      return;
    }

    exportInProgress = true;
    setExportButtonState('导出中…', true);

    try {
      const title = getExportTitle(target);
      const body = exportRichTextToMarkdown(target) || exportPostToMarkdown(target);
      if (!body) throw new Error('没有读取到可导出的正文');

      const sourceUrl = window.location.href.split('#')[0];
      const markdown = `# ${escapeMarkdown(title)}\n\n[查看原文](${markdownUrl(sourceUrl)})\n\n${body}\n`;
      const embedded = await embedMarkdownImages(markdown);
      downloadTextFile(embedded.markdown, buildExportFileName(target));
      setExportButtonState(
        embedded.failed.length ? `⚠️ 已导出，${embedded.failed.length} 张失败` : '✅ 已导出',
        true,
      );
      await wait(1200);
    } catch (error) {
      console.error('[Twitter 文章助手] 导出失败：', error);
      window.alert(`文章导出失败：${error?.message || error}`);
    } finally {
      exportInProgress = false;
      setExportButtonState(getDefaultExportButtonText(target), false);
      ensureExportButton(target);
    }
  }

  function normalizeListLayoutInClone(clonedTarget) {
    const listItemSelector = [
      'li.longform-unordered-list-item',
      'li.longform-unordered-list-item-narrow',
      'li.longform-ordered-list-item',
      'li.longform-ordered-list-item-narrow',
    ].join(',');

    clonedTarget.querySelectorAll(listItemSelector).forEach((listItem) => {
      // html2canvas 会把 X 绝对定位的 li::before 克隆成自定义元素。
      // 长文章中这些元素的坐标会漂移，所以直接移除克隆的伪元素，
      // 再让 html2canvas 使用自身稳定的原生列表标记绘制逻辑。
      listItem.querySelectorAll(':scope > html2canvaspseudoelement').forEach((marker) => {
        marker.remove();
      });

      const isOrdered = listItem.parentElement?.tagName === 'OL';
      listItem.style.setProperty('display', 'list-item', 'important');
      listItem.style.setProperty(
        'list-style-type',
        isOrdered ? 'decimal' : 'disc',
        'important',
      );
      listItem.style.setProperty('list-style-position', 'outside', 'important');
      listItem.style.setProperty('list-style-image', 'none', 'important');
    });
  }

  function markVisibleListMarkers(target) {
    const listItems = target.querySelectorAll([
      'li.longform-unordered-list-item',
      'li.longform-unordered-list-item-narrow',
      'li.longform-ordered-list-item',
      'li.longform-ordered-list-item-narrow',
    ].join(','));

    listItems.forEach((listItem) => {
      const markerStyle = getComputedStyle(listItem, '::before');
      const content = markerStyle.content?.trim() || '';
      const opacity = Number.parseFloat(markerStyle.opacity);
      const colorIsTransparent = /rgba\([^)]*,\s*0(?:\.0+)?\s*\)/i.test(markerStyle.color);
      const markerIsVisible = (
        content !== 'none' &&
        content !== 'normal' &&
        content !== '""' &&
        content !== "''" &&
        markerStyle.display !== 'none' &&
        markerStyle.visibility !== 'hidden' &&
        markerStyle.visibility !== 'collapse' &&
        opacity !== 0 &&
        Number.parseFloat(markerStyle.fontSize) !== 0 &&
        !colorIsTransparent
      );

      if (markerIsVisible) {
        listItem.setAttribute(VISIBLE_LIST_MARKER_ATTRIBUTE, '');
      } else {
        listItem.removeAttribute(VISIBLE_LIST_MARKER_ATTRIBUTE);
      }
    });
  }

  function clearVisibleListMarkerFlags(target) {
    target.querySelectorAll(`[${VISIBLE_LIST_MARKER_ATTRIBUTE}]`).forEach((listItem) => {
      listItem.removeAttribute(VISIBLE_LIST_MARKER_ATTRIBUTE);
    });
  }

  function fixListMarkersInClone(clonedDocument, clonedTarget) {
    const markerStyle = clonedDocument.createElement('style');
    markerStyle.textContent = `
      .longform-unordered-list-item::before,
      .longform-unordered-list-item-narrow::before,
      .longform-ordered-list-item::before,
      .longform-ordered-list-item-narrow::before {
        content: none !important;
        display: none !important;
      }
    `;
    clonedDocument.head.appendChild(markerStyle);

    const unorderedSelector = [
      'li.longform-unordered-list-item',
      'li.longform-unordered-list-item-narrow',
    ].join(',');
    const orderedSelector = [
      'li.longform-ordered-list-item',
      'li.longform-ordered-list-item-narrow',
    ].join(',');
    const listItems = clonedTarget.querySelectorAll(
      `${unorderedSelector},${orderedSelector}`,
    );

    listItems.forEach((listItem) => {
      // X 的 longform 类并不保证页面上真的有列表标记。
      // 只有主页面中可见的 ::before 才需要在截图副本中重建。
      if (!listItem.hasAttribute(VISIBLE_LIST_MARKER_ATTRIBUTE)) return;
      listItem.removeAttribute(VISIBLE_LIST_MARKER_ATTRIBUTE);

      const isOrdered = listItem.matches(orderedSelector);
      const computedStyle = clonedDocument.defaultView.getComputedStyle(listItem);
      const preservedStyle = {
        fontSize: computedStyle.fontSize,
        fontFamily: computedStyle.fontFamily,
        lineHeight: computedStyle.lineHeight,
        marginTop: computedStyle.marginTop,
        marginRight: computedStyle.marginRight,
        marginBottom: computedStyle.marginBottom,
        marginLeft: computedStyle.marginLeft,
      };

      // 部分作者会在已经是列表的项目里再手写一个圆点。
      // 找到首个可见文本节点，在截图副本中移除这个重复前缀。
      const textWalker = clonedDocument.createTreeWalker(listItem, 4);
      let firstTextNode = textWalker.nextNode();
      while (
        firstTextNode &&
        !firstTextNode.nodeValue.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '')
      ) {
        firstTextNode = textWalker.nextNode();
      }

      if (firstTextNode) {
        const duplicatePrefix = isOrdered
          ? /^([\s\u200B-\u200D\u2060\uFEFF]*)\d+[.)、][\s\u200B-\u200D\u2060\uFEFF]*/
          : /^([\s\u200B-\u200D\u2060\uFEFF]*)[•·●▪◦‣⁃][\s\u200B-\u200D\u2060\uFEFF]*/;
        firstTextNode.nodeValue = firstTextNode.nodeValue.replace(duplicatePrefix, '$1');
      }

      const meaningfulText = listItem.textContent.replace(
        /[\s\u200B-\u200D\u2060\uFEFF•·●▪◦‣⁃]/g,
        '',
      );
      if (!meaningfulText) {
        listItem.style.setProperty('display', 'none', 'important');
        return;
      }

      // 直接移除会生成 ::before 的 X longform 类。
      // 必要的字体和间距已从计算样式保存，所以排版不会变。
      listItem.classList.remove(
        'longform-unordered-list-item',
        'longform-unordered-list-item-narrow',
        'longform-ordered-list-item',
        'longform-ordered-list-item-narrow',
      );

      listItem.style.setProperty('display', 'block', 'important');
      listItem.style.setProperty('font-size', preservedStyle.fontSize, 'important');
      listItem.style.setProperty('font-family', preservedStyle.fontFamily, 'important');
      listItem.style.setProperty('line-height', preservedStyle.lineHeight, 'important');
      listItem.style.setProperty('margin-top', preservedStyle.marginTop, 'important');
      listItem.style.setProperty('margin-right', preservedStyle.marginRight, 'important');
      listItem.style.setProperty('margin-bottom', preservedStyle.marginBottom, 'important');
      listItem.style.setProperty('margin-left', preservedStyle.marginLeft, 'important');

      let markerText = '•';

      if (isOrdered) {
        const siblings = [...listItem.parentElement.children].filter(
          (element) => element.tagName === 'LI',
        );
        markerText = `${siblings.indexOf(listItem) + 1}.`;
      }

      const marker = clonedDocument.createElement('span');
      marker.textContent = markerText;
      marker.setAttribute('aria-hidden', 'true');
      const markerOffset = Number.parseFloat(preservedStyle.marginLeft) || 30;
      const markerWidth = Math.max(markerOffset - 6, 18);
      // 标记必须跟正文处在同一个文本流中。绝对定位的标记在长文章里
      // 会被 html2canvas 错配坐标，跑到完全无关的普通段落上。
      marker.style.setProperty('display', 'inline-block', 'important');
      marker.style.setProperty('width', `${markerWidth}px`, 'important');
      marker.style.setProperty('margin-left', `${-markerOffset}px`, 'important');
      marker.style.setProperty(
        'margin-right',
        `${Math.max(markerOffset - markerWidth, 0)}px`,
        'important',
      );
      marker.style.setProperty('line-height', 'inherit', 'important');
      marker.style.setProperty('vertical-align', 'baseline', 'important');
      marker.style.setProperty('text-align', isOrdered ? 'right' : 'center', 'important');
      marker.style.setProperty('font-size', isOrdered ? 'inherit' : '16px', 'important');
      marker.style.setProperty('font-weight', '400', 'important');
      marker.style.setProperty('font-family', 'Arial, sans-serif', 'important');

      const markerHost = listItem.firstElementChild || listItem;
      markerHost.prepend(marker);
    });
  }

  function buildFileName(part, total) {
    const target = getScreenshotTarget();
    const title =
      document.querySelector('[data-testid="twitter-article-title"]')?.textContent ||
      target?.querySelector?.('[data-testid="tweetText"]')?.textContent ||
      'x-post';
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const suffix = total > 1 ? `-${String(part).padStart(2, '0')}-of-${total}` : '';
    return `${sanitizeFileName(title)}-${stamp}${suffix}.png`;
  }

  function downloadCanvas(canvas, fileName) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('无法生成 PNG 图片'));
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        resolve();
      }, 'image/png');
    });
  }

  async function captureArticle() {
    if (screenshotInProgress) return;

    const target = getScreenshotTarget();
    if (!target) {
      window.alert('未找到文章内容，请先打开一篇 X/Twitter 文章。');
      return;
    }

    if (typeof html2canvas !== 'function') {
      window.alert('截图组件加载失败，请检查网络后刷新页面。');
      return;
    }

    screenshotInProgress = true;
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    setButtonState('准备文章…', true);

    try {
      processArticle(target);
      await document.fonts?.ready;
      await prepareImages(target);

      const width = Math.ceil(Math.max(target.scrollWidth, target.getBoundingClientRect().width));
      const captureWidth = width + CAPTURE_SIDE_PADDING * 2;
      const height = Math.ceil(Math.max(target.scrollHeight, target.getBoundingClientRect().height));
      const preferredScale = Math.min(
        Math.max(window.devicePixelRatio || 1, PREFERRED_CAPTURE_SCALE),
        MAX_CAPTURE_SCALE,
      );
      const scaleByCanvasHeight = MAX_CANVAS_HEIGHT / height;
      const scaleByCanvasPixels = Math.sqrt(
        MAX_CANVAS_PIXELS / (captureWidth * height),
      );
      const scale = Math.min(
        preferredScale,
        scaleByCanvasHeight,
        scaleByCanvasPixels,
      );
      const total = 1;
      const backgroundColor = getBackgroundColor(target);
      const targetStyle = getComputedStyle(target);
      const originalPaddingLeft = Number.parseFloat(targetStyle.paddingLeft) || 0;
      const originalPaddingRight = Number.parseFloat(targetStyle.paddingRight) || 0;

      target.setAttribute(CAPTURE_TARGET_ATTRIBUTE, '');

      for (let index = 0; index < total; index += 1) {
        const offsetY = 0;
        const currentHeight = height;
        setButtonState('截图中…', true);

        // 先让浏览器绘制进度文字，再开始占用主线程的截图。
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

        const canvas = await html2canvas(target, {
          backgroundColor,
          scale,
          useCORS: true,
          allowTaint: false,
          logging: false,
          removeContainer: true,
          // html2canvas 会自动加上目标元素在文档中的 left/top。
          // 这里必须传相对于文章容器的裁剪偏移，否则会裁到文章之外导致空白图。
          x: 0,
          y: offsetY,
          width: captureWidth,
          height: currentHeight,
          windowWidth: Math.max(document.documentElement.clientWidth, captureWidth),
          windowHeight: Math.max(document.documentElement.clientHeight, height),
          ignoreElements: (element) => element.hasAttribute?.(SCREENSHOT_UI_ATTRIBUTE),
          onclone: (clonedDocument) => {
            const clonedTarget = clonedDocument.querySelector(`[${CAPTURE_TARGET_ATTRIBUTE}]`);
            // 克隆内容位于 html2canvas 的 iframe 中，不能用主页面的
            // instanceof HTMLElement 判断（两个 window 的构造函数不同）。
            if (!clonedTarget?.style) return;

            // 额外的宽度和左右内边距数值相同，因此正文排版宽度不变，
            // 只在导出图中留出防止字形边缘被裁掉的安全区。
            clonedTarget.style.setProperty('box-sizing', 'border-box', 'important');
            clonedTarget.style.setProperty('width', `${captureWidth}px`, 'important');
            clonedTarget.style.setProperty('max-width', 'none', 'important');
            clonedTarget.style.setProperty(
              'padding-left',
              `${originalPaddingLeft + CAPTURE_SIDE_PADDING}px`,
              'important',
            );
            clonedTarget.style.setProperty(
              'padding-right',
              `${originalPaddingRight + CAPTURE_SIDE_PADDING}px`,
              'important',
            );
            clonedTarget.style.setProperty('overflow', 'visible', 'important');
            normalizeListLayoutInClone(clonedTarget);
          },
        });

        await downloadCanvas(canvas, buildFileName(index + 1, total));
      }

      setButtonState('✅ 已保存', true);
      await wait(1600);
    } catch (error) {
      console.error('[Twitter 文章助手] 长图截取失败：', error);
      window.alert(`文章截图失败：${error?.message || error}`);
    } finally {
      target.removeAttribute(CAPTURE_TARGET_ATTRIBUTE);
      clearVisibleListMarkerFlags(target);
      screenshotInProgress = false;
      setButtonState(getDefaultButtonText(), false);
      ensureScreenshotButton();
    }
  }

  function refreshPageState() {
    const target = getScreenshotTarget();
    if (target) processArticle(target);
    ensureScreenshotButton(target);
    ensureExportButton(target);
  }

  function scheduleRefresh(delay = 200) {
    if (refreshTimer !== null || screenshotInProgress) return;

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshPageState();
    }, delay);
  }

  function start() {
    refreshPageState();

    const observer = new MutationObserver(() => {
      // X/React 会在滚动、播放媒体和更新数字时密集修改 DOM。
      // 合并这些变化，避免每次都全页查询和重算样式。
      scheduleRefresh();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('popstate', () => {
      cachedTarget = null;
      cachedHref = '';
      scheduleRefresh(0);
    });
  }

  addStyle(css);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
