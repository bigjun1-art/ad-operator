# 本地配置与能力边界

需要Node.js 24或更新版本，以及已配置授权、包含 `headless-runtime.mjs` 和 `headless-actions.mjs` 的现有投流工作台后端。本仓库提供对话Skill和运行控制，不打包广告账户、授权模块、工作台业务数据或完整网页应用。

默认配置文件为 `~/.config/ad-operator/config.json`，也可由 `AD_OPERATOR_CONFIG` 指定本地文件：

```json
{
  "backendRoot": "/absolute/path/to/qianchuan-console",
  "stateRoot": "/absolute/path/to/private-ad-operator-state"
}
```

`stateRoot`可省略，默认 `~/.local/state/ad-operator`。目录和文件只保存在本机；不要把配置、账户列表、授权文件、回执和运行状态复制进Git仓库。凭据由原后端已有的凭据适配器提供，Skill不读取、显示或复制凭据。

新建环境需要把 `integration/` 中的headless适配文件放到现有后端项目根目录；后端本身还需相应的只读计划详情与私有临时入口门禁。集成文件是适配源代码，不是独立广告SDK，不能在没有原后端的目录直接运行。现有本机安装由 `doctor` 验证文件可用性；它不等于账户授权已核实。

日常操作通过 `actions`/`describe`取得当前字段定义。相同动作在两平台的对象、枚举和金额单位可以不同。任何写操作都应先取得真实授权账户和对应对象，不能使用示例ID执行。

读取过程失败时保留原错误，不把空数组、零金额或模拟数据作为平台结果。尚未公开的本地推全域写入保持明确不可用，网页历史脚本存在不等于正式MAPI已开放。
