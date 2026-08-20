#!/usr/bin/env bash
# 发布 workspace 里的公开包 —— OIDC + token 双通道。
#
# 在 `changeset version` 改完各 package.json 之后跑。逐包 pack，然后：
#
#   pass A — OIDC（env 里没有 NODE_AUTH_TOKEN）。配了 trusted publisher 的包走这条。
#   pass B — NPM_TOKEN 兜住 pass A 没成的（没配 trusted publisher、全新包等）。
#
# 从仓库根目录跑。NPM_TOKEN 需要在 env 里。
set -euo pipefail

# 发布用的 dist-tag。默认 latest（本地手跑时也是）。
# 关键：不是 latest 时用 `--tag <tag>` 且**绝不移动 latest** ——
# 预发布版本（如 0.2.0-next.0）不能劫持 `npm install` 的解析结果。
DIST_TAG="${NPM_DIST_TAG:-latest}"
echo "── publishing under dist-tag: ${DIST_TAG} ─────────────────"

ROOT=$(pwd)
TARBALL_DIR=$ROOT/tarballs
rm -rf "$TARBALL_DIR"
mkdir -p "$TARBALL_DIR"

echo "── packing non-private workspace packages ─────────────────"
PUBLISHED=()
REMAINING=()
SKIPPED=()
ALREADY=()

