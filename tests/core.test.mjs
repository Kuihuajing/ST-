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
    assert.deepEqual(collectStory(null), { sections: [], skipped: 0 });
    assert.equal(extractBody('<content>  </content>'), null);
    assert.deepEqual(collectStory([null, {}, {mes: 12}]), {sections: [], skipped: 0});
});
test('strips comments and nested auxiliary content from a body', () => {
    assert.equal(extractBody('<content>正文<!-- hidden --><analysis>plan</analysis></content>').text, '正文');
});
test('safe export filename cannot contain path separators or invalid file characters', () => {
    assert.equal(safeFilename('../../我的:作品?'), '.._.._我的_作品_');
});
