const std = @import("std");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

/// 常驻交互客户端的外壳。
///
/// 它只做三件事：
///   1. 把 node 侧 interact server 的页面装进系统 WebView
///   2. 把「发系统通知」按最小权限放给那个页面
///   3. 关窗改为隐藏 + 装一个状态栏项，让它在没有窗口时也活着
///
/// 关键在于**没有 TS core**：不写 Model、不派发 Msg、尤其不用 Cmd.fetch。
/// 实测 native 0.9.0 里 TS core 只要出现 Cmd.fetch，运行时就在 sc_f_nscfCommit
/// 里 free 一个未分配的指针（全新脚手架加一个从没被点击的分支即可复现）。
/// 网络全部走 WebView 里的 JS —— 那是系统 WKWebView，不经过 scriptc。
const App = struct {
    env_map: *std.process.Environ.Map,

    fn app(self: *@This()) native_sdk.App {
        return .{
            .context = self,
            .name = "interact-client",
            .source = native_sdk.frontend.productionSource(.{ .dist = "frontend/dist" }),
            .source_fn = source,
            .start_fn = start,
            .event_fn = event,
        };
    }

    /// URL 由 NATIVE_SDK_FRONTEND_URL 注入（见 SDK src/frontend/root.zig sourceFromEnv）。
    /// 这样 token 能保持每次会话随机，不必写死进 app.zon。
    fn source(context: *anyopaque) anyerror!native_sdk.WebViewSource {
        const self: *@This() = @ptrCast(@alignCast(context));
        return native_sdk.frontend.sourceFromEnv(self.env_map, .{
            .dist = "frontend/dist",
            .entry = "index.html",
        });
    }

    /// 状态栏项必须在这里装：关窗只是隐藏，没有它用户就再也找不回窗口了。
    fn start(context: *anyopaque, rt: *native_sdk.Runtime) anyerror!void {
        _ = context;
        try rt.createTray(tray_options);
    }

    fn event(context: *anyopaque, rt: *native_sdk.Runtime, ev: native_sdk.Event) anyerror!void {
        _ = context;
        switch (ev) {
            .command => |c| {
                if (std.mem.eql(u8, c.name, cmd_show)) {
                    try rt.showWindow(main_window_id);
                    // showWindow 只是让它可见；要真的浮到最前还得单独请求激活
                    try rt.focusWindow(main_window_id);
                } else if (std.mem.eql(u8, c.name, cmd_hide)) {
                    // 答完就收起来。
                    //
                    // 这里**不能**用 native-sdk.window.close：那条内置命令是真关，
                    // 不走 close_policy（SDK runtime/builtin_bridge.zig:546 写明
                    // "a closed policy-hidden window is gone, not hidden"），窗口连同
                    // WebView 一起没了，SSE 长连接断掉 —— 常驻也就不成立了。
                    // hideWindow 只藏窗口，页面继续活着。
                    try rt.hideWindow(main_window_id);
                } else if (std.mem.eql(u8, c.name, cmd_quit)) {
                    try rt.quitApp();
                }
            },
            else => {},
        }
    }
};

/// interact server 的 origin。
///
/// allowsOrigin 是精确字符串匹配（SDK src/security/root.zig:47，只认全等或 "*"），
/// 所以端口必须写死 —— 这是 WebChannel 需要固定端口的唯一原因。
/// token 仍然每次会话随机，固定下来的只有 origin。
/// server.mjs 直接从 app.zon 读这个端口，避免两处漂移。
const interact_origin = "http://127.0.0.1:47100";

/// app.zon 的 .windows[0] 没写 id，取 WindowOptions 的默认值 1。
const main_window_id: native_sdk.platform.WindowId = 1;

const cmd_show = "interact.show";
const cmd_hide = "interact.hide";
const cmd_quit = "interact.quit";

/// 必须与 app.zon 的 allowed_origins 一致：运行时用的是这里，app.zon 供打包工具校验。
const allowed_origins = [_][]const u8{
    "zero://app",
    "zero://inline",
    interact_origin,
};

/// 授予这个 app 的权限。只给通知 —— 页面加载的是 loopback 上的本地服务，
/// 多给一项就是多一分被这个页面滥用的面。
const app_permissions = [_][]const u8{native_sdk.security.permission_notifications};

