// Runs in the page world at document_start, before GitCode captures fetch.
(() => {
    if (window.GitCodeResolveMonitor) return;
    const STATUS_EVENT = 'gitCodeResolveStatus';
    let pending = null;
    let job = null;
    let labelRequest = null;
    const text = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
    const notify = (state, phase, message) => window.dispatchEvent(new CustomEvent(STATUS_EVENT, {
        detail: JSON.stringify({ token: state.token, pathname: state.pathname, editorId: state.editorId, enabled: state.enabled, phase, message })
    }));
    const current = state => state && !state.cancelled && location.pathname === state.pathname;
    const labels = data => [...(Array.isArray(data?.labels) ? data.labels : []),
        ...(Array.isArray(data?.enterprise_labels) ? data.enterprise_labels : [])]
        .map(label => typeof label === 'string' ? label : label?.name).filter(Boolean);
    const unwrap = data => data?.data && typeof data.data === 'object' ? data.data : data;
    const ok = data => data && data.success !== false && !data.error && !data.error_code;

    function cancel() {
        if (pending) {
            pending.cancelled = true;
            clearTimeout(pending.timer);
            notify(pending, 'cancelled', '已取消自动添加 resolved。');
            pending = null;
        }
        if (job) {
            job.cancelled = true;
            notify(job, 'interrupted', '关单说明已提交，自动标记已取消，请在右侧检查 resolved。');
            job = null;
        }
        if (labelRequest) labelRequest.finish(false);
    }

    function eligible(state) {
        if (!current(state) || !state.editor.isConnected) return false;
        const value = text(state.readComment(state.editor));
        // Removing/replacing the resolution heading turns this back into an ordinary draft.
        return value && (state.heading ? value.split('\n').some(line => line.trim() === state.heading)
            : value.includes(text(state.resolution)));
    }

    function arm(options) {
        cancel();
        const page = options.pathname?.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/|$)/);
        if (!page || options.pathname !== location.pathname) return false;
        let repository;
        try { repository = decodeURIComponent(`${page[1]}/${page[2]}`); } catch { return false; }
        const original = text(options.readComment(options.editor));
        if (!original) return false;
        const state = { ...options, repository, issue: page[3], heading: text(options.resolution).split('\n').find(line => /^#\s+/.test(line))?.trim(),
            attempt: null, cancelled: false, enabled: true };
        state.timer = setTimeout(() => {
            cancel();
            notify(state, 'expired', '自动标记已过期，请重新填入关单说明或手动添加 resolved。');
        }, 30 * 60 * 1000);
        pending = state;
        notify(state, 'armed', '本次关单说明提交成功后自动添加 resolved');
        return true;
    }

    function captureAttempt(event) {
        const state = pending;
        if (!state) return;
        if (event.isTrusted === false) return;
        if (!eligible(state)) { cancel(); return; }
        if (event.type === 'click') {
            const button = event.target.closest?.('button');
            if (button?.classList.contains('cancel-btn') && state.editor.contains(button)) { cancel(); return; }
            if (button !== state.findSubmitButton(state.editor)) return;
        } else if (!(event.key === 'Enter' && (event.ctrlKey || event.metaKey) && state.editor.contains(event.target))) return;
        state.attempt = { body: text(state.readComment(state.editor)), at: Date.now() };
    }
    document.addEventListener('click', captureAttempt, true);
    document.addEventListener('keydown', captureAttempt, true);
    // A human taking over the sidebar wins over automation.
    for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, event => {
        if (job && event.isTrusted) cancel();
    }, true);
    document.addEventListener('input', event => {
        if (pending && (!pending.submitting || event.isTrusted) && !eligible(pending)) cancel();
    }, true);
    window.addEventListener('pagehide', cancel);
    window.addEventListener('popstate', cancel);
    window.navigation?.addEventListener('navigate', event => {
        if (new URL(event.destination.url).pathname !== location.pathname) cancel();
    });
    window.addEventListener('gitCodeResolveCancel', cancel);
    window.addEventListener('gitCodeResolveToggle', event => {
        let value;
        try { value = JSON.parse(event.detail); } catch { return; }
        if (!pending || value?.token !== pending.token || value.pathname !== pending.pathname ||
            typeof value.enabled !== 'boolean') return;
        if (!eligible(pending)) { cancel(); return; }
        pending.enabled = value.enabled;
    });

    function endpoint(url) {
        try {
            const parsed = new URL(url, location.href);
            if (!['https://gitcode.com', 'https://web-api.gitcode.com'].includes(parsed.origin)) return null;
            const match = parsed.pathname.match(/^\/issuepr\/api\/v1\/issue\/([^/]+)\/issues\/(\d+)(\/discussions)?$/);
            // GitCode uses both numeric IDs and URL-encoded owner/repository paths.
            return match && { project: decodeURIComponent(match[1]), issue: match[2], discussion: !!match[3] };
        } catch { return null; }
    }

    function matchesIssue(route, state) {
        return route.issue === state.issue && (route.project === state.repository ||
            (/^\d+$/.test(String(state.projectId)) && route.project === String(state.projectId)));
    }

    function capture(url, method, body) {
        if (!pending && !labelRequest) return null;
        const route = endpoint(url);
        if (!route) return null;
        let data;
        try { data = typeof body === 'string' ? JSON.parse(body) : null; } catch { return null; }
        if (!data) return null;
        const state = pending;
        if (method === 'POST' && route.discussion && state && eligible(state) && state.attempt &&
            Date.now() - state.attempt.at < 10000 && matchesIssue(route, state) &&
            text(data.body) === state.attempt.body) {
            const attempt = state.attempt;
            state.attempt = null;
            state.submitting = true;
            return { kind: 'comment', state, body: attempt.body };
        }
        const watch = labelRequest;
        if (method === 'PUT' && !route.discussion && watch && current(watch.state) &&
            matchesIssue(route, watch.state)) {
            const names = [...(typeof data.labels === 'string' ? data.labels.split(',') : []),
                ...(Array.isArray(data.enterprise_labels) ? data.enterprise_labels : [])];
            if (names.includes('resolved') && watch.before.every(name => names.includes(name))) return { kind: 'labels', watch };
        }
        return null;
    }

    function complete(ticket, status, raw) {
        if (!ticket) return;
        const data = unwrap(raw);
        const success = status >= 200 && status < 300 && ok(raw) && ok(data);
        if (ticket.kind === 'labels') {
            if (ticket.watch !== labelRequest) return;
            const names = labels(data);
            ticket.watch.finish(success && String(data.iid) === ticket.watch.state.issue &&
                names.includes('resolved') && ticket.watch.before.every(name => names.includes(name)));
            return;
        }
        const { state, body } = ticket;
        if (pending !== state || !current(state)) return;
        const notes = Array.isArray(data?.notes) ? data.notes : [data];
        state.submitting = false;
        if (!success || !notes.some(note => note?.id && text(note.body) === body)) {
            notify(state, 'waiting', '未确认关单说明提交成功，未添加 resolved。');
            return;
        }
        clearTimeout(state.timer);
        pending = null;
        if (!state.enabled) {
            notify(state, 'cancelled', '');
            return;
        }
        job = state;
        notify(state, 'saving', '关单说明已提交，正在添加 resolved…');
        addResolved(state).then(() => {
            if (current(state)) notify(state, 'done', '关单说明已提交，已标记 resolved。');
        }).catch(error => {
            if (current(state)) notify(state, 'failed', `关单说明已提交，${error.message}`);
        }).finally(() => { if (job === state) job = null; });
    }

    // Observe only the two relevant requests; never read headers/cookies or change requests/responses.
    const nativeFetch = window.fetch;
    if (nativeFetch) window.fetch = function(input, init) {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        let ticket;
        try { ticket = capture(url, method, init?.body); } catch { /* Do not affect native submission. */ }
        const result = nativeFetch.apply(this, arguments);
        if (ticket) result.then(response => response.clone().json().then(data => complete(ticket, response.status, data))
            .catch(() => complete(ticket, 0, null)), () => complete(ticket, 0, null)).catch(() => {});
        return result;
    };
    const XHR = window.XMLHttpRequest;
    if (XHR) {
        const requests = new WeakMap();
        const open = XHR.prototype.open;
        const send = XHR.prototype.send;
        XHR.prototype.open = function(method, url) {
            requests.set(this, { method: String(method).toUpperCase(), url });
            return open.apply(this, arguments);
        };
        XHR.prototype.send = function(body) {
            const request = requests.get(this);
            let ticket;
            try { if (request) ticket = capture(request.url, request.method, body); } catch { /* Keep native behavior. */ }
            if (ticket) this.addEventListener('loadend', () => {
                try { complete(ticket, this.status, this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); }
                catch { complete(ticket, 0, null); }
            }, { once: true });
            return send.apply(this, arguments);
        };
    }

    const visible = node => node?.isConnected && node.getClientRects().length > 0;
    const sidebarLabels = section => [...section.querySelectorAll('.aside-label-content .g-label-tag-text')]
        .map(node => node.textContent.trim());
    async function waitFor(state, read, timeout = 5000) {
        const end = Date.now() + timeout;
        while (current(state)) {
            const value = read();
            if (value) return value;
            if (Date.now() >= end) break;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('未能确认标签已保存，请在右侧标签栏检查。');
    }

    async function addResolved(state) {
        if (!current(state)) return;
        const sections = [...document.querySelectorAll('.aside-label-set')].filter(visible);
        if (sections.length !== 1) throw new Error('无法定位标签栏，请手动添加 resolved。');
        const section = sections[0];
        const before = sidebarLabels(section);
        if (before.includes('resolved')) return;
        const trigger = section.querySelector('button[aria-label="Label"]');
        if (section.getAttribute('aria-readonly') === 'true' || !visible(trigger) || trigger.disabled ||
            trigger.getAttribute('aria-disabled') === 'true') throw new Error('没有可用的标签编辑入口，请手动添加 resolved。');
        if (trigger.getAttribute('aria-expanded') === 'true') throw new Error('标签正在编辑中，请手动添加 resolved。');
        trigger.click();
        let popup;
        let selected = false;
        try {
            popup = await waitFor(state, () => {
                const node = document.getElementById(trigger.getAttribute('aria-controls'));
                return visible(node) && node.getAttribute('role') === 'dialog' ? node : null;
            });
            const search = popup.querySelector('.custom-filter-input input');
            if (!search) throw new Error('标签选择器已变化，请手动添加 resolved。');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(search, 'resolved');
            search.dispatchEvent(new Event('input', { bubbles: true }));
            const option = await waitFor(state, () => {
                const matches = [...popup.querySelectorAll('.custom-filter-option-name')]
                    .filter(node => visible(node) && node.textContent.trim() === 'resolved');
                return matches.length === 1 ? matches[0].closest('.custom-option') : null;
            });
            if (!current(state)) return;
            if (!section.isConnected || !visible(option) || trigger.getAttribute('aria-expanded') !== 'true') {
                throw new Error('标签选择器已变化，请手动添加 resolved。');
            }
            const check = option.querySelector('use[href="#gt-success"]')?.parentElement;
            if (!check || getComputedStyle(check).visibility !== 'hidden') {
                throw new Error('标签选择状态已变化，请在右侧检查 resolved。');
            }
            // Saving is triggered by closing this popover. Start observing before selection or dismissal.
            const saved = new Promise(resolve => {
                const watch = { state, before, finish: success => {
                    clearTimeout(watch.timer);
                    if (labelRequest === watch) labelRequest = null;
                    resolve(success);
                } };
                watch.timer = setTimeout(() => watch.finish(false), 15000);
                labelRequest = watch;
            });
            option.click();
            selected = true;
            // Let Vue apply the selection before dismissing the popover. The gear
            // button only opens it; clicking that button again does not save.
            await waitFor(state, () => getComputedStyle(check).visibility === 'visible');
            dismissPopup(popup);
            await waitFor(state, () => trigger.getAttribute('aria-expanded') !== 'true');
            if (!await saved) throw new Error('resolved 标签保存失败或结果未确认，请在右侧检查。');
            await waitFor(state, () => trigger.getAttribute('aria-expanded') !== 'true' &&
                sidebarLabels(section).includes('resolved'));
        } finally {
            // Close only the untouched popup we opened. Never retry a label write.
            if (!selected && current(state) && popup?.isConnected && trigger.getAttribute('aria-expanded') === 'true') {
                dismissPopup(popup);
            }
            if (labelRequest?.state === state) labelRequest.finish(false);
        }
    }

    function dismissPopup(popup) {
        popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    }

    window.GitCodeResolveMonitor = { arm, cancel };
})();
