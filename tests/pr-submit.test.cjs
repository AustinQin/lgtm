const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../inject.js'), 'utf8');

function setup(options = {}) {
    const listeners = new Map();
    const responses = [];
    const state = { value: options.value || '', clicks: 0, writes: 0, time: 0, ticks: 0 };
    const location = { pathname: '/team/project/pull/42' };
    const button = {
        textContent: '评论', disabled: Boolean(options.disabled),
        closest: () => null,
        classList: { contains: () => false },
        getClientRects: () => [{}],
        getAttribute: name => options.attributes?.[name] || null,
        click() {
            state.clicks++;
            if (options.onClick) options.onClick(state, location, editor);
            else state.value = '';
        }
    };
    const doc = { toString: () => state.value, get length() { return state.value.length; } };
    const view = {
        state: { doc },
        dispatch({ changes }) {
            state.value = state.value.slice(0, changes.from) + changes.insert + state.value.slice(changes.to);
            state.writes++;
        },
        focus() {}
    };
    const cm5 = {
        getValue: () => state.value,
        setValue(value) { state.value = value; state.writes++; },
        posFromIndex: value => value, setCursor() {}, focus() {}, refresh() {}
    };
    const candidates = options.candidates ? options.candidates(button) : [button];
    const editor = {
        isConnected: true,
        querySelector(selector) {
            if (selector === '.cm-content[contenteditable="true"]') return options.cm5 ? null : { cmView: { view } };
            if (selector === '.CodeMirror') return options.cm5 ? { CodeMirror: cm5 } : null;
            if (selector === '.comment-editor__submit') return { querySelectorAll: () => candidates };
            return null;
        }
    };
    const context = vm.createContext({
        location,
        Date: { now: () => state.time },
        setTimeout(callback, ms) {
            return setImmediate(() => {
                state.time += ms;
                state.ticks++;
                options.onTick?.(state, location, editor, button);
                callback();
            });
        },
        document: { querySelector: () => editor },
        window: {
            addEventListener: (name, callback) => listeners.set(name, callback),
            dispatchEvent: event => responses.push(JSON.parse(event.detail))
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    });
    vm.runInContext(source, context);
    return {
        state, button, editor, location, responses,
        async request(overrides = {}) {
            const requestId = overrides.requestId || 'request-1';
            await listeners.get('gitCodeQuickCommentMessage')({ detail: JSON.stringify({
                action: 'submit', editorId: 'editor-1', comment: '/lgtm',
                pathname: location.pathname, ...overrides, requestId
            }) });
            return responses.find(response => response.requestId === requestId);
        }
    };
}

for (const cm5 of [false, true]) {
    test(`submits only the selected command once with CodeMirror ${cm5 ? 5 : 6}`, async () => {
        const fixture = setup({ cm5 });
        const result = await fixture.request();
        assert.equal(result.success, true);
        assert.equal(fixture.state.clicks, 1);
        assert.equal(fixture.state.writes, 1);
        assert.equal(fixture.state.value, '');
    });
}

test('preserves an existing draft, including a previous failed command', async () => {
    for (const value of ['unfinished review', '/lgtm']) {
        const fixture = setup({ value });
        const result = await fixture.request();
        assert.equal(result.success, false);
        assert.match(result.error, /已有内容/);
        assert.equal(fixture.state.value, value);
        assert.equal(fixture.state.writes, 0);
        assert.equal(fixture.state.clicks, 0);
    }
});

test('waits for the native submit button to enable', async () => {
    const fixture = setup({ disabled: true, onTick(state, location, editor, button) {
        if (state.ticks === 2) button.disabled = false;
    } });
    assert.equal((await fixture.request()).success, true);
    assert.equal(fixture.state.clicks, 1);
});

test('stops if the user edits the inserted command before submission', async () => {
    const fixture = setup({ disabled: true, onTick(state) { state.value = 'new draft'; } });
    assert.match((await fixture.request()).error, /内容已变化/);
    assert.equal(fixture.state.clicks, 0);
    assert.equal(fixture.state.value, 'new draft');
});

test('stops on PR navigation or editor removal before submission', async () => {
    for (const detach of [false, true]) {
        const fixture = setup({ disabled: true, onTick(state, location, editor) {
            if (detach) editor.isConnected = false;
            else location.pathname = '/team/project/pull/43';
        } });
        assert.equal((await fixture.request()).success, false);
        assert.equal(fixture.state.clicks, 0);
    }
});

test('rejects a mismatched request pathname and arbitrary commands', async () => {
    const fixture = setup();
    assert.equal((await fixture.request({ pathname: '/team/project/issues/42' })).success, false);
    assert.equal((await fixture.request({ comment: 'unexpected', requestId: 'other' })).success, false);
    assert.equal(fixture.state.clicks, 0);
    assert.equal(fixture.state.writes, 0);
});

test('ignores extension buttons and dangerous native actions', async () => {
    const fixture = setup({ candidates(button) {
        return [
            { ...button, closest: () => ({}) },
            { ...button, textContent: '评论并合并' },
            { ...button, textContent: '关闭 Pull Request' },
            button
        ];
    } });
    assert.equal((await fixture.request()).success, true);
    assert.equal(fixture.state.clicks, 1);
});

test('refuses missing or ambiguous native submit actions', async () => {
    for (const candidates of [() => [], button => [button, { ...button }]]) {
        const fixture = setup({ candidates });
        assert.match((await fixture.request()).error, /无法确定/);
        assert.equal(fixture.state.clicks, 0);
        assert.equal(fixture.state.writes, 0);
    }
});

test('leaves the command for manual submission when the native button stays disabled', async () => {
    const fixture = setup({ disabled: true });
    assert.match((await fixture.request()).error, /按钮暂不可用/);
    assert.equal(fixture.state.clicks, 0);
    assert.equal(fixture.state.value, '/lgtm');
});

test('blocks a second request while submission is pending', async () => {
    const fixture = setup({ disabled: true, onTick(state, location, editor, button) { button.disabled = false; } });
    const first = fixture.request();
    const second = await fixture.request({ requestId: 'request-2', comment: 'compile' });
    assert.match(second.error, /正在提交/);
    assert.equal((await first).success, true);
    assert.equal(fixture.state.clicks, 1);
});

test('does not retry or report success when GitCode does not clear the editor', async () => {
    const fixture = setup({ onClick() {} });
    assert.match((await fixture.request()).error, /无法确认提交结果/);
    assert.equal(fixture.state.clicks, 1);
    assert.equal(fixture.state.value, '/lgtm');
});

test('does not click again after navigation during an in-flight submission', async () => {
    const fixture = setup({ onClick(state, location) { location.pathname = '/team/project/pull/43'; } });
    assert.match((await fixture.request()).error, /无法确认提交结果/);
    assert.equal(fixture.state.clicks, 1);
});

test('the existing insertion action still preserves drafts without submitting', async () => {
    const fixture = setup({ value: 'draft' });
    assert.equal((await fixture.request({ action: undefined })).success, true);
    assert.equal(fixture.state.value, 'draft\n/lgtm');
    assert.equal(fixture.state.clicks, 0);
});

test('the page bridge accepts the confirmed approve command', async () => {
    const fixture = setup({ onClick(state) {
        assert.equal(state.value, '/approve');
        state.value = '';
    } });
    assert.equal((await fixture.request({ comment: '/approve' })).success, true);
    assert.equal(fixture.state.clicks, 1);
});

function setupContent() {
    const listeners = new Map();
    const buttons = [{ disabled: false }, { disabled: false }];
    const requests = [];
    const toasts = [];
    const window = {
        addEventListener(name, fn) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(fn);
        },
        removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
        dispatchEvent(event) {
            if (event.type === 'gitCodeQuickCommentMessage') requests.push(JSON.parse(event.detail));
            for (const fn of listeners.get(event.type) || []) fn(event);
        }
    };
    const context = vm.createContext({
        window, location: { pathname: '/team/project/pull/42' },
        document: { querySelector: () => ({ remove() {} }), querySelectorAll: () => buttons, body: {}, addEventListener() {} },
        MutationObserver: class { observe() {} }, requestAnimationFrame() {},
        setTimeout, clearTimeout, crypto: { randomUUID: () => 'content-request' },
        console: { warn() {} },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    });
    vm.runInContext(readFileSync(require.resolve('../settings.js'), 'utf8'), context);
    vm.runInContext(readFileSync(require.resolve('../content.js'), 'utf8'), context);
    context.showQuickCommentToast = message => toasts.push(message);
    return { context, buttons, requests, toasts, window,
        respond(response) { window.dispatchEvent({ type: 'gitCodeQuickCommentResponse', detail: JSON.stringify(response) }); }
    };
}

