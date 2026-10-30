const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = readFileSync(require.resolve('../content.js'), 'utf8');
const yaml = 'body:\n  - type: input\n    id: version\n    attributes:\n      label: 修复版本\n    validations:\n      required: true\n';

function setup(fetch) {
    const status = { textContent: '', dataset: {} };
    const editor = { isConnected: true, querySelector: () => status };
    const button = { isConnected: true, disabled: false, textContent: 'template' };
    const insertions = [];
    const toasts = [];
    const forms = [];
    const context = vm.createContext({
        fetch, AbortController, TypeError, setTimeout, clearTimeout, TextEncoder,
        crypto: webcrypto, jsyaml: require('../vendor/js-yaml.min.js'),
        location: { pathname: '/team/project/issues/42' },
        document: { querySelector: () => ({}), body: {}, addEventListener() {} },
        window: { addEventListener() {} },
        MutationObserver: class { observe() {} },
        requestAnimationFrame() {},
        IssueResolveForm: { open: async options => forms.push(options), checkContext() {} },
        recordInsertion: async (...args) => insertions.push(args),
        recordToast: message => toasts.push(message)
    });
    vm.runInContext(readFileSync(require.resolve('../issue-template.js'), 'utf8'), context);
    vm.runInContext(source, context);
    vm.runInContext('insertCommentAndWait = recordInsertion', context);
    vm.runInContext('showQuickCommentToast = recordToast', context);
    return {
        context, status, editor, button, insertions, toasts, forms,
        run: () => context.insertIssueTemplate(editor, 'editor-1', button)
    };
}

function response(body, status = 200, type = 'text/plain;charset=UTF-8') {
    return { ok: status === 200, status, headers: { get: () => type }, text: async () => body };
}

test('tries config and YAML first, then preserves the repository Markdown exactly', async () => {
    const markdown = '# Resolution\n\n<!-- notes -->\n- Version: 1.2\n';
    const requests = [];
    const fixture = setup(async (url, options) => {
        requests.push({ url, options });
        return url.endsWith('config.yaml') || url.endsWith('.yml') ? response('', 404) : response(markdown);
    });
    await fixture.run();
    assert.deepEqual(requests.map(request => request.url), [
        'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/config.yaml',
        'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/template/bug-close.yml',
        'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/template/issue_resolve_template.md'
    ]);
    assert.equal(requests[0].options.credentials, 'omit');
    assert.deepEqual(fixture.insertions, [['editor-1', markdown]]);
    assert.equal(fixture.button.disabled, false);
    assert.equal(fixture.status.dataset.error, undefined);
    assert.equal(fixture.forms.length, 0);
});

test('does not fetch outside an Issue detail page', async () => {
    const fixture = setup(() => assert.fail('unexpected fetch'));
    for (const pathname of ['/team/project/pull/42', '/team/project/issues', '/team/project/issues/42invalid']) {
        fixture.context.location.pathname = pathname;
        await fixture.run();
    }
    assert.equal(fixture.insertions.length, 0);
});

test('ignores repeated clicks while loading and restores the button', async () => {
    let release;
    let requests = 0;
    const fixture = setup(url => {
        requests++;
        if (requests === 1) return new Promise(resolve => { release = resolve; });
        return Promise.resolve(url.endsWith('.yml') ? response(yaml) : response('', 404));
    });
    const pending = fixture.run();
    assert.equal(fixture.button.disabled, true);
    await fixture.run();
    assert.equal(requests, 1);
    release(response('', 404));
    await pending;
    assert.equal(requests, 2);
    assert.equal(fixture.forms.length, 1);
    assert.equal(fixture.insertions.length, 0);
    assert.equal(fixture.button.disabled, false);
});

test('never inserts into a different Issue, repository, or detached editor', async () => {
    for (const change of [
        f => { f.context.location.pathname = '/team/project/issues/43'; },
        f => { f.context.location.pathname = '/other/project/issues/42'; },
        f => { f.editor.isConnected = false; },
        f => { f.button.isConnected = false; }
    ]) {
        let complete;
        const fixture = setup(() => new Promise(resolve => { complete = resolve; }));
        const pending = fixture.run();
        change(fixture);
        complete(response('template'));
        await pending;
        assert.equal(fixture.insertions.length, 0);
        assert.equal(fixture.button.disabled, false);
    }
});

test('opens the default form for missing, empty, HTML, network and timeout responses', async () => {
    for (const fetch of [
        async () => response('missing', 404),
        async () => response('forbidden', 403),
        async () => response('  \n'),
        async () => response('<html>Sign in</html>', 200, 'text/html'),
        async () => { throw new TypeError('Failed to fetch'); },
        async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
    ]) {
        const fixture = setup(fetch);
        await fixture.run();
        assert.equal(fixture.insertions.length, 0);
        assert.equal(fixture.forms.length, 1);
        assert.equal(fixture.status.dataset.error, undefined);
        assert.equal(fixture.status.textContent, '');
        assert.equal(fixture.button.disabled, false);
    }
});

test('uses the repository template when it becomes available on a later click', async () => {
    let available = false;
    const fixture = setup(async url => available && url.endsWith('.md') ? response('template') : response('', 404));
    await fixture.run();
    available = true;
    await fixture.run();
    assert.equal(fixture.insertions.length, 1);
    assert.equal(fixture.forms.length, 1);
    assert.equal(fixture.status.dataset.error, undefined);
});

