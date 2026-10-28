# ad-operator

<p align="center">
  <img src="./assets/readme/command-surface.svg" width="100%" alt="ad-operator：用自然语言指挥投放。用户指令经过 Agent 和巨量引擎 MAPI，完成数据查询、授权执行与结果回读，连接千川、随心推和巨量本地推。">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#用对话组织投放">对话操作</a> ·
  <a href="#按分钟跟踪按素材分析">分钟盯盘与素材分析</a> ·
  <a href="#三个平台一套对话入口">平台能力</a>
</p>

**你的投放指令，由 Agent 执行。**

ad-operator 将千川、随心推和巨量本地推工作台接入自然对话。你指定账户、投放对象、处理条件与允许动作，Agent 通过巨量引擎 MAPI（营销开放接口）读取数据，提出建议或执行授权操作，再查询平台结果。

你可以在一次对话里选户、查报表、查看计划素材、调整预算与目标 ROI、管理启停；也可以设定查询频率和结束时间，让 Agent 持续跟踪投放。日常查询与单次调整按需启动、完成后关闭，连续盯盘和托管按你设定的期限运行，无需常开网页。

## 用对话组织投放

完成安装和平台授权后，可以这样下达指令：

> 列出我已授权的千川账户。
>
> 查询这个本地推账户的日预算，告诉我当前金额和生效方式。
>
> 列出这个千川计划里的素材名称、ID 和状态。
>
> 把这个千川全域计划的预算调整到我指定的金额，完成后查询实际配置。

持续盯盘时，一次说明账户、报表范围、频率、处理条件和结束时间。例如：

> 监控这个千川账户的视频投放，每分钟查询一次整体报表，持续到今晚十点。达到我设定的条件时给出建议，由我决定是否执行。

单次修改时，Agent 先读取当前配置，再提交你指定的目标值，随后查询平台结果。持续运行提供两种模式：

| 模式 | 如何处理投放 |
| --- | --- |
| 半自动建议 `recommend` | 定时取数，条件命中后保存具体建议；你授权执行后，再提交对应操作。 |
| 全自动托管 `managed` | 按你事先确定的规则，自动执行指定账户、对象和动作范围内的操作，并遵守金额、动作次数和截止时间限制。 |

每条规则在一次托管中最多触发一次。规则全部完成、授权到期或你叫停时，进程退出。收到无法确认结果的回执时，托管停止后续操作，保留记录供查询核对。

停止托管会关闭监控和执行进程。若要同时暂停广告，需要在指令中指定要暂停的计划、项目或单元。托管规则与管理命令见[持续运行说明](references/managed.md)。

## 按分钟跟踪，按素材分析

投放中的决策需要连续的数据：这一轮花了多少、订单如何变化、哪些素材值得继续观察。工作台将定时查询、素材表现和投放操作放在同一套流程中，由你设定处理条件，Agent 负责取数、分析和执行。

对话 Skill 按指定对象读取千川分区报表，并将素材表现、调控任务和执行回执关联到同一条投放指令。

- **定时查询投放表现。** 对话监控支持 15～3600 秒的查询间隔，例如每 60 秒读取一次所选账户、商品计划、主播、素材或追投任务的数据。每轮取得平台当时返回的消耗、订单和 ROI，按你设定的条件形成建议或执行投放调整。
- **记录素材表现。** 千川素材跟踪同时绑定计划与素材 ID，读取当前账户允许的报表字段、单位和统计期间，计算相邻完整快照的消耗、订单增量及每分钟变化。素材审核、投放状态和任务状态分别保留。
- **通过对话操作投放。** 入口支持账户和报表查询、计划或项目配置调整、千川素材清单与移除，以及追投创建、名称与预算等设置修改、暂停、开启和手动结束。每次执行保存稳定请求标识和平台回执。

你可以为规则设置连续命中次数、最短观察窗口、动作冷却、调整比例、单次预算和追加预算总额度。严格“小于”和“小于等于”分别执行。产品、期间或累计数据重置时重新开始观察；提交前核对准备时的配置，原值变化则重新计算操作额度。

## 从投放跟踪到复盘报告

直接对Agent说“把这份导出报表按素材分析，列出消耗前十，并做四表周报”，即可沿用当前平台入口完成导入、查询、诊断和导出。平台CSV可按UTF-8或GBK读取，也可从已授权账户采集只读报表。

报表保存一次取数的快照，汇总、排序、诊断、对比和导出共同引用它。金额按列识别单位，原始值与换算值分别保留；长ID使用字符串，缺失值保持空白。支付、净成交和综合营销ROI分别记录，退款成熟度、归因窗口与时区进入报告口径。

周报包含场次核心明细、周报汇总、数据底表、数据字典四张表。分组区域随数据行数展开，底表保留公式，导出后重新打开逐格核对。对话中的追问可直接对同一快照调用汇总、排序、搜索与分组工具，保留源行号。

持续盯盘也会检查数据时效；推荐动作随采集证据和策略期限到期。分页返回保留逐页回执，一次命令记录实际请求次数、耗时和平台请求标识。

命令与数据结构见[报表操作](references/reports.md)，代码参考及融合位置见[四仓库对比](references/source-comparison.md)。

## 三个平台，一套对话入口

| 平台 | 查询功能 | 投放操作 |
| --- | --- | --- |
| [千川](subskills/ad-operator-qianchuan/SKILL.md) | 授权账户、分区与素材报表、全域/乘方计划、追投任务、余额和预算 | 计划预算、ROI、启停；素材移除；追投创建、修改、暂停、开启和结束 |
| [随心推](subskills/ad-operator-suixin/SKILL.md) | 普通订单、商品全域订单与报表、趋势、建议和预估 | 终止指定普通订单 |
| [巨量本地推](subskills/ad-operator-local/SKILL.md) | 授权账户、标准项目和单元、素材、账户日预算、全域历史受众 | 账户日预算、标准项目预算、标准项目和单元启停 |

