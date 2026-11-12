const EDITOR_ID_ATTRIBUTE = 'data-gitcode-quick-comment-editor-id';
const INSERT_REQUEST_EVENT = 'gitCodeQuickCommentMessage';
const INSERT_RESPONSE_EVENT = 'gitCodeQuickCommentResponse';
const ISSUE_CONFIG_PATH = '.msbot/config.yaml';
const ISSUE_TEMPLATE_PATH = '.msbot/template/bug-close.yml';
const ISSUE_TEMPLATE_REF = 'HEAD';
const ISSUE_MARKDOWN_TEMPLATE_PATH = '.msbot/template/issue_resolve_template.md';
let quickSettings = QuickCommentSettings.normalize();
let settingsReady = typeof chrome === 'undefined';
let settingsRevision = 0;
let settingsError = false;

let editorSequence = 0;
let updateScheduled = false;
let toastDismissTimer;
let commentSubmissionPending = false;
let activePullConfirm = null;
let resolveActionToken = null;

initPageEnvironment();
initQuickComments();
initSettings();

function initPageEnvironment() {
    if (document.querySelector('#gitcode-quick-comment-inject')) return;

    const script = document.createElement('script');
    script.id = 'gitcode-quick-comment-inject';
    script.src = chrome.runtime.getURL('inject.js');
    document.head.appendChild(script);
}

function initQuickComments() {
    window.addEventListener('gitCodeResolveStatus', event => {
        const result = parseEventDetail(event.detail);
        if (!result || result.token !== resolveActionToken) return;
        document.querySelector('.quick-comment-resolve-pending')?.remove();
        if (result.pathname !== location.pathname) return;
        if (['armed', 'waiting', 'unavailable'].includes(result.phase)) {
            const editor = [...document.querySelectorAll(`[${EDITOR_ID_ATTRIBUTE}]`)]
                .find(node => node.getAttribute(EDITOR_ID_ATTRIBUTE) === result.editorId);
            if (!editor) return;
            const status = document.createElement('div');
            status.className = 'quick-comment-resolve-pending';
            status.setAttribute('role', 'status');
            if (result.phase === 'unavailable') {
                status.textContent = result.message;
            } else {
                const label = document.createElement('label');
                label.className = 'quick-comment-resolve-option';
                label.title = '仅控制本次提交，不改变表单中保存的偏好';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = result.enabled !== false;
                checkbox.addEventListener('change', () => {
                    window.dispatchEvent(new CustomEvent('gitCodeResolveToggle', {
                        detail: JSON.stringify({ token: result.token, pathname: result.pathname, enabled: checkbox.checked })
                    }));
                });
                const text = document.createElement('span');
                text.textContent = '提交成功后标记 resolved';
                label.append(checkbox, text);
                status.append(label);
                if (result.phase === 'waiting') {
                    const message = document.createElement('span');
                    message.className = 'quick-comment-resolve-message';
                    message.textContent = result.message;
                    status.append(message);
                }
            }
            const attachment = editor.querySelector('.comment-editor__attach');
            if (attachment) attachment.insertAdjacentElement('afterend', status);
            else {
                const actions = editor.querySelector('.comment-editor__actions, .edit-area_actions');
                if (actions) actions.prepend(status);
                else {
                    status.classList.add('quick-comment-resolve-pending--fallback');
                    editor.appendChild(status);
                }
            }
        } else if (result.phase !== 'cancelled') {
            showQuickCommentToast(result.message);
        }
    });
    scheduleButtonUpdate();

    const observer = new MutationObserver(scheduleButtonUpdate);
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleButtonUpdate();
    });
    window.addEventListener('pageshow', scheduleButtonUpdate);

    window.addEventListener(INSERT_RESPONSE_EVENT, event => {
        const response = parseEventDetail(event.detail);
        if (response && !response.success) {
            console.warn('GitCode Quick Comment: failed to update the editor.');
        }
    });
}

function scheduleButtonUpdate() {
    if (updateScheduled) return;

    updateScheduled = true;
    requestAnimationFrame(() => {
        updateScheduled = false;
        addQuickCommentButtons();
    });
}

