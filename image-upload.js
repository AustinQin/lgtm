const IssueImageUpload = (() => {
    function resolveNuxtValue(data, value) {
        const seen = new Set();
        let current = value;
        while (true) {
            if (Array.isArray(current) && current.length === 2 && typeof current[0] === 'string' && typeof current[1] === 'number') {
                current = current[1];
                continue;
            }
            if (typeof current !== 'number') return current;
            if (seen.has(current) || current < 0 || current >= data.length) return null;
            seen.add(current);
            const next = data[current];
            if (typeof next === 'number') return next;
            current = next;
        }
    }

    function repositoryIdFromNuxt(data, repository) {
        if (!Array.isArray(data)) return null;
        const key = `repo-base:${repository}`;
        let entry;
        for (const item of data) {
            if (item && typeof item === 'object' && !Array.isArray(item) && Object.hasOwn(item, key)) {
                entry = item[key];
                break;
            }
        }
        if (entry === undefined) return null;
        const repo = resolveNuxtValue(data, entry);
        if (!repo || typeof repo !== 'object' || Array.isArray(repo)) return null;
        const pathKey = repo.pathWithNamespace !== undefined ? 'pathWithNamespace' : 'path_with_namespace';
        const repoPath = resolveNuxtValue(data, repo[pathKey]);
        if (repoPath !== null && repoPath !== repository) return null;
        const id = resolveNuxtValue(data, repo.id);
        return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
    }

    function repositoryId(repository) {
        const source = document.querySelector('#__NUXT_DATA__')?.textContent;
        if (!source) return null;
        try {
            return repositoryIdFromNuxt(JSON.parse(source), repository);
        } catch {
            return null;
        }
    }

    function markdownLabel(value) {
        return String(value || 'image.png')
            .replace(/[\r\n]+/g, ' ')
            .replace(/[[\]']/g, ' ')
            .trim() || 'image.png';
    }

    function buildImageMarkdown(path, fileName, repositoryId) {
        const cleanPath = String(path || '').replace(/^\/+/, '').replace(/^uploads\//, '');
        if (!cleanPath || !repositoryId) return null;
        const label = markdownLabel(fileName);
        return `![${label}](https://raw.gitcode.com/user-images/assets/${repositoryId}/${cleanPath} '${label}')`;
    }

    function readAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                const comma = result.indexOf(',');
                if (comma < 0) reject(new Error('无法读取图片，请重试。'));
                else resolve(result.slice(comma + 1));
            };
            reader.onerror = () => reject(new Error('无法读取图片，请重试。'));
            reader.readAsDataURL(file);
        });
    }

    async function upload(file, repository) {
        if (!file || !String(file.type || '').startsWith('image/')) throw new Error('仅支持图片文件。');
        const repoId = repositoryId(repository);
        if (!repoId) throw new Error('无法识别当前仓库，图片上传失败。');
        const attach = await readAsBase64(file);
        const response = await fetch(`https://gitcode.com/${repository}/uploads/image_file`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ attach, file_name: file.name || 'image.png' })
        });
        if (response.status === 401 || response.status === 403) {
            throw new Error('图片上传失败，请确认已登录 GitCode。');
        }
        if (!response.ok) throw new Error(`图片上传失败（HTTP ${response.status}）。`);
        let payload;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        if (!payload?.success || typeof payload.path !== 'string' || !payload.path) {
            throw new Error('图片上传失败，请重试。');
        }
        const markdown = buildImageMarkdown(payload.path, file.name || 'image.png', repoId);
        if (!markdown) throw new Error('图片上传失败，请重试。');
        return markdown;
    }

    return { repositoryIdFromNuxt, buildImageMarkdown, upload };
})();
