// 页面环境中的辅助代码
(function() {
    // 避免重复初始化
    if (window.__gitCodeQuickCommentHelper) {
        return;
    }

    window.__gitCodeQuickCommentHelper = {
        insertTextToCodeMirror: function(comment) {
            try {
                const commentSections = document.querySelectorAll('.g-discussion-item');
                if (commentSections.length === 0) {
                    return false;
                }
                
                const lastSection = commentSections[commentSections.length - 1];
                const codeMirror = lastSection.querySelector('.CodeMirror');
                
                if (!codeMirror) {
                    return false;
                }
                
                // 尝试获取CodeMirror实例
                let cm = null;
                if (codeMirror.CodeMirror) {
                    cm = codeMirror.CodeMirror;
                } else if (codeMirror.cm) {
                    cm = codeMirror.cm;
                } else if (codeMirror.__CodeMirror__) {
                    cm = codeMirror.__CodeMirror__;
                }
                
                if (cm && typeof cm.setValue === 'function') {
                    const currentValue = cm.getValue() || '';
                    const newValue = currentValue.trim() ? currentValue + '\n' + comment : comment;
                    
                    cm.setValue(newValue);
                    cm.setCursor(cm.lineCount(), 0);
                    cm.focus();
                    cm.refresh();
                    
                    return true;
                }
                
                return false;
            } catch (error) {
                return false;
            }
        }
    };

    // 监听来自 content script 的消息
    window.addEventListener('gitCodeQuickCommentMessage', function(event) {
        const detail = event.detail;
        
        if (detail.action === 'insertText') {
            const result = window.__gitCodeQuickCommentHelper.insertTextToCodeMirror(detail.comment);
            
            // 发送结果回 content script
            window.dispatchEvent(new CustomEvent('gitCodeQuickCommentResponse', {
                detail: {
                    action: 'insertText',
                    success: result
                }
            }));
        }
    });
})();