function cancelResolveLabel() {
    resolveActionToken = null;
    window.dispatchEvent(new CustomEvent('gitCodeResolveCancel', { detail: null }));
    document.querySelector('.quick-comment-resolve-pending')?.remove();
}

function applySettings(value) {
    cancelResolveLabel();
    quickSettings = QuickCommentSettings.normalize(value);
    settingsReady = true;
    settingsError = false;
    settingsRevision++;
    activePullConfirm?.close(false);
    document.querySelector('.quick-comment-menu')?.closeQuickCommentMenu?.();
    document.querySelectorAll('.quick-comment-buttons, .quick-comment-template-status').forEach(node => node.remove());
    IssueResolveForm.checkContext();
    scheduleButtonUpdate();
}

function initSettings() {
    if (typeof chrome === 'undefined') return;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[QuickCommentSettings.KEY]) {
            applySettings(changes[QuickCommentSettings.KEY].newValue);
        }
    });
    const revision = settingsRevision;
    chrome.storage.local.get(QuickCommentSettings.KEY).then(result => {
        if (revision === settingsRevision) applySettings(result[QuickCommentSettings.KEY]);
    }).catch(() => {
        if (revision === settingsRevision) { settingsError = true; scheduleButtonUpdate(); }
    });
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.type !== 'quick-comment-status') return;
        const context = QuickCommentSettings.pageContext(location.href);
        const editorReady = [...document.querySelectorAll('.comment-editor, .g-discussion-item')]
            .some(editor => findEditorTarget(editor));
        const visible = context.kind === 'pull' || context.kind === 'issue'
            ? QuickCommentSettings.items(quickSettings, context.kind).some(item =>
                item.id !== 'more' || QuickCommentSettings.items(quickSettings, 'replies').length > 0)
            : false;
        respond({ ...context, enabled: quickSettings.enabled, settingsReady, settingsError, editorReady, visible });
    });
}

function addQuickCommentButtons() {
    IssueResolveForm.checkContext();
    activePullConfirm?.checkContext();
    document.querySelector('.quick-comment-menu')?.checkContext?.();
    const pageType = getPageType();
    if (!settingsReady || !quickSettings.enabled || !pageType) {
        document.querySelectorAll('.quick-comment-buttons').forEach(node => node.remove());
        document.querySelector('.quick-comment-menu')?.closeQuickCommentMenu?.();
        return;
    }
    const items = QuickCommentSettings.items(quickSettings, pageType);
    const replies = QuickCommentSettings.items(quickSettings, 'replies');
    document.querySelectorAll('.comment-editor, .g-discussion-item').forEach(editor => {
        const target = findEditorTarget(editor);
        if (!target) return;
        const existingButtons = target.actions.querySelector('.quick-comment-buttons');
        const signature = `${pageType}:${location.pathname}:${settingsRevision}`;
        if (existingButtons?.dataset.signature === signature) return;
        existingButtons?.remove();
        const editorId = getEditorId(editor);
        const buttons = document.createElement('div');
        buttons.className = 'quick-comment-buttons';
        buttons.dataset.pageType = pageType;
        buttons.dataset.signature = signature;

        items.forEach(item => {
            if (pageType === 'pull') {
                const button = createQuickCommentButton(item.label, () => {
                    submitPullComment(editor, editorId, item.id, button);
                });
                button.title = `${QuickCommentSettings.modes[item.mode]} ${item.id} 评论`;
                button.disabled = commentSubmissionPending;
                if (item.id === '/lgtm') button.classList.add('quick-comment-button--lgtm');
                if (item.mode === 'confirm') {
                    button.setAttribute('aria-haspopup', 'dialog');
                    button.setAttribute('aria-expanded', 'false');
                }
                if (item.id === 'compile') button.classList.add('quick-comment-button--warning');
                buttons.appendChild(button);
            } else if (item.id === 'resolve') {
                const button = createQuickCommentButton('关单说明', () => insertIssueTemplate(editor, editorId, button));
                button.title = `读取当前仓库默认分支的 ${ISSUE_CONFIG_PATH} 或 ${ISSUE_TEMPLATE_PATH}`;
                buttons.appendChild(button);
            } else if (item.id === 'more' && replies.length) {
                const button = createQuickCommentButton('更多', event => {
                    event.stopPropagation();
                    toggleQuickCommentMenu(button, editor, editorId, replies);
                });
                button.disabled = commentSubmissionPending;
                button.classList.add('quick-comment-more-btn');
                button.setAttribute('aria-haspopup', 'menu');
                button.setAttribute('aria-expanded', 'false');
                buttons.appendChild(button);
            }
        });
        target.actions.insertBefore(buttons, target.sendButton);
    });
}