test('opens a dynamic form from YAML without fetching Markdown or inserting raw YAML', async () => {
    const requests = [];
    const fixture = setup(async url => { requests.push(url); return response(yaml, 200, 'application/yaml'); });
    await fixture.run();
    assert.deepEqual(requests, [
        'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/config.yaml',
        'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/template/bug-close.yml'
    ]);
    assert.equal(fixture.insertions.length, 0);
    const schema = fixture.forms[0].schema;
    assert.equal(schema.sections[0].fields[0].label, '修复版本');
    assert.ok(schema.validate({}).version);
    await fixture.forms[0].onInsert(schema.buildMarkdown({ version: 'v2.0' }));
    assert.match(fixture.insertions[0][1], /\| 修复版本 \| v2.0 \|/);
});

test('reads the template declared by audits.bug_issue_close in .msbot/config.yaml', async () => {
    const config = 'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: templates/close.yml\n    notification: engineering\n';
    const requests = [];
    const fixture = setup(async url => {
        requests.push(url);
        if (url.endsWith('/.msbot/config.yaml')) return response(config, 200, 'application/yaml');
        if (url.endsWith('/templates/close.yml')) return response(yaml, 200, 'application/yaml');
        return response('', 404);
    });
    await fixture.run();
    assert.deepEqual(requests, [
        'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/config.yaml',
        'https://raw.gitcode.com/team/project/raw/HEAD/templates/close.yml'
    ]);
    assert.equal(fixture.forms.length, 1);
    assert.equal(fixture.insertions.length, 0);
    assert.equal(fixture.forms[0].schema.sections[0].fields[0].label, '修复版本');
});

test('ignores disabled, invalid, or unsafe config and falls back to the default template', async () => {
    for (const config of [
        'version: 2\naudits:\n  bug_issue_close:\n    enabled: true\n    template: templates/close.yml\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: false\n    template: templates/close.yml\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: ../close.yml\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: https://example.com/close.yml\n',
        'not: [valid'
    ]) {
        const requests = [];
        const fixture = setup(async url => {
            requests.push(url);
            if (url.endsWith('/.msbot/config.yaml')) return response(config, 200, 'application/yaml');
            if (url.endsWith('/.msbot/template/bug-close.yml')) return response(yaml, 200, 'application/yaml');
            return response('', 404);
        });
        await fixture.run();
        assert.deepEqual(requests, [
            'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/config.yaml',
            'https://raw.gitcode.com/team/project/raw/HEAD/.msbot/template/bug-close.yml'
        ], config);
        assert.equal(fixture.forms.length, 1);
        assert.equal(fixture.forms[0].schema.sections[0].fields[0].label, '修复版本');
    }
});

test('falls back to the default template when the configured template cannot be used', async () => {
    const config = 'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: templates/close.yml\n';
    for (const configured of [response('', 404), response('body: [invalid'), response('<html>Sign in</html>', 200, 'text/html')]) {
        const requests = [];
        const fixture = setup(async url => {
            requests.push(url);
            if (url.endsWith('/.msbot/config.yaml')) return response(config, 200, 'application/yaml');
            if (url.endsWith('/templates/close.yml')) return configured;
            if (url.endsWith('/.msbot/template/bug-close.yml')) return response(yaml, 200, 'application/yaml');
            return response('', 404);
        });
        await fixture.run();
        assert.ok(requests.some(url => url.endsWith('/.msbot/template/bug-close.yml')));
        assert.equal(fixture.forms.length, 1);
    }
});

test('invalid YAML falls back to Markdown and then to the builtin form', async () => {
    for (const markdownAvailable of [true, false]) {
        const fixture = setup(async url => url.endsWith('.yml') ? response('body: [invalid')
            : markdownAvailable ? response('# Legacy template') : response('', 404));
        await fixture.run();
        assert.equal(fixture.insertions.length, markdownAvailable ? 1 : 0);
        if (!markdownAvailable) assert.equal(fixture.forms[0].schema, undefined);
    }
});

test('reports editor insertion failure instead of success', async () => {
    const fixture = setup(async () => response('template'));
    fixture.context.recordInsertion = async () => { throw new Error('Editor unavailable'); };
    vm.runInContext('insertCommentAndWait = recordInsertion', fixture.context);
    await fixture.run();
    assert.equal(fixture.status.dataset.error, 'true');
    assert.equal(fixture.status.textContent, 'Editor unavailable');
    assert.equal(fixture.button.disabled, false);
});

test('inserts generated Markdown only after the form requests it', async () => {
    const fixture = setup(async () => response('', 404));
    await fixture.run();
    assert.equal(fixture.insertions.length, 0);
    await fixture.forms[0].onInsert('# Generated resolution');
    assert.deepEqual(fixture.insertions, [['editor-1', '# Generated resolution']]);
    fixture.forms[0].onSuccess();
    assert.equal(fixture.toasts.length, 1);
});

test('does not insert the default into another Issue after a failed request', async () => {
    let complete;
    const fixture = setup(() => new Promise(resolve => { complete = resolve; }));
    const pending = fixture.run();
    fixture.context.location.pathname = '/team/project/issues/43';
    complete(response('', 404));
    await pending;
    assert.equal(fixture.insertions.length, 0);
    assert.equal(fixture.forms.length, 0);
    assert.equal(fixture.button.disabled, false);
});

test('prevents an open form from inserting into another Issue', async () => {
    const fixture = setup(async () => response('', 404));
    await fixture.run();
    fixture.context.location.pathname = '/team/project/issues/43';
    await assert.rejects(fixture.forms[0].onInsert('generated'), /页面已切换/);
    assert.equal(fixture.insertions.length, 0);
});
