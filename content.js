// 等待页面加载完成
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(addQuickCommentButtons, 1000);
});

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
    compileBtn.innerHTML = '<span class="button-content">compile</span>';
    compileBtn.onclick = function() {
        console.log('COMPILE button clicked');
        insertComment(lastCommentSection, 'compile');
    };

    const lgtmBtn = document.createElement('button');
    lgtmBtn.className = 'devui-button devui-button--outline devui-button--outline--secondary devui-button--md';
    lgtmBtn.type = 'button';
    lgtmBtn.innerHTML = '<span class="button-content">/lgtm</span>';
    lgtmBtn.onclick = function() {
        console.log('LGTM button clicked');
        insertComment(lastCommentSection, '/lgtm');
    };

    const moreBtn = document.createElement('button');
    moreBtn.className = 'devui-button devui-button--outline devui-button--outline--secondary devui-button--md quick-comment-more-btn';
    moreBtn.type = 'button';
    moreBtn.innerHTML = '<span class="button-content">更多</span>';
    moreBtn.onclick = function(e) {
        e.stopPropagation();
        toggleQuickCommentMenu(moreBtn, lastCommentSection);
    };

    quickCommentDiv.appendChild(compileBtn);
    quickCommentDiv.appendChild(lgtmBtn);
    quickCommentDiv.appendChild(moreBtn);

    // 插入到发送评论按钮的右侧
    const buttonContainer = sendButton.parentNode;
    buttonContainer.insertBefore(quickCommentDiv, sendButton.nextSibling);

    console.log('Quick comment buttons added successfully');
}

function findCommentArea() {
    // 这个函数现在主要用于兼容性，主要逻辑在addQuickCommentButtons中
    // 尝试多种选择器来找到评论输入区域
    const selectors = [
        // GitCode特定的选择器
        '.g-discussion-item .CodeMirror',
        '.g-discussion-item .dp-md-editor',
        '.g-discussion-item textarea',
        '.CodeMirror textarea',
        '.dp-md-editor textarea',
        // 通用选择器作为备选
        'textarea[name="comment"]',
        '.comment-form textarea',
        '.new-comment textarea',
        'textarea[placeholder*="评论"]',
        'textarea[placeholder*="comment"]',
        '.comment-textarea',
        'textarea.comment-input'
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            // 如果找到的是CodeMirror容器，找到其父容器
            if (element.classList.contains('CodeMirror')) {
                return element.closest('.g-discussion-item') || element.closest('.dp-md-editor');
            }
            return element;
        }
    }

    return null;
}

function insertComment(commentSection, comment) {
    // 在指定的评论区域内查找编辑器
    const codeMirror = commentSection.querySelector('.CodeMirror');
    const textarea = commentSection.querySelector('textarea');

    if (codeMirror) {
        // 方法1: 尝试通过CodeMirror API
        const success = tryCodeMirrorAPI(codeMirror, comment);
        if (!success) {
            // 方法2: 尝试模拟键盘事件
            simulateKeyboardInput(codeMirror, comment);
        }
    } else if (textarea) {
        // 普通textarea处理
        insertIntoTextarea(textarea, comment);
    }
}

function tryCodeMirrorAPI(codeMirror, comment) {
    // 尝试多种方式获取CodeMirror实例
    let cm = null;

    // 方法1: 直接访问
    if (codeMirror.CodeMirror) {
        cm = codeMirror.CodeMirror;
    }

    // 方法2: 通过属性访问
    if (!cm && codeMirror.cm) {
        cm = codeMirror.cm;
    }

    // 方法3: 通过数据属性访问
    if (!cm) {
        cm = codeMirror.__CodeMirror__;
    }

    if (cm && typeof cm.setValue === 'function') {
        try {
            const currentValue = cm.getValue() || '';
            const newValue = currentValue.trim() ? currentValue + '\n' + comment : comment;

            // 设置新值
            cm.setValue(newValue);

            // 移动光标到末尾
            cm.setCursor(cm.lineCount(), 0);

            // 聚焦到编辑器
            cm.focus();

            // 刷新显示
            cm.refresh();

            console.log('Text inserted via CodeMirror API:', newValue);
            return true;
        } catch (error) {
            console.error('CodeMirror API error:', error);
        }
    }

    return false;
}

