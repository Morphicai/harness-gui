#!/usr/bin/env bash
# 本机忠实复现 CI 的那一串。推之前跑一遍。
#
# **别把这个脚本管进 grep。** 管道的退出码是最后一个命令（grep）的，
# 于是这个门禁会静默失效：你看到「1 failed」那行字，命令却返回 0，
# `&& git commit` 照样执行。这已经真实发生过一次 —— 测试红着推了上去。
# 要摘取输出就用 `npm run ci:local | tee /tmp/x; echo ${PIPESTATUS[0]}`，
# 或者干脆直接跑、让它的退出码起作用。
#
# 为什么必须包含 `npm ci` 而不是复用现成的 node_modules：
# **加了新 workspace 包但忘了更新 package-lock.json 时，只有 npm ci 会报错。**
# 本地 npm install/test 会照常通过，然后 CI 上一句
# "Missing: <pkg> from lock file" —— 这个坑真的踩过。
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step 'npm ci（会顺带校验 lock 是否与 package.json 同步）'
npm ci

step 'typecheck'
npm run typecheck

step 'build（必须在 test 之前：用例 import 包名 → dist）'
npm run build

step 'test'
npm test

step 'pack 完整性（README / LICENSE 必须在 tarball 里）'
for p in packages/*/ shells/*/; do
    [ -f "$p/package.json" ] || continue
    node -p "require('./$p/package.json').private === true" | grep -q true && continue
    out=$(cd "$p" && npm pack --dry-run 2>&1)
    for f in README.md LICENSE; do
        echo "$out" | grep -q "$f" || { echo "  ✗ $p 的 tarball 里缺 $f"; exit 1; }
    done
    echo "  ✓ $(node -p "require('./$p/package.json').name")"
done

printf '\n\033[1;32m全部通过\033[0m\n'
# 这一行是给「不小心把输出管进 grep」的人留的最后一道提示：
# 只有全过才会打印它，所以 grep 不到它就说明有问题，别只 grep 「全部通过」以外的东西。
printf 'CI_LOCAL_RESULT=ok\n'
