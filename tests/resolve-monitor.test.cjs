const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require.resolve('../resolve-monitor.js'), 'utf8');
const url = 'https://web-api.gitcode.com/issuepr/api/v1/issue/123/issues/42';
const flush = async () => { for (let n = 0; n < 12; n++) await new Promise(setImmediate); };

function setup(options = {}) {
    const events = new Map();
    const statuses = [];
    const state = { value: '# 关单说明\n\n修复版本 v2', names: options.resolved ? ['bug', 'resolved'] : ['bug'],
        open: false, selected: false, clicks: 0, writes: [], time: 0 };
    const emit = (type, extra = {}) => {
        for (const fn of events.get(type) || []) fn({ type, ...extra });
    };
    const listen = (type, fn) => events.set(type, [...(events.get(type) || []), fn]);
    const visible = { isConnected: true, getClientRects: () => [{}] };
    const button = { ...visible, classList: { contains: () => false }, closest() { return this; } };
    const editor = { ...visible, contains: () => true };
    class Input { set value(value) { this.text = value; } dispatchEvent() {} }
    const option = { ...visible, querySelector: () => ({ parentElement: {} }), click() { state.selected = true; state.clicks++; } };
    const popup = { ...visible, getAttribute: () => 'dialog',
        dispatchEvent(event) {
            assert.equal(event.key, 'Escape');
            state.open = false;
            if (state.selected) {
                const body = JSON.stringify(options.enterprise
                    ? { labels: 0, enterprise_labels: [...state.names, 'resolved'] }
                    : { labels: [...state.names, 'resolved'].join(','), enterprise_labels: [] });
                context.window.fetch(options.labelUrl || url, { method: 'PUT', body });
            }
        },
        querySelector: () => new Input(),
        querySelectorAll: () => options.missingLabel ? [] : [{ ...visible, textContent: 'resolved', closest: () => option }] };
    const trigger = { ...visible,
        getAttribute: name => name === 'aria-controls' ? 'picker' : name === 'aria-expanded' ? String(state.open) : null,
        // The real GitCode gear only opens; saving requires Escape / outside dismissal.
        click() { state.open = true; }
    };
    const section = { ...visible,
        getAttribute: () => options.readonly ? 'true' : 'false', querySelector: () => trigger,
        querySelectorAll: () => state.names.map(textContent => ({ textContent })) };
    const network = async (requestUrl, init) => {
        const data = JSON.parse(init.body);
        if (init.method === 'PUT') {
            state.writes.push(data);
            if (!options.labelFail) state.names = options.enterprise ? data.enterprise_labels : data.labels.split(',');
            return new Response(JSON.stringify({ iid: 42, labels: options.enterprise ? [] : options.dropExisting ? ['resolved'] : state.names,
                enterprise_labels: options.enterprise ? state.names.map(name => ({ name })) : [] }),
                { status: options.labelFail ? 403 : 200 });
        }
        if (options.beforeResponse) options.beforeResponse(state, emit);
        return new Response(JSON.stringify(options.response ?? { id: 'discussion', notes: [{ id: 1, body: data.body }] }),
            { status: options.status || 200 });
    };
    class XHR {
        open(method, requestUrl) { this.method = method; this.url = requestUrl; }
        addEventListener(type, fn) { this.done = fn; }
        send(body) {
            network(this.url, { method: this.method, body }).then(async response => {
                this.status = response.status; this.responseText = await response.text(); this.done?.();
            });
        }
    }
    const context = vm.createContext({
        URL, Event, Response, HTMLInputElement: Input,
        KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        location: { pathname: '/team/repo/issues/42', href: 'https://gitcode.com/team/repo/issues/42' },
        Date: { now: () => state.time },
        setTimeout(fn, ms) {
            // Let missing-label/persistence waits expire quickly, without expiring the armed draft.
            if (ms >= 15000) return { unref() {} };
            return setImmediate(() => { state.time += ms; fn(); });
        }, clearTimeout() {}, getComputedStyle: () => ({ visibility: state.selected ? 'visible' : 'hidden' }),
        document: { addEventListener: listen, querySelectorAll: () => [section], getElementById: () => popup },
        window: { fetch: network, XMLHttpRequest: XHR, addEventListener: listen,
            dispatchEvent(event) {
                if (event.type === 'gitCodeResolveStatus') statuses.push(JSON.parse(event.detail));
                emit(event.type, event);
            }
        }
    });
    vm.runInContext(source, context);
    const arm = () => context.window.GitCodeResolveMonitor.arm({ editor, editorId: 'editor-1',
        readComment: () => state.value, findSubmitButton: () => button, issue: '42', projectId: Object.hasOwn(options, 'projectId') ? options.projectId : 123,
        pathname: context.location.pathname, token: 'test', resolution: '# 关单说明\n\n修复版本 v2' });
    arm();
    return { context, state, statuses, emit, arm, editor, button,
        click: (extra = {}) => emit('click', { target: button, isTrusted: true, ...extra }),
        async send(extra = {}) {
            const args = { method: 'POST', body: JSON.stringify({ body: state.value }), ...extra };
            if (extra.xhr) { const xhr = new context.window.XMLHttpRequest(); xhr.open('POST', extra.url || url + '/discussions'); xhr.send(args.body); }
            else await context.window.fetch(extra.url || url + '/discussions', args);
            await flush();
        }
    };
}

