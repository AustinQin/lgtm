const EDITOR_ID_ATTRIBUTE = 'data-gitcode-quick-comment-editor-id';
const INSERT_REQUEST_EVENT = 'gitCodeQuickCommentMessage';
const INSERT_RESPONSE_EVENT = 'gitCodeQuickCommentResponse';

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

function createQuickCommentButton(label, onClick) {
    const button = document.createElement('button');
    button.className = 'quick-comment-button';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function insertComment(editorId, comment) {
    window.dispatchEvent(new CustomEvent(INSERT_REQUEST_EVENT, {
        detail: JSON.stringify({ editorId, comment })
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
