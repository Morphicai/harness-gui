# macOS 签名与公证

签名信息全部来自环境变量，仓库里不留任何账号信息（与 autoproxy-cli 同名，两个项目共用一套约定）：

| 变量 | 用途 |
|---|---|
| `CSC_NAME` | 指定签名身份。不设则自动挑选 |
| `CSC_IDENTITY_AUTO_DISCOVERY` | 设为 `false` 完全跳过签名，出未签名包 |
| `APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_APP_SPECIFIC_PASSWORD` | 公证用 |

```sh
node scripts/build-mac.mjs                # 构建 + 签名
node scripts/build-mac.mjs --notarize     # 构建 + 签名 + 公证 + 装订
CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-mac.mjs   # 不签名
```

公证会把二进制**上传到 Apple**，属于外发行为，所以必须显式加 `--notarize`，
不会因为环境变量刚好齐了就自动发出去。

身份选择：有 `APPLE_TEAM_ID` 时按 Team 精确匹配（证书 Team 与公证 Team 不一致，
公证必然失败，不如在选证书这步就对齐）。同名同 Team 的重复项按 SHA-1 指纹选 ——
按名字签对 codesign 是歧义的。

## 不带 entitlements

这个壳只链系统框架、不加载第三方 dylib、JS 跑在 WKWebView 自己（Apple 签名）的进程里，
**不需要** Electron 那套 `allow-jit` / `allow-unsigned-executable-memory` /
`disable-library-validation` 豁免。真需要时放 `build/entitlements.mac.plist`，脚本自动带上。

---

## 已知问题：errSecInternalComponent（2026-08-15，本机未解决）

```
Warning: unable to build chain to self-signed root for signer "Developer ID Application: ..."
<app>: errSecInternalComponent
```

### 那句 "unable to build chain" 是误导

证书链其实是好的：

```sh
security find-certificate -c "Developer ID Application" -a -p > /tmp/leaf.pem
security verify-cert -c /tmp/leaf.pem -p codeSign
# → ...certificate verification successful.
```

### 决定性对照

同一个 codesign、同一个文件：

| 签名方式 | 结果 |
|---|---|
| 真实身份（哪怕不带任何选项） | `errSecInternalComponent` |
| ad-hoc `codesign -s - <file>`（不需要私钥） | **成功** |

所以卡的是**私钥的使用权限**，不是证书链、不是网络、不是会话。

### 已逐条排除

| 猜测 | 实测 |
|---|---|
| 证书过期 | 否，有效期至 2031-01 |
| 缺 G2 中间证书 | 否，login/System/SystemRoot 三处都有，有效期至 2031-09 |
| 缺 Apple Root CA | 否，在系统根钥匙串 |
| 时间戳服务器不可达 | 否，`timestamp.apple.com` HTTP 302 / 0.49s；去掉 `--timestamp` 同样失败 |
| 钥匙串锁定 | 否，`show-keychain-info` 返回 no-timeout |
| 钥匙串搜索列表不含 login | 否，login 排第一；显式 `--keychain` 亦失败 |
| 脱离 GUI 登录会话 | 否，`launchctl managername` = **Aqua** |
| 只有某张证书坏 | 否，三张身份表现完全一致 |
| Apple Root CA 被用户信任设置覆盖 | 否，用户域只有一条 whistle 代理 CA |

### 结论：这台机器不是签名机

排查到最后没能在本机跑通。**这不是脚本的问题，是机器的问题** —— 这是公司统管的
设备（装有 MDM），证书信任与钥匙串权限受策略约束；同一套 env 约定的 autoproxy-cli
也是在个人设备上出包的。

所以现阶段的正确做法是：**本机只出未签名包**，签名与公证放到有完整签名环境的机器
（或 CI）上做。脚本本身是环境驱动的，换台机器把变量配齐即可，不用改代码。

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-mac.mjs
```

### 换到签名机上时的排查顺序

万一在别的机器上也撞到同样的报错，按这个顺序查（本机已逐条走过一遍）：

1. **钥匙串访问.app** 里看证书左侧有无展开三角 —— 有才说明私钥在，一眼定生死
2. 搜索列表有无重复项（本机 `System.keychain` 出现了两次，不正常）：
   ```sh
   security list-keychains
   security list-keychains -d user -s ~/Library/Keychains/login.keychain-db /Library/Keychains/System.keychain
   ```
3. 私钥 ACL 的 partition list 缺 `apple-tool:`（.p12 非交互导入或系统迁移后常见）：
   ```sh
   security set-key-partition-list -S apple-tool:,apple: -s ~/Library/Keychains/login.keychain-db
   # 省略 -k 会交互式提示输入密码；密码只在终端敲，别贴进任何对话或文件
   ```
4. 证书的信任设置是否被显式改成「不信任」（本机一度处于该状态）

每步之后复验：

```sh
CSC_IDENTITY_AUTO_DISCOVERY= node scripts/build-mac.mjs
```

### 一条旁证

环境里预设着 `CSC_IDENTITY_AUTO_DISCOVERY=false`（autoproxy-cli 读同名变量），
说明这台机器上的签名**在本次改动之前就不通**，一直靠出未签名包绕过 —— 与上面的
结论一致。
