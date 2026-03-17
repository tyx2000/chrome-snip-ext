# Chrome Snip Clipboard

一个最小可用的 Chrome Manifest V3 扩展，支持：

- 单击浏览器工具栏中的扩展图标，截取当前可视区域并复制到剪贴板
- 双击浏览器工具栏中的扩展图标，进入当前页面选区模式
- 右键浏览器工具栏中的扩展图标，点击“进入选区模式”后在当前页面右上角打开图标工具条
- 在页面右键菜单中点击“截取当前可视区域并复制到剪贴板”
- 截图后将 PNG 图片直接复制到系统剪贴板
- 扩展图标使用狙击手准星风格，截图失败时显示系统通知

## 加载方式

1. 打开 Chrome，进入 `chrome://extensions`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前目录：`/Users/adib/Desktop/practices/chrome-snip-ext`

## 说明

- 扩展使用 `activeTab` 权限，只在用户点击扩展图标或右键菜单时访问当前标签页
- 选区模式通过 `chrome.scripting.executeScript()` 将覆盖层注入到当前页面，右上角提供图标工具条
- 截图通过 `chrome.tabs.captureVisibleTab()` 完成，只截取当前可视区域，不滚动拼接整页
- 图片写入剪贴板依赖页面为安全上下文，因此普通 `https://` 页面最稳定；`chrome://` 等受限页面会直接通知失败
- 选区模式使用页面覆盖层，支持矩形选区、椭圆选区、拖动已有选区和放大镜式区域预览；快捷键保留 `R`、`C`、`Z`、`Enter`、`Esc`

## 文件结构

- `manifest.json`：扩展清单
- `background.js`：后台 service worker，处理点击事件、截图、写入剪贴板和失败通知
- `selection-ui.js`：注入到页面中的选区覆盖层、右上角工具条和截图裁剪逻辑
- `icons/`：扩展图标资源
