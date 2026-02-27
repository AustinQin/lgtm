// 初始化页面环境中的代码注入
initPageEnvironment();

// 初始化页面环境中的辅助函数
function initPageEnvironment() {
    // 避免重复注入
    if (document.querySelector('#gitcode-quick-comment-inject')) {
        return;
    }
    
    const script = document.createElement('script');
    script.id = 'gitcode-quick-comment-inject';
    script.src = chrome.runtime.getURL('inject.js');
    document.head.appendChild(script);
}

// 在页面环境中执行插入文本
function insertTextInPageContext(comment, callback) {
    // 发送消息到页面环境
    window.dispatchEvent(new CustomEvent('gitCodeQuickCommentMessage', {
        detail: {
            action: 'insertText',
            comment: comment
        }
    }));
    
    // 监听响应
    const responseHandler = function(event) {
        if (event.detail && event.detail.action === 'insertText') {
            window.removeEventListener('gitCodeQuickCommentResponse', responseHandler);
            callback(event.detail.success);
        }
    };
    
    window.addEventListener('gitCodeQuickCommentResponse', responseHandler);
}

// 监听页面变化（SPA应用）
const observer = new MutationObserver(function() {
    // 延迟执行，确保DOM完全渲染
    setTimeout(addQuickCommentButtons, 500);
});

// 开始观察整个文档
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// 监听路由变化（针对SPA应用）
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(addQuickCommentButtons, 1000);
    }
}).observe(document, { subtree: true, childList: true });

// 页面显示时重新检查（用户切换标签页等）
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        setTimeout(addQuickCommentButtons, 500);
    }
});

function addQuickCommentButtons() {
    // 避免重复添加
    if (document.querySelector('.quick-comment-buttons')) return;

    // 找到所有的评论区域
    const commentSections = document.querySelectorAll('.g-discussion-item');

    if (commentSections.length === 0) return;

    // 获取最后一个评论区域
    const lastCommentSection = commentSections[commentSections.length - 1];

    // 在最后一个评论区域中查找发送评论按钮
    const sendButton = lastCommentSection.querySelector('.edit-area_actions button.devui-button--solid--primary');

    if (!sendButton) return;

    // 创建按钮容器
    const quickCommentDiv = document.createElement('div');
    quickCommentDiv.className = 'quick-comment-buttons';
    quickCommentDiv.style.display = 'flex';
    quickCommentDiv.style.alignItems = 'center';
    quickCommentDiv.style.gap = '8px';

    const compileBtn = document.createElement('button');
    compileBtn.className = 'devui-button devui-button--outline devui-button--outline--secondary devui-button--md';
    compileBtn.type = 'button';
    compileBtn.innerHTML = 'compile';
    compileBtn.onclick = function() {
        const currentSection = getCurrentCommentSection();
        if (currentSection) {
            insertComment(currentSection, 'compile');
        }
    };

    const lgtmBtn = document.createElement('button');
    lgtmBtn.className = 'devui-button devui-button--outline devui-button--outline--secondary devui-button--md';
    lgtmBtn.type = 'button';
    lgtmBtn.innerHTML = '/lgtm';
    lgtmBtn.onclick = function() {
        const currentSection = getCurrentCommentSection();
        if (currentSection) {
            insertComment(currentSection, '/lgtm');
        }
    };

    const moreBtn = document.createElement('button');
    moreBtn.className = 'devui-button devui-button--outline devui-button--outline--secondary devui-button--md quick-comment-more-btn';
    moreBtn.type = 'button';
    moreBtn.innerHTML = '更多';
    moreBtn.onclick = function(e) {
        e.stopPropagation();
        const currentSection = getCurrentCommentSection();
        if (currentSection) {
            toggleQuickCommentMenu(moreBtn, currentSection);
        }
    };

    quickCommentDiv.appendChild(compileBtn);
    quickCommentDiv.appendChild(lgtmBtn);
    quickCommentDiv.appendChild(moreBtn);

    // 插入到发送评论按钮的右侧
    const buttonContainer = sendButton.parentNode;
    buttonContainer.insertBefore(quickCommentDiv, sendButton.nextSibling);
}

function getCurrentCommentSection() {
    const commentSections = document.querySelectorAll('.g-discussion-item');
    if (commentSections.length === 0) {
        return null;
    }
    return commentSections[commentSections.length - 1];
}

function insertComment(commentSection, comment) {
    // 在页面环境中通过CodeMirror API插入文本
    insertTextInPageContext(comment, function(success) {
        if (success) {

        }
    });
}

function toggleQuickCommentMenu(button, commentSection) {
    const existingMenu = document.querySelector('.quick-comment-menu');
    
    if (existingMenu) {
        existingMenu.remove();
        return;
    }
    
    const menu = createQuickCommentMenu(button, commentSection);
    document.body.appendChild(menu);
    
    setTimeout(() => {
        menu.classList.add('show');
    }, 10);
    
    const closeMenu = (e) => {
        if (!menu.contains(e.target) && !button.contains(e.target)) {
            menu.classList.remove('show');
            setTimeout(() => menu.remove(), 200);
            document.removeEventListener('click', closeMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 10);
}

function createQuickCommentMenu(button) {
    const menu = document.createElement('div');
    menu.className = 'quick-comment-menu';
    
    const menuItems = [
        { label: '/approve', value: '/approve' },
        { label: '/check-pr', value: '/check-pr' },
        { label: '/label add triage-review', value: '/label add triage-review' },
        { label: '/label add triaged', value: '/label add triaged' },
        { label: '/label add pending', value: '/label add pending' },
        { label: '/label add feature', value: '/label add feature' },
        { label: '/label add resolved', value: '/label add resolved' },
        { label: '/label add stale', value: '/label add stale' },
        { label: '/label add duplicated', value: '/label add duplicated' },
        { label: '收到反馈，感谢！', value: '收到反馈，感谢！我会尽快查看并回复进展。' }
    ];
    
    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'quick-comment-menu-item';
        menuItem.textContent = item.label;
        menuItem.onclick = function() {
            const currentSection = getCurrentCommentSection();
            if (currentSection) {
                insertComment(currentSection, item.value);
            }
            menu.classList.remove('show');
            setTimeout(() => menu.remove(), 200);
        };
        menu.appendChild(menuItem);
    });
    
    document.body.appendChild(menu);
    const menuHeight = menu.offsetHeight;
    document.body.removeChild(menu);
    
    const buttonRect = button.getBoundingClientRect();
    menu.style.left = buttonRect.left + 'px';
    menu.style.top = (buttonRect.top - menuHeight - 4) + 'px';
    
    return menu;
}