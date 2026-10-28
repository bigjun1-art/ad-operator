import {createHash} from 'node:crypto';

const fail=(message,code='HEADLESS_INPUT')=>{throw Object.assign(Error(message),{code});};
const id=value=>typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const money=value=>positive(value)&&Number.isSafeInteger(Math.round(value*100))&&Math.abs(value*100-Math.round(value*100))<1e-7;
const fields={id:{type:'id'},money:{type:'money'},roi:{type:'positive'},text:{type:'text'},date:{type:'date'},ids:{type:'ids'}};
const option=values=>({type:'enum',values});
const optional=rule=>({...rule,optional:true});
const scope={range:optional(option(['realtime','yesterday','d7','d30','d90','custom'])),start:optional(fields.date),end:optional(fields.date)};
const qcScope={...scope,dim:optional(option(['all','uni','overall','standard'])),scene:optional(option(['all','live','video']))};
const suixinScope={...scope,dim:optional(option(['normal','uni'])),scene:optional(option(['all','live','video']))};
const localScope={...scope,mgoal:optional(option(['all','LIVE','VIDEO_IMAGE'])),delivery:optional(option(['standard','manual','standard_manual','standard_auto']))};
const entries=[];
function add(platform,name,method,path,schema={},extra={}){entries.push({platform,name,method,path,schema,effect:method==='POST'?'write':'read',...extra});}
add('qianchuan','accounts.list','GET','/api/accounts',{}, {accountRequired:false});
add('local','accounts.list','GET','/api/local/accounts',{}, {accountRequired:false});
add('suixin','accounts.list','GET','/api/suixin/accounts',{}, {accountRequired:false,note:'使用随心推应用自身授权发现，不借用千川PC账户授权。'});
add('suixin','overview.get','GET','/api/suixin/overview',suixinScope,{queryDefaults:{dim:'normal',scene:'all'},note:'普通/商品全域分别查询；complete=false的结果不能用于托管触发。'});
add('suixin','orders.list','GET','/api/suixin/orders',{scene:optional(option(['all','live','video']))},{queryDefaults:{scene:'all'},note:'普通随心推全量订单库存，不以计划ID替代订单ID。'});
add('suixin','order.get','GET','/api/suixin/orders',{order_id:fields.id},{queryDefaults:{scene:'all'},note:'从当前随心推账户完整普通订单库存中定位精确order_id。'});
add('suixin','uni.orders.list','GET','/api/suixin/uni_orders',{}, {queryDefaults:{scene:'video'},note:'当前全域订单库存仅商品类型；不混入普通订单终止接口。'});
add('suixin','trend.get','GET','/api/suixin/trend',{...scope,scene:optional(option(['all','live','video']))},{queryDefaults:{dim:'normal',scene:'all'}});
add('suixin','order.terminate','POST','/api/suixin/order/terminate',{order_id:fields.id},{preflight:'orders.list',destructive:true,note:'明确授权终止单个普通订单；不是暂停或恢复，不操作全域订单。'});
add('suixin','suggest.roi.get','GET','/api/qianchuan/aweme/suggest_roi',{aweme_id:fields.id});
add('suixin','suggest.bid.get','GET','/api/qianchuan/aweme/suggest_bid',{budget:{type:'positiveInteger'},external_action:optional(fields.text),audience_mode:optional(fields.text)},{note:'budget为原建议接口整数参数，不能在未核实单位时解释成可提交元金额。'});
add('suixin','estimate.get','GET','/api/qianchuan/aweme/estimate_profit',{budget:{type:'positiveInteger'},marketing_goal:optional(option(['LIVE_PROM_GOODS','VIDEO_PROM_GOODS'])),external_action:optional(fields.text),bid_mode:optional(fields.text),audience_mode:optional(fields.text)},{note:'仅预估读取，保留原接口整数预算参数口径，不据此自动建单。'});
add('suixin','uni.report.get','GET','/api/qianchuan/aweme/uni_promotion/order_report',scope,{note:'商品全域逐订单原始报表；不与普通订单报表混合。'});
add('qianchuan','overview.get','GET','/api/overview',qcScope);
add('local','overview.get','GET','/api/local/overview',localScope,{note:'仅标准投放；不将标准归因与全域成交合计。'});
add('qianchuan','plans.list','GET','/api/command/plans',qcScope);
add('qianchuan','plan.detail','GET','/api/plan/detail',{ad_id:fields.id});
const marketingScope={...scope,scene:option(['live','video']),level:option(['account','plan','anchor','material']),period:option(['chengfang','uni','combined']),ad_id:optional(fields.id),anchor_id:optional(fields.id),material_id:optional(fields.id)};
add('qianchuan','marketing.fields.get','GET','/api/chengfang/fields',marketingScope);
add('qianchuan','marketing.report.get','GET','/api/chengfang/report',marketingScope);
add('qianchuan','marketing.context.get','GET','/api/chengfang/context',{ad_id:fields.id});
add('qianchuan','marketing.diagnose','GET','/api/chengfang/diagnose',marketingScope);
const taskScope={...scope,ad_id:fields.id};
add('qianchuan','boost.tasks.list','GET','/api/chengfang/tasks',taskScope);
add('qianchuan','boost.task.get','GET','/api/chengfang/task',{...taskScope,task_id:fields.id});
add('qianchuan','boost.receipt.get','GET','/api/chengfang/receipt',{...taskScope,requestKey:{type:'requestKey'}});
add('qianchuan','boost.create','POST','/api/chengfang/boost/create',{...taskScope,name:{type:'taskName'},budget:fields.money,material_ids:{type:'materialIds'},objective:option(['volume','payment_roi','net_roi']),roi2_goal:optional({type:'decimal2'}),duration:optional({type:'duration'}),requestKey:{type:'requestKey'}},{preflight:'plan.detail',note:'按精确计划与素材创建追投；放量、支付ROI和净成交ROI分别选择。'});
add('qianchuan','boost.update','POST','/api/chengfang/boost/update',{...taskScope,task_id:fields.id,name:optional({type:'taskName'}),budget:optional(fields.money),material_ids:optional({type:'materialIds'}),objective:optional(option(['volume','payment_roi','net_roi'])),roi2_goal:optional({type:'decimal2'}),duration:optional({type:'duration'}),requestKey:{type:'requestKey'}},{preflight:'boost.task.get'});
add('qianchuan','boost.status.set','POST','/api/chengfang/boost/status',{...taskScope,task_id:fields.id,opt_type:option(['PAUSE','ENABLE','DISABLE']),requestKey:{type:'requestKey'}},{preflight:'boost.task.get',note:'PAUSE暂停、ENABLE开启、DISABLE手动结束；暂停回执单独记录。'});
add('qianchuan','balance.get','GET','/api/qianchuan/balance',{}, {note:'将account_general_total的千分之一分原值换算元；缺失保持未知。'});
add('qianchuan','account.budget.get','GET','/api/qianchuan/budget');
add('qianchuan','logs.list','GET','/api/qianchuan/logs',{...scope,object_type:option(['ACCOUNT','AD']),object_id:optional(fields.id),page:optional({type:'positiveInteger'}),page_size:optional({type:'logPageSize'})});
add('local','balance.get','GET','/api/local/balance');
add('local','account.budget.get','GET','/api/local/account/budget');
add('local','projects.list','GET','/api/local/projects');
add('local','promotions.list','GET','/api/local/promotions');
add('local','project.detail','GET','/api/local/project/detail',{project_id:fields.id},{note:'官方配置budget/bid原值为分；结果附budget_yuan/bid_yuan及明确单位。'});
add('local','awemes.list','GET','/api/local/aweme/list');
add('qianchuan','materials.list','GET','/api/materials',{ad_id:fields.id});
add('local','materials.list','GET','/api/local/material/videos',{}, {queryDefaults:{all:'1'}});
add('local','global.audience.get','GET','/api/local/global/audience',{
 start_date:fields.date,end_date:fields.date,roi2_type:option(['LIVE_ROI2','POI_ROI2']),
 audience_dimension:optional(option(['GENDER','PROVINCE','CITY','DISTRICT','PLATFORM','AGE','AC','EIGHT_GROUP_LABEL'])),
 aweme_id:optional(fields.id),poi_ids:optional(fields.ids),
},{note:'T-1历史受众。LIVE_ROI2必须明确当前账户已授权aweme_id；不称实时账户主报表。'});
add('qianchuan','plan.budget.set','POST','/api/plan/budget',{ad_id:fields.id,budget:fields.money},{preflight:'plan.detail'});
add('qianchuan','plan.roi.set','POST','/api/plan/roi',{ad_id:fields.id,roi2_goal:fields.roi},{preflight:'plan.detail'});
add('qianchuan','plan.status.set','POST','/api/plan/status',{ad_id:fields.id,opt_status:option(['ENABLE','DISABLE'])},{preflight:'plan.detail'});
add('qianchuan','materials.remove','POST','/api/material/delete',{ad_id:fields.id,material_ids:fields.ids},{preflight:'materials.list',destructive:true});
add('local','account.budget.set','POST','/api/local/account/budget',{
 effective_mode:option(['EFFECTIVE_NOW','EFFECTIVE_NEXT_DAY']),budget_mode:option(['BUDGET_MODE_DAY','BUDGET_MODE_INFINITE']),
 budget:optional(fields.money),expected:{type:'expectedBudget'},requestKey:{type:'requestKey'},
},{preflight:'account.budget.get',note:'元、两位小数；不限预算省略budget；隔日回执不等于已生效。'});
add('local','project.budget.set','POST','/api/local/project/budget',{project_id:fields.id,budget:fields.money,budget_mode:option(['BUDGET_MODE_DAY','BUDGET_MODE_TOTAL','BUDGET_MODE_7DAY_TOTAL'])},{preflight:'project.detail',note:'params.budget单位元；原详情budget为分，后台精确转换。'});
add('local','project.status.set','POST','/api/local/project/status',{data:{type:'statusBatch',entity:'project_id'}},{preflight:'projects.list'});
add('local','promotion.status.set','POST','/api/local/promotion/status',{data:{type:'statusBatch',entity:'promotion_id'}},{preflight:'promotions.list'});

