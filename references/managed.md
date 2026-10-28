# 持续监控与托管

用户明确开启持续盯盘或托管后启动进程，绑定账户、对象、允许动作、金额及期限。`recommend` 定时生成建议，`managed` 按事先授权的规则执行。

```sh
node scripts/ad.mjs managed validate
node scripts/ad.mjs managed start --confirm-managed
node scripts/ad.mjs managed status SESSION_ID
node scripts/ad.mjs managed stop SESSION_ID
node scripts/ad.mjs managed reconcile SESSION_ID
```

`validate`只检查输入，`start`接受标准输入中的完整策略，`reconcile`在会话停止后通过只读请求核对未明动作。运行状态保存在本机配置的 `stateRoot`。

## 千川跟踪对象

千川新增 `monitor`，示例为结构说明，使用前填入用户确定的实际值：

```json
{
  "platform": "qianchuan",
  "accountId": "ACCOUNT_ID",
  "mode": "recommend",
  "explicitManagedAuthorization": false,
  "userInstruction": "用户本人明确的持续监控指令",
  "expiresAt": "FUTURE_ISO_TIME",
  "intervalSeconds": 60,
  "monitor": {
    "level": "material",
    "scene": "video",
    "period": "chengfang",
    "ad_id": "PLAN_ID",
    "material_id": "MATERIAL_ID"
  },
  "entityIds": ["PLAN_ID"],
  "taskIds": ["TASK_ID"],
  "materialIds": ["MATERIAL_ID"],
  "allowedActions": ["boost.status.set"],
  "maxObservedCost": 1000,
  "maxActionsPerDay": 3,
  "minActionIntervalSeconds": 900,
  "rules": [{
    "id": "pause-task",
    "metric": "marketing_roi",
    "operator": "lte",
    "threshold": 2,
    "consecutiveObservations": 3,
    "minObservationSeconds": 180,
    "action": {
      "name": "boost.status.set",
      "params": {"ad_id":"PLAN_ID","task_id":"TASK_ID","opt_type":"PAUSE","requestKey":"USER_INTENT_KEY"}
    }
  }]
}
```

示例金额、目标、次数和间隔由用户实际要求替换。`entityIds`绑定允许操作的计划，`taskIds`和`materialIds`分别绑定任务及素材。创建或修改追投预算还需要 `maxSingleBudget` 和 `maxAdditionalBudget`；追加总额计算已创建、待核实及结果未知动作的预算占用。

`monitor.level`为账户`account`、商品计划`plan`、直播主播`anchor`、素材`material`或追投任务`task`。单素材需同时给出计划和素材ID，任务需计划和任务ID。直播按主播统计，使用`anchor_id`绑定。

`period`选择`chengfang/uni/combined`。乘方期间使用官方`marketing_roi`或明确选择的`calculated_marketing_roi`；全域期间使用支付或净成交ROI。整体期间按消耗、订单及流速制定规则。

## 指标与观察窗口

比较符使用 `gt/lt` 表示严格大于/小于，`gte/lte` 表示大于等于/小于等于，`eq/neq` 表示等于/不等于。

可用指标包括消耗`cost`、订单`orders`、官方支付ROI`payment_roi`、官方净成交ROI`net_roi`、实付金额/消耗`cash_return_ratio`、综合营销ROI及具名计算值、单素材CTR，以及消耗/订单增量和每分钟增量。

连续完整快照按同一账户、对象、期间和成本口径计算增量。更换对象、切换期间或产品、跨统计日、累计数据回落时重新开始观察窗口。指标缺失中断该规则的连续命中计数。

- `consecutiveObservations`：连续达到条件的轮数。
- `minObservationSeconds`：基线建立后最短观察时间。
- `minActionIntervalSeconds`：本会话已执行动作之间的冷却时间。
- `maxChangePercent`：数值动作相对当前原值的调整比例上限。

查询间隔为15～3600秒。每条规则在一次会话最多触发一次；规则完成、用户叫停或授权到期后退出。官方数据的统计周期和更新状态随查询结果保留。

## 支持的动作

千川支持计划预算、ROI、启停，以及授权的追投创建、修改和状态操作。素材移除通过单次明确授权执行。乘方托管创建使用该计划、产品类型、场景和目标已有的成功创建及精确回读记录；证据保存在私人任务回执目录。

追投任务的`PAUSE`表示暂停、`ENABLE`表示开启、`DISABLE`表示手动结束。暂停成功ID记录为受理，最终状态未明确时停止后续规则。用户明确开启或结束同一任务后，精确回读的新状态可将原暂停请求标记为被替代。

任务指标保留任务合计。用户未设置金额条件、只允许暂停或结束任务时，可按任务订单数或任务ROI监控；金额阈值使用已有单位核验结果的计划或素材报表。

本地推连续监控限定标准投放的明确`mgoal/delivery`范围，允许标准项目预算、项目和单元启停及账户日预算。随心推连续监控限定普通订单`scope.dim=normal`和明确`scene`，执行对象为普通`order_id`，允许终止订单。随心推金额单位状态为未知时，用户未设置金额边界的订单数规则可运行。

## 金额和生命周期

`maxObservedCost`限制所选监控范围的观察成本。达到后，停止新增预算和ROI调整，仅执行已授权且命中条件的暂停或结束动作，然后退出。实际平台预算通过对应预算动作设置。

`maxSingleBudget`限制单次目标预算。`maxActionsPerDay`统计本会话执行次数；账户日预算解除上限还需`allowUnlimitedBudget:true`及用户对该效果的明确授权。

准备结果记录当前配置指纹，执行时在持锁读取和最终提交前核对原值；配置变化时以未提交状态退出，重新读取和计算额度。写入前保存动作，执行边界再次检查有效期。回执未知、只有受理结果或隔日待生效时停止后续写入，按原回执查询核对。进程停止后保留原记录；新会话重新取得用户授权。

停止托管关闭所属进程及临时后台。广告启停按用户对具体投放对象的指令执行。

## 采集时效与建议有效期

`maxDataAgeSeconds`指定采集数据的有效秒数，默认取60秒与三倍查询间隔中的较大值。取数失败、时间缺失、超时或时间晚于当前时刻时，本轮停止条件判断，保留最近成功快照和采集健康状态。后端缓存沿用最初成功采集时间。

推荐动作保存建议ID、创建时间、截止时间、账户对象、策略摘要、证据摘要、准备意图和配置指纹。截止时间取策略截止与采集证据失效中的较早值；到期后状态为`expired`。执行建议时先核对有效期与绑定信息，再通过现有`prepare/execute`接受对应用户授权。
