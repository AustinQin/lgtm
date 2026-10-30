const IssueTemplate = (() => {
    const MAX_TEMPLATE_LENGTH = 128 * 1024;
    const reservedIds = new Set(['constructor', 'prototype', '__proto__']);

    function fail(message) {
        throw new Error(`YAML 模板格式错误：${message}`);
    }

    function text(value, name, required = false) {
        if (value === undefined && !required) return '';
        if (typeof value !== 'string' || (required && !value.trim())) fail(`${name} 必须为文本`);
        return value;
    }

    function boolean(value, name) {
        if (value !== undefined && typeof value !== 'boolean') fail(`${name} 必须为 true 或 false`);
        return value === true;
    }

    function tableCell(value) {
        return value.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\\/g, '&#92;').replace(/\|/g, '&#124;').replace(/\r\n?|\n/g, '<br>');
    }

    async function parseYaml(source) {
        if (typeof source !== 'string' || source.length > MAX_TEMPLATE_LENGTH) fail('文件过大');
        // CORE_SCHEMA accepts ordinary YAML data only, never executable/custom tags.
        const document = jsyaml.load(source, { schema: jsyaml.CORE_SCHEMA });
        if (!document || !Array.isArray(document.body) || document.body.length > 80) fail('body 必须为最多 80 项的数组');
        const sections = [];
        const ids = new Set();
        let section;
        const newSection = title => {
            section = { title, description: '', fields: [] };
            sections.push(section);
        };

        for (const item of document.body) {
            if (!item || typeof item !== 'object' || !item.attributes || typeof item.attributes !== 'object') fail('每项需要 type 和 attributes');
            const attributes = item.attributes;
            if (item.type === 'markdown') {
                const value = text(attributes.value, 'markdown.value', true).trim();
                const lines = value.split(/\r?\n/);
                if (/^#{1,6}\s+/.test(lines[0])) {
                    newSection(lines.shift().replace(/^#{1,6}\s+/, '').replace(/^\d+[.、]\s*/, '')
                        .replace(/（(?:必填|可选)）$/, '').trim());
                    section.description = lines.join('\n').trim();
                } else {
                    if (!section) newSection('填写说明');
                    section.description = [section.description, value].filter(Boolean).join('\n\n');
                }
                continue;
            }

            if (!['input', 'textarea', 'dropdown', 'checkboxes'].includes(item.type)) fail(`不支持字段类型 ${item.type}`);
            const id = text(item.id, '字段 id', true);
            if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || reservedIds.has(id) || ids.has(id)) fail(`字段 id 不合法或重复：${id}`);
            ids.add(id);
            const label = text(attributes.label, 'label', true).replace(/[\r\n]+/g, ' ');
            const field = {
                id, label,
                required: boolean(item.validations?.required, 'validations.required'),
                help: text(attributes.description, 'description'),
                placeholder: text(attributes.placeholder, 'placeholder')
            };
            if (item.type === 'input' || item.type === 'textarea') {
                field.type = item.type === 'input' ? 'text' : 'textarea';
                field.initial = text(attributes.value, 'value');
            } else {
                const multiple = item.type === 'checkboxes' || boolean(attributes.multiple, 'multiple');
                field.type = multiple ? 'checkbox' : 'radio';
                if (!Array.isArray(attributes.options) || !attributes.options.length || attributes.options.length > 50) fail('选项数量必须为 1–50');
                field.options = attributes.options.map(option => text(item.type === 'checkboxes' ? option?.label : option, 'option', true));
                if (new Set(field.options).size !== field.options.length) fail('选项不能重复');
                field.requiredOptions = item.type === 'checkboxes'
                    ? attributes.options.filter(option => boolean(option.required, 'option.required')).map(option => option.label) : [];
                if (field.requiredOptions.length) field.required = true;
                field.initial = multiple ? [] : '';
                if (attributes.default !== undefined) {
                    const defaults = Array.isArray(attributes.default) ? attributes.default : [attributes.default];
                    if ((!multiple && defaults.length !== 1) || defaults.some(index => !Number.isInteger(index) || index < 0 || index >= field.options.length)) fail('default 必须是有效的选项下标');
                    field.initial = multiple ? defaults.map(index => field.options[index]) : field.options[defaults[0]];
                }
            }
            if (!section || (!section.fields.length && section.title === '填写说明')) newSection('关单信息');
            section.fields.push(field);
        }
        const fields = sections.flatMap(group => group.fields);
        if (!fields.length) fail('至少需要一个可填写字段');
        sections.forEach(group => { group.optional = group.fields.length > 0 && group.fields.every(field => !field.required); });

        function normalize(values = {}) {
            const data = {};
            for (const field of fields) {
                const value = values && Object.hasOwn(values, field.id) ? values[field.id] : field.initial;
                data[field.id] = field.type === 'checkbox'
                    ? field.options.filter(option => Array.isArray(value) && value.includes(option))
                    : typeof value === 'string' && (!field.options || field.options.includes(value)) ? value : '';
            }
            return data;
        }

        function validate(values) {
            const data = normalize(values);
            const errors = {};
            for (const field of fields) {
                const value = data[field.id];
                if (field.required && !(Array.isArray(value) ? value.length : value.trim())) {
                    errors[field.id] = `请${field.options ? '选择' : '填写'}${field.label}。`;
                }
                if (field.requiredOptions?.some(option => !value.includes(option))) errors[field.id] = '请勾选标记为必选的选项。';
            }
            return errors;
        }

        function buildMarkdown(values) {
            const data = normalize(values);
            const rows = [];
            const body = [];
            for (const field of fields) {
                const value = Array.isArray(data[field.id]) ? data[field.id].join('、') : data[field.id].trim();
                if (!value) continue;
                if (field.type === 'textarea') body.push(`## ${field.label}\n\n${value}`);
                else rows.push(`| ${tableCell(field.label)} | ${tableCell(value)} |`);
            }
            const table = rows.length ? ['| 信息 | 内容 |', '| --- | --- |', ...rows].join('\n') : '';
            return ['# 关单说明', table, ...body].filter(Boolean).join('\n\n') + '\n';
        }

        // Changed field semantics must not silently reuse an older template's draft.
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sections)));
        const draftId = 'yaml:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        return { sections, normalize, validate, buildMarkdown, draftId, isVisible: () => true };
    }

    function resolveTemplatePath(source) {
        if (typeof source !== 'string' || source.length > MAX_TEMPLATE_LENGTH) return null;
        let config;
        try {
            config = jsyaml.load(source, { schema: jsyaml.CORE_SCHEMA });
        } catch {
            return null;
        }
        if (!config || typeof config !== 'object' || Array.isArray(config) || config.version !== 1) return null;
        const audit = config.audits?.bug_issue_close;
        if (!audit || typeof audit !== 'object' || Array.isArray(audit) || audit.enabled !== true) return null;
        if (typeof audit.template !== 'string') return null;
        const path = audit.template.trim();
        if (!path || path.length > 256 || path.startsWith('/') || path.includes('\\') ||
            /[\u0000-\u001f\u007f?#]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) ||
            path.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null;
        return path;
    }

    return { parseYaml, resolveTemplatePath };
})();
