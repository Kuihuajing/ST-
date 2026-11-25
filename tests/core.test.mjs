import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStory, extractBody, normalizeTag, safeFilename } from '../reader-core.mjs';

test('extracts only body, omitting analysis, choices, tips and status', () => {
    const text = '<think_fox~>planning</think_fox~><content>雨停了。\n\n她推开门。</content><fox_selc>choice</fox_selc><fox_tip>tip</fox_tip><StatusBlock>status</StatusBlock>';
    assert.deepEqual(extractBody(text), { text: '雨停了。\n\n她推开门。', tagged: true });
});
test('ignores user, system, and reasoning-only messages without modifying chat', () => {
    const chat = [{ is_user: true, mes: '<content>user</content>' }, { is_system: true, mes: '<content>system</content>' }, { mes: '', extra: { reasoning: 'reasoning' } }, { mes: '<content>正文</content>', extra: { reasoning: 'reasoning' } }];
    const before = JSON.stringify(chat);
    assert.deepEqual(collectStory(chat).sections.map(x => x.text), ['正文']);
    assert.equal(JSON.stringify(chat), before);
});
test('uses only selected swipe mes, preserves order, skips missing body', () => {
    const chat = [{ mes: '<content>当前版本</content>', swipes: ['旧版', '其他版'] }, { is_user: true, mes: '接着写' }, { mes: 'unmarked' }, { mes: '<content>第二段</content>' }];
    assert.deepEqual(collectStory(chat).sections.map(x => [x.messageIndex, x.text]), [[0, '当前版本'], [3, '第二段']]);
    assert.equal(collectStory(chat).skipped, 1);
});
test('supports multiple body blocks and case insensitive tags', () => {
    assert.equal(extractBody('<CONTENT>一</CONTENT>other<content>二</content>').text, '一\n\n二');
});
test('does not extract example content inside analysis', () => {
    assert.equal(extractBody('<think_fox~>example <content>not story</content></think_fox~>'), null);
});
test('rejects incomplete body and incomplete analysis even in fallback mode', () => {
    assert.equal(extractBody('<content>unfinished', { fallback: true }), null);
    assert.equal(extractBody('<think>secret <content>not body</content>', { fallback: true }), null);
    assert.equal(extractBody('<content>unfinished<OS>example <StatusBlock>status</StatusBlock></OS>'), null);
    assert.equal(extractBody('<think_fox~>plan <content>example<StatusBlock>status</StatusBlock>'), null);
});
test('recovers an unclosed content block when the reply reaches a recognized footer', () => {
    const variants = [
        '<think_fox~>规划</think_fox~><content>雨停了。<StatusBlock><CharacterStatus>状态</CharacterStatus></StatusBlock><fox_tip>尾注</fox_tip>',
        '<content>雨停了。<fox_selc>选项</fox_selc>',
        '<think_fox~>规划</think_fox~><head><content>雨停了。<statusblock>状态</statusblock>',
        '<content>雨停了。<OS>注释 <StatusBlock>示例</StatusBlock></OS><fox_tip>尾注</fox_tip>',
    ];
    for (const message of variants) assert.deepEqual(extractBody(message), { text: '雨停了。', tagged: true });
});
test('starts at the legacy OS body heading and stops before closing tags or footers', () => {
    const prefix = '规划提纲\n\n[OS]\n---\n【正文开始】\n';
    for (const message of [
        `${prefix}雨停了。\n<StatusBlock>状态</StatusBlock>`,
        `${prefix}雨停了。\n</content>\n<fox_selc>选项</fox_selc>`,
        `<think_fox~>${prefix}雨停了。\n<StatusBlock>状态</StatusBlock>`,
        '规划\r\n{OS}\r\n【正文開始】 雨停了。\r\n【正文結束】',
    ]) assert.deepEqual(extractBody(message), { text: '雨停了。', tagged: true });
});
test('ignores legacy heading examples inside closed planning and skips separator-only replies', () => {
    const example = '\n[OS]\n---\n【正文开始】\n格式示例';
    assert.deepEqual(extractBody(`<think_fox~>${example}</think_fox~><content>雨停了。</content>`), { text: '雨停了。', tagged: true });
    assert.equal(extractBody(`<think_fox~>${example}`), null);
    assert.equal(extractBody(`<think_fox~>${example}</think_fox~>——`), null);
});
test('recognizes legacy headings without OS and OS without a heading when the end is known', () => {
    assert.equal(extractBody('规划\n【正式正文】\n雨停了。\n<StatusBlock>状态</StatusBlock>').text, '雨停了。');
    assert.equal(extractBody('规划\n[OS]\n---\n雨停了。\n</content>').text, '雨停了。');
    assert.equal(extractBody('规划\n[OS]\n<content>雨停了。</content>').text, '雨停了。');
    assert.equal(extractBody('规划\n[OS]\n规划提纲\n<StatusBlock>状态</StatusBlock>'), null);
    assert.equal(extractBody('【导演检查】\n规划提纲\n<StatusBlock>状态</StatusBlock>'), null);
});
test('explicit fallback removes auxiliary blocks and details', () => {
    assert.equal(extractBody('普通回复'), null);
    assert.deepEqual(extractBody('<think>plan</think>普通回复<details>status</details><fox_tip>tip</fox_tip>', { fallback: true }), { text: '普通回复', tagged: false });
});
test('supports custom tag without allowing arbitrary regex or hidden tags', () => {
    assert.equal(extractBody('<story>作品</story>', { tag: 'story' }).text, '作品');
    assert.equal(normalizeTag('.*'), 'content');
    assert.equal(normalizeTag('think_fox~'), 'content');
    assert.equal(normalizeTag('<story>'), 'story');
});
test('empty and malformed messages do not break extraction', () => {
    assert.deepEqual(collectStory(null), { sections: [], skipped: 0, skippedFormats: [] });
    assert.equal(extractBody('<content>  </content>'), null);
    assert.deepEqual(collectStory([null, {}, {mes: 12}]), {sections: [], skipped: 0, skippedFormats: []});
});
test('reads mixed body tags and a legacy body heading', () => {
    assert.equal(extractBody('<正文>第一段</正文><content>第二段</content><故事>第三段</故事>', { tag: '<故事>' }).text, '第一段\n\n第二段\n\n第三段');
    assert.equal(extractBody('<正文>雨停了。\n<StatusBlock>状态</StatusBlock>状态栏以后的尾注').text, '雨停了。');
});
test('recovers legacy narrative after planning, OS and leading notes or before a footer', () => {
    for (const message of [
        '规划</konatan_planning~>雨停了。<tucao>附言</tucao>',
        '<konatan_planning~><content>示例</content></konatan_planning~>雨停了。',
        '<OS>附言</OS>\n<tucao>附言</tucao>\n雨停了。',
        '雨停了。<tucao>附言',
    ]) assert.equal(extractBody(message).text, '雨停了。');
});
test('ambiguous notes and fake story examples are not extracted', () => {
    for (const message of ['<OS>注释</OS>', '<OS>未结束注释', '<tucao><正文>示例</正文></tucao>', '<konatan_planning~><正文>未闭合规划']) {
        assert.equal(extractBody(message), null);
    }
});
test('skipped formats are grouped without exposing message text or attributes', () => {
    const chat = [{ mes: '<未知 value="private">private text</未知>' }, { mes: '<未知>different text</未知>' }, { mes: 'private plain text' }];
    assert.deepEqual(collectStory(chat).skippedFormats, [
        { label: '<未知> </未知>', count: 2, examples: [0, 1] },
        { label: '无标签', count: 1, examples: [2] },
    ]);
});
test('strips comments and nested auxiliary content from a body', () => {
    assert.equal(extractBody('<content>正文<!-- hidden --><analysis>plan</analysis></content>').text, '正文');
});
test('safe export filename cannot contain path separators or invalid file characters', () => {
    assert.equal(safeFilename('../../我的:作品?'), '.._.._我的_作品_');
});
