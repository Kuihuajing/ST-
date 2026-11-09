import { collectStory, normalizeTag, safeFilename } from './reader-core.mjs';

const KEY = 'local_story_reader';
const ID = 'st-story-reader';
const DEFAULTS = { tag: 'content', fallback: false, fontSize: 20, theme: 'paper', positions: {} };
let dialog, viewport, article, sidebar, status, titleElement;
let activeKey = '', currentTitle = '', timer, progressTimer, previousFocus;
let initialized = false, converter;
const context = () => globalThis.SillyTavern.getContext();

function settings() {
    const store = context().extensionSettings;
    if (!store[KEY] || typeof store[KEY] !== 'object') store[KEY] = { ...DEFAULTS, positions: {} };
    return store[KEY];
}

function saveSettings() {
    context().saveSettingsDebounced();
}

function chatInfo() {
    const ctx = context();
    const character = ctx.characters?.[ctx.characterId];
    const group = ctx.groups?.find(item => String(item.id) === String(ctx.groupId));
    const id = ctx.getCurrentChatId?.() ?? ctx.chatId ?? '';
    const name = group?.name || character?.name || ctx.name2 || '我的作品';
    return { key: id ? JSON.stringify([ctx.groupId ?? '', character?.avatar ?? ctx.characterId ?? '', id]) : '', title: String(name) };
}

function button(label, action, className = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.className = className;
    element.addEventListener('click', action);
    return element;
}

function notify(text) {
    if (globalThis.toastr?.info) globalThis.toastr.info(text);
    else if (status) status.textContent = text;
}

function renderBody(text) {
    const libs = globalThis.SillyTavern.libs ?? {};
    if (libs.showdown?.Converter && libs.DOMPurify?.sanitize) {
        converter ??= new libs.showdown.Converter({ noHeaderId: true, strikethrough: true, literalMidWordUnderscores: true });
        const html = libs.DOMPurify.sanitize(converter.makeHtml(text), {
            ALLOWED_TAGS: ['p', 'br', 'em', 'strong', 'b', 'i', 's', 'del', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'hr', 'pre', 'code', 'div', 'span', 'ruby', 'rt', 'rp'],
            ALLOWED_ATTR: [],
            FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'svg', 'math', 'template'],
        });
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        return wrapper;
    }
    // Safe plain text fallback when optional ST formatting libraries are absent.
    const wrapper = document.createElement('div');
    for (const paragraph of text.split(/\n\s*\n/)) {
        const p = document.createElement('p');
        p.textContent = paragraph;
        wrapper.append(p);
    }
    return wrapper;
}

function capturePosition() {
    if (!viewport || !article?.children.length) return null;
    const top = viewport.getBoundingClientRect().top;
    const section = [...article.querySelectorAll('.sr-section')].find(item => item.getBoundingClientRect().bottom > top + 16);
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    return { index: Number(section.dataset.messageIndex), fraction: Math.min(1, Math.max(0, (top - rect.top) / Math.max(rect.height, 1))) };
}

function savePosition() {
    if (!activeKey) return;
    const position = capturePosition();
    if (!position) return;
    const prefs = settings();
    if (!prefs.positions || typeof prefs.positions !== 'object') prefs.positions = {};
    delete prefs.positions[activeKey];
    prefs.positions[activeKey] = position;
    const keys = Object.keys(prefs.positions);
    for (const key of keys.slice(0, Math.max(0, keys.length - 30))) delete prefs.positions[key];
    saveSettings();
}

function restorePosition(position) {
    viewport.scrollTop = 0;
    if (!position) return;
    const section = [...article.querySelectorAll('.sr-section')].find(item => Number(item.dataset.messageIndex) === position.index);
    if (!section) return;
    const fraction = Math.min(1, Math.max(0, Number(position.fraction) || 0));
    viewport.scrollTop += section.getBoundingClientRect().top - viewport.getBoundingClientRect().top + section.getBoundingClientRect().height * fraction;
}

function applyAppearance() {
    const prefs = settings();
    const size = Math.min(28, Math.max(16, Number(prefs.fontSize) || 20));
    dialog.style.setProperty('--sr-font-size', `${size}px`);
    dialog.dataset.theme = prefs.theme === 'night' ? 'night' : 'paper';
    dialog.querySelector('[data-action="theme"]').textContent = prefs.theme === 'night' ? '☀ 日间' : '☾ 夜间';
    dialog.querySelector('[data-action="font-size"]').textContent = `${size}`;
}

