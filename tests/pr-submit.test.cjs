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

test('does not submit on an Issue page or accept arbitrary commands', async () => {
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
        document: { querySelector: () => ({}), querySelectorAll: () => buttons, body: {}, addEventListener() {} },
        MutationObserver: class { observe() {} }, requestAnimationFrame() {},
        setTimeout, clearTimeout, crypto: { randomUUID: () => 'content-request' },
        console: { warn() {} },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    });
    vm.runInContext(readFileSync(require.resolve('../content.js'), 'utf8'), context);
    context.showQuickCommentToast = message => toasts.push(message);
    return { context, buttons, requests, toasts, window,
        respond(response) { window.dispatchEvent({ type: 'gitCodeQuickCommentResponse', detail: JSON.stringify(response) }); }
    };
}

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
