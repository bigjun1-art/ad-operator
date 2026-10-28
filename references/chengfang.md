# 千川乘方：数据、素材与执行

## 产品和期间

乘方配置对应 `OVERALL_PROJECT`，全域对应 `UNI_PROJECT`。从官方计划列表的 `ad_info.id/adlab_scene` 定位计划；计划详情保留原始产品字段。全域升级乘方后计划 ID 延续，期间和指标随产品状态变化。

`marketing.report.get` 明确指定：

- `scene`：`live` 或 `video`。
- `level`：`account`、商品 `plan`、直播 `anchor`、`material`。
- `period`：`chengfang`乘方期间、`uni`全域期间、`combined`整体期间。
- 计划、主播和素材分别使用 `ad_id`、`anchor_id`、`material_id`。单素材同时绑定计划。

`marketing.fields.get` 读取当前账户、主题和期间允许的指标及维度。系统依据返回的名称、定义、单位和精确筛选字段建立绑定，返回实际字段、歧义与缺项。

## ROI和金额

乘方期间读取官方 `marketing_roi`；按已确认成本成分计算的值单列为 `calculated_marketing_roi`。基础投放使用净成交金额和投放消耗；开启相关佣金成本优化时，将预估达人佣金和明确纳入的团长服务费加入分母。实际结算佣金另行保留。

2026-08-01起电商技术服务费退出综合营销ROI计算。查询范围跨越该日期时，保留官方ROI，派生计算留空。整体期间汇总金额和订单，各阶段ROI分别查看。

配置单位1为千分之一分、2为分、3为元，按字段及原始来源处理。已有金额核验适配提供元值和证据；新金额字段保留单位、原值和归一结果。未取得单位依据的字段保持空值。

## 素材来源检查

用 `marketing.context.get` 读取计划佣金、星选开关、商品、抖音号和成本项原值。根据官方返回及来源资料组织检查输入，再运行：

```sh
node scripts/ad.mjs assess supply --platform qianchuan
```

标准输入为实际证据对象：`source:own|xingxuan|affiliate`，账户、商品、抖音号、素材ID和同名 `binding`；自有素材使用 `authorized`。

星选对象 `xingxuan` 包含任务有效状态、协议、商品绑定、能力开关和官方/自运营授权类型。联盟素材检查投放授权；自动选材时以 `deliveryMode:auto` 检查自动投开关。双佣素材另记录商家双佣设置、素材结算方式、生效时间、投放期佣金状态及商品店铺和账户店铺绑定。

评估输出 `checks` 和证据状态，用于解释候选素材是否具备相应投放条件。实际修改仍按本次用户授权和接口回读执行。

## 素材追投

| 动作 | 用途 |
|---|---|
| `boost.tasks.list` / `boost.task.get` | 读取计划调控任务和精确任务详情 |
| `boost.create` | 创建指定素材追投 |
| `boost.update` | 修改任务名称、预算、ROI目标、素材或适用时长 |
| `boost.status.set` | `PAUSE`暂停、`ENABLE`开启、`DISABLE`手动结束 |
| `boost.receipt.get` | 按原requestKey查询并核对回执 |

创建参数包括 `ad_id/name/budget/material_ids/objective/requestKey`。单次1～20个视频素材，名称1～50字，预算为元、两位小数且在当前计划预算内。直播控成本追投支持 `payment_roi/net_roi/volume`，放量任务省略ROI目标；直播控成本计划的素材追投长期有效，省略时长。商品放量追投使用 `objective:volume`，设置0.5～24小时、步进0.5小时的时长。商品ROI追投需取得对应目标合约后再接入。

主计划日预算与追投追加预算分别记录。修改任务先回读当前名称、预算、素材和目标；任务指标保留任务合计。全域素材接口返回查询期间有消耗的素材；新素材可通过通用计划素材接口取得该计划下的精确素材ID及审核、删除、投放状态作为补充证据。实际返回匹配且状态可投时才进入追投准备。

创建成功使用返回的精确任务ID回读。暂停接口的成功ID证明受理；当前官方列表未给出独立暂停状态枚举，回执保持 `receipt_only`。用户另行明确开启或结束同一任务时可执行，并在新状态回读成功后标记原暂停请求被替代。未知创建保持占额和同计划拦截，使用原回执查询。

官方产品资料明确乘方支持素材追投；公开MAPI创建文档仍使用全域控成本表述。乘方托管创建需要同计划、产品、场景和目标已有创建及精确回读成功的本地记录；逐次授权创建的结果按真实回执保存。

## 分钟跟踪和诊断

托管的 `monitor` 明确跟踪账户、计划、主播、素材或任务。两次完整、同期间、同对象快照计算 `cost_delta/orders_delta/cost_per_minute/orders_per_minute`；产品、成本口径、日期或累计数据重置时，重新开始观察窗口。

规则可设置连续命中次数、最短观察时间、动作冷却、调整比例、单次预算和追加预算总额度。`marketing.diagnose` 按实际余额、相同期间的预算与消耗提供发现；`logs.list` 按账户或精确计划读取操作记录，`assess diagnose` 对已取得的状态和调整记录进行只读解释。

## 官方依据

- [乘方产品手册](https://bytedance.larkoffice.com/docx/V08mdNhrcolk4Gx5t21cLuoRn2O)，修订2082，2026-10-28取得。
- [数据分区](https://bytedance.larkoffice.com/wiki/D7K9worVFiIUAakXOmlcbyHonkz)，修订159。
- [基础FAQ](https://bytedance.larkoffice.com/wiki/SjgCw3q3fiP5iPkrBNRc1lbYnyb)，修订427。
- [达人营销](https://bytedance.larkoffice.com/docx/PB7Rd9XLeoRpGMxsVyCctL7tnbb)，修订2068。
- [配置维度与指标](https://open.oceanengine.com/labels/12/docs/1823296280645708)、[报表数据](https://open.oceanengine.com/labels/12/docs/1823297941140569)。
- [创建调控任务](https://open.oceanengine.com/labels/12/docs/1825827435645963)、[修改任务](https://open.oceanengine.com/labels/12/docs/1848759062499338)、[任务状态](https://open.oceanengine.com/labels/12/docs/1825827367287017)、[任务列表](https://open.oceanengine.com/labels/12/docs/1824940765838411)。
