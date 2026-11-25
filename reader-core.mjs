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

const maskBlock = block => ' '.repeat(block.length);
const LEGACY_OS_LINE = /(?:^|\n)[ \t]*(?:\[OS\]|\{OS\})[ \t]*(?=\n|$)/gi;
const BODY_HEADING = /(?:^|\n)[ \t]*【[ \t]*(?:正文[ \t]*(?:开始|開始)|正式正文)[ \t]*】/gi;
const LEGACY_BODY_END = new RegExp(`<\\/(?:content|正文)\\s*>|${openingTag(FOOTER)}|【[ \\t]*正文(?:结束|結束)[ \\t]*】`, 'i');
const SEPARATOR_LINES = /^(?:[ \t]*(?:-{3,}|—{2,})?[ \t]*\n)+/;
const ONLY_SEPARATORS = /^(?:[ \t]*(?:-{3,}|—{2,})?[ \t]*\n)*[ \t]*(?:-{3,}|—{2,})?[ \t]*$/;
const PLANNING_HEADING = /(?:^|\n)[ \t]*(?:\*{1,2})?【[ \t]*(?:开始思考|结束思考|正文输出流程预演|导演检查(?:与分析)?|部分[一二三四五].{0,20}?(?:预演|检查|硬规则))[ \t]*】/;

function extractLegacyMarkedBody(text) {
    // Keep offsets while excluding examples inside closed planning and auxiliary blocks.
    // An unclosed planning tag can still be recovered if both story boundaries exist.
    const closedPlanning = new RegExp(`${openingTag(PLANNING)}[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
    const visible = stripBlocks(text.replace(closedPlanning, maskBlock), AUXILIARY, maskBlock);
    const heading = [...visible.matchAll(BODY_HEADING)].at(-1);
    const os = [...visible.matchAll(LEGACY_OS_LINE)].at(-1);
    const startMarker = heading ?? os;
    if (!startMarker) return undefined;

    const offset = startMarker.index + startMarker[0].length;
    const prefix = visible.slice(0, startMarker.index);
    const tail = text.slice(offset);
    // Ignore lookalike closing tags in auxiliary blocks. A footer's opening tag
    // is itself a boundary, so only mask notes that are not footers here.
    const end = stripBlocks(tail, 'os|details', maskBlock).search(LEGACY_BODY_END);
    const planningOpen = new RegExp(openingTag(PLANNING), 'i').test(prefix);
    const osBeforeHeading = heading && os && os.index < heading.index
        && ONLY_SEPARATORS.test(visible.slice(os.index + os[0].length, heading.index));
    // Bare OS is ambiguous. Only trust it without a heading when a body end
    // tag independently confirms the boundary. A plain footer is not enough.
    if (!heading && (end === -1 || !/^<\/(?:content|正文)\s*>/i.test(tail.slice(end)))) return null;
    if (planningOpen && (!osBeforeHeading || end === -1) && heading) return null;

    const body = stripBlocks(stripBlocks((end === -1 ? tail : tail.slice(0, end)).replace(SEPARATOR_LINES, ''), PLANNING), AUXILIARY)
        .trim().replace(/^<(?:content|正文)(?:\s[^>]*)?>/i, '').trim();
    return /[\p{L}\p{N}]/u.test(body) && !PLANNING_HEADING.test(body) ? { text: body, tagged: true } : null;
}

function afterPlanning(text) {
    // Some saved messages retained the closing marker but lost the opening marker.
    const stripped = stripBlocks(text, PLANNING);
    const closing = new RegExp(`<\\/(?:${PLANNING})\\s*>`, 'gi');
    let start = 0;
    for (const match of stripped.matchAll(closing)) start = match.index + match[0].length;
    return stripped.slice(start).trim();
}

const FLOOR_LABEL_LINE = /^[（(][ \t]*第[ \t]*[0-9０-９]+[ \t]*[楼樓][ \t]*[）)][ \t]*(?:\n|$)/;

function recoverUnclosedKonatan(text) {
    if (!/^<konatan_planning~?>[ \t]*\n/i.test(text)) return '';

    // This layout uses stand-alone comment and status blocks around the story.
    // Require both blocks to be complete before discarding the unclosed plan.
    const note = /^[ \t]*<tucao>[ \t]*\n[\s\S]*?^[ \t]*<\/tucao>[ \t]*\n/im.exec(text);
    if (!note) return '';
    const tail = text.slice(note.index + note[0].length);
    const status = /^[ \t]*<StatusBlock>[ \t]*\n[\s\S]*?^[ \t]*<\/StatusBlock>[ \t]*$/im.exec(tail);
    if (!status) return '';

    const body = tail.slice(0, status.index).trim();
    const unexpectedTag = new RegExp(`<\\/?(?:${PLANNING}|${AUXILIARY}|content|正文|advice)(?=[\\s>])`, 'i');
    return unexpectedTag.test(body) ? '' : body;
}

function legacyBody(text) {
    // A leading note can precede the story. The same markers later in a reply
    // are treated as a boundary, so their contents do not become story text.
    const leadingNote = new RegExp(`^${openingTag('os|tucao')}[\\s\\S]*?<\\/\\1\\s*>`, 'i');
    let body = text;
    let hasBoundary = false;
    for (let match; (match = leadingNote.exec(body) ?? FLOOR_LABEL_LINE.exec(body));) {
        body = body.slice(match[0].length).trimStart();
        if (match[1]) hasBoundary = true;
    }
    const end = body.search(new RegExp(openingTag(AUXILIARY), 'i'));
    return { text: (end === -1 ? body : body.slice(0, end)).trim(), hasBoundary: hasBoundary || end !== -1 };
}

export function extractBody(text, options = DEFAULT_OPTIONS) {
    const source = String(text ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '').trim();
    const legacyMarked = extractLegacyMarkedBody(source);
    if (legacyMarked) return legacyMarked;
    const clean = afterPlanning(source);
    const tags = `${escapeRegex(normalizeTag(options.tag))}|content|正文`;
    const open = openingTag(tags);
    // Mask auxiliary sections before looking for explicit tags, including examples
    // of the body format inside an OS or end note.
    const marked = stripBlocks(clean, AUXILIARY, maskBlock);
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
    if (current?.tag === 'content') {
        // A recognized footer can end an older reply whose body tag was left open.
        const tail = clean.slice(current.start);
        const footer = stripBlocks(tail, 'os|details', maskBlock).search(new RegExp(openingTag(FOOTER), 'i'));
        if (footer !== -1) blocks.push(stripBlocks(tail.slice(0, footer), AUXILIARY).trim());
    }
    const taggedBody = blocks.filter(Boolean).join('\n\n');
    if (taggedBody) return { text: taggedBody, tagged: true };
    if (blocks.length || current || legacyMarked === null) return null;

    const legacy = legacyBody(clean || recoverUnclosedKonatan(source));
    if (/[\p{L}\p{N}]/u.test(legacy.text) && !PLANNING_HEADING.test(legacy.text) && (options.fallback || clean !== source || legacy.hasBoundary)) {
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
