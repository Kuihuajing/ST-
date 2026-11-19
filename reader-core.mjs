// Pure extraction helpers. Never mutate the chat or inspect reasoning metadata.
export const DEFAULT_TAG = 'content';
export const DEFAULT_OPTIONS = Object.freeze({ tag: DEFAULT_TAG, fallback: false });
const PLANNING = 'think_fox~|konatan_planning~?|think|thinking|analysis|reasoning';
const FOOTER = 'tucao|fox_selc|fox_tip|StatusBlock|CharacterStatus';
const AUXILIARY = `${FOOTER}|os|details`;
const HIDDEN_TAG = new RegExp(`^(?:${PLANNING}|${AUXILIARY})$`, 'i');

export function normalizeTag(value) {
    const tag = String(value ?? '').trim().replace(/^<\/?|>$/g, '');
    return /^\p{L}[\p{L}\p{N}_~-]{0,59}$/u.test(tag) && !HIDDEN_TAG.test(tag) ? tag : DEFAULT_TAG;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openingTag(names) {
    return `<(${names})(?:\\s[^>]*)?>`;
}

function stripBlocks(text, names, replacement = '') {
    return text.replace(new RegExp(`${openingTag(names)}[\\s\\S]*?(?:<\\/\\1\\s*>|$)`, 'gi'), replacement);
}

function afterPlanning(text) {
    // Some saved messages retained the closing marker but lost the opening marker.
    const stripped = stripBlocks(text, PLANNING);
    const closing = new RegExp(`<\\/(?:${PLANNING})\\s*>`, 'gi');
    let start = 0;
    for (const match of stripped.matchAll(closing)) start = match.index + match[0].length;
    return stripped.slice(start).trim();
}

function legacyBody(text) {
    // A leading note can precede the story. The same markers later in a reply
    // are treated as a boundary, so their contents do not become story text.
    const leadingNote = new RegExp(`^${openingTag('os|tucao')}[\\s\\S]*?<\\/\\1\\s*>`, 'i');
    let body = text;
    let hasBoundary = false;
    for (let match; (match = body.match(leadingNote));) {
        body = body.slice(match[0].length).trimStart();
        hasBoundary = true;
    }
    const end = body.search(new RegExp(openingTag(AUXILIARY), 'i'));
    return { text: (end === -1 ? body : body.slice(0, end)).trim(), hasBoundary: hasBoundary || end !== -1 };
}

export function extractBody(text, options = DEFAULT_OPTIONS) {
    const source = String(text ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '').trim();
    const clean = afterPlanning(source);
    const tags = `${escapeRegex(normalizeTag(options.tag))}|content|正文`;
    const open = openingTag(tags);
    // Mask auxiliary sections before looking for explicit tags, including examples
    // of the body format inside an OS or end note.
    const marked = stripBlocks(clean, AUXILIARY, block => ' '.repeat(block.length));
    const blocks = [];
    const boundaries = new RegExp(`${open}|<\\/(${tags})\\s*>`, 'gi');
    let current;
    for (const match of marked.matchAll(boundaries)) {
        if (match[1]) {
            current = { tag: match[1].toLowerCase(), start: match.index + match[0].length };
        } else if (current?.tag === match[2].toLowerCase()) {
            blocks.push(stripBlocks(clean.slice(current.start, match.index), AUXILIARY).trim());
            current = undefined;
        }
    }
    // Older presets can use 正文 as a heading, with no closing tag.
    if (current?.tag === '正文') blocks.push(legacyBody(clean.slice(current.start).trim()).text);
    const taggedBody = blocks.filter(Boolean).join('\n\n');
    if (taggedBody) return { text: taggedBody, tagged: true };
    if (blocks.length || current) return null;

    const legacy = legacyBody(clean);
    if (legacy.text && (options.fallback || clean !== source || legacy.hasBoundary)) {
        return { text: legacy.text, tagged: false };
    }
    return null;
}

export function collectStory(chat, options = DEFAULT_OPTIONS) {
    const sections = [];
    let skipped = 0;
    const skippedFormats = new Map();
    for (const [messageIndex, message] of (Array.isArray(chat) ? chat : []).entries()) {
        if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
        const body = extractBody(message.mes, options);
        if (!body) {
            skipped++;
            const tags = new Set();
            for (const match of message.mes.matchAll(/<(\/?[\p{L}][\p{L}\p{N}_~-]{0,59})(?=[\s/>])[^<>]*>/gu)) {
                tags.add(`<${match[1].toLowerCase()}>`);
            }
            const markers = [...tags];
            const label = (markers.length > 8 ? [...markers.slice(0, 4), '…', ...markers.slice(-4)] : markers).join(' ') || '无标签';
            const group = skippedFormats.get(label) ?? { label, count: 0, examples: [] };
            group.count++;
            if (group.examples.length < 3) group.examples.push(messageIndex);
            skippedFormats.set(label, group);
            continue;
        }
        // mes is the currently selected swipe; alternatives must not be concatenated.
        sections.push({ messageIndex, name: String(message.name ?? ''), ...body });
    }
    return { sections, skipped, skippedFormats: [...skippedFormats.values()].sort((a, b) => b.count - a.count) };
}

export function safeFilename(title) {
    return String(title || '我的作品').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 100) || '我的作品';
}