test('the approve button uses the submission flow with its confirmation anchor', () => {
    const fixture = setupContent();
    const buttons = [];
    fixture.context.IssueResolveForm = { checkContext() {} };
    fixture.context.findEditorTarget = () => ({ actions: { querySelector() {}, insertBefore() {} } });
    fixture.context.getEditorId = () => 'editor-1';
    fixture.context.document.querySelectorAll = () => [{ isConnected: true }];
    fixture.context.document.createElement = () => ({ dataset: {}, appendChild(button) { buttons.push(button); } });
    fixture.context.createQuickCommentButton = (label, onClick) => ({ label, onClick, setAttribute() {}, classList: { add() {} } });
    const submissions = [];
    fixture.context.submitPullComment = (...args) => submissions.push(args);
    fixture.context.addQuickCommentButtons();
    const approve = buttons.find(button => button.label === '/approve');
    assert.match(approve.title, /确认后提交/);
    approve.onClick();
    assert.equal(fixture.requests.length, 0);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0][2], '/approve');
    assert.equal(submissions[0][3], approve);
});

test('content bridge locks every PR button and correlates the response before unlocking', async () => {
    const fixture = setupContent();
    const editor = { isConnected: true };
    const first = fixture.context.submitPullComment(editor, 'editor-1', '/lgtm');
    await fixture.context.submitPullComment(editor, 'editor-1', 'compile');
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].action, 'submit');
    assert.equal(fixture.requests[0].pathname, '/team/project/pull/42');
    assert.ok(fixture.buttons.every(button => button.disabled));
    fixture.respond({ requestId: 'unrelated', success: true });
    assert.ok(fixture.buttons.every(button => button.disabled));
    fixture.respond({ requestId: 'content-request', success: true });
    await first;
    assert.ok(fixture.buttons.every(button => !button.disabled));
    assert.equal(fixture.toasts[0], '已提交 /lgtm');
});