for pkg in packages/*/; do
    [ -f "$pkg/package.json" ] || continue
    is_private=$(node -p "require('./$pkg/package.json').private === true" 2>/dev/null || echo false)
    if [ "$is_private" = "true" ]; then
        echo "  - skipped (private): $pkg"
        continue
    fi
    # 当前版本已经在 registry 上就别 pack —— 省一次往返，也避免「文档改动」这类
    # 没产生版本变化的提交被 changesets 的 publish 步骤报成「一个包都没发」。
    pkg_name=$(node -p "require('./$pkg/package.json').name" 2>/dev/null)
    pkg_version=$(node -p "require('./$pkg/package.json').version" 2>/dev/null)
    if [ -n "$pkg_name" ] && [ -n "$pkg_version" ]; then
        existing=$(npm view "$pkg_name@$pkg_version" version 2>/dev/null || true)
        if [ "$existing" = "$pkg_version" ]; then
            ALREADY+=("$pkg_name@$pkg_version")
            continue
        fi
    fi
    ( cd "$pkg" && npm pack --pack-destination "$TARBALL_DIR" >/dev/null )
done
ls -la "$TARBALL_DIR" 2>/dev/null || true

# 从 tarball 内嵌的 package.json 取名字和版本
extract_pkg() {
    tar -xzOf "$1" package/package.json 2>/dev/null | node -e "
        let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
            const j=JSON.parse(d);process.stdout.write(j.name+'\n'+j.version+'\n');
        });" 2>/dev/null
}

# 发一个 tarball。处理「要发的版本低于当前 latest」的情况 —— npm 拒绝隐式把
# latest 往回移，所以先发到一个 staging tag，再显式 `npm dist-tag add`。
#
# 参数：$1 = tgz 路径，$2 = "oidc" | "token"
publish_one() {
    # 别在这个函数里动 `set +e` / `set -e`：bash 函数与调用方共享 shell 状态，
    # 在这里切换会把调用方的 `set +e` 包裹废掉，导致 for 循环在**第一个**失败处
    # 就退出，而不是跑完所有 tarball。两个调用点都已经包了 `set +e`。
    local tgz="$1" mode="$2" name version env_prefix output rc
    { name=$(extract_pkg "$tgz" | head -1); version=$(extract_pkg "$tgz" | tail -1); } 2>/dev/null

    if [ "$mode" = "oidc" ]; then
        env_prefix="env -u NODE_AUTH_TOKEN -u npm_config__authToken"
    else
        env_prefix="env NODE_AUTH_TOKEN=$NPM_TOKEN"
    fi

    # latest 时**不带** --tag，这样下面「低于 latest」的补救逻辑才适用；
    # 其他 tag 带 --tag 且不碰 latest。
    if [ "$DIST_TAG" = "latest" ]; then
        output=$($env_prefix npm publish "$tgz" --access public --provenance 2>&1)
    else
        output=$($env_prefix npm publish "$tgz" --access public --provenance --tag="$DIST_TAG" 2>&1)
    fi
    rc=$?
    echo "$output"
    [ $rc -eq 0 ] && return 0

    # 下面的补救只关 latest
    [ "$DIST_TAG" != "latest" ] && return $rc

    if echo "$output" | grep -q "Cannot implicitly apply the \"latest\" tag"; then
        echo "  → latest 在更高版本上；先发到 staging tag 再显式移动。"
        local staging_tag="staging-$(date +%s)"
        $env_prefix npm publish "$tgz" --access public --provenance --tag="$staging_tag" || return $?
        if [ -n "$name" ] && [ -n "$version" ]; then
            echo "  → moving latest to $name@$version"
            $env_prefix npm dist-tag add "$name@$version" latest || {
                echo "  → dist-tag add 失败；包只发在 $staging_tag 下"
                return 1
            }
        fi
        return 0
    fi
    return $rc
}

# 一个都没 pack ⇒ 所有公开包都已经在 registry 上（文档/脚本类提交，或发布成功后重跑）。
# 那是成功而不是失败 —— 在 publish 循环之前退出，否则空 glob 会展开成字面
# "*.tgz" 并以 ENOENT 挂掉。
shopt -s nullglob
_tgzs=("$TARBALL_DIR"/*.tgz)
shopt -u nullglob
if [ ${#_tgzs[@]} -eq 0 ]; then
    echo ""
    echo "── nothing to publish: ${#ALREADY[@]} package(s) already up to date ──"
    exit 0
fi

echo ""
echo "── pass A: OIDC ───────────────────────────────────────────"
for tgz in "$TARBALL_DIR"/*.tgz; do
    name=$(basename "$tgz")
    echo "::group::pass-A $name (OIDC)"
    set +e; publish_one "$tgz" oidc; rc=$?; set -e
    if [ $rc -eq 0 ]; then PUBLISHED+=("$name (oidc)")
    else REMAINING+=("$tgz"); echo "  → pass A 失败 (exit $rc)，转 pass B"; fi
    echo "::endgroup::"
done

if [ ${#REMAINING[@]} -gt 0 ]; then
    echo ""
    echo "── pass B: token (${#REMAINING[@]} remaining) ─────────────"
    if [ -z "${NPM_TOKEN:-}" ]; then
        echo "::warning::NPM_TOKEN 未设置，pass B 跑不了。"
        for tgz in "${REMAINING[@]}"; do SKIPPED+=("$(basename "$tgz") (no NPM_TOKEN)"); done
    else
        for tgz in "${REMAINING[@]}"; do
            name=$(basename "$tgz")
            echo "::group::pass-B $name (token)"
            set +e; publish_one "$tgz" token; rc=$?; set -e
            if [ $rc -eq 0 ]; then PUBLISHED+=("$name (token)")
            else SKIPPED+=("$name (token exit $rc)"); echo "::warning::$name 两轮都没发出去 (exit $rc)"; fi
            echo "::endgroup::"
        done
    fi
fi

echo ""
echo "── summary ─────────────────────────────────────────────────"
echo "published (${#PUBLISHED[@]}):"; for n in "${PUBLISHED[@]:-}"; do [ -n "$n" ] && echo "  ✓ $n"; done
if [ ${#ALREADY[@]} -gt 0 ]; then
    echo "already up to date (${#ALREADY[@]}):"; for n in "${ALREADY[@]}"; do echo "  · $n"; done
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
    echo "skipped (${#SKIPPED[@]}):"; for n in "${SKIPPED[@]}"; do echo "  ✗ $n"; done
fi

# 「什么都没发」但「所有包都已是 registry 上的版本」不算失败（文档类提交，
# changesets 正确地没产生版本变化）。只有真的有 skip 且一个都没成才失败。
if [ ${#PUBLISHED[@]} -eq 0 ] && [ ${#SKIPPED[@]} -gt 0 ]; then
    echo "::error::一个包都没发出去，且有 ${#SKIPPED[@]} 个被跳过"
    exit 1
fi
