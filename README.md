# tabmate

一个为个人使用而设计、易于扩展的浏览器插件。

> 项目处于早期设计阶段，尚无可用版本。

## 计划功能

- 沉浸式双语翻译（自带 API key，支持 OpenAI 兼容接口）
- 划词操作（翻译、发送到 Notion 等）
- 通用 MCP 客户端，可接入任意远程 MCP 服务

## 设计理念

- 薄内核 + 功能模块：每个功能是一个独立模块，向内核注册自己的设置、划词按钮、右键菜单和后台逻辑。
- API key 只保存在本地，仅后台脚本读取。

## 技术栈

- [WXT](https://wxt.dev)
- TypeScript
- React
- Manifest V3

## License

[MIT](LICENSE)

## 参与开发

开始前请阅读 [AGENTS.md](AGENTS.md)（流程与规则）和 [docs/README.md](docs/README.md)（文档索引）。
