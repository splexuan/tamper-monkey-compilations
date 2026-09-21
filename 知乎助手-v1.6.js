// ==UserScript==
// @name          知乎纯文本模式（快捷键搜索版）
// @namespace     tamper-monkey-compilations
// @version       1.6
// @description   知乎纯文本阅读 + / 快捷键搜索
// @author        lexuan
// @match         https://www.zhihu.com/*
// @match         https://zhuanlan.zhihu.com/*
// @grant         none
// @run-at        document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* ================== 样式 ================== */
    const style = document.createElement('style');
    style.textContent = `
        /* === 全局文字样式（不破坏交互） === */
        * {
            font-weight: normal !important;
            font-size: inherit !important;
            line-height: 1.8 !important;
        }

        /* === 正文统一 16px === */
        .RichContent-inner,
        .Post-RichText,
        .Article-Content,
        .AnswerContent,
        .CommentContent,
        .RichContent-inner p,
        .Post-RichText p,
        .Article-Content p {
            font-size: 16px !important;
        }

        /* === 输入/搜索框恢复原生 === */
        input,
        textarea {
            font-size: 14px !important;
            line-height: normal !important;
        }

        input[type="search"] {
            height: 32px !important;
            padding: 4px 8px !important;
        }

        /* === 按钮交互修复 === */
        button,
        .Button,
        .RichContent-expandButton,
        .ContentItem-more,
        .zhihu-collapse-expand,
        [role="button"] {
            line-height: normal !important;
            pointer-events: auto !important;
            opacity: 1 !important;
        }

        /* === 隐藏媒体和干扰元素 === */
        img, video, iframe, picture {
            display: none !important;
        }

        .Topstory-sideColumn,
        .Question-sideColumn,
        .GlobalSideBar,
        .Reward,
        .RichContent-cover,
        .css-1qyytj7 {
            display: none !important;
        }

        /* === 顶部：默认隐藏，搜索时显示 === */
        .AppHeader {
            display: none !important;
        }

        /* === 主体铺满 === */
        .App-main,
        .Topstory-container,
        .Question-main,
        .Search-container {
            max-width: 100% !important;
            width: 100% !important;
        }

        .Topstory-mainColumn,
        .Question-mainColumn {
            width: 100% !important;
            padding-right: 0 !important;
        }

        body {
            overflow-x: hidden !important;
            background: #fff !important;
        }
    `;
    document.head.appendChild(style);

    /* ================== 展开正文修复 ================== */
    function fixExpandButtons() {
        document.querySelectorAll(
            '.RichContent-expandButton, .zhihu-collapse-expand, .ContentItem-more'
        ).forEach(btn => {
            btn.style.removeProperty('display');
            btn.style.removeProperty('opacity');
            btn.style.removeProperty('pointer-events');
            btn.removeAttribute('disabled');
        });
    }

    /* ================== DOM 监听 ================== */
    // 知乎是重 SPA，class / data-state 变动极频繁，先节流合并再统一处理，避免主线程被拖垮
    let fixScheduled = false;
    function scheduleFix() {
        if (fixScheduled) return;
        fixScheduled = true;
        setTimeout(() => {
            fixScheduled = false;
            runFix();
        }, 120);
    }

    function runFix() {
        fixExpandButtons();

        document
            .querySelectorAll('.RichContent[data-state="expanded"] .RichContent-inner')
            .forEach(inner => {
                inner.style.display = 'block';
                inner.style.height = 'auto';
            });
    }

    const observer = new MutationObserver(scheduleFix);

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state', 'class']
    });

    /* ================== 快捷键搜索 ================== */
    // === 快捷键搜索（URL 跳转，最稳定） ===
    document.addEventListener('keydown', (e) => {
        // 输入状态下不触发
        if (
            e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.isContentEditable
        ) {
            return;
        }

        if (e.key === '/') {
            e.preventDefault();

            const keyword = prompt('知乎搜索：');
            if (!keyword) return;

            const url = `https://www.zhihu.com/search?q=${encodeURIComponent(keyword)}`;
            window.location.href = url;
        }
    });

    /* ================== 初始化 ================== */
    // @run-at document-idle 时 load 事件可能早已触发，直接判断 readyState，避免回调永远不执行
    if (document.readyState === 'complete') {
        setTimeout(fixExpandButtons, 1000);
    } else {
        window.addEventListener('load', () => {
            setTimeout(fixExpandButtons, 1000);
        });
    }
})();