function rebuild({ restore = true } = {}) {
    if (!dialog?.open) return;
    const info = chatInfo();
    const sameChat = info.key === activeKey;
    const position = restore ? (sameChat ? capturePosition() : settings().positions?.[info.key]) : null;
    if (!sameChat) savePosition();
    activeKey = info.key;
    currentTitle = info.title;
    titleElement.textContent = info.title;
    const result = collectStory(context().chat, { tag: normalizeTag(settings().tag), fallback: !!settings().fallback });
    article.replaceChildren();
    sidebar.replaceChildren();
    let count = 0;
    for (const [index, item] of result.sections.entries()) {
        const section = document.createElement('section');
        section.className = 'sr-section';
        section.dataset.messageIndex = String(item.messageIndex);
        section.setAttribute('aria-label', `第 ${index + 1} 节，原聊天第 ${item.messageIndex + 1} 条`);
        const body = renderBody(item.text);
        count += [...(body.textContent || '').replace(/\s/g, '')].length;
        section.append(body);
        article.append(section);
        const nav = button(`第 ${index + 1} 节`, () => {
            viewport.scrollTop += section.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24;
            savePosition();
            if (window.matchMedia('(max-width: 700px)').matches) setSidebar(false);
        });
        nav.title = `原聊天第 ${item.messageIndex + 1} 条`;
        sidebar.append(nav);
    }
    status.textContent = `${result.sections.length} 节 · ${count.toLocaleString()} 字符`;
    if (result.skipped) status.textContent += ` · ${result.skipped} 条未识别正文`;
    if (!result.sections.length) {
        const empty = document.createElement('div');
        empty.className = 'sr-empty';
        const heading = document.createElement('h2');
        heading.textContent = '正文会在这里连成一篇';
        const help = document.createElement('p');
        help.textContent = context().chat?.length
            ? `当前聊天中没有完整的 <${normalizeTag(settings().tag)}> 正文。可在“选项”中修改正文标签；无标签的作品可开启兼容模式。`
            : '先在酒馆中打开一段聊天，再进入阅读模式。';
        empty.append(heading, help);
        article.append(empty);
    }
    applyAppearance();
    restorePosition(position);
}

function setSidebar(open) {
    dialog.classList.toggle('sr-toc-open', open);
    dialog.querySelector('[data-action="toc"]').setAttribute('aria-expanded', String(open));
}

