const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({ URL });
vm.runInContext(readFileSync(require.resolve('../image-upload.js'), 'utf8'), context);
vm.runInContext(readFileSync(require.resolve('../issue-form.js'), 'utf8'), context);
const form = vm.runInContext('IssueResolveForm', context);
const valid = {
    introduced: '#123, 3f2a9c1', prLinks: 'https://gitcode.com/team/project/pull/123',
    milestone: 'v1.2.0', rootCause: '根因：边界值未检查\n影响范围：导入任务',
    userVisible: '否', buildType: 'daily', buildVersion: 'daily-20261029',
    evidence: '执行回归用例：全部通过'
};

test('requires all core fields and at least one version or download URL', () => {
    assert.equal(Object.keys(form.validate(valid)).length, 0);
    const errors = form.validate({});
    for (const key of ['rootCause', 'userVisible', 'buildType', 'buildVersion', 'evidence']) {
        assert.ok(errors[key], key);
    }
    for (const key of ['introduced', 'prLinks', 'milestone']) assert.equal(errors[key], undefined);
    assert.equal(Object.keys(form.validate({ ...valid, introduced: '', prLinks: '', milestone: '' })).length, 0);
    assert.equal(form.validate({ ...valid, buildVersion: '', buildLink: 'https://example.com/build.zip' }).buildVersion, undefined);
});

test('validates commit references, links and whitespace without accepting arbitrary URL schemes', () => {
    assert.ok(form.validate({ ...valid, introduced: 'invalid' }).introduced);
    assert.ok(form.validate({ ...valid, introduced: '#123,' }).introduced);
    assert.ok(form.validate({ ...valid, prLinks: 'javascript:alert(1)' }).prLinks);
    assert.ok(form.validate({ ...valid, buildLink: 'file:///tmp/build.zip' }).buildLink);
    assert.ok(form.validate({ ...valid, rootCause: ' \n' }).rootCause);
    assert.equal(form.validate({ ...valid, prLinks: '无' }).prLinks, undefined);
});

test('requires change details only for user-visible changes and does not export hidden stale answers', () => {
    assert.ok(form.validate({ ...valid, userVisible: '是' }).changeDetail);
    assert.equal(form.validate({ ...valid, userVisible: '是', changeDetail: '新增配置项' }).changeDetail, undefined);
    const markdown = form.buildMarkdown({ ...valid, changeDetail: 'stale detail', changeTypes: ['UI 变化'] });
    assert.doesNotMatch(markdown, /stale detail|UI 变化/);
    assert.match(markdown, /\| 用户可感知变更 \| 否 \|/);
    assert.doesNotMatch(markdown, /用户感知变更说明|变更类型/);
});

test('generates a summary table and preserves long Markdown content in body sections', () => {
    const markdown = form.buildMarkdown({ ...valid, userVisible: '是', changeTypes: ['UI 变化', '性能变化'],
        changeDetail: '新增配置项\n保持兼容', fixSummary: '- 增加入参校验\n- 补充用例',
        evidence: '```sh\npytest\n```\n![截图](https://example.com/test.png)' });
    assert.match(markdown, /\| 信息 \| 内容 \|\n\| --- \| --- \|/);
    assert.match(markdown, /\| 变更类型 \| UI 变化、性能变化 \|/);
    assert.match(markdown, /\| 包名 \/ 版本号 \| daily-20261029 \|/);
    assert.match(markdown, /## 原因分析\n\n根因：边界值未检查\n影响范围：导入任务/);
    assert.match(markdown, /## 修复方案\n\n- 增加入参校验\n- 补充用例/);
    assert.match(markdown, /## 用户感知变更说明\n\n新增配置项\n保持兼容/);
    assert.match(markdown, /```sh\npytest\n```/);
    assert.match(markdown, /!\[截图\]\(https:\/\/example.com\/test.png\)/);
});

test('omits empty optional rows and sections', () => {
    const markdown = form.buildMarkdown({ ...valid, introduced: '', prLinks: '', milestone: '  ' });
    assert.doesNotMatch(markdown, /缺陷引入 Commit|PR 链接|里程碑|关联组件|修复方案|回归包链接/);
    assert.match(markdown, /## 原因分析/);
    assert.match(markdown, /## 自测验证/);
});

test('keeps pipes, backslashes, HTML and multiline entries within table cells', () => {
    const markdown = form.buildMarkdown({ ...valid, components: '组件 A | v1\\build\r\n组件 B <dev> & v2',
        prLinks: 'https://example.com/pull/1\nhttps://example.com/pull/2' });
    assert.match(markdown, /\| 关联组件 \| 组件 A &#124; v1&#92;build<br>组件 B &lt;dev&gt; &amp; v2 \|/);
    assert.match(markdown, /\| PR 链接 \| https:\/\/example.com\/pull\/1<br>https:\/\/example.com\/pull\/2 \|/);
});

test('normalizes malformed drafts and isolates storage by repository and Issue', () => {
    const data = form.normalize({ introduced: {}, userVisible: 'maybe', changeTypes: ['UI 变化', 'unknown'], unknown: 'ignored' });
    assert.equal(data.introduced, '');
    assert.equal(data.userVisible, '');
    assert.equal(data.changeTypes.join(','), 'UI 变化');
    assert.equal(data.unknown, undefined);
    assert.notEqual(form.draftKey({ repository: 'team/a', issue: '1' }), form.draftKey({ repository: 'team/b', issue: '1' }));
    assert.notEqual(form.draftKey({ repository: 'team/a', issue: '1' }), form.draftKey({ repository: 'team/a', issue: '2' }));
});
