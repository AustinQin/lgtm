(() => {
    const S = QuickCommentSettings;
    const $ = id => document.getElementById(id);
    let settings = S.normalize();
    let loaded = false;
    let saving = false;
    let activeTab = null;
    let statusSequence = 0;

    function announce(message, error = false) {
        $('save-status').textContent = message;
        $('save-status').dataset.error = String(error);
    }

    function lock(value) {
        $('controls').disabled = value;
        $('enabled').disabled = value;
        $('reset').disabled = value;
    }

    function render() {
        $('enabled').checked = settings.enabled;
        for (const [group, definitions] of Object.entries(S.groups)) {
            const list = $(`${group}-list`);
            list.replaceChildren();
            settings.groups[group].forEach((item, index, rows) => {
                const definition = definitions.find(entry => entry.id === item.id);
                const row = document.createElement('div');
                row.className = 'row';
                row.dataset.hidden = String(!item.visible);
                const label = document.createElement('label');
                label.className = 'row-label';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = item.visible;
                checkbox.setAttribute('aria-label', `显示 ${definition.label}`);
                checkbox.addEventListener('change', () => save(next => {
                    next.groups[group][index].visible = checkbox.checked;
                }));
                const title = document.createElement('span');
                title.textContent = definition.label;
                if (group === 'pull' || item.id.startsWith('/')) title.className = 'command';
                label.append(checkbox, title);
                row.append(label);
                if (group === 'pull') {
                    const select = document.createElement('select');
                    select.setAttribute('aria-label', `${definition.label} 提交方式`);
                    for (const [value, text] of Object.entries(S.modes)) {
                        const option = document.createElement('option');
                        option.value = value; option.textContent = text;
                        select.append(option);
                    }
                    select.value = item.mode;
                    select.addEventListener('change', () => save(next => {
                        next.groups[group][index].mode = select.value;
                    }));
                    row.append(select);
                }
                const sort = document.createElement('div');
                sort.className = 'sort';
                for (const [offset, text, action] of [[-1, '↑', '上移'], [1, '↓', '下移']]) {
                    const button = document.createElement('button');
                    button.type = 'button'; button.textContent = text;
                    const name = `${action} ${definition.label}`;
                    button.setAttribute('aria-label', name); button.title = name;
                    button.disabled = index + offset < 0 || index + offset >= rows.length;
                    button.addEventListener('click', () => save(next => {
                        const items = next.groups[group];
                        [items[index], items[index + offset]] = [items[index + offset], items[index]];
                    }, name));
                    sort.append(button);
                }
                row.append(sort); list.append(row);
            });
        }
    }

    async function save(change, focusName) {
        if (!loaded || saving) return;
        const previousFocus = focusName || document.activeElement?.getAttribute('aria-label');
        const next = S.normalize(settings);
        change(next);
        saving = true; lock(true); announce('正在保存…');
        try {
            await chrome.storage.local.set({ [S.KEY]: next });
            settings = next;
            announce('已保存 · 自动应用到 GitCode 页面');
        } catch {
            announce('保存失败，请重试。', true);
        } finally {
            saving = false; render(); lock(false);
            if (previousFocus) {
                [...document.querySelectorAll('[aria-label]')]
                    .find(node => node.getAttribute('aria-label') === previousFocus)?.focus();
            }
            refreshStatus();
        }
    }

    function showPage(context, badge, detail, tone = 'muted') {
        $('page-badge').textContent = badge;
        $('page-badge').dataset.tone = tone;
        $('repository').textContent = context.repository
            ? `${context.repository} · ${context.kind === 'pull' ? 'PR' : 'Issue'} #${context.number}`
            : context.kind === 'gitcode' ? 'GitCode' : '当前页面不支持快捷评论';
        $('page-detail').textContent = detail;
    }

    async function refreshStatus() {
        const sequence = ++statusSequence;
        let context = { kind: 'unsupported' };
        try {
            [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            context = S.pageContext(activeTab?.url);
            if (!['pull', 'issue'].includes(context.kind)) {
                showPage(context, '未适用', '请打开 GitCode 的 PR 或 Issue 详情页。');
                return;
            }
            if (!settings.enabled) {
                showPage(context, '已暂停', '开启右上角开关，即可恢复快捷评论。');
                return;
            }
            const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'quick-comment-status' });
            if (sequence !== statusSequence) return;
            if (!response?.kind) throw new Error('Missing content script');
            context = response;
            if (response.settingsError) showPage(context, '读取失败', '无法读取设置，请刷新页面后重试。', 'warning');
            else if (!response.settingsReady) showPage(context, '加载中', '页面正在加载设置，请稍后重新打开面板。');
            else if (!response.enabled) showPage(context, '已暂停', '开启右上角开关，即可恢复快捷评论。');
            else if (!response.visible) showPage(context, '按钮已隐藏', '在下方勾选需要显示的快捷按钮。');
            else if (!response.editorReady) showPage(context, '等待评论区', '暂未检测到评论框，请确认已登录并打开评论区。', 'warning');
            else showPage(context, '已就绪', '快捷按钮已启用，可在页面评论区使用。', 'ready');
        } catch {
            if (sequence === statusSequence) showPage(context, '需要刷新', '请刷新当前 GitCode 页面，让扩展加载后再试。', 'warning');
        }
    }

    function selectTab(group, focus = false) {
        for (const name of ['pull', 'issue']) {
            const selected = group === name;
            $(`${name}-tab`).setAttribute('aria-selected', String(selected));
            $(`${name}-tab`).tabIndex = selected ? 0 : -1;
            $(`${name}-panel`).hidden = !selected;
        }
        if (focus) $(`${group}-tab`).focus();
    }

    async function load() {
        lock(true); $('retry').hidden = true;
        try {
            const result = await chrome.storage.local.get(S.KEY);
            settings = S.normalize(result[S.KEY]); loaded = true;
            render(); lock(false); announce('设置仅保存在当前浏览器');
            await refreshStatus();
            if (S.pageContext(activeTab?.url).kind === 'issue') selectTab('issue');
        } catch {
            loaded = false; lock(true); $('retry').hidden = false;
            announce('无法加载设置，请重试。', true);
        }
    }

    $('enabled').addEventListener('change', () => save(next => { next.enabled = $('enabled').checked; }));
    $('reset').addEventListener('click', () => save(next => Object.assign(next, S.normalize())));
    $('retry').addEventListener('click', load);
    for (const tab of document.querySelectorAll('[data-tab]')) {
        tab.addEventListener('click', () => selectTab(tab.dataset.tab));
        tab.addEventListener('keydown', event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                selectTab(event.key === 'Home' ? 'pull' : event.key === 'End' ? 'issue'
                    : tab.dataset.tab === 'pull' ? 'issue' : 'pull', true);
            }
        });
    }
    $('version').textContent = `v${chrome.runtime.getManifest().version}`;
    load();
})();