function getPageType() {
    if (/^\/[^/]+\/[^/]+\/(?:pull|merge_requests)\/\d+(?:\/|$)/.test(location.pathname)) return 'pull';
    if (/^\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/.test(location.pathname)) return 'issue';
    return null;
}

function findEditorTarget(editor) {
    const modernActions = editor.querySelector('.comment-editor__submit');
    if (modernActions) {
        const sendButton = [...modernActions.querySelectorAll('button')]
            .find(button => !button.classList.contains('cancel-btn') &&
                !button.closest('.quick-comment-buttons'));
        return sendButton ? { actions: modernActions, sendButton } : null;
    }

    const sendButton = editor.querySelector('.edit-area_actions button.devui-button--solid--primary');
    return sendButton ? { actions: sendButton.parentElement, sendButton } : null;
}

function getEditorId(editor) {
    let editorId = editor.getAttribute(EDITOR_ID_ATTRIBUTE);
    if (!editorId) {
        editorId = `gitcode-quick-comment-${++editorSequence}`;
        editor.setAttribute(EDITOR_ID_ATTRIBUTE, editorId);
    }
    return editorId;
}

function getIssueContext() {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/|$)/);
    if (!match) return null;
    return { repository: `${match[1]}/${match[2]}`, issue: match[3] };
}

async function readRepositoryFile(repository, signal, path = ISSUE_TEMPLATE_PATH, ref = ISSUE_TEMPLATE_REF) {
    const url = `https://raw.gitcode.com/${repository}/raw/${ref}/${path}`;
    const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) {
        throw new Error(response.status === 404
            ? `未找到 ${path}，请确认当前仓库 ${ref === 'HEAD' ? '默认' : ref} 分支中存在该文件，且文件可公开访问。`
            : `模板读取失败（HTTP ${response.status}），请确认文件可公开访问后重试。`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/^(?:text\/(?:plain|markdown|yaml|x-yaml)|application\/(?:yaml|x-yaml))(?:;|$)/i.test(contentType)) {
        throw new Error('未获取到模板原文，请确认文件可公开访问后重试。');
    }
    const template = await response.text();
    if (!template.trim()) throw new Error('模板文件为空，请先在仓库中填写模板内容。');
    return template;
}

async function loadIssueTemplate(repository, signal, isCurrent) {
    try {
        const config = await readRepositoryFile(repository, signal, ISSUE_CONFIG_PATH);
        const templatePath = IssueTemplate.resolveTemplatePath(config);
        if (templatePath) {
            const yaml = await readRepositoryFile(repository, signal, templatePath);
            if (!isCurrent()) return { kind: 'default' };
            return { kind: 'yaml', schema: await IssueTemplate.parseYaml(yaml) };
        }
    } catch {
        if (signal.aborted || !isCurrent()) return { kind: 'default' };
    }
    if (!isCurrent()) return { kind: 'default' };
    try {
        const yaml = await readRepositoryFile(repository, signal);
        if (!isCurrent()) return { kind: 'default' };
        return { kind: 'yaml', schema: await IssueTemplate.parseYaml(yaml) };
    } catch {
        if (signal.aborted || !isCurrent()) return { kind: 'default' };
    }
    try {
        return { kind: 'markdown', content: await readRepositoryFile(repository, signal, ISSUE_MARKDOWN_TEMPLATE_PATH) };
    } catch {
        return { kind: 'default' };
    }
}

