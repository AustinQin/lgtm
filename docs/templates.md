# 仓库关单模板

点击 Issue 评论区的「关单说明」时，扩展从当前仓库的**默认分支**依次尝试：

1. `.msbot/config.yaml` 中指定的模板。
2. `.msbot/template/bug-close.yml`：解析为填写表单。
3. `.msbot/template/issue_resolve_template.md`：将 Markdown 原文填入评论框。
4. 以上均不可用时，使用内置表单。

模板须可公开读取，无需配置 Token。私有仓库或无法读取模板时仍可使用内置表单。内容只填入评论框，由用户手动提交。

## 指定模板路径

仓库可在默认分支根目录放置 `.msbot/config.yaml` 指定关单模板：

```yaml
version: 1
audits:
  bug_issue_close:
    enabled: true
    template: .msbot/template/bug-close.yml
    notification: engineering
```

- 仅当 `version` 为 `1`、`audits.bug_issue_close.enabled` 为 `true` 且 `template` 为仓库内的相对路径时生效。
- `template` 指向的文件按仓库 YAML 模板格式解析；读取失败或格式不支持时回退到 `.msbot/template/bug-close.yml`，再回退到 Markdown 模板和内置表单。
- 不允许绝对路径、`..`、URL 或反斜杠路径。

## YAML 模板格式

沿用 GitHub Issue Forms 的 `body` 结构：

```yaml
name: 关单说明
body:
  - type: input
    id: fixed_version
    attributes:
      label: 修复版本
      placeholder: 例如 v1.2.0
    validations:
      required: true
  - type: textarea
    id: verification
    attributes:
      label: 自测验证
      description: 填写自测步骤与结果
    validations:
      required: true
```

- 支持 `input`、`textarea`、`dropdown`、`checkboxes`、`markdown`；字段必须有唯一 `id` 和 `attributes.label`。
- `dropdown` 显示为单选按钮，`multiple: true` 显示为复选框；支持零起始的 `attributes.default` 选项下标。
- 支持 `validations.required` 和复选框选项的 `required`；支持说明、占位提示和文本字段的 `attributes.value` 初始值。
- `markdown` 中的标题用于分组，说明文字按纯文本展示，不执行 HTML；选填分组默认折叠。
- 单行和选择项生成信息表格，多行字段生成正文段落；输出标题为「关单说明」，空项省略。
- 仓库 YAML 以自身的必填规则为准，不推断描述文字中的条件或格式校验；例如填写“否”后要填“无”，由用户按说明填写。内置表单的条件显示与格式校验保持原样。
- YAML 上限为 128 KiB 字符、80 个 body 项，每个选择字段最多 50 个选项；不支持自定义 YAML 标签或脚本。

[返回使用说明](../README.md)