test('content bridge shows submission errors and restores the buttons', async () => {
    const fixture = setupContent();
    const pending = fixture.context.submitPullComment({ isConnected: true }, 'editor-1', 'retry');
    fixture.respond({ requestId: 'content-request', success: false, error: '草稿已保留' });
    await pending;
    assert.deepEqual(fixture.toasts, ['草稿已保留']);
    assert.ok(fixture.buttons.every(button => !button.disabled));
    assert.equal(fixture.requests.length, 1);
});

for (const command of ['compile', '/approve']) {
    test(`canceling ${command} confirmation does not insert or submit a comment`, async () => {
        const fixture = setupContent();
        const trigger = { isConnected: true };
        fixture.context.confirmPullComment = async (button, editor, comment) => {
            assert.equal(button, trigger);
            assert.equal(comment, command);
            return false;
        };
        await fixture.context.submitPullComment({ isConnected: true }, 'editor-1', command, trigger);
        assert.equal(fixture.requests.length, 0);
        assert.ok(fixture.buttons.every(button => !button.disabled));
        assert.deepEqual(fixture.toasts, []);
    });

    test(`accepting ${command} confirmation submits the command once`, async () => {
        const fixture = setupContent();
        let confirmations = 0;
        fixture.context.confirmPullComment = async (button, editor, comment) => {
            assert.equal(comment, command);
            confirmations++;
            return true;
        };
        const pending = fixture.context.submitPullComment({ isConnected: true }, 'editor-1', command, { isConnected: true });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(confirmations, 1);
        assert.equal(fixture.requests.length, 1);
        assert.equal(fixture.requests[0].comment, command);
        assert.equal(fixture.requests[0].action, 'submit');
        fixture.respond({ requestId: 'content-request', success: true });
        await pending;
        assert.deepEqual(fixture.toasts, [`已提交 ${command}`]);
    });

    test(`does not submit ${command} if the PR changes while confirmation is open`, async () => {
        const fixture = setupContent();
        let accept;
        fixture.context.confirmPullComment = () => new Promise(resolve => { accept = resolve; });
        const pending = fixture.context.submitPullComment({ isConnected: true }, 'editor-1', command, { isConnected: true });
        fixture.context.location.pathname = '/team/project/pull/43';
        accept(true);
        await pending;
        assert.equal(fixture.requests.length, 0);
        assert.ok(fixture.buttons.every(button => !button.disabled));
    });
}