/// 放给页面的内置桥命令。默认全拒，这里逐条显式开，并且都锁死在 interact_origin 上。
///
/// showNotification 是 SDK 自带的内置命令（runtime/builtin_bridge.zig:192），
/// 不需要我们写 Zig handler —— 页面直接 window.zero.os.showNotification(...)。
/// platform.supports 让页面在用之前能先问「这台机器到底支不支持通知」，
/// 而不是发出去石沉大海。
const builtin_commands = [_]native_sdk.BridgeCommandPolicy{
    .{
        .name = "native-sdk.os.showNotification",
        .permissions = &.{native_sdk.security.permission_notifications},
        .origins = &.{interact_origin},
    },
    .{
        .name = "native-sdk.platform.supports",
        .origins = &.{interact_origin},
    },
    // 让页面能触发 app 自己的命令 —— 目前只用来在人答完之后收起窗口。
    //
    // 走 command.invoke 而不是直接开 window 类命令：SDK 的 window.close 是真关，
    // 会连 WebView 一起销毁；隐藏只有 app 侧的 hideWindow 做得到。开这一条的代价是
    // 页面能触发本 app 声明过的任意命令 —— 包括 interact.quit。可接受：页面来自
    // 我们自己的 loopback 服务，而且退出这个外壳不造成数据损失。
    .{
        .name = "native-sdk.command.invoke",
        .origins = &.{interact_origin},
    },
};

/// 状态栏菜单。校验规则见 SDK runtime/validation.zig:119 —— 带 command 的行必须有非零 id
/// 且不能是分隔符，非分隔符必须有 label。pi 之前撞的 InvalidTrayOptions 就出在这一带。
const tray_items = [_]native_sdk.TrayMenuItem{
    .{ .id = 1, .label = "显示 Interact 窗口", .command = cmd_show },
    .{ .separator = true },
    .{ .id = 2, .label = "退出 Interact", .command = cmd_quit },
};

const tray_options = native_sdk.TrayOptions{
    // 用标题而不是图标：菜单栏图标需要小尺寸模板图（纯黑 + alpha），
    // 而应用图标 assets/icon.png 不是那个形状，直接塞进去会很难看。
    // 标题一定能显示出来 —— 状态栏项是窗口隐藏后唯一的找回入口，不能赌它渲染不出来。
    .title = "◆",
    .tooltip = "Interact —— 交互客户端",
    .items = &tray_items,
};

pub fn main(init: std.process.Init) !void {
    var app = App{ .env_map = init.environ_map };
    try runner.runWithOptions(app.app(), .{
        .app_name = "Interact",
        .window_title = "Interact",
        .bundle_id = "dev.native_sdk.interact-client",
        .icon_path = "assets/icon.png",
        .security = .{
            // 授予集放这里，要求集放在每条命令上；运行时会把它拷进 bridge policy
            // （runtime/builtin_bridge.zig:58-60）。放错一边就是 permission_denied。
            .permissions = &app_permissions,
            .navigation = .{ .allowed_origins = &allowed_origins },
        },
        .builtin_bridge = .{
            .enabled = true,
            .commands = &builtin_commands,
        },
    }, init);
}

test "allowlist covers the interact server origin" {
    const security = native_sdk.security;
    try std.testing.expect(security.allowsOrigin(&allowed_origins, interact_origin));
    // 端口不同即不同 origin —— 这条防止有人把固定端口改掉却忘了同步 allowlist
    try std.testing.expect(!security.allowsOrigin(&allowed_origins, "http://127.0.0.1:47101"));
}

test "notification is granted to the interact origin only" {
    const policy = native_sdk.BridgePolicy{
        .enabled = true,
        .permissions = &app_permissions,
        .commands = &builtin_commands,
    };
    try std.testing.expect(policy.allows("native-sdk.os.showNotification", interact_origin));
    // 别的 origin 拿不到通知能力
    try std.testing.expect(!policy.allows("native-sdk.os.showNotification", "https://example.invalid"));
    // 没显式列出的内置命令一律拒 —— 默认全拒，不是默认全开
    try std.testing.expect(!policy.allows("native-sdk.dialog.openFile", interact_origin));
    try std.testing.expect(!policy.allows("native-sdk.clipboard.readText", interact_origin));
}

test "granting nothing denies the notification command" {
    // 授予集为空时，即便命令列了出来也该被拒：证明要求集真的在起作用
    const policy = native_sdk.BridgePolicy{
        .enabled = true,
        .permissions = &.{},
        .commands = &builtin_commands,
    };
    try std.testing.expect(!policy.allows("native-sdk.os.showNotification", interact_origin));
}

test "tray options are accepted by the runtime" {
    // 关窗改成隐藏之后，状态栏项是用户找回窗口的唯一入口 —— 它要是配错了，
    // 窗口一关就再也回不来。这条走真实的 createTray 路径（NullPlatform），
    // 把校验挡在 CI 里，不用起 GUI 才发现。
    const harness = try native_sdk.TestHarness().create(std.testing.allocator, .{});
    defer harness.destroy(std.testing.allocator);
    try harness.runtime.createTray(tray_options);
}

test "every tray row that does something can be routed" {
    // 有 command 的行必须能被 event() 认出来，否则点了没反应
    for (tray_items) |item| {
        if (item.command.len == 0) continue;
        try std.testing.expect(std.mem.eql(u8, item.command, cmd_show) or
            std.mem.eql(u8, item.command, cmd_quit));
        // 带 command 的行必须有非零 id，否则 SDK 校验会拒
        try std.testing.expect(item.id != 0);
    }
}