async function insertIssueTemplate(editor, editorId, button) {
    if (button.disabled) return;
    const context = getIssueContext();
    if (!context) return;

    let status = editor.querySelector('.quick-comment-template-status');
    if (!status) {
        status = document.createElement('div');
        status.className = 'quick-comment-template-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        button.parentElement.parentElement.insertAdjacentElement('afterend', status);
    }
    status.textContent = '';
    delete status.dataset.error;
    button.disabled = true;
    button.textContent = '读取中…';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const isCurrentEditor = () => {
        const current = getIssueContext();
        return editor.isConnected && button.isConnected &&
            current?.repository === context.repository && current.issue === context.issue;
    };

    try {
        const template = await loadIssueTemplate(context.repository, controller.signal, isCurrentEditor);
        clearTimeout(timer);
        if (!isCurrentEditor()) return;

        if (template.kind !== 'markdown') {
            await IssueResolveForm.open({
                context,
                schema: template.schema,
                isCurrent: isCurrentEditor,
                onInsert: async (markdown, options = {}) => {
                    if (!isCurrentEditor()) throw new Error('页面已切换，请在当前 Issue 重新打开关单说明。');
                    await insertResolveComment(editorId, markdown, context, options.resolveAfterSubmit !== false);
                },
                onSuccess: () => showQuickCommentToast('关单说明已填入评论框，请检查后提交。')
            });
            return;
        }

        const autoLabelEnabled = await IssueResolveForm.getAutoLabelPreference();
        if (!isCurrentEditor()) return;
        await insertResolveComment(editorId, template.content, context, autoLabelEnabled);
        if (isCurrentEditor()) {
            showQuickCommentToast('仓库模板已填入，请补充关单说明和版本信息后提交。');
        }
    } catch (error) {
        if (!isCurrentEditor()) return;
        status.dataset.error = 'true';
        status.textContent = error.name === 'AbortError'
            ? '模板读取超时，请稍后重试。'
            : error instanceof TypeError
                ? '无法读取模板，请检查网络及文件是否可公开访问后重试。'
                : error.message;
    } finally {
        clearTimeout(timer);
        button.disabled = false;
        button.textContent = '关单说明';
    }
}

function showQuickCommentToast(message) {
    clearTimeout(toastDismissTimer);
    document.querySelector('.quick-comment-toast')?.remove();

    const toast = document.createElement('div');
    toast.className = 'quick-comment-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
    toast.textContent = message;
    toastDismissTimer = setTimeout(() => toast.remove(), 5000);
}