test('an insert-only PR command appends without requesting submission or confirmation', async () => {
    const fixture = setupContent();
    vm.runInContext("quickSettings.groups.pull.find(row => row.id === '/approve').mode = 'insert'", fixture.context);
    fixture.context.confirmPullComment = () => assert.fail('must not confirm an insert-only command');
    const pending = fixture.context.submitPullComment({ isConnected: true }, 'editor-1', '/approve');
    assert.equal(fixture.requests[0].action, undefined);
    fixture.respond({ requestId: 'content-request', success: true });
    await pending;
    assert.equal(fixture.toasts[0], '已填入 /approve，请检查后提交。');
});

test('the direct option bypasses confirmation and the confirm option applies to any PR command', async () => {
    for (const [comment, mode] of [['compile', 'direct'], ['/lgtm', 'confirm']]) {
        const fixture = setupContent();
        vm.runInContext(`quickSettings.groups.pull.find(row => row.id === '${comment}').mode = '${mode}'`, fixture.context);
        let confirmations = 0;
        fixture.context.confirmPullComment = async () => { confirmations++; return true; };
        const pending = fixture.context.submitPullComment({ isConnected: true }, 'editor-1', comment, { isConnected: true });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(confirmations, mode === 'confirm' ? 1 : 0);
        assert.equal(fixture.requests[0].action, 'submit');
        fixture.respond({ requestId: 'content-request', success: true });
        await pending;
    }
});

test('disabled, hidden or not-yet-loaded settings prevent command dispatch', async () => {
    for (const change of ["quickSettings.enabled = false", "settingsReady = false",
        "quickSettings.groups.pull.find(row => row.id === '/lgtm').visible = false"]) {
        const fixture = setupContent();
        vm.runInContext(change, fixture.context);
        await fixture.context.submitPullComment({ isConnected: true }, 'editor-1', '/lgtm');
        assert.equal(fixture.requests.length, 0);
    }
});

test('a settings change cancels pending confirmation before any command is sent', async () => {
    const fixture = setupContent();
    let accept;
    fixture.context.confirmPullComment = () => new Promise(resolve => { accept = resolve; });
    const pending = fixture.context.submitPullComment({ isConnected: true }, 'editor-1', 'compile', { isConnected: true });
    vm.runInContext('settingsRevision++', fixture.context);
    accept(true);
    await pending;
    assert.equal(fixture.requests.length, 0);
});

