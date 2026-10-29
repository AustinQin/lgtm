const IssueResolveForm = (() => {
    const changeTypes = ['使用方式变化', 'UI 变化', '接口 / 行为变化', '性能变化', '兼容性变化', '其他'];
    const sections = [
        { title: '缺陷引入', optional: true, fields: [
            { id: 'introduced', label: 'Commit 或 PR 编号', type: 'text',
                help: '7–40 位 commit SHA 或 #123；多个值用英文逗号分隔。', placeholder: '例如 3f2a9c1 或 #123' },
            { id: 'prLinks', label: 'PR 链接', type: 'textarea',
                help: '完整链接，每行一个；无对应 PR 可留空。', placeholder: 'https://gitcode.com/组织/仓库/pull/123' },
            { id: 'milestone', label: '里程碑', type: 'text',
                help: '填写里程碑或版本号；没有可留空。', placeholder: '例如 v1.2.0 或 2026Q4' }
        ] },
        { title: '原因分析', fields: [
            { id: 'rootCause', label: '引入缺陷的原因', required: true, type: 'textarea',
                help: '说明触发条件、根因和影响范围，可附关键代码、日志或复现步骤。',
                placeholder: '触发条件：\n根因：\n影响范围：\n关键代码 / 日志：' }
        ] },
        { title: '修复方案', optional: true, fields: [
            { id: 'fixSummary', label: '修复说明', type: 'textarea',
                help: '简述修复思路和改动范围，详细信息可参考关联 PR。', placeholder: '修复思路：\n改动范围：\n风险点：' }
        ] },
        { title: '用户感知', fields: [
            { id: 'userVisible', label: '是否引入用户可感知变更', required: true, type: 'radio', options: ['是', '否'] },
            { id: 'changeTypes', label: '可感知变更类型', type: 'checkbox', options: changeTypes, conditional: true,
                help: '可多选。' },
            { id: 'changeDetail', label: '变更说明', required: true, type: 'textarea', conditional: true,
                help: '说明用户可见的具体变化。', placeholder: '例如设置页新增“自动更新”开关，默认开启。' }
        ] },
        { title: '测试回归版本', fields: [
            { id: 'buildType', label: '回归包类型', required: true, type: 'radio', options: ['daily', 'tag'] },
            { id: 'buildVersion', label: '包名 / 版本号', type: 'text', placeholder: '例如 xxx-daily-20261029 或 v1.2.3' },
            { id: 'buildLink', label: '回归包链接', type: 'text',
                help: '版本号和链接至少填写一项，建议同时填写。可使用华为云 OBS 链接。', placeholder: 'https://…' }
        ] },
        { title: '关联组件', optional: true, fields: [
            { id: 'components', label: '关联组件版本号 / 链接', type: 'textarea',
                help: '填写本仓库外需配套升级的组件；多个组件每行一个，无则留空。', placeholder: '组件名 / 版本号 / 链接' }
        ] },
        { title: '自测验证', fields: [
            { id: 'evidence', label: '自测截图与结论', required: true, type: 'textarea',
                help: '填写环境、步骤和结果。截图可在生成后的评论框中添加；无截图时提供自测命令、用例与结论。',
                placeholder: '自测环境：\n自测步骤 / 命令：\n自测结果：' }
        ] }
    ];
    const fields = sections.flatMap(section => section.fields);
    let active = null;
    let opening = false;
    const pendingWrites = new Map();

    function normalize(values = {}) {
        const result = {};
        for (const field of fields) {
            const value = values?.[field.id];
            result[field.id] = field.type === 'checkbox'
                ? field.options.filter(option => Array.isArray(value) && value.includes(option))
                : typeof value === 'string' && (!field.options || field.options.includes(value)) ? value : '';
        }
        return result;
    }

    function isWebUrl(value) {
        try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
    }

    function validate(values) {
        const data = normalize(values);
        const errors = {};
        for (const field of fields) {
            if (field.required && (!field.conditional || data.userVisible === '是') && !data[field.id].trim()) {
                errors[field.id] = `请填写${field.label}。`;
            }
        }
        if (data.introduced.trim() && !data.introduced.split(',').every(value => /^(?:[a-f\d]{7,40}|#[1-9]\d*)$/i.test(value.trim()))) {
            errors.introduced = '请输入 7–40 位 commit SHA 或 #123，多个值用英文逗号分隔。';
        }
        if (data.prLinks.trim() && data.prLinks.trim() !== '无' && !data.prLinks.trim().split(/\r?\n/).every(line => isWebUrl(line.trim()))) {
            errors.prLinks = '请每行填写一个完整的 http(s) 链接；没有则填写“无”。';
        }
        if (!data.buildVersion.trim() && !data.buildLink.trim()) errors.buildVersion = '版本号和回归包链接至少填写一项。';
        if (data.buildLink.trim() && !isWebUrl(data.buildLink.trim())) errors.buildLink = '请输入完整的 http(s) 链接。';
        return errors;
    }

    function buildMarkdown(values) {
        const data = normalize(values);
        // Keep literal separators and multiline values inside a single table cell.
        const cell = value => value.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/\\/g, '&#92;').replace(/\|/g, '&#124;')
            .replace(/\r\n?|\n/g, '<br>');
        const rows = [
            ['缺陷引入 Commit / PR', data.introduced],
            ['PR 链接', data.prLinks],
            ['里程碑', data.milestone],
            ['用户可感知变更', data.userVisible],
            ['变更类型', data.userVisible === '是' ? data.changeTypes.join('、') : ''],
            ['回归包类型', data.buildType],
            ['包名 / 版本号', data.buildVersion],
            ['回归包链接', data.buildLink],
            ['关联组件', data.components]
        ].filter(([, value]) => value.trim()).map(([label, value]) => `| ${label} | ${cell(value)} |`);
        const table = ['| 信息 | 内容 |', '| --- | --- |', ...rows].join('\n');
        const body = [
            ['原因分析', data.rootCause],
            ['修复方案', data.fixSummary],
            ['用户感知变更说明', data.userVisible === '是' ? data.changeDetail : ''],
            ['自测验证', data.evidence]
        ].filter(([, value]) => value.trim()).map(([title, value]) => `## ${title}\n\n${value.trim()}`);
        return ['# 缺陷关闭', table, ...body].join('\n\n') + '\n';
    }

    function draftKey(context, draftId) {
        const base = `issue-resolve:v1:${context.repository}:${context.issue}`;
        return draftId ? `${base}:${draftId}` : base;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    async function open({ context, isCurrent, onInsert, onSuccess, schema }) {
        if (active) { active.focus(); return; }
        if (opening) return;
        opening = true;
        const model = schema || { sections, normalize, validate, buildMarkdown,
            isVisible: (field, data) => !field.conditional || data.userVisible === '是' };
        const key = draftKey(context, model.draftId);
        let draft;
        let storageAvailable = true;
        try {
            await pendingWrites.get(key);
            draft = (await chrome.storage.local.get(key))[key];
        } catch {
            storageAvailable = false;
        } finally {
            opening = false;
        }
        if (!isCurrent()) return;

        let data = model.normalize(draft?.values);
        let errors = {};
        let submitting = false;
        let closed = false;
        let saveTimer;
        const previousFocus = document.activeElement;
        const dialog = element('dialog', 'qc-resolve-dialog');
        dialog.setAttribute('aria-labelledby', 'qc-resolve-title');
        const form = element('form', 'qc-resolve-form');
        form.noValidate = true;
        const header = element('header', 'qc-resolve-header');
        const title = element('h2', '', '填写关单说明');
        title.id = 'qc-resolve-title';
        const closeButton = element('button', 'qc-resolve-close');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', '保存草稿并关闭');
        const closeIcon = element('span', 'qc-resolve-close-icon');
        closeIcon.setAttribute('aria-hidden', 'true');
        closeButton.append(closeIcon);
        header.append(title, closeButton);

        const body = element('div', 'qc-resolve-body');
        const controls = new Map();
        const groups = new Map();

        model.sections.forEach((section, index) => {
            const group = element(section.optional ? 'details' : 'section', 'qc-resolve-section');
            if (section.optional) group.open = section.fields.some(field =>
                Array.isArray(data[field.id]) ? data[field.id].length : data[field.id].trim());
            const sectionTitle = element(section.optional ? 'summary' : 'h3', 'qc-resolve-section-title');
            sectionTitle.append(element('span', 'qc-resolve-number', String(index + 1).padStart(2, '0')),
                element('span', '', section.title), element('span', 'qc-resolve-optional', section.optional ? '可选 · 展开填写' : section.fields.length ? '必填' : ''));
            group.append(sectionTitle);
            if (section.description) group.append(element('p', 'qc-resolve-description', section.description));
            const grid = element('div', 'qc-resolve-fields');
            for (const field of section.fields) {
                const wrapper = element('div', 'qc-resolve-field');
                const id = `qc-resolve-${field.id}`;
                const label = element(field.options ? 'div' : 'label', 'qc-resolve-label', field.label);
                label.id = `${id}-label`;
                if (!field.options) label.htmlFor = id;
                if (field.required) label.append(element('span', 'qc-resolve-required', ' *'));
                wrapper.append(label);
                const inputs = [];
                if (field.options) {
                    const choices = element('div', 'qc-resolve-choices');
                    choices.setAttribute('role', field.type === 'radio' ? 'radiogroup' : 'group');
                    choices.setAttribute('aria-labelledby', label.id);
                    field.options.forEach(option => {
                        const choice = element('label', 'qc-resolve-choice');
                        const input = element('input');
                        input.type = field.type;
                        input.name = field.id;
                        input.value = option;
                        input.checked = field.type === 'checkbox' ? data[field.id].includes(option) : data[field.id] === option;
                        choice.append(input, element('span', '', option + (field.requiredOptions?.includes(option) ? ' *' : '')));
                        choices.append(choice);
                        inputs.push(input);
                    });
                    wrapper.append(choices);
                } else {
                    const input = element(field.type === 'textarea' ? 'textarea' : 'input', 'qc-resolve-input');
                    input.id = id;
                    input.name = field.id;
                    if (field.type === 'text') input.type = 'text';
                    else input.rows = schema || ['rootCause', 'evidence'].includes(field.id) ? 4 : 2;
                    input.value = data[field.id];
                    input.placeholder = field.placeholder || '';
                    wrapper.append(input);
                    inputs.push(input);
                }
                const help = element('p', 'qc-resolve-help', field.help || '');
                help.id = `${id}-help`;
                const error = element('p', 'qc-resolve-error');
                error.id = `${id}-error`;
                error.setAttribute('aria-live', 'polite');
                inputs.forEach(input => input.setAttribute('aria-describedby', `${help.id} ${error.id}`));
                wrapper.append(help, error);
                controls.set(field.id, { field, wrapper, inputs, error });
                groups.set(field.id, group);
                grid.append(wrapper);
            }
            group.append(grid);
            body.append(group);
        });

        const footer = element('footer', 'qc-resolve-footer');
        const footerInfo = element('div', 'qc-resolve-footer-info');
        const draftStatus = element('span', 'qc-resolve-draft', storageAvailable
            ? draft ? '已恢复此 Issue 的本地草稿' : '草稿自动保存在本机' : '无法读取本地草稿，请勿关闭页面');
        const formError = element('p', 'qc-resolve-error');
        formError.setAttribute('role', 'alert');
        footerInfo.append(draftStatus, element('small', '', '填入后可补充截图，检查后手动提交'), formError);
        const actions = element('div', 'qc-resolve-actions');
        const cancelButton = element('button', 'qc-resolve-secondary', '保存并关闭');
        cancelButton.type = 'button';
        const submitButton = element('button', 'qc-resolve-primary', '填入评论框');
        submitButton.type = 'submit';
        actions.append(cancelButton, submitButton);
        footer.append(footerInfo, actions);
        form.append(header, body, footer);
        dialog.append(form);

        function readValues() {
            for (const [id, { field, inputs }] of controls) {
                data[id] = field.type === 'checkbox' ? inputs.filter(input => input.checked).map(input => input.value)
                    : field.type === 'radio' ? inputs.find(input => input.checked)?.value || '' : inputs[0].value;
            }
        }

        function update() {
            for (const [id, { field, wrapper, inputs, error }] of controls) {
                const visible = model.isVisible(field, data);
                wrapper.hidden = !visible;
                inputs.forEach(input => {
                    input.disabled = !visible || submitting;
                    input.setAttribute('aria-invalid', String(visible && Boolean(errors[id])));
                    input.setAttribute('aria-required', String(visible && Boolean(field.required)));
                });
                error.textContent = visible ? errors[id] || '' : '';
            }
        }

        function save() {
            clearTimeout(saveTimer);
            const snapshot = { values: model.normalize(data), updatedAt: Date.now() };
            // Serialize writes so a slow older save cannot overwrite a newer draft.
            const writes = (pendingWrites.get(key) || Promise.resolve()).then(() => chrome.storage.local.set({ [key]: snapshot })).then(() => {
                draftStatus.textContent = '草稿已保存在本机';
            }).catch(() => { draftStatus.textContent = '草稿保存失败，请保留当前页面'; });
            pendingWrites.set(key, writes);
            return writes;
        }

        function close() {
            if (closed) return;
            closed = true;
            readValues();
            save();
            window.removeEventListener('pagehide', save);
            dialog.close();
            dialog.remove();
            active = null;
            if (previousFocus?.isConnected) previousFocus.focus();
        }

        form.addEventListener('input', () => {
            readValues();
            const nextErrors = model.validate(data);
            errors = Object.fromEntries(Object.keys(errors).filter(id => nextErrors[id]).map(id => [id, nextErrors[id]]));
            formError.textContent = '';
            update();
            clearTimeout(saveTimer);
            draftStatus.textContent = '正在保存草稿…';
            saveTimer = setTimeout(save, 250);
        });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (submitting) return;
            readValues();
            errors = model.validate(data);
            update();
            const firstInvalid = Object.keys(errors)[0];
            if (firstInvalid) {
                const group = groups.get(firstInvalid);
                if (group.tagName === 'DETAILS') group.open = true;
                controls.get(firstInvalid).inputs[0].focus();
                formError.textContent = '请完善标出的字段，再填入评论框。';
                return;
            }
            if (!isCurrent()) { close(); return; }
            submitting = true;
            submitButton.disabled = true;
            cancelButton.disabled = true;
            closeButton.disabled = true;
            submitButton.textContent = '正在填入…';
            update();
            await save();
            if (closed) return;
            try {
                await onInsert(model.buildMarkdown(data));
                close();
                onSuccess();
            } catch (error) {
                formError.textContent = error.message || '填入失败，请重试。';
            } finally {
                submitting = false;
                submitButton.disabled = false;
                cancelButton.disabled = false;
                closeButton.disabled = false;
                submitButton.textContent = '填入评论框';
                update();
            }
        });
        closeButton.addEventListener('click', close);
        cancelButton.addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); if (!submitting) close(); });
        window.addEventListener('pagehide', save);
        const focusFirstField = () => [...dialog.querySelectorAll('input, textarea')]
            .find(input => !input.disabled && input.getClientRects().length > 0)?.focus();
        active = { isCurrent, close, focus: focusFirstField };
        update();
        document.body.appendChild(dialog);
        dialog.showModal();
        focusFirstField();
    }

    function checkContext() {
        if (active && !active.isCurrent()) active.close();
    }

    return { open, checkContext, normalize, validate, buildMarkdown, draftKey };
})();