test('only a manually submitted, positively confirmed resolution adds resolved exactly once and retains existing labels', async () => {
    const f = setup();
    await f.send();
    assert.equal(f.state.writes.length, 0);
    f.click(); await f.send();
    assert.deepEqual(f.state.names, ['bug', 'resolved']);
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.statuses.at(-1).phase, 'done');
    assert.equal(f.statuses[0].editorId, 'editor-1');
    f.click(); await f.send();
    assert.equal(f.state.writes.length, 1);
});

test('XHR submission and native editor clearing after request both work', async () => {
    const f = setup({ beforeResponse(state, emit) { state.value = ''; emit('input', { isTrusted: false }); } });
    f.click(); await f.send({ xhr: true });
    assert.equal(f.statuses.at(-1).phase, 'done');
});

for (const options of [{ status: 500 }, { response: { success: false } }, { response: {} },
    { response: { notes: [{ id: 1, body: 'other comment' }] } }, { response: { error_code: 42 } }]) {
    test(`never labels unsuccessful or unconfirmed comment: ${JSON.stringify(options)}`, async () => {
        const f = setup(options); f.click(); await f.send();
        assert.equal(f.state.writes.length, 0);
        assert.equal(f.statuses.at(-1).phase, 'waiting');
    });
}

for (const other of [url.replace('/123/', '/124/') + '/discussions', url.replace('/42', '/43') + '/discussions',
    url.replace('web-api.gitcode.com', 'example.com') + '/discussions']) {
    test(`does not act on another request: ${other}`, async () => {
        const f = setup(); f.click(); await f.send({ url: other }); assert.equal(f.state.writes.length, 0);
    });
}

test('synthetic clicks, changed request bodies and stale attempts cannot arm a submission', async () => {
    for (const change of [f => f.click({ isTrusted: false }), f => { f.click(); f.state.value += '\nextra'; },
        f => { f.click(); f.state.time += 10001; }]) {
        const f = setup(); change(f); await f.send(); assert.equal(f.state.writes.length, 0);
    }
});

test('edits retaining the resolution heading can be submitted with keyboard', async () => {
    const f = setup(); f.state.value += '\n补充验证信息';
    f.emit('keydown', { key: 'Enter', ctrlKey: true, isTrusted: true, target: f.editor });
    await f.send(); assert.equal(f.statuses.at(-1).phase, 'done');
});

test('cancel, navigation, detached editor and replaced draft prevent automatic labeling', async () => {
    for (const change of [f => f.emit('gitCodeResolveCancel'), f => { f.context.location.pathname += '/other'; },
        f => { f.editor.isConnected = false; }, f => { f.state.value = 'ordinary comment'; f.emit('input'); }]) {
        const f = setup(); f.click(); change(f); await f.send(); assert.equal(f.state.writes.length, 0);
    }
});