test('a storage change during initial loading wins over the stale initial read', async () => {
    const fixture = setupContent();
    let finishRead, onChanged;
    fixture.context.document.querySelectorAll = () => [];
    fixture.context.IssueResolveForm = { checkContext() {} };
    fixture.context.chrome = {
        storage: { local: { get: () => new Promise(resolve => { finishRead = resolve; }) },
            onChanged: { addListener: callback => { onChanged = callback; } } },
        runtime: { onMessage: { addListener() {} } }
    };
    vm.runInContext('settingsReady = false; initSettings()', fixture.context);
    await fixture.context.submitPullComment({ isConnected: true }, 'editor-1', '/lgtm');
    assert.equal(fixture.requests.length, 0);
    onChanged({ quickCommentSettings: { newValue: { enabled: false } } }, 'local');
    finishRead({ quickCommentSettings: { enabled: true } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(vm.runInContext('quickSettings.enabled', fixture.context), false);
    assert.equal(vm.runInContext('settingsReady', fixture.context), true);
});

test('failed initial storage reads do not fall back to submitting with default settings', async () => {
    const fixture = setupContent();
    fixture.context.chrome = {
        storage: { local: { get: async () => { throw Error('unavailable'); } }, onChanged: { addListener() {} } },
        runtime: { onMessage: { addListener() {} } }
    };
    vm.runInContext('settingsReady = false; initSettings()', fixture.context);
    await new Promise(resolve => setImmediate(resolve));
    await fixture.context.submitPullComment({ isConnected: true }, 'editor-1', '/lgtm');
    assert.equal(fixture.requests.length, 0);
    assert.equal(vm.runInContext('settingsError', fixture.context), true);
});

const issueReplies = require('../settings.js').groups.replies;
for (const cm5 of [false, true]) {
    test(`submits every Issue menu reply exactly once with CodeMirror ${cm5 ? 5 : 6}`, async () => {
        for (const item of issueReplies) {
            const fixture = setup({ cm5, onClick(state) {
                assert.equal(state.value, item.value);
                state.value = '';
            } });
            fixture.location.pathname = '/team/project/issues/42';
            assert.equal((await fixture.request({ comment: item.value })).success, true);
            assert.equal(fixture.state.clicks, 1);
            assert.equal(fixture.state.writes, 1);
        }
    });
}

test('direct submission allowlists are restricted to their respective page types', async () => {
    for (const [route, comment] of [
        ['issues/42', '/lgtm'], ['pull/42', '/label add resolved'],
        ['issues/42', '/label add arbitrary'], ['issues/42', 'arbitrary reply'],
        ['tree/main', '/label add resolved']
    ]) {
        const fixture = setup();
        fixture.location.pathname = `/team/project/${route}`;
        assert.equal((await fixture.request({ comment })).success, false);
        assert.equal(fixture.state.clicks, 0);
        assert.equal(fixture.state.writes, 0);
    }
});

test('Issue submission preserves existing text and refuses close-and-comment native actions', async () => {
    for (const options of [{ value: 'unfinished issue comment' }, {
        candidates: button => [{ ...button, textContent: '评论并关闭 Issue' }]
    }]) {
        const fixture = setup(options);
        fixture.location.pathname = '/team/project/issues/42';
        assert.equal((await fixture.request({ comment: '/label add resolved' })).success, false);
        assert.equal(fixture.state.clicks, 0);
        assert.equal(fixture.state.writes, 0);
        assert.equal(fixture.state.value, options.value || '');
    }
});

test('Issue submission stops if navigation occurs while waiting for the native button', async () => {
    const fixture = setup({ disabled: true, onTick(state, location) {
        location.pathname = '/team/project/issues/43';
    } });
    fixture.location.pathname = '/team/project/issues/42';
    assert.match((await fixture.request({ comment: '/label add pending' })).error, /页面已切换/);
    assert.equal(fixture.state.clicks, 0);
});

test('Issue menu dispatches directly, locks repeated clicks and shows a short success message', async () => {
    const fixture = setupContent();
    fixture.context.location.pathname = '/team/project/issues/42';
    const editor = { isConnected: true };
    const pending = fixture.context.submitIssueComment(editor, 'editor-1', 'thanks');
    await fixture.context.submitIssueComment(editor, 'editor-1', '/label add pending');
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].action, 'submit');
    assert.equal(fixture.requests[0].comment, issueReplies.at(-1).value);
    assert.ok(fixture.buttons.every(button => button.disabled));
    fixture.respond({ requestId: 'content-request', success: true });
    await pending;
    assert.ok(fixture.buttons.every(button => !button.disabled));
    assert.deepEqual(fixture.toasts, ['已提交 收到反馈，感谢！']);
});

