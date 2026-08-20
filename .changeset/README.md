# Changesets

发布由 changesets 驱动，流程见 `.github/workflows/release.yml` 顶部的注释。

一句话：改完代码跑 `npm run changeset` 声明「哪些包变了、什么语义级别」，把生成的
`.changeset/*.md` 一起提交。合进 `main` 后机器人开一个 "version packages" PR，
读完 diff 合它，就发布。

**壳包（`@harness-gui/shell-*`）落地后要挪到 `fixed`**，不是 `linked`：
`harness-gui` 的 `optionalDependencies` 按精确版本钉住它们，版本必须永远相等。

## 为什么三个包不共享版本线

一度配过 `linked`，但那是错的：`linked` 只在**同一批一起发布**时对齐版本，而
`@harness-gui/skill` 既不依赖 `harness-gui`、也不会每次都跟着变，于是必然落后
（首发之后就是 skill 0.1.0 / 另两个 0.2.0）。配置宣称了一件它守不住的事。

各自独立才是诚实的：skill 自上次发布没改过，它就该还是那个版本号。
**不要为了让数字看起来整齐而发空版本** —— 版本号是给人判断「有没有变」的，
把它变成装饰就没用了。

`@harness-gui/mcp` 会跟着 `harness-gui` 走，但那是因为它**真的依赖**后者，
由 `updateInternalDependencies` 自动处理，不需要 `linked`。

**壳包（`@harness-gui/shell-*`）是另一回事，那些要 `fixed`**：
`harness-gui` 的 `optionalDependencies` 按精确版本钉住它们，版本必须永远相等 ——
漂移的失败形态是「窗口起来了、白屏、永远连不上」。
