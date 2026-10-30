const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({ crypto: webcrypto, TextEncoder, jsyaml: require('../vendor/js-yaml.min.js') });
vm.runInContext(readFileSync(require.resolve('../issue-template.js'), 'utf8'), context);
const parser = vm.runInContext('IssueTemplate', context);
const fixture = `
name: 关单模板
body:
  - type: markdown
    attributes:
      value: |
        ## 修复信息
        请填写版本与验证结果。
  - type: input
    id: version
    attributes:
      label: 修复版本
      placeholder: v1.2.0
    validations:
      required: true
  - type: textarea
    id: cause
    attributes:
      label: 原因分析
      value: |
        触发条件：
        根因：
  - type: dropdown
    id: kind
    attributes:
      label: 回归包类型
      options: [daily, tag]
      default: 1
    validations:
      required: true
  - type: dropdown
    id: platforms
    attributes:
      label: 验证平台
      multiple: true
      options: [Linux, Windows]
  - type: checkboxes
    id: checks
    attributes:
      label: 验证结果
      options:
        - label: 回归通过
          required: true
        - label: 文档已更新
`;

test('parses Issue Forms controls, defaults, descriptions and required options', async () => {
    const schema = await parser.parseYaml(fixture);
    const fields = schema.sections.flatMap(section => section.fields);
    assert.equal(fields.length, 5);
    assert.equal(schema.sections[0].title, '修复信息');
    assert.equal(schema.sections[0].description, '请填写版本与验证结果。');
    assert.equal(fields.find(field => field.id === 'platforms').type, 'checkbox');
    assert.equal(schema.normalize().kind, 'tag');
    assert.match(schema.normalize().cause, /触发条件：\n根因：/);
    assert.ok(schema.validate({}).version);
    assert.ok(schema.validate({ checks: ['文档已更新'] }).checks);
    assert.equal(Object.keys(schema.validate({ version: 'v1.2', checks: ['回归通过'] })).length, 0);
});

test('generates Chinese headings, summary rows and unmodified multiline Markdown', async () => {
    const schema = await parser.parseYaml(fixture);
    const result = schema.buildMarkdown({ version: 'v1|v2', cause: '```sh\nrun-test\n```',
        kind: 'daily', platforms: ['Linux', 'Windows'], checks: ['回归通过'] });
    assert.match(result, /^# 关单说明/);
    assert.match(result, /\| 修复版本 \| v1&#124;v2 \|/);
    assert.match(result, /\| 验证平台 \| Linux、Windows \|/);
    assert.match(result, /## 原因分析\n\n```sh\nrun-test\n```/);
    assert.doesNotMatch(result, /body:|validations:|请填写版本/);
});

test('normalizes stale options and isolates drafts when field semantics change', async () => {
    const original = await parser.parseYaml(fixture);
    const unchanged = await parser.parseYaml('# comment\n' + fixture);
    const changed = await parser.parseYaml(fixture.replace('label: 修复版本', 'label: 引入版本'));
    assert.equal(original.draftId, unchanged.draftId);
    assert.notEqual(original.draftId, changed.draftId);
    assert.equal(original.normalize({ kind: 'removed', platforms: ['Linux', 'removed'] }).kind, '');
    assert.equal(original.normalize({ platforms: ['Linux', 'removed'] }).platforms.join(','), 'Linux');
});

test('rejects invalid syntax, duplicate IDs, unsupported controls, tags and oversized input', async () => {
    for (const yaml of [
        'body: [', 'body: []', fixture.replace('id: cause', 'id: version'),
        fixture.replace('id: cause', 'id: constructor'), fixture.replace('type: input', 'type: execute'),
        fixture.replace('options: [daily, tag]', 'options: []'),
        fixture.replace('default: 1', 'default: 9'), fixture.replace('required: true', 'required: "true"'),
        '!!js/function function() {}', 'x'.repeat(128 * 1024 + 1)
    ]) await assert.rejects(parser.parseYaml(yaml));
});

test('optional checkbox sections can contain only multiselect values', async () => {
    const schema = await parser.parseYaml(`body:\n  - type: dropdown\n    id: choices\n    attributes:\n      label: 可选平台\n      multiple: true\n      options: [Linux, Windows]\n`);
    assert.equal(schema.sections[0].optional, true);
    assert.equal(schema.normalize({ choices: ['Linux'] }).choices[0], 'Linux');
    assert.equal(Object.keys(schema.validate({ choices: [] })).length, 0);
});

test('resolves the bug issue close template from a version 1 msbot config', () => {
    const config = 'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: .msbot/template/bug-close.yml\n    notification: engineering\n';
    assert.equal(parser.resolveTemplatePath(config), '.msbot/template/bug-close.yml');
    assert.equal(parser.resolveTemplatePath('version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: templates/close.yml\n'), 'templates/close.yml');
});

test('ignores configs whose audit is disabled, unsupported, malformed or unsafe', () => {
    for (const config of [
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: false\n    template: .msbot/template/bug-close.yml\n',
        'version: 2\naudits:\n  bug_issue_close:\n    enabled: true\n    template: .msbot/template/bug-close.yml\n',
        'version: 1\naudits:\n  other_audit:\n    enabled: true\n    template: .msbot/template/bug-close.yml\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: /etc/passwd\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: ../bug-close.yml\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: https://example.com/bug-close.yml\n',
        'version: 1\naudits:\n  bug_issue_close:\n    enabled: true\n    template: ".msbot\\\\bug-close.yml"\n',
        'audits: [', '', null, 'x'.repeat(128 * 1024 + 1)
    ]) assert.equal(parser.resolveTemplatePath(config), null);
});
