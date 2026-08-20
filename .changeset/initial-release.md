---
'harness-gui': minor
'harness-gui-mcp': minor
---

首个可发布版本。

`harness-gui`：五种交互（notify / show / confirm / select / form）、四种结果
（accept / cancel / timeout / unsupported）、四个通道（scripted / tty / web / daemon），
外加原生壳承载。零运行时依赖。

新增 `requireApproval` / `askText` / `showToUser` 批准层，由 `HARNESS_GUI`
（off / on / strict）门控 —— 默认 off，因为库无从判断此刻有没有人在看。

`harness-gui-mcp`：把同样五种交互暴露成 MCP 工具（stdio）。`gui_form` 刻意不收
password 字段：MCP 工具的返回值按定义进模型上下文，在那里收密码等于写进对话记录。
