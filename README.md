# GitCode Quick Comment

这是一个浏览器插件，为 GitCode 的 Pull Request 和 Issue 页面添加快捷评论按钮，提高代码审查和问题处理的效率。

## 功能

### Pull Request 页面功能

**直接按钮：**
- `/check-pr` - 快速插入 PR 检查命令
- `compile` - 快速插入 "compile" 评论
- `retry` - 快速插入重试命令
- `/approve` - 快速插入批准合入评论
- `/lgtm` - 快速插入 "Looks Good To Me" 评论

### Issue 页面功能

**关单说明按钮：**
- 根据当前 Issue 页面地址自动识别仓库
- 点击后优先读取该仓库 `master` 分支、根目录下的 `.msbot/template/bug-close.yml`，动态生成填写弹窗
- YAML 不存在、无法读取或格式不支持时，尝试默认分支的 `.msbot/template/issue_resolve_template.md`，将 Markdown 原文填入评论框
- 两种仓库模板都不可用时打开内置表单；已有评论内容会保留，新内容追加到末尾
- 仅填入内容，不会自动提交评论
- 当前通过公开原文地址读取，无需配置 Token；私有仓库或无法公开访问的文件使用默认模板
- 模板填入后在页面顶部显示轻提示，5 秒后自动消失，不打断评论填写
- 默认表单依据 `bug-close.yml` 定义，包含七个分组；可选分组默认折叠，选择无用户感知变更时隐藏相关字段
- 表单校验必填项、Commit/PR 编号、链接格式，以及回归版本/链接至少填写一项，填写后自动生成 Markdown
- 生成内容采用“信息表格 + 分段正文”：PR、版本、关联组件等放入表格，原因分析、修复方案和自测验证保留正文；空的选填项省略，代码块及截图语法保持原样
- 草稿按仓库和 Issue 保存在扩展的本地存储中，关闭、刷新后可恢复；填入后仍保留草稿便于再次修改
- 仓库 YAML 和内置表单的草稿分开保存；YAML 字段定义变化后不复用旧模板草稿
- 截图在填入后的 GitCode 评论框中添加；自定义仓库 Markdown 模板仍直接填入，不转换为表单
- 编辑器不可用时显示错误提示，可重试

**更多菜单（标签管理）：**
- `/label add triage-review` - 添加 triage-review 标签
- `/label add triaged` - 添加 triaged 标签
- `/label add pending` - 添加 pending 标签
- `/label add feature` - 添加 feature 标签
- `/label add resolved` - 添加 resolved 标签
- `/label add stale` - 添加 stale 标签
- `/label add duplicated` - 添加 duplicated 标签
- `收到反馈，感谢！` - 快速插入感谢回复

## 安装方法

### Chrome / Edge

1. **下载插件源码**
   - 克隆仓库或下载 ZIP 文件
   - 解压到本地文件夹

2. **打开扩展管理页面**
   - Chrome：访问 `chrome://extensions/`
   - Edge：访问 `edge://extensions/`

3. **启用开发者模式**
   - 点击右上角的"开发者模式"开关
   - 开关变为蓝色表示已启用

（Chrome：访问 `chrome://extensions/`）
4. **加载插件**
   - 点击"加载已解压的扩展程序"按钮
   - 选择插件文件夹
   - 确认插件已加载并启用

5. **固定插件（可选）**
   - 在浏览器工具栏中找到插件图标
   - 右键点击图标，选择"固定到工具栏"

### Firefox

1. **下载插件源码**
   - 克隆仓库或下载 ZIP 文件
   - 解压到本地文件夹

2. **打开调试页面**
   - 访问 `about:debugging`

3. **加载插件**
   - 点击"此 Firefox"链接
   - 点击"临时载入附加组件"按钮
   - 选择插件文件夹中的 `manifest.json` 文件
   - 确认插件已加载

**注意：** Firefox 的临时加载在浏览器关闭后会失效，需要重新加载。

## 使用方法

### Pull Request 页面使用

1. 访问 GitCode 的任意 Pull Request 页面
   - 例如：`https://gitcode.com/Ascend/mstt/pull/5310`

