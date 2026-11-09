// Pure extraction helpers. Never mutate the chat or inspect reasoning metadata.
export const DEFAULT_TAG = 'content';
export const DEFAULT_OPTIONS = Object.freeze({ tag: DEFAULT_TAG, fallback: false });
const HIDDEN_TAGS = ['think_fox~', 'think', 'thinking', 'analysis', 'reasoning', 'fox_selc', 'fox_tip', 'StatusBlock', 'CharacterStatus'];

export function normalizeTag(value) {
    const tag = String(value ?? '').trim().replace(/^<\/?|>$/g, '');
    return /^[a-zA-Z][\w~-]{0,59}$/.test(tag) && !HIDDEN_TAGS.some(x => x.toLowerCase() === tag.toLowerCase()) ? tag : DEFAULT_TAG;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripAuxiliaryBlocks(text) {
    let result = String(text ?? '').replace(/\r\n?/g, '\n');
    for (const tag of HIDDEN_TAGS) {
        const escaped = escapeRegex(tag);
        // Also suppress incomplete auxiliary blocks instead of leaking their text.
        result = result.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?(?:<\\/${escaped}\\s*>|$)`, 'gi'), '');
    }
    result = result.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
    return result.trim();
}

export function extractBody(text, options = DEFAULT_OPTIONS) {
    const tag = normalizeTag(options.tag);
    const clean = stripAuxiliaryBlocks(text);
    const escaped = escapeRegex(tag);
    const blocks = [...clean.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'gi'))]
        .map(match => stripAuxiliaryBlocks(match[1])).filter(Boolean);
    if (blocks.length) return { text: blocks.join('\n\n'), tagged: true };
    // Never show a partially generated tagged response as an untagged fallback.
    if (!options.fallback || new RegExp(`<${escaped}(?:\\s[^>]*)?>`, 'i').test(clean)) return null;
    const fallback = clean.replace(/<details\b[^>]*>[\s\S]*?(?:<\/details\s*>|$)/gi, '').trim();
    return fallback ? { text: fallback, tagged: false } : null;
}

export function collectStory(chat, options = DEFAULT_OPTIONS) {
    const sections = [];
    let skipped = 0;
    for (const [messageIndex, message] of (Array.isArray(chat) ? chat : []).entries()) {
        if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
        const body = extractBody(message.mes, options);
        if (!body) { skipped++; continue; }
        // mes is the currently selected swipe; alternatives must not be concatenated.
        sections.push({ messageIndex, name: String(message.name ?? ''), ...body });
    }
    return { sections, skipped };
}

export function safeFilename(title) {
    return String(title || '我的作品').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 100) || '我的作品';
}
