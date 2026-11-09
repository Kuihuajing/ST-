# 正文阅读 · Story Reader

把当前聊天中 AI 回复的正文连成一篇作品。进入阅读面板欣赏，关闭后继续原聊天。

## 安装和使用

- 手动安装：将完整的 `ST-StoryReader` 文件夹放入 `SillyTavern/public/scripts/extensions/third-party/`。
- GitHub 安装：顶部“扩展” → “安装扩展”，粘贴以下链接并安装：

  ```text
  https://github.com/Kuihuajing/ST-.git
  ```

  `manifest.json`、`index.js`、`reader-core.mjs` 和 `style.css` 直接位于仓库根目录。
- 如果已经手动安装同一插件，先停用手动版本再用链接安装，避免同时启用两份。
- 在已打开的酒馆页面按 `Ctrl+F5` 刷新。输入框左边会出现带书本图标的“阅读”按钮；扩展面板也有入口。
- 点击“阅读”，点击“返回创作”或按 `Esc` 回到原聊天。
- “目录”用于跳到某次 AI 回复；每条回复只使用当前选中的版本，不会拼入其他候选回复。
- 支持 16–28 像素字号、日间/夜间、记住最近 30 段聊天的阅读位置、导出纯正文 TXT。

## 正文识别

默认只显示完整的 `<content>正文</content>`。以下内容不展示：

- 用户输入、系统消息、模型独立的 reasoning 字段；
- `think_fox~`、`think`、`thinking`、`analysis`、`reasoning`；
- `fox_selc`、`fox_tip`、`StatusBlock`、`CharacterStatus`。

可在阅读面板的“选项”修改正文标签（如 `story`）。若作品没有正文标签，可手动开启“未标正文标签时，也显示 AI 回复”。兼容模式只能过滤已知标签，无法保证识别所有预设的自定义分析/状态格式。未闭合的正文会被略过，避免展示生成中的内容。

正文保留基础 Markdown 排版。为避免执行卡内 HTML 或加载远程资源，不运行脚本，也不展示嵌入图片、iframe、音视频或自定义交互界面。

## 只读与本地运行

- 不修改、删除、隐藏或重写原聊天；不改变发给模型的提示词；不调用模型，不消耗 token。
- 使用酒馆官方 `SillyTavern.getContext()` 读取当前已加载的聊天，不遍历其他聊天文件。
- 只保存阅读偏好和位置，不额外保存正文。不向外部服务发送数据，不读取 API Key；阅读偏好由酒馆自身的设置保存机制持久化。
- 字符统计含标点、不含空白，非 token 计数。字体和窗口变化后阅读位置为近似恢复。

## 管理和卸载

顶部“扩展” → “管理扩展”，找到 **正文阅读 · Story Reader**，可停用/启用；操作后刷新页面。通过 Git 仓库安装的版本可使用酒馆的更新按钮，手动安装的版本需替换文件更新。

卸载可在酒馆的扩展管理中进行（如果该安装方式提供删除按钮），或关闭酒馆后移除本扩展文件夹。不需要删除任何角色或聊天文件。

## 开发与验证

无需构建或额外安装依赖。Node.js 20+：

```sh
node --test tests/core.test.mjs
```

本扩展针对 SillyTavern 1.19.0 的接口开发。未来酒馆更新后若有界面变动，可能需要适配。源码使用 MIT 许可证。

另附独立浏览器测试 `tests/browser.test.mjs` 和隔离酒馆加载测试 `tests/integration.test.mjs`，需自行准备 `playwright-core` 并通过 `ST_READER_PLAYWRIGHT` 指定其 `index.mjs` 路径。集成测试只允许使用 8001 端口的独立测试实例，不能对真实用户实例运行。

## 原仓库说明

# ST-
我的ST插件仓库