function confirmPullComment(trigger, editor, comment) {
    const previous = activePullConfirm;
    previous?.close(false);
    if (previous?.trigger === trigger) return Promise.resolve(false);

    return new Promise(resolve => {
        const pathname = location.pathname;
        const popup = document.createElement('div');
        popup.className = 'quick-comment-popconfirm';
        popup.id = `qc-comment-confirm-${crypto.randomUUID()}`;
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-labelledby', `${popup.id}-message`);
        const message = document.createElement('div');
        message.className = 'quick-comment-popconfirm-message';
        message.id = `${popup.id}-message`;
        const icon = document.createElement('span');
        icon.className = 'quick-comment-popconfirm-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '!';
        const text = document.createElement('span');
        text.textContent = `您确认要${comment.replace(/^\//, '')}吗？`;
        message.append(icon, text);
        const actions = document.createElement('div');
        actions.className = 'quick-comment-popconfirm-actions';
        const cancel = createQuickCommentButton('取消', () => close(false, true));
        const confirm = createQuickCommentButton('确认', () => close(true, true));
        confirm.classList.add('quick-comment-popconfirm-confirm');
        actions.append(cancel, confirm);
        popup.append(message, actions);
        let closed = false;
        const isCurrent = () => trigger.isConnected && editor.isConnected &&
            !trigger.disabled && !commentSubmissionPending && location.pathname === pathname;

        function close(accepted, restoreFocus = false) {
            if (closed) return;
            const valid = accepted && isCurrent();
            closed = true;
            popup.remove();
            trigger.setAttribute('aria-expanded', 'false');
            trigger.removeAttribute('aria-controls');
            document.removeEventListener('pointerdown', onOutside, true);
            document.removeEventListener('keydown', onKeydown, true);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
            if (activePullConfirm?.trigger === trigger) activePullConfirm = null;
            if (restoreFocus && trigger.isConnected) trigger.focus();
            resolve(valid);
        }

        function position() {
            if (!isCurrent()) { close(false); return; }
            const anchor = trigger.getBoundingClientRect();
            if (anchor.bottom <= 0 || anchor.top >= window.innerHeight ||
                anchor.right <= 0 || anchor.left >= window.innerWidth) { close(false); return; }
            const rect = popup.getBoundingClientRect();
            const edge = 8;
            const gap = 10;
            const above = anchor.top >= rect.height + gap + edge;
            const left = Math.max(edge, Math.min(anchor.left + anchor.width / 2 - rect.width / 2,
                window.innerWidth - rect.width - edge));
            const top = above ? anchor.top - rect.height - gap : anchor.bottom + gap;
            popup.dataset.placement = above ? 'top' : 'bottom';
            popup.style.left = `${left}px`;
            popup.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - rect.height - edge))}px`;
            popup.style.setProperty('--qc-arrow-left', `${Math.max(16,
                Math.min(anchor.left + anchor.width / 2 - left, rect.width - 16))}px`);
        }

        function onOutside(event) {
            if (!popup.contains(event.target) && !trigger.contains(event.target)) close(false);
        }

        function onKeydown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(false, true);
            } else if (event.key === 'Tab' && popup.contains(document.activeElement)) {
                if (event.shiftKey && document.activeElement === cancel) {
                    event.preventDefault(); confirm.focus();
                } else if (!event.shiftKey && document.activeElement === confirm) {
                    event.preventDefault(); cancel.focus();
                }
            }
        }

        document.body.appendChild(popup);
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-controls', popup.id);
        activePullConfirm = { trigger, close, checkContext: () => { if (!isCurrent()) close(false); } };
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKeydown, true);
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        position();
        if (!closed) cancel.focus({ preventScroll: true });
    });
}

async function submitPullComment(editor, editorId, comment, trigger) {
    if (!settingsReady || !quickSettings.enabled || commentSubmissionPending || !editor.isConnected || getPageType() !== 'pull') return;
    const item = quickSettings.groups.pull.find(item => item.id === comment && item.visible);
    if (!item) return;
    const pathname = location.pathname;
    const revision = settingsRevision;
    if (item.mode === 'insert') {
        activePullConfirm?.close(false);
        try {
            await insertCommentAndWait(editorId, comment);
            if (location.pathname === pathname) showQuickCommentToast(`已填入 ${comment}，请检查后提交。`);
        } catch { showQuickCommentToast('无法填入评论框，请刷新页面后重试。'); }
        return;
    }
    if (item.mode === 'confirm') {
        if (!trigger?.isConnected || !await confirmPullComment(trigger, editor, comment)) return;
        if (!quickSettings.enabled || settingsRevision !== revision || commentSubmissionPending || !editor.isConnected || location.pathname !== pathname) return;
    } else activePullConfirm?.close(false);
    await submitQuickComment(editorId, comment, pathname);
}

async function submitIssueComment(editor, editorId, itemId, pathname = location.pathname) {
    if (!settingsReady || !quickSettings.enabled || commentSubmissionPending || !editor.isConnected ||
        getPageType() !== 'issue' || location.pathname !== pathname) return;
    if (!QuickCommentSettings.items(quickSettings, 'issue').some(item => item.id === 'more')) return;
    const item = QuickCommentSettings.items(quickSettings, 'replies').find(item => item.id === itemId);
    if (!item) return;
    await submitQuickComment(editorId, item.value, pathname, item.label);
}

async function submitQuickComment(editorId, comment, pathname, label = comment) {
    commentSubmissionPending = true;
    const setPending = pending => document.querySelectorAll(
        '.quick-comment-buttons[data-page-type="pull"] button, .quick-comment-more-btn'
    ).forEach(button => { button.disabled = pending; });
    setPending(true);
    try {
        await requestEditorUpdate({ action: 'submit', editorId, comment, pathname }, 22000,
            '无法确认提交结果，请检查评论列表和输入框，避免重复提交。');
        if (location.pathname === pathname) {
            showQuickCommentToast(`已提交 ${label}`);
        }
    } catch (error) {
        if (location.pathname === pathname) showQuickCommentToast(error.message);
    } finally {
        commentSubmissionPending = false;
        setPending(false);
    }
}

async function insertResolveComment(editorId, comment, context, resolveAfterSubmit) {
    cancelResolveLabel();
    resolveActionToken = crypto.randomUUID();
    await insertCommentAndWait(editorId, comment, { resolveAfterSubmit, resolveToken: resolveActionToken,
        pathname: location.pathname, projectId: IssueImageUpload.repositoryId(context.repository) });
}

async function insertCommentAndWait(editorId, comment, options = {}) {
    const errorMessage = '模板已读取，但无法填入评论框。请刷新页面后重试。';
    try {
        await requestEditorUpdate({ editorId, comment, ...options }, 2000, errorMessage);
    } catch {
        throw new Error(errorMessage);
    }
}

function requestEditorUpdate(payload, timeout, fallbackError) {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const finish = (success, error) => {
            clearTimeout(timer);
            window.removeEventListener(INSERT_RESPONSE_EVENT, onResponse);
            if (success) resolve();
            else reject(new Error(error || fallbackError));
        };
        const onResponse = event => {
            const response = parseEventDetail(event.detail);
            if (response?.requestId === requestId) finish(response.success, response.error);
        };
        const timer = setTimeout(() => finish(false), timeout);
        window.addEventListener(INSERT_RESPONSE_EVENT, onResponse);
        window.dispatchEvent(new CustomEvent(INSERT_REQUEST_EVENT, {
            detail: JSON.stringify({ ...payload, requestId })
        }));
    });
}

function createQuickCommentButton(label, onClick) {
    const button = document.createElement('button');
    button.className = 'quick-comment-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function toggleQuickCommentMenu(button, editor, editorId, menuItems) {
    if (commentSubmissionPending) return;
    const pathname = location.pathname;
    const revision = settingsRevision;
    const isCurrent = () => button.isConnected && editor.isConnected &&
        location.pathname === pathname && settingsRevision === revision;
    const existingMenu = document.querySelector('.quick-comment-menu');
    if (existingMenu) {
        const isSameButton = existingMenu.triggerButton === button;
        existingMenu.closeQuickCommentMenu?.();
        if (isSameButton) return;
    }

    const menu = document.createElement('div');
    menu.className = 'quick-comment-menu';
    menu.setAttribute('role', 'menu');
    menu.triggerButton = button;

    menuItems.forEach(item => {
        const menuItem = document.createElement('button');
        menuItem.className = 'quick-comment-menu-item';
        menuItem.type = 'button';
        menuItem.setAttribute('role', 'menuitem');
        menuItem.textContent = item.label;
        menuItem.title = `直接提交 ${item.label}`;
        menuItem.addEventListener('click', () => {
            closeMenu();
            if (isCurrent()) submitIssueComment(editor, editorId, item.id, pathname);
        });
        menu.appendChild(menuItem);
    });

    let outsideListenerTimer;
    const closeMenu = () => {
        clearTimeout(outsideListenerTimer);
        menu.remove();
        button.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('keydown', handleEscape);
    };
    const handleOutsideClick = event => {
        if (!menu.contains(event.target) && event.target !== button) closeMenu();
    };
    const handleEscape = event => {
        if (event.key === 'Escape') closeMenu();
    };
    menu.closeQuickCommentMenu = closeMenu;
    menu.checkContext = () => { if (!isCurrent()) closeMenu(); };

    document.body.appendChild(menu);
    positionMenu(menu, button);
    button.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => menu.classList.add('show'));
    outsideListenerTimer = setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 0);
    document.addEventListener('keydown', handleEscape);
}

function positionMenu(menu, button) {
    const gap = 4;
    const edge = 8;
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(buttonRect.left, window.innerWidth - menuRect.width - edge);
    const top = buttonRect.top >= menuRect.height + gap
        ? buttonRect.top - menuRect.height - gap
        : buttonRect.bottom + gap;

    menu.style.left = `${Math.max(edge, left)}px`;
    menu.style.top = `${Math.max(edge, top)}px`;
}

function parseEventDetail(detail) {
    try {
        return typeof detail === 'string' ? JSON.parse(detail) : detail;
    } catch (error) {
        return null;
    }
}
