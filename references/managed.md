# 持续运行

`managed validate`只校验政策，不启动；`managed start --confirm-managed`在用户明确授权后持续运行；`managed status SESSION_ID`查询，`managed reconcile SESSION_ID`在停止后只读核实未明动作；`managed stop SESSION_ID`停止所属进程及临时子进程。没有安装定时任务、登录启动项或系统服务。

启动输入包含以下内容。以下是结构说明，必须用用户已明确同意的真实值填写，不可以直接启动占位示例：

```json
{
  "platform": "qianchuan",
  "accountId": "ACCOUNT_ID",
  "mode": "recommend",
  "explicitManagedAuthorization": false,
  "userInstruction": "用户本人明确的持续监控或托管指令",
  "expiresAt": "FUTURE_ISO_TIME",
  "intervalSeconds": 60,
  "scope": {"dim":"all","scene":"video"},
  "entityIds": ["PLAN_ID"],
  "allowedActions": ["plan.status.set"],
  "maxObservedCost": 1000,
  "maxSingleBudget": 500,
  "maxActionsPerDay": 3,
  "rules": [{
    "id":"pause-at-threshold",
    "metric":"cost","operator":"gte","threshold":800,
    "action":{"name":"plan.status.set","params":{"ad_id":"PLAN_ID","opt_status":"DISABLE"}}
  }]
}
```

`recommend`只保存准备好的建议，等待用户通过普通execute操作批准；`managed`在同一份明确授权的范围内执行固定规则。每条规则每个会话最多触发一次；完成所有规则后退出，不循环重复调整。需要重新制定规则时先停原会话，再取得新授权，不能自行延长截止时间或增加对象。

支持的托管动作：千川计划预算、ROI、启停；随心推已明确授权的普通订单终止；本地推标准项目预算、项目/单元启停和账户日预算。素材删除不放入自动托管。只有平台接口和实际字段支持的动作才可执行，普通Skill支持某个手动动作不代表可放入托管。

随心推持续监控限定`scope.dim="normal"`及明确的`scene`，对象列表中放普通`order_id`，允许动作只为`order.terminate`。这是一项终止操作，没有恢复动作；用户只说暂停时不擅自改为终止。随心推商品全域与直播全域不能借这个普通接口终止。返回`complete=false`时，即使存在部分金额也不触发规则。

普通随心推金额单位尚未在当前公开正文中直接明确，查询会附未核实标记，不将非明确元金额用于成本阈值或用户的金额边界。当前可运行明确的订单数终止规则：用户未设置金额边界时才可省略`maxObservedCost`，且规则指标只能为`orders`。用户已经给出的金额条件不能为了启动而删去；有这类条件而单位未核时保持阻断，待核实单位后再执行。

本地推持续监控限定 `scope.dim="standard"`，可按动作定义设置 `mgoal` 和 `delivery`。不把全域T-1历史受众当作实时流速；缺失的官方ROI不会回退为现金比值。监控范围必须向用户说明：千川 `all` 指整体但不含标准，不能将这个范围的成本称作全平台账户总消耗。

可用规则指标为 `cost`、`orders`、`payment_roi`、`net_roi`、`cash_return_ratio`。后两种ROI字段与计算值不能互换；指标缺失时不触发相应规则。15秒是本工具允许的最短轮询间隔，并非官方延迟或频控承诺。

`maxObservedCost`是所选监控范围的成本边界，不是平台计费上限。达到后不再执行加预算或调ROI，只允许已经明确授权且命中的暂停动作或随心推普通订单终止，然后停止本技能。没有这类规则时不会擅自暂停或终止广告。实际账户预算应通过平台预算接口另行设置。

金额动作不得超过 `maxSingleBudget`；托管解除账户日预算上限还需要政策明确 `allowUnlimitedBudget:true`，并有用户对该效果的明确授权。`maxActionsPerDay`统计本技能当前会话内的动作，不代表平台账户所有来源的操作总量。原值或配置变化导致准备失败时保留错误，不猜新预算。

写入前保存动作状态，回执不明、隔日待核实、只有受理回执或明确拒绝时停止后续执行，不自动重发。查看实际配置与原操作记录后再决定如何处理。进程崩溃后不会自动恢复旧托管；未知动作必须先核实。

状态与日志保存在本地 `stateRoot`，不进入GitHub。停止命令会核对PID、工作脚本、会话路径和进程标识，只停止自己启动的进程。托管停止、规则完成或授权到期，均不代表广告本身已经暂停。
