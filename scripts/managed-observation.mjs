const exact=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export const SCOPED_METRICS=new Set(['marketing_roi','calculated_marketing_roi','cost_delta','orders_delta','cost_per_minute','orders_per_minute','ctr']);
export function validateMonitor(policy){
 const m=policy.monitor;if(!m)return;
 if(policy.platform!=='qianchuan'||!['account','plan','anchor','material','task'].includes(m.level)||!['live','video'].includes(m.scene)||!['chengfang','uni','combined'].includes(m.period))throw Error('请明确千川跟踪层级、直播或商品场景、数据期间');
 const keys=['ad_id','anchor_id','material_id','task_id'];for(const k of keys)if(m[k]!==undefined&&!exact(m[k]))throw Error('跟踪对象需要精确ID：'+k);
 if(['plan','material','task'].includes(m.level)&&!m.ad_id||m.level==='material'&&!m.material_id||m.level==='anchor'&&!m.anchor_id||m.level==='task'&&!m.task_id)throw Error('跟踪范围缺少对应计划、素材、主播或任务ID');
 if(m.level==='plan'&&m.scene==='live')throw Error('直播表现按主播统计，请指定anchor层级及精确主播ID');
 for(const r of policy.rules||[]){
  if(m.period==='combined'&&/roi/.test(r.metric))throw Error('整体期间规则请选择消耗、订单或流速；ROI规则需指定乘方或全域期间');
  if(m.period==='chengfang'&&m.level!=='task'&&['payment_roi','net_roi'].includes(r.metric))throw Error('乘方期间请使用marketing_roi或明确的calculated_marketing_roi');
  if(m.level==='task'&&['marketing_roi','calculated_marketing_roi'].includes(r.metric))throw Error('追投任务使用调控支付ROI或调控净成交ROI');
  if(r.consecutiveObservations!==undefined&&(!Number.isInteger(r.consecutiveObservations)||r.consecutiveObservations<1||r.consecutiveObservations>100))throw Error('连续命中次数需要1至100的整数');
  if(r.minObservationSeconds!==undefined&&(!Number.isFinite(r.minObservationSeconds)||r.minObservationSeconds<0||r.minObservationSeconds>86400))throw Error('观察窗口需要0至86400秒');
  const p=r.action?.params||{};
  if(m.ad_id&&p.ad_id&&p.ad_id!==m.ad_id)throw Error('规则操作计划与跟踪绑定计划不一致');
  if(m.level==='task'&&p.task_id&&p.task_id!==m.task_id)throw Error('规则操作任务与跟踪任务不一致');
  if(m.level==='material'&&p.material_ids&&p.material_ids.some(id=>id!==m.material_id))throw Error('单素材规则只能操作本次绑定的素材');
 }
 if(policy.minActionIntervalSeconds!==undefined&&(!Number.isFinite(policy.minActionIntervalSeconds)||policy.minActionIntervalSeconds<0||policy.minActionIntervalSeconds>86400))throw Error('动作冷却间隔需要0至86400秒');
 if(policy.maxChangePercent!==undefined&&(!Number.isFinite(policy.maxChangePercent)||policy.maxChangePercent<=0||policy.maxChangePercent>100))throw Error('单次数值调整比例上限需要0至100之间的正数');
}
export function monitorReadRequest(policy){
 const m=policy.monitor;if(!m)return {mode:'read',action:'overview.get',platform:policy.platform,accountId:policy.accountId,params:policy.platform==='local'?{range:'realtime',...(policy.scope.mgoal?{mgoal:policy.scope.mgoal}:{}),...(policy.scope.delivery?{delivery:policy.scope.delivery}:{})}:{...policy.scope,range:'realtime'}};
 const params={...m,range:'realtime'};if(m.level==='task'){delete params.level;delete params.scene;delete params.period;return {mode:'read',action:'boost.task.get',platform:'qianchuan',accountId:policy.accountId,params};}
 return {mode:'read',action:'marketing.report.get',platform:'qianchuan',accountId:policy.accountId,params};
}
export function scopedObservation(raw,policy,previous,at){
 const d=raw?.data,m=policy.monitor,s=d?.scope;
 if(raw?.ok!==true||d?.complete!==true||!s||s.accountId!==policy.accountId||s.level!==m.level)throw Error('跟踪数据的账户、层级或完整性与策略不一致');
 for(const k of ['scene','period','ad_id','anchor_id','material_id','task_id'])if(m[k]!==undefined&&s[k]!==m[k])throw Error('跟踪数据对象或期间不一致：'+k);
 const source=d.summary||{},summary=Object.fromEntries(['cost','orders','marketing_roi','calculated_marketing_roi','payment_roi','net_roi','cash_return_ratio','ctr'].map(k=>[k,finite(source[k])]));
 const key=JSON.stringify(s),epoch=String(d.epoch??key),observedAt=finite(d.observedAt)??at;
 const same=previous?.scopeKey===key&&previous?.epoch===epoch&&observedAt>previous.at&&previous.day===new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(at));
 const seconds=same?(observedAt-previous.at)/1000:null;
 for(const metric of ['cost','orders']){
  const delta=same&&summary[metric]!==null&&finite(previous.summary?.[metric])!==null?summary[metric]-previous.summary[metric]:null;
  summary[metric+'_delta']=delta!==null&&delta>=0?delta:null;summary[metric+'_per_minute']=delta!==null&&delta>=0&&seconds>0?delta*60/seconds:null;
 }
 const costRebased=same&&summary.cost!==null&&finite(previous.summary?.cost)!==null&&summary.cost_delta===null;
 const ordersRebased=same&&summary.orders!==null&&finite(previous.summary?.orders)!==null&&summary.orders_delta===null;
 const reset=!same||costRebased||ordersRebased;
 return {summary,scope:s,scopeKey:key,epoch,at:observedAt,day:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(at)),baselineAt:reset?observedAt:previous.baselineAt??previous.at,reset};
}
export function boundedNumericChange(policy,action,prepared){
 if(policy.maxChangePercent===undefined)return;
 const p=action.params||{},before=prepared?.prepared?.before||{},task=before.task||before,config=task.delivery_setting||task;
 for(const field of ['budget','roi2_goal'])if(p[field]!==undefined){const original=finite(config[field]);if(original===null||original<=0)throw Error('当前'+field+'缺少可比较原值，未提交比例调整');if(Math.abs(p[field]-original)*100/original>policy.maxChangePercent+1e-8)throw Error('本次'+field+'调整超过策略允许比例');}
}
