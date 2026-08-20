# Changesets

发布由 changesets 驱动，流程见 `.github/workflows/release.yml` 顶部的注释。

一句话：改完代码跑 `npm run changeset` 声明「哪些包变了、什么语义级别」，把生成的
`.changeset/*.md` 一起提交。合进 `main` 后机器人开一个 "version packages" PR，
读完 diff 合它，就发布。

**壳包（`@harness-gui/shell-*`）落地后要挪到 `fixed`**，不是 `linked`：
`harness-gui` 的 `optionalDependencies` 按精确版本钉住它们，版本必须永远相等。