function exportText() {
    const sections = [...article.querySelectorAll('.sr-section')];
    if (!sections.length) { notify('当前没有可导出的正文'); return; }
    const text = sections.map(section => section.innerText.trim()).join('\n\n\n');
    const blob = new Blob(['\uFEFF', currentTitle, '\n\n', text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFilename(currentTitle)}-正文.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function changeFont(delta) {
    const position = capturePosition();
    settings().fontSize = Math.min(28, Math.max(16, (Number(settings().fontSize) || 20) + delta));
    applyAppearance();
    restorePosition(position);
    saveSettings();
}

function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = ID;
    dialog.setAttribute('aria-labelledby', 'sr-title');
    dialog.innerHTML = `
      <header class="sr-header">
        <div class="sr-heading"><span class="sr-eyebrow">STORY READER · 正文阅读</span><h1 id="sr-title"></h1><span class="sr-status" aria-live="polite"></span></div>
        <button type="button" class="sr-return" data-action="close">返回创作 <span>Esc</span></button>
      </header>
      <nav class="sr-toolbar" aria-label="阅读工具">
        <button type="button" data-action="toc" aria-expanded="false">☷ 目录</button>
        <div class="sr-font-controls"><button type="button" data-action="smaller" aria-label="缩小字号">A−</button><span data-action="font-size"></span><button type="button" data-action="larger" aria-label="放大字号">A＋</button></div>
        <button type="button" data-action="theme">☾ 夜间</button>
        <button type="button" data-action="refresh">刷新正文</button>
        <button type="button" data-action="export">导出 TXT</button>
        <button type="button" data-action="options" aria-expanded="false">选项</button>
      </nav>
      <form class="sr-options" hidden>
        <label>正文标签 <input name="tag" type="text" placeholder="content" maxlength="60" autocomplete="off"></label>
        <label class="sr-checkbox"><input name="fallback" type="checkbox">未标正文标签时，也显示 AI 回复</label>
        <p>默认仅提取完整正文标签内的内容。兼容模式会过滤已知分析及状态标签，但无法识别所有自定义格式。</p>
        <button type="submit">应用</button>
      </form>
      <div class="sr-layout"><aside class="sr-toc" aria-label="正文目录"></aside><div class="sr-viewport" tabindex="0" aria-label="作品正文"><article class="sr-article"></article><footer class="sr-end">读到这里，也可以继续写下去。</footer></div></div>
    `;
    document.body.append(dialog);
    viewport = dialog.querySelector('.sr-viewport');
    article = dialog.querySelector('.sr-article');
    sidebar = dialog.querySelector('.sr-toc');
    status = dialog.querySelector('.sr-status');
    titleElement = dialog.querySelector('#sr-title');
    const actions = {
        close: () => { savePosition(); dialog.close(); },
        toc: () => setSidebar(!dialog.classList.contains('sr-toc-open')),
        smaller: () => changeFont(-2), larger: () => changeFont(2),
        theme: () => { const position = capturePosition(); settings().theme = settings().theme === 'night' ? 'paper' : 'night'; applyAppearance(); restorePosition(position); saveSettings(); },
        refresh: () => rebuild(), export: exportText,
        options: () => {
            const form = dialog.querySelector('.sr-options');
            form.hidden = !form.hidden;
            dialog.querySelector('[data-action="options"]').setAttribute('aria-expanded', String(!form.hidden));
            form.elements.tag.value = normalizeTag(settings().tag);
            form.elements.fallback.checked = !!settings().fallback;
            if (!form.hidden) form.elements.tag.focus();
        },
    };
    for (const [name, callback] of Object.entries(actions)) dialog.querySelector(`[data-action="${name}"]`).addEventListener('click', callback);
    dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const form = event.currentTarget;
        settings().tag = normalizeTag(form.elements.tag.value);
        settings().fallback = form.elements.fallback.checked;
        form.elements.tag.value = settings().tag;
        saveSettings();
        rebuild({ restore: false });
    });
    viewport.addEventListener('scroll', () => { clearTimeout(progressTimer); progressTimer = setTimeout(savePosition, 350); }, { passive: true });
    dialog.addEventListener('cancel', event => { event.preventDefault(); savePosition(); dialog.close(); });
    dialog.addEventListener('close', () => {
        clearTimeout(timer);
        clearTimeout(progressTimer);
        // Drop extracted text from the DOM when closing; the original chat is untouched.
        article.replaceChildren();
        sidebar.replaceChildren();
        activeKey = '';
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
}

export function openReader() {
    ensureDialog();
    if (dialog.open) return;
    previousFocus = document.activeElement;
    activeKey = '';
    dialog.showModal();
    rebuild();
}

function mount() {
    if (!document.getElementById('st-story-reader-open')) {
        const entry = button('阅读', openReader, 'sr-entry interactable');
        entry.id = 'st-story-reader-open';
        entry.title = '打开正文阅读模式';
        entry.setAttribute('aria-label', '打开正文阅读模式');
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-book-open';
        icon.setAttribute('aria-hidden', 'true');
        entry.prepend(icon);
        const anchor = document.querySelector('#leftSendForm');
        if (anchor) anchor.append(entry);
        else { entry.classList.add('sr-entry-floating'); document.body.append(entry); }
    }
    const container = document.querySelector('#extensions_settings2, #extensions_settings');
    if (container && !document.getElementById('sr-extension-settings')) {
        const section = document.createElement('div');
        section.id = 'sr-extension-settings';
        section.className = 'sr-extension-settings';
        const heading = document.createElement('b');
        heading.textContent = '正文阅读 · Story Reader';
        const hint = document.createElement('p');
        hint.textContent = '只读汇总 AI 正文，关闭即返回聊天。无需 API，也不会修改聊天记录。';
        section.append(heading, hint, button('打开阅读模式', openReader, 'menu_button'));
        container.append(section);
    }
}

export function init() {
    if (initialized) return;
    initialized = true;
    mount();
    const ctx = context();
    const events = ['CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'GENERATION_ENDED'];
    for (const name of events) {
        if (ctx.eventTypes[name]) ctx.eventSource.on(ctx.eventTypes[name], () => {
            if (!dialog?.open) return;
            clearTimeout(timer);
            timer = setTimeout(() => rebuild(), 250);
        });
    }
    if (ctx.eventTypes.APP_READY) ctx.eventSource.on(ctx.eventTypes.APP_READY, mount);
}
