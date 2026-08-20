---
'harness-gui': minor
---

批准闸门变成 SDK 上的一等能力，不再只服务于 MCP。

- **`requireApproval` / `askText` / `showToUser` 接受 `ui`**。此前它们硬绑在共享单例
  （daemon + tty）上，已经 `createInteract()` 过的调用方没有任何办法让批准走自己那条
  通道 —— 结果是一个程序里出现两个界面。`setUi()` 提供进程级的同一件事。
- **`preview` / `content` 直接收 markdown 字符串**。批准的价值一半在「让人看见他在批准
  什么」，而手搓 `Content` 的那点摩擦足以让人省掉预览 —— 省掉之后批准就退化成盲签。
  新导出 `asContent()` 做这层转换。
- `setUiForTest` 改名 `setUi`（旧名保留为别名，0.2.0 已经导出过它）。

同时加了一条机械用例核对 MCP 与 SDK 的能力对等：MCP 的每个工具都必须映射到 Interact
上真实存在的方法，加了工具却没登记会直接红。唯一的不对等是反方向的 ——
`askText({ secret: true })` 只在 SDK 上有，因为 MCP 工具的返回值按定义进模型上下文。
