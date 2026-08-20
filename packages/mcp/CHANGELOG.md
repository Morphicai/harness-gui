# @harness-gui/mcp

## 0.2.1

### Patch Changes

- Updated dependencies [16f1ef3]
  - harness-gui@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [c8be6ee]
  - harness-gui@0.2.0

## 0.1.0

### Minor Changes

- f7de5b1: 首个可发布版本。

  `harness-gui`：五种交互（notify / show / confirm / select / form）、四种结果
  （accept / cancel / timeout / unsupported）、四个通道（scripted / tty / web / daemon），
  外加原生壳承载。零运行时依赖。

  新增 `requireApproval` / `askText` / `showToUser` 批准层，由 `HARNESS_GUI`
  （off / on / strict）门控 —— 默认 off，因为库无从判断此刻有没有人在看。

  `@harness-gui/mcp`：把同样五种交互暴露成 MCP 工具（stdio）。`gui_form` 刻意不收
  password 字段：MCP 工具的返回值按定义进模型上下文，在那里收密码等于写进对话记录。

  `@harness-gui/skill`：给 agent 的 playbook，`npx @harness-gui/skill install`
  装到 Claude Code / Cursor / Kiro。默认装 user scope —— 「要不要打扰人」不随仓库变。
  用例把 SKILL.md 里的工具名和 MCP 实际注册的对了起来，改名而不改文档会直接红。

### Patch Changes

- Updated dependencies [f7de5b1]
  - harness-gui@0.1.0
