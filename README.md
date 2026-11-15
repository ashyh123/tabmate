# tabmate

一个为个人使用而设计、易于扩展的浏览器插件。

> 项目处于早期阶段：目前只有扩展骨架（设置页、弹出面板、「测试连接」），还没有翻译功能。

## 计划功能

- 沉浸式双语翻译（自带 API key，支持 OpenAI 兼容接口）
- 划词操作（翻译、发送到 Notion 等）
- 通用 MCP 客户端，可接入任意远程 MCP 服务

## 设计理念

- 薄内核 + 功能模块：每个功能是 `src/features/` 下的一个独立目录，在一处向内核注册自己的设置、后台逻辑和页面内逻辑。划词按钮、右键菜单等接入点等到第一个需要它们的功能出现时再加。
- API key 只保存在本地，仅后台脚本读取。

## 技术栈

- [WXT](https://wxt.dev)，Manifest V3，仅 Chrome
- TypeScript（严格模式）
- 扩展页面：React + Tailwind；页面内译文：原生 DOM
- 设置校验：Zod
- 模型调用：直接 `fetch` 调 OpenAI 兼容的 Chat Completions 接口
- 语言识别：`chrome.i18n.detectLanguage`
- 测试：Vitest（单元）、Playwright（端到端）
- 格式与检查：Biome；包管理：pnpm；CI：GitHub Actions

选型理由、被否决的选项和权限设计见 [docs/architecture.md](docs/architecture.md)。

## 本地开发

需要 Node.js 22.12 或更高版本和 pnpm（版本见 `package.json` 的 `packageManager`）。

```sh
pnpm install
pnpm dev          # 开发模式：启动一个加载了扩展的 Chrome，修改后自动重载
pnpm build        # 构建到 .output/chrome-mv3/
pnpm check        # 类型检查、Biome、单元测试、构建
pnpm exec playwright install chromium   # 首次运行端到端测试前
pnpm test:e2e     # 端到端测试
```

开发模式下 WXT 会为热重载临时加上 `tabs` 权限；`pnpm build` 的产物只有 `storage`、`scripting` 和 `<all_urls>`。

在 Chrome 中加载构建产物：

1. 执行 `pnpm build`。
2. 打开 `chrome://extensions`，打开右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择仓库中的 `.output/chrome-mv3` 目录。
4. 点击工具栏中的扩展图标，再点「打开设置」，填写 API 地址、API key 和模型名并保存，然后点「测试连接」。

## License

[MIT](LICENSE)

## 参与开发

开始前请阅读 [AGENTS.md](AGENTS.md)（流程与规则）和 [docs/README.md](docs/README.md)（文档索引）。
