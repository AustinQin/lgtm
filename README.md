# GitCode Quick Comment

在 GitCode 的 PR 和 Issue 评论区添加快捷按钮，快速提交评审命令、填写关单说明。

## 安装

- **Chrome**：[从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/gitcode-quick-comment/jomkbgbgkmiifmloikjcgklmiejdeadk)
- **Edge**：[从 Microsoft Edge 加载项商店安装](https://microsoftedge.microsoft.com/addons/detail/gitcode-quick-comment/cdkhfdibiljhlnmhmhepfpbdcamolgib)

安装后刷新已打开的 GitCode 页面。建议将扩展固定到浏览器工具栏，方便访问。

## 主页

插件主页源码在 [`docs/`](docs/)，包含在线安装、离线安装、使用指南和离线包下载。在仓库 Settings → Pages 中选择 `main` 分支的 `/docs` 目录即可发布。

## 使用

登录 GitCode，打开 PR 或 Issue 详情页，在评论区使用快捷按钮。

### PR 评审

支持 `/pull/编号` 和 `/merge_requests/编号` 两种 PR 链接。

| 按钮 | 默认操作 |
| --- | --- |
| `/check-pr`、`retry`、`/lgtm` | 直接提交命令评论 |
| `compile`、`/approve` | 二次确认后提交 |

评论框已有内容时会停止快捷提交，请先提交或清空。命令的实际效果取决于仓库机器人配置和你的权限。

### Issue 管理

- **关单说明**：填写原因、修复方案和版本信息，点击「填入评论框」，检查后手动提交。支持仓库模板，没有可用模板时使用内置表单。
- **更多**：点击后直接提交常用标签命令或感谢回复；评论框已有内容时，请先提交或清空。
- **草稿和图片**：关单表单自动保存本地草稿；粘贴或拖入图片会立即上传至当前 GitCode 仓库。

### 工具栏设置

点击扩展图标，可查看当前页面状态、启用或暂停快捷评论、隐藏和排序按钮，并为每个 PR 命令选择「填入评论框」「直接提交」或「确认后提交」。

设置自动保存在当前浏览器，重启后仍保留，不跨浏览器同步。「恢复默认」只重置设置，不删除关单草稿。关单说明仍需检查后手动提交。

<details>
<summary>从源码安装 / 试用最新功能</summary>

1. 下载并解压[源码 ZIP](https://github.com/AustinQin/lgtm/archive/refs/heads/main.zip)，或克隆本仓库。
2. 打开 `chrome://extensions/`（Chrome）或 `edge://extensions/`（Edge），开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。
4. 刷新 GitCode 页面。以后更新源码后，先在扩展管理页点击重新加载，再刷新页面。

</details>

## 帮助

按钮未出现时，先刷新页面，并确认扩展已启用、当前为 GitCode PR / Issue 详情页且评论框已加载。也可通过工具栏面板检查按钮是否被隐藏。

[仓库模板配置](docs/templates.md) · [更新记录](CHANGELOG.md) · [隐私政策](PRIVACY.md) · [反馈问题](https://github.com/AustinQin/lgtm/issues)

本扩展为独立开发工具，与 GitCode 官方无隶属或背书关系。采用 MIT License。
