const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../settings.js');

test('fresh settings preserve the existing submission defaults', () => {
    const settings = S.normalize();
    assert.equal(settings.enabled, true);
    assert.deepEqual(settings.groups.pull.map(row => row.mode), ['direct', 'confirm', 'direct', 'confirm', 'direct']);
    assert.equal(S.items(settings, 'replies').length, 8);
});

test('corrupt or older stored settings cannot introduce commands or unsafe modes', () => {
    const settings = S.normalize({ groups: { pull: [
        null, { id: 'unexpected', mode: 'direct' }, { id: '/approve', mode: 'toString', visible: false },
        { id: '/approve', mode: 'direct' }, { id: 'retry', mode: 'insert' }
    ], replies: 'invalid' } });
    assert.deepEqual(settings.groups.pull[0], { id: '/approve', mode: 'confirm', visible: false });
    assert.equal(settings.groups.pull.length, 5);
    assert.equal(settings.groups.pull[1].mode, 'insert');
    assert.equal(S.items(settings, 'pull').some(row => row.id === '/approve'), false);
    assert.equal(settings.groups.replies.length, 8);
});

test('settings retain hidden entries and order across saves without sharing mutable defaults', () => {
    const settings = S.normalize();
    settings.enabled = false;
    settings.groups.issue.reverse();
    settings.groups.replies[0].visible = false;
    const restored = S.normalize(JSON.parse(JSON.stringify(settings)));
    assert.equal(restored.enabled, false);
    assert.deepEqual(restored.groups.issue.map(row => row.id), ['more', 'resolve']);
    assert.equal(S.items(restored, 'replies')[0].id, '/label add triaged');
    assert.equal(S.normalize().enabled, true);
    assert.equal(S.normalize().groups.replies[0].visible, true);
});

test('page detection only accepts GitCode detail routes', () => {
    assert.deepEqual(S.pageContext('https://gitcode.com/team/repo/pull/42/files'), {
        kind: 'pull', repository: 'team/repo', number: '42'
    });
    assert.equal(S.pageContext('https://gitcode.com/team/repo/issues/7?tab=all').kind, 'issue');
    for (const url of ['https://gitcode.com/team/repo', 'https://gitcode.com/team/repo/pull/4fake']) {
        assert.equal(S.pageContext(url).kind, 'gitcode');
    }
    for (const url of [undefined, 'chrome://extensions', 'https://gitcode.com.evil.test/team/repo/pull/1']) {
        assert.equal(S.pageContext(url).kind, 'unsupported');
    }
});
