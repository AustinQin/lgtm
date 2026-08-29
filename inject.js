(function() {
    if (window.__gitCodeQuickCommentHelper) return;

    const EDITOR_ID_ATTRIBUTE = 'data-gitcode-quick-comment-editor-id';
    const INSERT_REQUEST_EVENT = 'gitCodeQuickCommentMessage';
    const INSERT_RESPONSE_EVENT = 'gitCodeQuickCommentResponse';

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
        const codeMirrorElement = editor.querySelector('.CodeMirror');
        const codeMirror = codeMirrorElement && (
            codeMirrorElement.CodeMirror ||
            codeMirrorElement.cm ||
            codeMirrorElement.__CodeMirror__
        );

        if (!codeMirror || typeof codeMirror.setValue !== 'function') return false;

        const currentValue = codeMirror.getValue() || '';
        const newValue = currentValue.trim() ? `${currentValue}\n${comment}` : comment;

        codeMirror.setValue(newValue);
        codeMirror.setCursor(codeMirror.posFromIndex(newValue.length));
        codeMirror.focus();
        codeMirror.refresh();
        return true;
    }

    function parseEventDetail(detail) {
        try {
            return typeof detail === 'string' ? JSON.parse(detail) : detail;
        } catch (error) {
            return null;
        }
    }

    window.__gitCodeQuickCommentHelper = { appendComment };

    window.addEventListener(INSERT_REQUEST_EVENT, event => {
        const request = parseEventDetail(event.detail);
        if (!request?.editorId || typeof request.comment !== 'string') return;

        const editor = document.querySelector(
            `[${EDITOR_ID_ATTRIBUTE}="${request.editorId}"]`
        );
        const success = Boolean(editor && appendComment(editor, request.comment));

        window.dispatchEvent(new CustomEvent(INSERT_RESPONSE_EVENT, {
            detail: JSON.stringify({ success })
        }));
    });
})();