test('existing resolved is not toggled off and needs no write', async () => {
    const f = setup({ resolved: true }); f.click(); await f.send();
    assert.equal(f.state.writes.length, 0); assert.equal(f.statuses.at(-1).phase, 'done');
});

for (const options of [{ readonly: true }, { labelFail: true }, { dropExisting: true }]) {
    test(`label permission or persistence failure never reports success or retries: ${JSON.stringify(options)}`, async () => {
        const f = setup(options); f.click(); await f.send();
        assert.equal(f.statuses.at(-1).phase, 'failed'); assert.ok(f.state.writes.length <= 1);
    });
}

test('user interaction while looking for a label cancels automation without a write', async () => {
    const f = setup({ missingLabel: true }); f.click(); await f.send();
    f.emit('pointerdown', { isTrusted: true }); await flush();
    assert.equal(f.state.writes.length, 0);
    assert.ok(!f.statuses.some(s => s.phase === 'done'));
});

test('matches encoded repository paths for both comment and label requests, including mixed numeric/path routes', async () => {
    const encoded = url.replace('/123/', '/team%2Frepo/');
    for (const [commentUrl, labelUrl] of [[encoded, encoded], [encoded, url], [url, encoded]]) {
        const f = setup({ labelUrl }); f.click(); await f.send({ url: commentUrl + '/discussions' });
        assert.equal(f.statuses.at(-1).phase, 'done');
        assert.deepEqual(f.state.names, ['bug', 'resolved']);
        assert.equal(f.state.writes.length, 1);
    }
});

test('encoded repository matching still rejects another repository and malformed encoding', async () => {
    for (const project of ['other%2Frepo', 'team%2Fother', 'team%252Frepo', 'team%ZZrepo']) {
        const f = setup(); f.click(); await f.send({ url: url.replace('/123/', '/' + project + '/') + '/discussions' });
        assert.equal(f.state.writes.length, 0);
        assert.ok(!f.statuses.some(s => s.phase === 'saving'));
    }
});

test('saves enterprise labels through native Escape dismissal with the real path-based request shape', async () => {
    const encoded = url.replace('/123/', '/team%2Frepo/');
    const f = setup({ labelUrl: encoded, enterprise: true });
    f.click(); await f.send({ url: encoded + '/discussions' });
    assert.equal(f.statuses.at(-1).phase, 'done');
    assert.equal(f.state.open, false);
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.writes[0].labels, 0);
    assert.deepEqual(f.state.writes[0].enterprise_labels, ['bug', 'resolved']);
});

test('uses the verified page repository path when numeric project metadata is unavailable', async () => {
    const encoded = url.replace('/123/', '/team%2Frepo/');
    const f = setup({ projectId: null, labelUrl: encoded });
    f.click(); await f.send({ url: encoded + '/discussions' });
    assert.equal(f.statuses.at(-1).phase, 'done');
    const other = setup({ projectId: null });
    other.click(); await other.send();
    assert.equal(other.state.writes.length, 0);
});

test('the per-comment checkbox can disable and re-enable labels without canceling the draft', async () => {
    for (const reenable of [false, true]) {
        const f = setup();
        const toggle = enabled => f.emit('gitCodeResolveToggle', {
            detail: JSON.stringify({ token: 'test', pathname: f.context.location.pathname, enabled })
        });
        toggle(false);
        if (reenable) toggle(true);
        f.click(); await f.send();
        assert.equal(f.state.writes.length, reenable ? 1 : 0);
        assert.equal(f.statuses.at(-1).phase, reenable ? 'done' : 'cancelled');
    }
});

test('checkbox changes from a different draft or Issue do not affect the current submission', async () => {
    const f = setup();
    for (const detail of [
        { token: 'other', pathname: f.context.location.pathname, enabled: false },
        { token: 'test', pathname: '/team/repo/issues/43', enabled: false }
    ]) f.emit('gitCodeResolveToggle', { detail: JSON.stringify(detail) });
    f.click(); await f.send();
    assert.equal(f.statuses.at(-1).phase, 'done');
});
