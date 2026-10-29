const EDITOR_ID_ATTRIBUTE = 'data-gitcode-quick-comment-editor-id';
const INSERT_REQUEST_EVENT = 'gitCodeQuickCommentMessage';
const INSERT_RESPONSE_EVENT = 'gitCodeQuickCommentResponse';
const ISSUE_CONFIG_PATH = '.msbot/config.yaml';
const ISSUE_TEMPLATE_PATH = '.msbot/template/bug-close.yml';
const ISSUE_TEMPLATE_REF = 'HEAD';
const ISSUE_MARKDOWN_TEMPLATE_PATH = '.msbot/template/issue_resolve_template.md';
const PAGE_COMMENTS = {
    pull: {
        direct: [
            { label: '/check-pr', value: '/check-pr' },
            { label: 'compile', value: 'compile' },
            { label: 'retry', value: 'retry' },
            { label: '/approve', value: '/approve' },
            { label: '/lgtm', value: '/lgtm' }
        ],
        more: []
    },
    issue: {
        direct: [],
        more: [
            { label: '/label add triage-review', value: '/label add triage-review' },
            { label: '/label add triaged', value: '/label add triaged' },
            { label: '/label add pending', value: '/label add pending' },
            { label: '/label add feature', value: '/label add feature' },
            { label: '/label add resolved', value: '/label add resolved' },
            { label: '/label add stale', value: '/label add stale' },
            { label: '/label add duplicated', value: '/label add duplicated' },
            { label: '收到反馈，感谢！', value: '收到反馈，感谢！我会尽快查看并回复进展。' }
        ]
    }
};

let editorSequence = 0;
let updateScheduled = false;
let toastDismissTimer;

initPageEnvironment();
initQuickComments();

function initPageEnvironment() {
    if (document.querySelector('#gitcode-quick-comment-inject')) return;

    const script = document.createElement('script');
    script.id = 'gitcode-quick-comment-inject';
    script.src = chrome.runtime.getURL('inject.js');
    document.head.appendChild(script);
}

function initQuickComments() {
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

function addQuickCommentButtons() {
    IssueResolveForm.checkContext();
    const pageType = getPageType();
    const comments = PAGE_COMMENTS[pageType];
    if (!comments) return;

    document.querySelectorAll('.comment-editor, .g-discussion-item').forEach(editor => {
        const target = findEditorTarget(editor);
        if (!target) return;

        const existingButtons = target.actions.querySelector('.quick-comment-buttons');
        if (existingButtons?.dataset.pageType === pageType) return;
        existingButtons?.remove();

        const editorId = getEditorId(editor);
        const buttons = document.createElement('div');
        buttons.className = 'quick-comment-buttons';
        buttons.dataset.pageType = pageType;

        comments.direct.forEach(item => {
            const button = createQuickCommentButton(item.label, () => {
                insertComment(editorId, item.value);
            });
            if (item.value === '/lgtm') {
                button.classList.add('quick-comment-button--lgtm');
            }
            if (item.value === 'compile') {
                button.classList.add('quick-comment-button--warning');
            }
            buttons.appendChild(button);
        });

        if (pageType === 'issue') {
            const templateButton = createQuickCommentButton('关单说明', () => {
                insertIssueTemplate(editor, editorId, templateButton);
            });
            templateButton.title = `读取当前仓库默认分支的 ${ISSUE_CONFIG_PATH} 或 ${ISSUE_TEMPLATE_PATH}`;
            buttons.appendChild(templateButton);
        }

        if (comments.more.length > 0) {
            const moreButton = createQuickCommentButton('更多', event => {
                event.stopPropagation();
                toggleQuickCommentMenu(moreButton, editorId, comments.more);
            });
            moreButton.classList.add('quick-comment-more-btn');
            moreButton.setAttribute('aria-haspopup', 'menu');
            moreButton.setAttribute('aria-expanded', 'false');
            buttons.appendChild(moreButton);
        }

        target.actions.insertBefore(buttons, target.sendButton);
    });
}

function getPageType() {
    if (/\/pull\/\d+/.test(location.pathname)) return 'pull';
    if (/\/issues\/\d+/.test(location.pathname)) return 'issue';
    return null;
}

function findEditorTarget(editor) {
    const modernActions = editor.querySelector('.comment-editor__submit');
    if (modernActions) {
        const sendButton = [...modernActions.querySelectorAll('button')]
            .find(button => !button.classList.contains('cancel-btn'));
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
                onInsert: async markdown => {
                    if (!isCurrentEditor()) throw new Error('页面已切换，请在当前 Issue 重新打开关单说明。');
                    await insertCommentAndWait(editorId, markdown);
                },
                onSuccess: () => showQuickCommentToast('关单说明已填入评论框，请检查后提交。')
            });
            return;
        }

        await insertCommentAndWait(editorId, template.content);
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

function insertCommentAndWait(editorId, comment) {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const finish = success => {
            clearTimeout(timer);
            window.removeEventListener(INSERT_RESPONSE_EVENT, onResponse);
            if (success) resolve();
            else reject(new Error('模板已读取，但无法填入评论框。请刷新页面后重试。'));
        };
        const onResponse = event => {
            const response = parseEventDetail(event.detail);
            if (response?.requestId === requestId) finish(response.success);
        };
        const timer = setTimeout(() => finish(false), 2000);
        window.addEventListener(INSERT_RESPONSE_EVENT, onResponse);
        insertComment(editorId, comment, requestId);
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

function insertComment(editorId, comment, requestId) {
    window.dispatchEvent(new CustomEvent(INSERT_REQUEST_EVENT, {
        detail: JSON.stringify({ editorId, comment, requestId })
    }));
}

function toggleQuickCommentMenu(button, editorId, menuItems) {
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
        menuItem.addEventListener('click', () => {
            insertComment(editorId, item.value);
            closeMenu();
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
