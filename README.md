# GitCode Quick Comment

这是一个浏览器插件，为 GitCode 的 Pull Request 和 Issue 页面添加快捷评论按钮，提高代码审查和问题处理的效率。

## 功能

### Pull Request 页面功能

**直接按钮：**
- `compile` - 快速插入 "compile" 评论
- `/lgtm` - 快速插入 "Looks Good To Me" 评论

**更多菜单：**
- `/approve` - 快速插入批准合入评论
- `/check-pr` - 快速插入 PR 检查命令

### Issue 页面功能

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
   - `compile`、`/lgtm`、`更多` 按钮

3. 点击按钮快速插入对应评论
   - 点击 `compile` 或 `/lgtm` 直接插入
   - 点击 `更多` 查看额外选项（`/approve`、`/check-pr`、收到反馈）

4. 点击提交按钮发送评论

### Issue 页面使用

1. 访问 GitCode 的任意 Issue 页面
   - 例如：`https://gitcode.com/Ascend/mstt/issues/1234`

2. 在评论区域会看到快捷按钮
   - `compile`、`/lgtm`、`更多` 按钮

3. 点击 `更多` 查看标签相关命令
   - 选择对应的标签命令快速添加标签

4. 点击提交按钮发送评论

### 页面切换

插件支持 SPA 页面切换，无需刷新：
- 从首页切换到 PR/issue 页面会自动加载按钮
- 在不同 PR/issue 之间切换会自动更新

## 文件结构

- `manifest.json` - 插件配置文件
- `content.js` - 主要功能脚本（content script）
- `inject.js` - 页面环境注入脚本
- `styles.css` - 按钮和菜单样式
- `popup.html` - 插件弹出页面
- `README.md` - 说明文档

## 技术实现

- 使用 Chrome 扩展的 Content Script API
- 通过外部 JS 文件注入绕过 CSP 限制
- 使用 CustomEvent 在 content script 和页面环境间通信
- 通过 CodeMirror API 直接操作编辑器
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

### v1.0
- 初始版本
- 添加基础快捷评论功能
- 支持标签管理功能
- 支持 SPA 页面切换

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个插件。

## 许可证

MIT License