function simulateKeyboardInput(codeMirror, comment) {
    // 查找隐藏的textarea
    const hiddenTextarea = codeMirror.querySelector('textarea');
    if (!hiddenTextarea) {
        console.error('Hidden textarea not found');
        return;
    }

    // 聚焦到编辑器
    hiddenTextarea.focus();

    // 获取当前值
    const currentValue = hiddenTextarea.value || '';

    // 如果当前行不为空，先模拟按回车键
    if (currentValue.trim()) {
        // 模拟按下回车键
        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        hiddenTextarea.dispatchEvent(enterEvent);

        // 模拟释放回车键
        const enterUpEvent = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        hiddenTextarea.dispatchEvent(enterUpEvent);
    }

    // 逐个字符输入
    setTimeout(() => {
        for (let i = 0; i < comment.length; i++) {
            setTimeout(() => {
                const char = comment[i];

                // 模拟按下字符键
                const keyDownEvent = new KeyboardEvent('keydown', {
                    key: char,
                    code: `Key${char.toUpperCase()}`,
                    keyCode: char.charCodeAt(0),
                    which: char.charCodeAt(0),
                    bubbles: true,
                    cancelable: true
                });
                hiddenTextarea.dispatchEvent(keyDownEvent);

                // 模拟按下字符键
                const keyPressEvent = new KeyboardEvent('keypress', {
                    key: char,
                    code: `Key${char.toUpperCase()}`,
                    keyCode: char.charCodeAt(0),
                    which: char.charCodeAt(0),
                    bubbles: true,
                    cancelable: true
                });
                hiddenTextarea.dispatchEvent(keyPressEvent);

                // 模拟输入事件
                const inputEvent = new InputEvent('input', {
                    data: char,
                    bubbles: true,
                    cancelable: true
                });
                hiddenTextarea.dispatchEvent(inputEvent);

                // 模拟释放字符键
                const keyUpEvent = new KeyboardEvent('keyup', {
                    key: char,
                    code: `Key${char.toUpperCase()}`,
                    keyCode: char.charCodeAt(0),
                    which: char.charCodeAt(0),
                    bubbles: true,
                    cancelable: true
                });
                hiddenTextarea.dispatchEvent(keyUpEvent);

                // 更新textarea值
                hiddenTextarea.value += char;

            }, i * 50); // 每个字符间隔50ms
        }

        console.log('Text inserted via keyboard simulation:', comment);
    }, 100);
}

function insertIntoTextarea(textarea, comment) {
    // 如果已经有内容，添加换行
    if (textarea.value.trim()) {
        textarea.value += '\n' + comment;
    } else {
        textarea.value = comment;
    }

    // 聚焦到评论框
    textarea.focus();

    // 触发多个事件，确保页面检测到变化
    const events = ['input', 'change', 'keyup'];
    events.forEach(eventType => {
        const event = new Event(eventType, { bubbles: true });
        textarea.dispatchEvent(event);
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

function createQuickCommentMenu(button, commentSection) {
    const menu = document.createElement('div');
    menu.className = 'quick-comment-menu';
    
    const menuItems = [
        { label: '/approve', value: '/approve' },
        { label: '/label add triaged', value: '/label add triaged' },
        { label: '/label add feature', value: '/label add feature' },
        { label: '/check-pr', value: '/check-pr' },
        { label: '收到反馈，感谢！', value: '收到反馈，感谢！我会尽快查看并回复进展。' }
    ];
    
    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'quick-comment-menu-item';
        menuItem.textContent = item.label;
        menuItem.onclick = function() {
            console.log('Quick comment selected:', item.value);
            insertComment(commentSection, item.value);
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