export const HEADLESS_ACTIONS=Object.freeze(entries.map(entry=>Object.freeze(entry)));
const backendRoutes=Object.freeze({
 GET:Object.freeze(['/api/accounts', '/api/local/accounts', '/api/suixin/accounts', '/api/suixin/overview', '/api/suixin/orders', '/api/suixin/uni_orders', '/api/suixin/trend', '/api/qianchuan/aweme/suggest_roi', '/api/qianchuan/aweme/suggest_bid', '/api/qianchuan/aweme/estimate_profit', '/api/qianchuan/aweme/uni_promotion/order_report', '/api/overview', '/api/local/overview', '/api/command/plans', '/api/plan/detail', '/api/chengfang/fields', '/api/chengfang/report', '/api/chengfang/context', '/api/chengfang/diagnose', '/api/chengfang/tasks', '/api/chengfang/task', '/api/chengfang/receipt', '/api/qianchuan/balance', '/api/qianchuan/budget', '/api/qianchuan/logs', '/api/local/balance', '/api/local/account/budget', '/api/local/projects', '/api/local/promotions', '/api/local/project/detail', '/api/local/aweme/list', '/api/materials', '/api/local/material/videos', '/api/local/global/audience']),
 POST:Object.freeze(['/api/suixin/order/terminate', '/api/chengfang/boost/create', '/api/chengfang/boost/update', '/api/chengfang/boost/status', '/api/plan/budget', '/api/plan/roi', '/api/plan/status', '/api/material/delete', '/api/local/account/budget', '/api/local/project/budget', '/api/local/project/status', '/api/local/promotion/status']),
});
export function validateHeadlessActions(actions=HEADLESS_ACTIONS,{routes=backendRoutes}={}){
 const seen=new Set();
 for(const action of actions){
  const key=action.platform+':'+action.name;
  if(!['qianchuan','suixin','local'].includes(action.platform)||!action.name||seen.has(key))fail('动作平台或名称重复/无效：'+key,'HEADLESS_CATALOG');
  seen.add(key);
  if(!['GET','POST'].includes(action.method)||action.effect!==(action.method==='POST'?'write':'read'))fail('动作效果与方法不一致：'+key,'HEADLESS_CATALOG');
  if(!routes[action.method]?.includes(action.path))fail('动作没有对应的后端方法和路由：'+key,'HEADLESS_CATALOG');
  if(action.method==='POST'&&!action.preflight)fail('修改动作缺少预检：'+key,'HEADLESS_CATALOG');
  if(action.preflight){
   const before=actions.find(candidate=>candidate.platform===action.platform&&candidate.name===action.preflight);
   if(!before||before.method!=='GET'||before.effect!=='read')fail('预检必须为同平台已接入的读取动作：'+key,'HEADLESS_CATALOG');
  }
 }
 return true;
}
validateHeadlessActions();
export const HEADLESS_LIMITATIONS=Object.freeze([
 '本地推LIVE_ROI2/POI_ROI2全域对象预算、ROI、素材生命周期专用写入当前公开MAPI未提供；不以标准项目/单元接口替代。',
 '全域启停与标准项目/单元ID映射尚待官方明确；本入口只提供明确的标准对象启停。',
 '临时调用不开网页、不启后台盯盘、不会启动或恢复旧托管策略。',
]);
export function getHeadlessAction(platform,name){const action=HEADLESS_ACTIONS.find(a=>a.platform===platform&&a.name===name);if(!action)fail('该平台没有已接入的动作：'+String(name),'HEADLESS_ACTION_UNAVAILABLE');return action;}
export function describeHeadlessActions(platform){if(platform!==undefined&&!['qianchuan','suixin','local'].includes(platform))fail('平台须为qianchuan、suixin或local');return {actions:HEADLESS_ACTIONS.filter(a=>platform===undefined||a.platform===platform).map(a=>({...a,accountRequired:a.accountRequired!==false})),limitations:HEADLESS_LIMITATIONS};}
function valid(rule,value){
 switch(rule.type){
  case 'id':return id(value);case 'positive':return positive(value);case 'positiveInteger':return positive(value)&&Number.isSafeInteger(value);case 'money':return money(value);
  case 'text':return typeof value==='string'&&value.length>0&&value.length<=100;
  case 'taskName':return typeof value==='string'&&value.trim().length>0&&[...value].length<=50;
  case 'decimal2':return money(value);
  case 'duration':return positive(value)&&value<=24&&Number.isInteger(value*2);
  case 'materialIds':return Array.isArray(value)&&value.length>0&&value.length<=20&&value.every(id)&&new Set(value).size===value.length;
  case 'logPageSize':return Number.isInteger(value)&&value>=1&&value<=20;
  case 'date':return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  case 'enum':return rule.values.includes(value);
  case 'ids':return Array.isArray(value)&&value.length>0&&value.length<=50&&value.every(id)&&new Set(value).size===value.length;
  case 'requestKey':return typeof value==='string'&&/^[A-Za-z0-9_-]{8,160}$/.test(value);
  case 'expectedBudget':return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='budget,budget_mode'&&['BUDGET_MODE_DAY','BUDGET_MODE_TOTAL','BUDGET_MODE_INFINITE'].includes(value.budget_mode)&&typeof value.budget==='number'&&Number.isFinite(value.budget)&&value.budget>=0;
  case 'statusBatch':return Array.isArray(value)&&value.length>0&&value.length<=50&&value.every(row=>row&&Object.keys(row).sort().join(',')===[rule.entity,'opt_status'].sort().join(',')&&id(row[rule.entity])&&['ENABLE','PAUSED'].includes(row.opt_status))&&new Set(value.map(row=>row[rule.entity])).size===value.length;
  default:return false;
 }
}
export function normalizeHeadlessRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('需要操作请求对象');
 if(Object.keys(input).some(k=>!['mode','platform','accountId','action','params','authorization'].includes(k)))fail('操作请求包含未定义字段');
 if(!['read','prepare','execute'].includes(input.mode))fail('运行方式须为read、prepare或execute');
 const action=getHeadlessAction(input.platform,input.action),params=input.params??{};
 if(!params||typeof params!=='object'||Array.isArray(params))fail('params须为JSON对象');
 if(action.accountRequired!==false&&!id(input.accountId))fail('请明确一个账户ID，不能依赖页面当前账户或ALL');
 if(input.accountId!==undefined&&!id(input.accountId))fail('账户ID须为精确数字字符串');
 for(const key of Object.keys(params))if(!Object.hasOwn(action.schema,key))fail('该动作不接受字段：'+key);
 for(const [key,rule]of Object.entries(action.schema)){
  if(params[key]===undefined){if(!rule.optional)fail('缺少字段：'+key);}
  else if(!valid(rule,params[key]))fail('字段值无效：'+key);
 }
 if(action.method==='GET'&&input.mode!=='read')fail('查询动作请使用read');
 if(action.method==='POST'&&input.mode==='read')fail('修改动作请先prepare，取得明确授权后execute');
 if(params.range==='custom'&&(!params.start||!params.end))fail('自定义日期需要start与end');
 if(params.start&&params.end&&params.start>params.end)fail('开始日期不能晚于结束日期');
 if(action.name==='global.audience.get'){
  if(params.roi2_type==='LIVE_ROI2'&&!params.aweme_id)fail('直播全域历史查询须明确已授权aweme_id，不能选取第一个抖音号代替');
  if(params.roi2_type==='POI_ROI2'&&params.aweme_id||params.roi2_type==='LIVE_ROI2'&&params.poi_ids)fail('全域筛选对象与场景不符');
 }
 if(action.name==='account.budget.set'){
  if(params.budget_mode==='BUDGET_MODE_DAY'&&params.budget===undefined)fail('日预算需要budget');
  if(params.budget_mode==='BUDGET_MODE_INFINITE'&&params.budget!==undefined)fail('不限预算时省略budget');
 }
 return {...input,params:structuredClone(params),definition:action};
}
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function headlessIntentHash(input){return createHash('sha256').update(canonical({platform:input.platform,accountId:input.accountId,action:input.action,params:input.params??{}})).digest('hex');}
export function createActionAuthorization({platform,accountId,action,params={},expiresAt,userInstruction}){
 return {authorized:true,basis:'explicit_user_instruction',platform,accountId,action,intentHash:headlessIntentHash({platform,accountId,action,params}),expiresAt,userInstruction};
}
export function assertHeadlessAuthorization(input,{now=Date.now()}={}){
 const a=input.authorization;
 if(!a||a.authorized!==true||a.basis!=='explicit_user_instruction'||typeof a.userInstruction!=='string'||!a.userInstruction.trim()||a.userInstruction.length>4000||a.platform!==input.platform||a.accountId!==input.accountId||a.action!==input.action||a.intentHash!==headlessIntentHash(input)||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=now)fail('缺少与本次账户、动作、参数一致且有效的用户授权记录','HEADLESS_AUTHORIZATION_REQUIRED');
 return true;
}
export function headlessRoute(input){
 const {definition:a,params,platform,accountId}=input,query={...a.queryDefaults,workbench:platform,...(accountId?platform==='local'?{local_account_id:accountId}:{advertiser_id:accountId}:{})};
 if(a.method==='GET')Object.assign(query,params);
 if(platform==='local'&&['overview.get','projects.list','promotions.list'].includes(a.name))query.dim='standard';
 const url=new URL(a.path,'http://127.0.0.1');for(const [k,v]of Object.entries(query))url.searchParams.set(k,typeof v==='object'?JSON.stringify(v):String(v));
 const body=a.method==='POST'?{...params,...(platform==='local'?{local_account_id:accountId}:{advertiser_id:accountId})}:undefined;
 return {method:a.method,path:url.pathname+url.search,body};
}
