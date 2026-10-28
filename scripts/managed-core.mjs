import {createHash} from 'node:crypto';
import {SCOPED_METRICS,validateMonitor,scopedObservation,boundedNumericChange} from './managed-observation.mjs';
const id=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v);
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const copy=v=>structuredClone(v);
const actions={qianchuan:new Set(['plan.budget.set','plan.roi.set','plan.status.set','boost.create','boost.update','boost.status.set']),suixin:new Set(['order.terminate']),local:new Set(['project.budget.set','project.status.set','promotion.status.set','account.budget.set'])};
const metrics=new Set(['cost','orders','payment_roi','net_roi','cash_return_ratio',...SCOPED_METRICS]);
const operators={gte:(v,t)=>v>=t,lte:(v,t)=>v<=t,gt:(v,t)=>v>t,lt:(v,t)=>v<t,eq:(v,t)=>v===t,neq:(v,t)=>v!==t};
export const businessDay=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const taskStopsWithoutMoney=p=>p.platform==='qianchuan'&&p.monitor?.level==='task'&&Array.isArray(p.allowedActions)&&p.allowedActions.length>0&&p.allowedActions.every(a=>a==='boost.status.set')&&Array.isArray(p.rules)&&p.rules.length>0&&p.rules.every(r=>['orders','orders_delta','orders_per_minute','payment_roi','net_roi'].includes(r.metric)&&r.action?.name==='boost.status.set'&&['PAUSE','DISABLE'].includes(r.action.params?.opt_type));
export function validateManagedPolicy(p,{now=Date.now(),requireAuthorization=true}={}){
 if(!p||!actions[p.platform]||!id(p.accountId))throw Error('托管须指定平台和精确单个账户ID');
 if(requireAuthorization&&p.explicitManagedAuthorization!==true||typeof p.userInstruction!=='string'||!p.userInstruction.trim())throw Error('只有用户明确开启持续托管或持续半自动监控，才能启动');
 if(!['recommend','managed'].includes(p.mode)||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=now)throw Error('需要运行模式和未来的授权截止时间');
 if(!Number.isInteger(p.intervalSeconds)||p.intervalSeconds<15||p.intervalSeconds>3600)throw Error('查询间隔须为15至3600秒');
 const mayOmitCost=p.maxObservedCost===undefined&&(p.platform==='suixin'||taskStopsWithoutMoney(p));
 if(!mayOmitCost&&!positive(p.maxObservedCost)||!Number.isInteger(p.maxActionsPerDay)||p.maxActionsPerDay<1)throw Error('需要监控范围成本及每日动作数量上限');
 if(!Array.isArray(p.allowedActions)||!p.allowedActions.length||p.allowedActions.some(a=>!actions[p.platform].has(a)))throw Error('允许动作不属于当前平台已接通的托管范围');
 if(p.allowedActions.some(a=>a.endsWith('budget.set'))&&!positive(p.maxSingleBudget)||p.maxSingleBudget!==undefined&&!positive(p.maxSingleBudget))throw Error('预算动作需要有效的单次预算上限');
 if(!Array.isArray(p.entityIds)||p.entityIds.some(v=>!id(v))||new Set(p.entityIds).size!==p.entityIds.length)throw Error('需要精确对象ID列表，不能用名称或ALL代替');
 if(p.platform==='local'&&p.scope?.dim!=='standard')throw Error('本地推连续监控目前只使用标准投放实时口径；全域历史受众不能代替实时数据');
 if(p.platform==='qianchuan'&&!p.monitor&&(!['all','standard','uni','overall'].includes(p.scope?.dim)||!['all','live','video'].includes(p.scope?.scene)))throw Error('请明确千川报表类型和场景');
 if(p.platform==='suixin'&&(p.scope?.dim!=='normal'||!['all','live','video'].includes(p.scope?.scene)))throw Error('随心推托管仅支持明确的普通订单范围，不能用全域订单调用普通终止接口');
 if(!Array.isArray(p.rules)||!p.rules.length||p.rules.length>50)throw Error('需要1至50条明确规则');
 validateMonitor(p);
 if(p.rules.some(r=>SCOPED_METRICS.has(r.metric))&&!p.monitor)throw Error('综合营销ROI、素材指标和流速规则需要明确monitor跟踪对象');
 if(p.platform==='qianchuan'&&!p.monitor&&p.scope?.dim==='overall'&&p.rules.some(r=>['payment_roi','net_roi'].includes(r.metric)))throw Error('乘方期间ROI规则请选择monitor与综合营销ROI字段');
 if(p.allowedActions.some(a=>a.startsWith('boost.'))&&!p.monitor)throw Error('素材追投托管需要明确的跟踪范围');
 if(p.allowedActions.some(a=>a==='boost.create'||a==='boost.update')&&(!positive(p.maxSingleBudget)||!positive(p.maxAdditionalBudget)))throw Error('追投创建和修改需要单次预算上限与追加预算总额度');
 if(p.platform==='suixin'&&p.maxObservedCost===undefined&&p.rules.some(r=>r.metric!=='orders'))throw Error('未设置金额边界的随心推终止规则只能使用订单数；金额策略须先核实单位');
 const seen=new Set();for(const r of p.rules){
  if(typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(r.id)||seen.has(r.id))throw Error('规则ID无效或重复');seen.add(r.id);
  if(!metrics.has(r.metric)||!Object.hasOwn(operators,r.operator)||typeof r.threshold!=='number'||!Number.isFinite(r.threshold)||r.threshold<0)throw Error('规则需要明确的官方指标或具名计算值、比较方向及阈值');
  const a=r.action,params=a?.params;if(!p.allowedActions.includes(a?.name)||!params||typeof params!=='object'||Array.isArray(params))throw Error('规则动作不在允许范围');
  const entityKeys=['ad_id','order_id','project_id','promotion_id'];const bound=entityKeys.flatMap(k=>params[k]?[params[k]]:[]);
  if(params.data){if(!Array.isArray(params.data)||!params.data.length)throw Error('状态动作需要对象列表');for(const item of params.data)for(const k of entityKeys)if(item[k])bound.push(item[k]);}
  if(a.name!=='account.budget.set'&&(!bound.length||bound.some(v=>!p.entityIds.includes(v))))throw Error('每个动作对象必须在用户绑定的对象列表内');
  if(params.budget!==undefined&&(!positive(params.budget)||params.budget>p.maxSingleBudget))throw Error('动作预算超过单次允许上限');
  if(a.name.startsWith('boost.')&&a.name!=='boost.create'&&(!params.task_id||!p.taskIds?.includes(params.task_id)))throw Error('追投操作任务必须位于授权taskIds列表');
  if((a.name==='boost.create'||a.name==='boost.update'&&params.material_ids!==undefined)&&(!Array.isArray(params.material_ids)||!params.material_ids.length||params.material_ids.some(id=>!p.materialIds?.includes(id))))throw Error('追投素材必须位于授权materialIds列表');
  if(a.name==='boost.status.set'&&!['PAUSE','ENABLE','DISABLE'].includes(params.opt_type))throw Error('托管任务状态为暂停、开启或手动结束');
  if(params.budget_mode==='BUDGET_MODE_INFINITE'&&p.allowUnlimitedBudget!==true)throw Error('托管解除账户日预算上限需要单独明确授权');
 }
 return copy(p);
}
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function monitoringSummary(result,platform){
 const d=result?.data;if(!d||result.ok!==true)throw Error('监控读取未取得成功结果');
 if(d.complete===false||d.paginationComplete===false)throw Error('平台返回的数据范围或分页不完整，停止生成托管动作');
 const s=d.summary||d.total||d;
 if(!s)throw Error('监控没有返回明确汇总，不能把缺失当成零');
 const unitKnown=platform!=='suixin'||d.monetaryVerification?.unitKnown===true;
 const cost=unitKnown?finite(s.cost??s.stat_cost??s.total_cost):null,orders=finite(s.orders??s.oto_pay_order_count??s.order??s.total_order);
 if((platform!=='suixin'&&cost===null)||orders===null)throw Error('监控范围缺少有效消耗或订单数');
 return {cost,orders,payment_roi:finite(s.payment_roi),net_roi:finite(s.net_roi),cash_return_ratio:unitKnown?finite(s.cash_return_ratio):null,unitKnown,sourceScope:d.range||{delivery:d.delivery,mgoal:d.mgoal},platform};
}
export const newManagedState=()=>({version:1,status:'starting',actions:[],completedRuleIds:[],proposals:[],lastSnapshot:null});
export const unresolvedAction=a=>['submitting','unknown','receipt_only','scheduled'].includes(a.status);
export function createManagedRunner(policy,{read,prepare,execute,persist=async()=>{},now=Date.now,state=newManagedState()}={}){
 const p=validateManagedPolicy(policy,{now:now()}),end=Date.parse(p.expiresAt);
 if(state.version!==1||!Array.isArray(state.actions)||!Array.isArray(state.completedRuleIds)||!Array.isArray(state.proposals))throw Error('托管状态损坏，不能重新开始动作');
 if(state.actions.some(unresolvedAction))state.status='needs_reconciliation';
 let busy=false;
 return {state,async tick(){
  if(busy)throw Error('上一轮仍在进行');busy=true;
  try{
   if(state.status==='needs_reconciliation'||state.actions.some(unresolvedAction)){state.status='needs_reconciliation';return copy(state);}
   if(now()>=end){state.status='expired';await persist(copy(state));return copy(state);}
   const readDay=businessDay(now());
   const raw=await read({platform:p.platform,accountId:p.accountId,scope:{...p.scope,range:'realtime'}});
   if(businessDay(now())!==readDay){state.status='day_boundary_recheck';await persist(copy(state));return copy(state);}
   const observation=p.monitor?scopedObservation(raw,p,state.lastSnapshot,now()):null;
   const summary=observation?observation.summary:monitoringSummary(raw,p.platform);
   if(p.maxObservedCost!==undefined&&summary.cost===null)throw Error('金额单位尚未核实，不能比较用户设置的元金额边界或触发金额策略');
   state.lastSnapshot=observation||{at:now(),summary};state.status='running';
   if(observation?.reset)state.ruleObservations={};
   if(p.minActionIntervalSeconds&&state.lastActionAt&&now()-state.lastActionAt<p.minActionIntervalSeconds*1000){state.status='cooldown';await persist(copy(state));return copy(state);}
   const costLimitReached=p.maxObservedCost!==undefined&&summary.cost>=p.maxObservedCost;
   for(const rule of p.rules){
    if(now()>=end){state.status='expired';break;}
    if(state.completedRuleIds.includes(rule.id))continue;
    const isPause=p.platform==='suixin'&&rule.action.name==='order.terminate'||rule.action.name==='boost.status.set'&&['PAUSE','DISABLE'].includes(rule.action.params.opt_type)||rule.action.name.endsWith('status.set')&&(rule.action.params.opt_status==='DISABLE'||Array.isArray(rule.action.params.data)&&rule.action.params.data.every(row=>row.opt_status==='PAUSED'));
    if(costLimitReached&&!isPause)continue;
    const v=summary[rule.metric];if(v===null||v===undefined){if(state.ruleObservations)state.ruleObservations[rule.id]=0;continue;}
    state.ruleObservations??={};const hit=operators[rule.operator](v,rule.threshold);
    state.ruleObservations[rule.id]=hit?(state.ruleObservations[rule.id]||0)+1:0;
    if(!hit||state.ruleObservations[rule.id]<(rule.consecutiveObservations||1)||observation&&now()-observation.baselineAt<(rule.minObservationSeconds||0)*1000)continue;
    const today=businessDay(now()),used=state.actions.filter(a=>a.day===today&&a.attempted).length;
    if(used>=p.maxActionsPerDay){state.status='action_limit_reached';break;}
    const prepared=await prepare(rule.action);
    boundedNumericChange(p,rule.action,prepared);
    if(rule.action.name==='boost.create'||rule.action.name==='boost.update'){
     const next=rule.action.params.budget??prepared?.prepared?.before?.task?.budget;
     if(!positive(next)||next>p.maxSingleBudget)throw Error('追投任务预算缺失或超过单次上限');
     const previous=rule.action.name==='boost.update'?prepared?.prepared?.before?.task?.budget:0;
     if(typeof previous!=='number')throw Error('追投任务原预算缺失');
     const additional=Math.max(0,next-previous),reserved=state.actions.filter(a=>a.attempted&&!['not_submitted','rejected','failed','expired'].includes(a.status)).reduce((n,a)=>n+(a.additionalBudget||0),0);
     if(reserved+additional>p.maxAdditionalBudget)throw Error('追投追加预算超过本会话授权总额度');
    }
    if(businessDay(now())!==today){state.status='day_boundary_recheck';await persist(copy(state));return copy(state);}
    if(p.mode==='recommend'){
     state.proposals.push({ruleId:rule.id,at:now(),prepared});state.completedRuleIds.push(rule.id);continue;
    }
    if(now()>=end){state.status='expired';break;}
    const originalBudget=rule.action.name==='boost.update'?prepared?.prepared?.before?.task?.budget:0;
    const record={ruleId:rule.id,day:today,at:now(),status:'submitting',attempted:true,action:copy(rule.action),additionalBudget:rule.action.name==='boost.create'||rule.action.name==='boost.update'?Math.max(0,(rule.action.params.budget??originalBudget)-originalBudget):0};
    state.actions.push(record);await persist(copy(state));
    try{
     const result=await execute(rule.action,prepared);
     record.result=result;const resultStatus=result?.data?.status;
     if(result?.data?.executionAttempted===false)record.attempted=false;
     if(resultStatus==='not_submitted'||resultStatus==='expired'&&result?.data?.executionAttempted===false){record.status='not_submitted';record.attempted=false;state.status='not_submitted';await persist(copy(state));return copy(state);}
     if(resultStatus==='failed'){record.status='rejected';state.status='needs_reconciliation';await persist(copy(state));return copy(state);}
     if(['unknown','scheduled','submitting','rejected','not_submitted','retryable','blocked'].includes(resultStatus)){record.status=resultStatus;state.status='needs_reconciliation';await persist(copy(state));return copy(state);}
     if(result?.ok!==true)throw Error('动作未返回可核实结果');
     if(result?.data?.verified!==true&&result?.data?.stateReadbackVerified!==true&&resultStatus!=='verified'){
      record.status='receipt_only';state.status='needs_reconciliation';await persist(copy(state));return copy(state);
     }
     record.status='completed';state.completedRuleIds.push(rule.id);state.lastActionAt=now();
     if(p.minActionIntervalSeconds)break;
    }catch(e){record.status=e.requestDispatched===false?'not_submitted':'unknown';record.attempted=e.requestDispatched!==false;record.error=String(e?.message||e);state.status=e.requestDispatched===false?'not_submitted':'needs_reconciliation';await persist(copy(state));return copy(state);}
   }
   if(costLimitReached&&state.status==='running')state.status='cost_limit_reached';
   await persist(copy(state));return copy(state);
  }catch(e){state.lastError=String(e?.message||e);state.status='read_error';state.ruleObservations={};await persist(copy(state));return copy(state);}
  finally{busy=false;}
 }};
}
export const policyDigest=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