2. 在评论区域会看到快捷按钮
   - `/check-pr`、`compile`、`retry`、`/approve`、`/lgtm` 按钮

3. 点击按钮快速插入对应评论
   - 点击对应按钮直接插入评论

4. 点击提交按钮发送评论

### Issue 页面使用

1. 访问 GitCode 的任意 Issue 页面
   - 例如：`https://gitcode.com/Ascend/mstt/issues/1234`

2. 在评论区域会看到快捷按钮
   - 显示 `关单说明` 和 `更多` 按钮

3. 点击 `关单说明`，按 YAML → Markdown → 内置表单的顺序读取模板
   - `master` 分支的 `.msbot/template/bug-close.yml` 可用时，根据 YAML 字段打开表单
   - YAML 不可用时尝试默认分支的 `.msbot/template/issue_resolve_template.md`，可用则直接填入原文
   - 两者都不可用时打开内置表单；填写后点击「填入评论框」
   - 点击「保存并关闭」或按 Esc 可关闭表单，下次打开继续填写；不同 Issue 的草稿互不影响
   - 或点击 `更多`，选择标签命令

4. 点击提交按钮发送评论

### 页面切换

插件支持 SPA 页面切换，无需刷新：
- 从首页切换到 PR/issue 页面会自动加载按钮
- 在不同 PR/issue 之间切换会自动更新

### 仓库 YAML 模板格式

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

## 文件结构

- `manifest.json` - 插件配置文件
- `content.js` - 主要功能脚本（content script）
- `issue-form.js` - 默认关单说明表单、校验、草稿保存与 Markdown 生成
- `issue-template.js` - 仓库 YAML 的解析、字段校验与动态表单模型
- `vendor/` - 随插件打包的 YAML 解析器及许可证，不依赖运行时 CDN
- `issue-form.css` - 表单弹窗及移动端样式
- `inject.js` - 页面环境注入脚本
- `styles.css` - 按钮和菜单样式
- `popup.html` - 插件弹出页面
- `README.md` - 说明文档

## 技术实现

- 使用 Chrome 扩展的 Content Script API
- 通过外部 JS 文件进入页面上下文，访问编辑器实例
- 使用 CustomEvent 在 content script 和页面环境间通信
- 同时兼容新版 PR 页面的 CodeMirror 6 和 Issue 页面的 CodeMirror 5
- 支持 SPA 应用的路由变化监听

## 故障排除

### 按钮不显示

1. **刷新页面**
   - 按 F5 或 Ctrl+R 刷新页面
   - 等待几秒钟让按钮加载

2. **检查插件状态**
   - 访问 `chrome://extensions/`
   - 确认插件已启用
   - 查看是否有错误信息

## 版本历史

### v1.5
- 优先读取仓库 YAML 动态生成关单表单，兼容 Markdown 和内置表单回退
- 支持仓库定义的字段、选项、默认值和必填规则，草稿按模板隔离

### v1.4
- 默认关单说明改为分组表单，支持条件显示和字段校验
- 新增本地草稿保存与恢复，需要扩展的 `storage` 权限
- 一键生成 Markdown 填入原评论框，保留已有文字，由用户手动提交

### v1.3
- Issue 评论区新增「关单说明」按钮，读取当前仓库默认分支中的模板
- 增加加载、成功及失败提示，保留已有评论内容
- 加载期间切换到其他 Issue 时，不向新的评论区插入旧模板

### v1.2
- PR 页面仅展示 `/check-pr`、`compile`、`retry`、`/approve`、`/lgtm`
- Issue 页面仅展示标签管理和感谢回复

### v1.1
- 适配新版 GitCode Pull Request 评论区
- 同时兼容 CodeMirror 5 和 CodeMirror 6 编辑器
- 减少重复 DOM 监听和对 GitCode 内部按钮样式的依赖

### v1.0
- 初始版本
- 添加基础快捷评论功能
- 支持标签管理功能
- 支持 SPA 页面切换

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个插件。

## 许可证

MIT License
