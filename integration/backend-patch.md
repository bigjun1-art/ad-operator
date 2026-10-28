# 现有后端的接入点

把同目录四个 `headless-*.mjs` 和 `suixin-report-contract.mjs` 复制到现有工作台项目根目录；保留原工作台的配置、凭据适配、API校验、金额适配和路由，不使用其他账户的配置。

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

随心推需要独立的`GET /api/suixin/accounts`：账户发现、组织展开和店铺展开均使用随心推应用自身授权，缓存按应用分开，不复用千川PC账户授权。受控手动写入授权检查也必须选择相应应用。

`GET /api/suixin/orders`在明确`scene=all`时返回两类普通订单的完整游标库存，并附`mode=normal, complete=true`；全域库存独立使用`uni_orders`。只有完整分页真实完成后才能标记完整。普通订单终止参数是实际`order_id`，不能用`ad_id`或全域订单ID替代；返回成功订单ID与后续只读状态核对分别保留。

临时调用通过 `headless-server-child.mjs` 设置测试启动标志、受控模式和后台关闭，再手动监听随机127.0.0.1端口。生命周期结束关闭所属server与SQLite；不附着到已有网页后台。此集成依赖现有工作台原生路由，不是完整工作台的替代实现。

执行授权的截止时间还需通过私有临时请求的 expires-at 标头传入请求上下文，贯穿 `apiPost`、本地推写入适配和底层transport的 `writeDeadline` 选项。只在私有headless门禁开启的POST解析这个标头；普通网页请求不继承它。校验应覆盖服务端详情回读、并发等待、节流等待与凭据获取，在实际平台fetch前再次检查。过期且尚未发送的请求必须保留 `requestDispatched:false`，不能将它改成未知回执或允许继续发送。

随心推普通和商品全域报表在汇总前调用`checkedSuixinCore`核对真实核心字段，不能将null、缺失或非法值补成0；库存用`checkedSuixinOrderPage`核对has_more、失败项和游标，缺少完整性证据时不可返回complete=true。日期范围和金额口径继续由原后端验证，不把不完整结果交给托管规则。

## 乘方与三平台知识调用（0.3）

新增适配模块为 `chengfang-policy.mjs`、`chengfang-report.mjs`、`chengfang-http.mjs`、`chengfang-tasks.mjs`、`chengfang-task-store.mjs`、`execution-preconditions.mjs`，并同步本目录 `verified-plan-update.mjs`。后端原有 `report-contract.mjs`、`report-currency-service.mjs`、官方请求契约、精确ID传输和日期范围模块继续提供依赖。

`server-chengfang.patch`给出现有后端接线差异：注册乘方请求处理、绑定账户、传递托管模式和配置指纹、允许明确的调控工具路径。应用前读取当前后端内容并合并相应段落，保留本机已有修改。

GET `/api/chengfang/fields/report/context/diagnose/tasks/task/receipt`分别提供指标配置、报表、配置、诊断、任务和回执。追投准备使用GET `/api/chengfang/boost/prepare`，实际写入使用POST `/api/chengfang/boost/create/update/status`。广告层调用均经原 `apiGet/apiPost`，在实际POST前校验授权截止时间。

临时进程接收 `AD_OPERATOR_TASK_STATE_DIR`，回执存于私人 `stateRoot/task-receipts`。配置指纹经 `x-workbench-headless-precondition` 传递，并在最终持锁读取后校验；`x-workbench-headless-mode=managed`标识已明确开启的托管执行。上述标头只用于所属本机临时后台。

知识库调用在Skill进程读取本机索引和已配置正文缓存，无需启动广告后台。三平台入口、缓存格式及命令见 `references/knowledge.md`。
