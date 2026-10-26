# 现有后端的接入点

把同目录四个 `headless-*.mjs` 复制到现有工作台项目根目录；保留原工作台的配置、凭据适配、API校验、金额适配和路由，不使用其他账户的配置。

后端需导出 `server` 和 `watchStore`，并在 `WORKBENCH_TEST=1` 时不自行监听、不启动后台。受控模式 `WORKBENCH_READONLY_PREVIEW=1` 使用独立内存监控库，不加载已有托管策略，但允许已经过账户绑定检查的原手动写路由。账号预算必要回执仍由原适配保存。

HTTP入口最前方需要私有请求门禁：

```js
if (process.env.WORKBENCH_HEADLESS_KEY &&
    req.headers['x-workbench-headless-key'] !== process.env.WORKBENCH_HEADLESS_KEY) {
  return fail(res, 403, '此临时后台仅接受所属对话进程的请求');
}
```

该值是每次临时运行生成的随机本机请求标识，不是广告凭据，不持久化或输出。没有此门禁的旧后端不能作为本适配的已验证运行环境。

增加 `GET /api/plan/detail`，接收本次明确账户与 `ad_id`，先核实账户在当前授权列表，再调用已支持的 `qianchuan/uni_promotion/ad/detail/`，保持精确ID、使用新鲜读取并核对返回 `ad_id`。不能把标准计划ID或主播汇总ID送入全域计划写接口。

临时调用通过 `headless-server-child.mjs` 设置测试启动标志、受控模式和后台关闭，再手动监听随机127.0.0.1端口。生命周期结束关闭所属server与SQLite；不附着到已有网页后台。此集成依赖现有工作台原生路由，不是完整工作台的替代实现。

执行授权的截止时间还需通过私有临时请求的 expires-at 标头传入请求上下文，贯穿 `apiPost`、本地推写入适配和底层transport的 `writeDeadline` 选项。只在私有headless门禁开启的POST解析这个标头；普通网页请求不继承它。校验应覆盖服务端详情回读、并发等待、节流等待与凭据获取，在实际平台fetch前再次检查。过期且尚未发送的请求必须保留 `requestDispatched:false`，不能将它改成未知回执或允许继续发送。
