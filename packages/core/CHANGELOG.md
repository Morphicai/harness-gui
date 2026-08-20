# harness-gui

## 0.3.0

### Minor Changes

- 16f1ef3: 批准闸门变成 SDK 上的一等能力，不再只服务于 MCP。

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

## 0.2.0

### Minor Changes

- c8be6ee: 界面文案支持多语言，**默认英文**。内置 `en` / `zh`。

  ```ts
  createInteract({ locale: "zh" }); // 单实例
  setLocale("zh"); // 整进程
  createInteract({ locale: { confirm: "Ship it" } }); // 部分覆盖，其余英文兜底
  ```

  `HARNESS_GUI_LOCALE=zh` 也行。优先级：显式参数 → setLocale → 环境变量 → 英文。

  调用方给的 title / message / 选项标签**原样透传**，locale 只挑库自己产出的字。

  刻意不跟随 `LANG`：默认值必须确定，同一份代码在不同机器上说不同语言这类差异
  在 CI 与容器里最难复现。

  `throw` 与 daemon 日志一律英文、不进文案表 —— 那些是给开发者看的，本地化之后
  搜不到、也没法对着 issue 匹配，而这正是遇到报错的人要做的第一件事。

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
