# harness-gui

## 0.4.0

### Minor Changes

- 00b2b9e: 预构建原生壳开始随 npm 下发。

  `harness-gui` 现在声明三个 `optionalDependencies`，npm 按 `os`/`cpu` 只装匹配当前
  机器的那一个：

  ```
  @harness-gui/shell-darwin-arm64
  @harness-gui/shell-darwin-x64
  @harness-gui/shell-win32-x64
  ```

  **装不上不致命** —— 那正好对应「没有壳就用浏览器」，而且 `nativeShellUnavailableReason()`
  会说出原因。壳换来的是浏览器给不了的三样：系统通知、状态栏常驻、关窗不退出。

  **使用成本没有增加。** 壳是自包含的：`otool -L` 显示每个动态依赖都是
  `/System/Library/Frameworks` 或 `/usr/lib/libSystem`，没有 `@rpath`、没有随包分发的
  dylib。所以没有工具链、没有 postinstall 下载、没有运行时要装 —— 只多 3 MB。

  不用 postinstall 是有意的：那会在 `--ignore-scripts`、企业代理、离线安装下失效，
  而 `optionalDependencies` 走 lockfile 的完整性校验。

  版本与 `harness-gui` 精确相等，由 `scripts/sync-shell-versions.mjs` 强制 ——
  漂移的失败形态是「窗口起来了、白屏、永远连不上」。

  Windows 壳只验证了「编得出来」，运行时还没有人试过（那边 daemon 走命名管道、
  壳要 WebView2）。装不上或起不来都会退回浏览器并说明原因。

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
