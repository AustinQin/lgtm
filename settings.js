const QuickCommentSettings = (() => {
    const KEY = 'quickCommentSettings';
    const groups = {
        pull: [
            { id: '/check-pr', label: '/check-pr', mode: 'direct' },
            { id: 'compile', label: 'compile', mode: 'confirm' },
            { id: 'retry', label: 'retry', mode: 'direct' },
            { id: '/approve', label: '/approve', mode: 'confirm' },
            { id: '/lgtm', label: '/lgtm', mode: 'direct' }
        ],
        issue: [{ id: 'resolve', label: '关单说明' }, { id: 'more', label: '更多' }],
        replies: [
            ...['triage-review', 'triaged', 'pending', 'feature', 'resolved', 'stale', 'duplicated']
                .map(tag => ({ id: `/label add ${tag}`, label: `/label add ${tag}`, value: `/label add ${tag}` })),
            { id: 'thanks', label: '收到反馈，感谢！', value: '收到反馈，感谢！我会尽快查看并回复进展。' }
        ]
    };
    const modes = { insert: '填入评论框', direct: '直接提交', confirm: '确认后提交' };

    function normalize(input) {
        const raw = input && typeof input === 'object' ? input : {};
        const result = { enabled: raw.enabled !== false, groups: {} };
        for (const [name, definitions] of Object.entries(groups)) {
            const stored = Array.isArray(raw.groups?.[name]) ? raw.groups[name] : [];
            const seen = new Set();
            result.groups[name] = [];
            for (const row of [...stored, ...definitions]) {
                const definition = definitions.find(item => item.id === row?.id);
                if (!definition || seen.has(row.id)) continue;
                seen.add(row.id);
                const item = { id: row.id, visible: row.visible !== false };
                if (name === 'pull') {
                    item.mode = Object.hasOwn(modes, row.mode) ? row.mode : definition.mode;
                }
                result.groups[name].push(item);
            }
        }
        return result;
    }

    function items(settings, group) {
        return settings.groups[group].filter(item => item.visible).map(item => ({
            ...groups[group].find(definition => definition.id === item.id), ...item
        }));
    }

    function pageContext(url) {
        try {
            const parsed = new URL(url);
            if (parsed.origin !== 'https://gitcode.com') return { kind: 'unsupported' };
            const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)(?:\/|$)/);
            if (match) return { kind: match[3] === 'pull' ? 'pull' : 'issue', repository: `${match[1]}/${match[2]}`, number: match[4] };
            return { kind: 'gitcode' };
        } catch { return { kind: 'unsupported' }; }
    }

    return { KEY, groups, modes, normalize, items, pageContext };
})();
if (typeof module !== 'undefined') module.exports = QuickCommentSettings;