随心推的终止操作会结束普通订单，当前没有对应的恢复动作。创建订单、修改随心推预算与 ROI 尚未接入。

本地推全域的对象预算、目标 ROI、素材创建、修改、暂停和关闭尚未接入；当前启停操作用于标准项目和单元。全域受众查询提供前一天及更早日期的受众分布，可按直播、门店和受众维度筛选。

### 一个主 Skill，三个平台入口

主 Skill 根据业务选择平台；三个子 Skill 分别处理本平台的账户授权、投放对象和接口参数，共用查询与执行程序。随心推使用自身应用授权，与千川 PC 应用分别取得账户列表。

### 先读业务知识，再调用投放接口

三平台均可通过对话检索本机知识库，读取官方手册、规则和操作资料，并保留原始链接、日期和版本。千川接入乘方知识链，本地推接入官方知识链，随心推复用已有普通、全域商品和全域直播资料索引。

```sh
node scripts/ad.mjs knowledge search --platform qianchuan --query '乘方 综合营销 ROI'
node scripts/ad.mjs knowledge search --platform local --query '直播 全域'
node scripts/ad.mjs knowledge search --platform suixin --query '随心推 全域 推商品'
```

配置与正文读取见[三平台知识库调用](references/knowledge.md)，乘方指标、素材条件与任务操作见[乘方操作](references/chengfang.md)。

### 报表与金额

- **千川余额：**`account_general_total` 原值的单位为千分之一分，除以 100000 得到元。查询同时保留原值和元值。
- **千川报表：**乘方、全域和整体期间分别取数；乘方采用官方综合营销 ROI，成本中明确纳入的预估达人佣金和团长服务费分别记录。官方 ROI 与按已确认成本计算的值单列。标准投放通过 `dim=standard` 查询。
- **本地推预算：**账户日预算以元设置，最多两位小数；标准项目详情中的预算和出价原值为分，查询另给元值，修改预算时输入元。隔日预算受理后，按回执中的生效日期查询结果。
- **随心推普通报表：**金额字段保留接口原值，附 `unitKnown:false`。当前托管支持在用户未设置金额条件时，按订单数触发普通订单终止；带金额条件的规则暂不可运行。

## 快速开始

运行环境需要 **Node.js 24 或更新版本**，以及已完成平台授权的兼容投流工作台后端。本仓库提供 Skill 和后端适配源代码；完整工作台后端需另行部署。

### 1. 安装 Skill

在默认本地 Skill 目录安装：

```sh
git clone https://github.com/bigjun1-art/ad-operator.git ~/.codex/skills/ad-operator
cd ~/.codex/skills/ad-operator
node scripts/install-subskills.mjs
```

已有安装时从原目录更新，并保留本地修改。安装脚本为三个子 Skill 建立链接；遇到指向其他内容的同名目录或链接时会停止。

### 2. 配置后端路径

创建 `~/.config/ad-operator/config.json`，将 `backendRoot` 替换为本机后端的实际绝对路径：

```json
{
  "backendRoot": "/absolute/path/to/qianchuan-console",
  "knowledgeRoot": "/absolute/path/to/wiki001",
  "knowledgeCaches": ["/absolute/path/to/official-document-crawl"]
}
```

首次接入后端时，按[后端接入说明](integration/backend-patch.md)安装适配模块并合并所附接线差异，配置所需路由和请求校验。平台凭据由原后端管理。本机配置保存后端路径，运行状态默认保存在 `~/.local/state/ad-operator`；账户数据、操作回执和托管规则保存在本机，发布仓库时排除这些文件。

### 3. 查询账户

在主 Skill 目录运行：

```sh
node scripts/ad.mjs doctor
node scripts/ad.mjs actions qianchuan
node scripts/ad.mjs read accounts.list --platform qianchuan
```

`doctor` 检查配置和后端文件，`actions` 列出操作，`read accounts.list` 查询该应用授权的账户。随心推的平台参数为 `suixin`，本地推为 `local`。

查询具体操作所需的参数：

```sh
node scripts/ad.mjs describe marketing.report.get --platform qianchuan
node scripts/ad.mjs describe boost.create --platform qianchuan
node scripts/ad.mjs describe order.terminate --platform suixin
node scripts/ad.mjs describe account.budget.set --platform local
```

参数结构、执行授权和返回结果见[主 Skill 说明](SKILL.md)。

## 开发资料

- [scripts/](scripts/)：命令入口、子 Skill 安装和托管运行程序。
- [integration/](integration/)：现有后端的适配代码与接入说明。
- [references/backend.md](references/backend.md)：本地配置、运行状态目录与后端依赖。
- [references/managed.md](references/managed.md)：托管对象、指标、窗口、停止和结果核对。
- [references/chengfang.md](references/chengfang.md)：乘方口径、素材条件和任务生命周期。
- [references/reports.md](references/reports.md)：快照、查询、条件诊断与四表导出。
- [references/source-comparison.md](references/source-comparison.md)：四个参考仓库的源码差量与接入位置。
- [references/knowledge.md](references/knowledge.md)：三平台知识入口和本地正文缓存。

运行测试：

```sh
npm test
```

测试通过隔离驱动和临时目录验证平台入口、安装、授权与进程退出。后端 HTTP 和完整运行流程的测试在工作台后端项目中执行。
