# GitCode Quick Comment

这是一个浏览器插件，为 GitCode 的 Pull Request 页面添加快捷评论按钮。

## 功能

- 在 GitCode PR 页面的评论区域添加两个快捷按钮
- `/lgtm` 按钮：快速插入 "Looks Good To Me" 评论
- `/approve` 按钮：快速插入批准评论

## 安装方法

### Chrome

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择此插件文件夹

### Firefox

1. 打开 Firefox 浏览器
2. 访问 `about:debugging`
3. 点击"此 Firefox"
4. 点击"临时载入附加组件"
5. 选择此插件文件夹中的 manifest.json 文件

## 使用方法

1. 访问 GitCode 的任意 Pull Request 页面（如：https://gitcode.com/Ascend/mstt/pull/5310）
2. 在评论区域上方会显示"快捷评论"按钮
3. 点击 `/lgtm` 或 `/approve` 按钮即可快速插入对应评论
4. 点击提交按钮发送评论

## 文件结构

- `manifest.json` - 插件配置文件
- `content.js` - 主要功能脚本
- `styles.css` - 按钮样式
- `popup.html` - 插件弹出页面
- `README.md` - 说明文档

## 注意事项

- 插件仅在 GitCode 的 Pull Request 页面生效
- 需要手动点击提交按钮来发送评论
- 插件会自动适应 GitCode 页面的变化