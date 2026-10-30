(function() {
    if (window.__gitCodeQuickCommentHelper) return;

    const EDITOR_ID_ATTRIBUTE = 'data-gitcode-quick-comment-editor-id';
    const INSERT_REQUEST_EVENT = 'gitCodeQuickCommentMessage';
    const INSERT_RESPONSE_EVENT = 'gitCodeQuickCommentResponse';
    let submissionPending = false;

    function appendComment(editor, comment) {
        return appendToCodeMirror6(editor, comment) || appendToCodeMirror5(editor, comment);
    }

    function appendToCodeMirror6(editor, comment) {
        const content = editor.querySelector('.cm-content[contenteditable="true"]');
        const view = findCodeMirror6View(content);

        if (!view?.state?.doc || typeof view.dispatch !== 'function') return false;

        const currentValue = view.state.doc.toString();
        const hasContent = Boolean(currentValue.trim());
        const insertion = hasContent ? `\n${comment}` : comment;
        const from = hasContent ? view.state.doc.length : 0;
        const cursor = from + insertion.length;

        view.dispatch({
            changes: { from, to: view.state.doc.length, insert: insertion },
            selection: { anchor: cursor },
            scrollIntoView: true
        });
        view.focus();
        return true;
    }

    function findCodeMirror6View(content) {
        if (!content) return null;

        const candidates = [content.cmTile, content.cmView];
        Object.getOwnPropertyNames(content).forEach(property => {
            try {
                candidates.push(content[property]);
            } catch (error) {
                // Ignore browser-managed DOM properties that cannot be read.
            }
        });

        for (const candidate of candidates) {
            const view = candidate?.view || candidate;
            if (view?.state?.doc && typeof view.dispatch === 'function') return view;
        }
        return null;
    }

    function appendToCodeMirror5(editor, comment) {
        const codeMirror = findCodeMirror5(editor);

        if (!codeMirror || typeof codeMirror.setValue !== 'function') return false;

        const currentValue = codeMirror.getValue() || '';
        const newValue = currentValue.trim() ? `${currentValue}\n${comment}` : comment;

        codeMirror.setValue(newValue);
        codeMirror.setCursor(codeMirror.posFromIndex(newValue.length));
        codeMirror.focus();
        codeMirror.refresh();
        return true;
    }

    function findCodeMirror5(editor) {
        const element = editor.querySelector('.CodeMirror');
        return element && (element.CodeMirror || element.cm || element.__CodeMirror__);
    }

    function readComment(editor) {
        const view = findCodeMirror6View(editor.querySelector('.cm-content[contenteditable="true"]'));
        if (view?.state?.doc) return view.state.doc.toString();
        const codeMirror = findCodeMirror5(editor);
        return typeof codeMirror?.getValue === 'function' ? codeMirror.getValue() : null;
    }

    function findSubmitButton(editor) {
        const modern = editor.querySelector('.comment-editor__submit');
        const candidates = [...(modern || editor).querySelectorAll(modern
            ? 'button' : '.edit-area_actions button.devui-button--solid--primary')]
            .filter(button => !button.closest('.quick-comment-buttons') &&
                !button.classList.contains('cancel-btn') && button.getClientRects().length &&
                !/关闭|合并|取消|close|merge|cancel/i.test(
                    `${button.textContent} ${button.getAttribute('aria-label') || ''}`));
        // Never guess between multiple native actions (for example, comment and review).
        return candidates.length === 1 ? candidates[0] : null;
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function submitComment(editor, request) {
        if (submissionPending) throw new Error('正在提交评论，请稍候。');
        const pathname = request.pathname;
        const isCurrent = () => editor.isConnected && location.pathname === pathname;
        if (!/^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(pathname || '') || !isCurrent()) {
            throw new Error('页面已切换，请在当前 PR 重新操作。');
        }
        const value = readComment(editor);
        if (value === null) throw new Error('无法读取评论框，请刷新页面后重试。');
        if (value.trim()) throw new Error('评论框中已有内容，请先提交或清空。');
        if (!findSubmitButton(editor)) throw new Error('无法确定评论提交按钮，请手动提交。');

        submissionPending = true;
        try {
            if (!appendComment(editor, request.comment)) throw new Error('无法填入评论框，请刷新页面后重试。');
            const readyDeadline = Date.now() + 3000;
            let sendButton;
            while (Date.now() < readyDeadline) {
                if (!isCurrent()) throw new Error('页面已切换，已停止自动提交。');
                if (readComment(editor) !== request.comment) throw new Error('评论内容已变化，已停止自动提交，请检查后手动提交。');
                sendButton = findSubmitButton(editor);
                if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true' &&
                    sendButton.getAttribute('aria-busy') !== 'true') break;
                sendButton = null;
                await delay(50);
            }
            if (!sendButton) throw new Error('提交按钮暂不可用，命令已保留在输入框，请检查后手动提交。');
            sendButton.click();

            // GitCode owns the network request. Do not retry when its result is uncertain.
            const submittedDeadline = Date.now() + 15000;
            while (Date.now() < submittedDeadline) {
                if (!isCurrent()) throw new Error('页面已切换，无法确认提交结果，请检查原 PR 的评论列表。');
                if (readComment(editor) === '') {
                    await delay(1000);
                    return;
                }
                await delay(100);
            }
            throw new Error('无法确认提交结果，请检查 GitCode 的提示、评论列表和输入框，避免重复提交。');
        } finally {
            submissionPending = false;
        }
    }

    function parseEventDetail(detail) {
        try {
            return typeof detail === 'string' ? JSON.parse(detail) : detail;
        } catch (error) {
            return null;
        }
    }

    window.__gitCodeQuickCommentHelper = { appendComment };

    window.addEventListener(INSERT_REQUEST_EVENT, async event => {
        const request = parseEventDetail(event.detail);
        if (!request?.editorId || typeof request.comment !== 'string') return;

        let success = false;
        let error;
        try {
            const editor = document.querySelector(
                `[${EDITOR_ID_ATTRIBUTE}="${request.editorId}"]`
            );
            if (!editor) throw new Error('评论框已不可用，请刷新页面后重试。');
            if (request.action === 'submit') {
                if (!['/check-pr', 'compile', 'retry', '/approve', '/lgtm'].includes(request.comment)) {
                    throw new Error('不支持此快捷提交命令。');
                }
                await submitComment(editor, request);
                success = true;
            } else {
                success = appendComment(editor, request.comment);
            }
        } catch (cause) {
            error = cause.message;
        }

        window.dispatchEvent(new CustomEvent(INSERT_RESPONSE_EVENT, {
            detail: JSON.stringify({ success, error, requestId: request.requestId })
        }));
    });
})();