test('Issue menu respects settings and rejects stale or disconnected contexts', async () => {
    for (const change of [
        'quickSettings.enabled = false', 'settingsReady = false',
        "quickSettings.groups.issue.find(row => row.id === 'more').visible = false",
        "quickSettings.groups.replies.find(row => row.id === 'thanks').visible = false",
        "location.pathname = '/team/project/issues/43'", "location.pathname = '/team/project/pull/42'",
        'editor.isConnected = false'
    ]) {
        const fixture = setupContent();
        fixture.context.location.pathname = '/team/project/issues/42';
        fixture.context.editor = { isConnected: true };
        vm.runInContext(change, fixture.context);
        await fixture.context.submitIssueComment(fixture.context.editor, 'editor-1', 'thanks', '/team/project/issues/42');
        assert.equal(fixture.requests.length, 0, change);
    }
});

for (const cm5 of [false, true]) {
    test(`merge_requests supports all PR commands with CodeMirror ${cm5 ? 5 : 6}`, async () => {
        for (const item of require('../settings.js').groups.pull) {
            const fixture = setup({ cm5, onClick(state) {
                assert.equal(state.value, item.id);
                state.value = '';
            } });
            fixture.location.pathname = '/Ascend/msinsight/merge_requests/1388';
            assert.equal((await fixture.request({ comment: item.id })).success, true);
            assert.equal(fixture.state.clicks, 1);
        }
    });
}

test('merge_requests preserves drafts and stops submission on navigation', async () => {
    const draft = setup({ value: 'unfinished review' });
    draft.location.pathname = '/Ascend/msinsight/merge_requests/1388';
    assert.match((await draft.request()).error, /已有内容/);
    assert.equal(draft.state.value, 'unfinished review');
    assert.equal(draft.state.clicks, 0);
    const moved = setup({ disabled: true, onTick(state, location) {
        location.pathname = '/Ascend/msinsight/merge_requests/1389';
    } });
    moved.location.pathname = '/Ascend/msinsight/merge_requests/1388';
    assert.match((await moved.request()).error, /页面已切换/);
    assert.equal(moved.state.clicks, 0);
});

test('merge_requests rejects Issue commands and malformed detail routes', async () => {
    for (const [path, comment] of [
        ['/Ascend/msinsight/merge_requests/1388', '/label add resolved'],
        ['/Ascend/msinsight/merge_requests/1388fake', '/lgtm'],
        ['/Ascend/msinsight/merge_requests/new', '/lgtm']
    ]) {
        const fixture = setup();
        fixture.location.pathname = path;
        assert.equal((await fixture.request({ comment })).success, false);
        assert.equal(fixture.state.writes, 0);
        assert.equal(fixture.state.clicks, 0);
    }
});

test('merge_requests uses PR submission settings, including confirmation and insert-only mode', async () => {
    for (const mode of ['direct', 'confirm', 'insert']) {
        const fixture = setupContent();
        fixture.context.location.pathname = '/Ascend/msinsight/merge_requests/1388';
        assert.equal(fixture.context.getPageType(), 'pull');
        vm.runInContext(`quickSettings.groups.pull.find(row => row.id === '/approve').mode = '${mode}'`, fixture.context);
        let confirmations = 0;
        fixture.context.confirmPullComment = async () => { confirmations++; return true; };
        const pending = fixture.context.submitPullComment({ isConnected: true }, 'editor-1', '/approve', { isConnected: true });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(confirmations, mode === 'confirm' ? 1 : 0);
        assert.equal(fixture.requests.length, 1);
        assert.equal(fixture.requests[0].action, mode === 'insert' ? undefined : 'submit');
        if (mode !== 'insert') assert.equal(fixture.requests[0].pathname, '/Ascend/msinsight/merge_requests/1388');
        fixture.respond({ requestId: 'content-request', success: true });
        await pending;
    }
});
