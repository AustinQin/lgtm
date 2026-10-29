const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function load(deps = {}) {
    const context = vm.createContext({ console, ...deps });
    vm.runInContext(readFileSync(require.resolve('../image-upload.js'), 'utf8'), context);
    return vm.runInContext('IssueImageUpload', context);
}

const nuxtData = [
    ['ShallowReactive', 1],
    { data: 2 },
    ['ShallowReactive', 3],
    { 'repo-base:team/project': 4, 'repo-base:other/repo': 9 },
    { id: 5, pathWithNamespace: 6 },
    42,
    'team/project',
    null,
    null,
    { id: 10, pathWithNamespace: 11 },
    43,
    'other/repo'
];

const wrappedNuxtData = [
    ['ShallowReactive', 1],
    { data: 2 },
    ['ShallowReactive', 3],
    { 'repo-base:team/project': 4 },
    ['Ref', 5],
    { id: 6, pathWithNamespace: 7 },
    ['Ref', 8],
    'team/project',
    42
];

test('resolves the numeric repository ID from the Nuxt page state', () => {
    const parser = load();
    assert.equal(parser.repositoryIdFromNuxt(nuxtData, 'team/project'), '42');
    assert.equal(parser.repositoryIdFromNuxt(nuxtData, 'other/repo'), '43');
    assert.equal(parser.repositoryIdFromNuxt(nuxtData, 'missing/repo'), null);
    assert.equal(parser.repositoryIdFromNuxt(wrappedNuxtData, 'team/project'), '42');
    assert.equal(parser.repositoryIdFromNuxt(wrappedNuxtData.map((value, index) =>
        index === 7 ? 'different/repo' : value), 'team/project'), null);
});

test('builds the same image Markdown shape as the GitCode editor', () => {
    const parser = load();
    assert.equal(
        parser.buildImageMarkdown('uploads/abc123/test.png', 'test.png', '8812986'),
        "![test.png](https://raw.gitcode.com/user-images/assets/8812986/abc123/test.png 'test.png')"
    );
    assert.equal(parser.buildImageMarkdown('/test.png', 'test.png', '42'),
        "![test.png](https://raw.gitcode.com/user-images/assets/42/test.png 'test.png')");
    assert.equal(parser.buildImageMarkdown('test.png', 'a]b.png', '42'),
        "![a b.png](https://raw.gitcode.com/user-images/assets/42/test.png 'a b.png')");
    assert.equal(parser.buildImageMarkdown('', 'test.png', '42'), null);
});

test('uploads an image with cookies and returns Markdown', async () => {
    let captured;
    const parser = load({
        FileReader: class {
            readAsDataURL(file) {
                this.result = `data:${file.type};base64,${file.base64}`;
                this.onload();
            }
        },
        fetch: async (url, options) => {
            captured = { url, options };
            return {
                ok: true,
                status: 201,
                json: async () => ({ success: true, path: 'uploads/uuid/test.png' })
            };
        },
        document: {
            querySelector: selector => selector === '#__NUXT_DATA__'
                ? { textContent: JSON.stringify(nuxtData) } : null
        }
    });
    const markdown = await parser.upload(
        { type: 'image/png', name: 'test.png', base64: 'QUJD' }, 'team/project'
    );
    assert.equal(markdown,
        "![test.png](https://raw.gitcode.com/user-images/assets/42/uuid/test.png 'test.png')");
    assert.equal(captured.url, 'https://gitcode.com/team/project/uploads/image_file');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.credentials, 'include');
    assert.deepEqual(JSON.parse(captured.options.body), { attach: 'QUJD', file_name: 'test.png' });
});

test('reports unsupported files, missing repository state and auth failures', async () => {
    const parser = load({
        FileReader: class {
            readAsDataURL(file) { this.result = `data:${file.type};base64,${file.base64}`; this.onload(); }
        },
        fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
        document: {
            querySelector: selector => selector === '#__NUXT_DATA__'
                ? { textContent: JSON.stringify(nuxtData) } : null
        }
    });
    await assert.rejects(parser.upload({ type: 'text/plain', name: 'a.txt' }, 'team/project'), /仅支持图片文件/);
    await assert.rejects(parser.upload({ type: 'image/png', name: 'a.png' }, 'missing/repo'), /无法识别当前仓库/);
    await assert.rejects(parser.upload({ type: 'image/png', name: 'a.png' }, 'team/project'), /已登录 GitCode/);
});
