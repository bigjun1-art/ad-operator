import {normalizeHeadlessRequest} from './headless-actions.mjs';
import {createChengfangReport} from './chengfang-report.mjs';
import {createChengfangTaskService} from './chengfang-tasks.mjs';
import {diagnoseChengfang} from './chengfang-policy.mjs';

const fail=(message,code='CHENGFANG_INPUT')=>Object.assign(Error(message),{code,statusCode:400});
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const readActions={'/api/chengfang/fields':'marketing.fields.get','/api/chengfang/report':'marketing.report.get','/api/chengfang/context':'marketing.context.get','/api/chengfang/diagnose':'marketing.diagnose','/api/chengfang/tasks':'boost.tasks.list','/api/chengfang/task':'boost.task.get','/api/chengfang/receipt':'boost.receipt.get'};
const writeActions={'/api/chengfang/boost/create':['boost.create','create'],'/api/chengfang/boost/update':['boost.update','update'],'/api/chengfang/boost/status':['boost.status.set','status']};

export function createChengfangHandler({get,post,taskStore,authorize,readBody,currentAccount,resolveRange,deadline=()=>undefined,executionMode=()=> 'manual',precondition=()=>undefined,now=Date.now}={}){
 const reports=createChengfangReport({get:(p,o)=>get(p,o.query),now}),tasks=createChengfangTaskService({get,post,store:taskStore,now});
 async function planContext(accountId,ad_id){
  if(!ad_id)return null;const r=await get('/open_api/v1.0/qianchuan/uni_promotion/ad/detail/',{advertiser_id:accountId,ad_id});
  if(r?.code!==0||String(r.data?.ad_id)!==ad_id)throw fail('计划详情没有匹配本次账户和计划','CHENGFANG_PLAN_IDENTITY');return r.data;
 }
 const rangeFor=params=>{const r=resolveRange(params.range||'realtime',{start:params.start,end:params.end});if(!r)throw fail('投放查询日期范围无效');return {startTime:r.startTime,endTime:r.endTime};};
 const taskInput=(accountId,params)=>({accountId,...params,...rangeFor(params),executionMode:executionMode()});
 return async(req,res,url)=>{
  const p=url.pathname;if(!p.startsWith('/api/chengfang/'))return false;
  try{
   const accountId=String(currentAccount());if(!await authorize(accountId))throw Object.assign(fail('目标账户不在千川应用授权列表中'),{statusCode:403});
   if(req.method==='GET'&&p==='/api/chengfang/boost/prepare'){
    const operation=url.searchParams.get('operation'),pair=Object.values(writeActions).find(v=>v[1]===operation),encoded=url.searchParams.get('params')||'{}';
    if(!pair||encoded.length>16384)throw fail('追投准备参数无效');const params=JSON.parse(encoded);
    normalizeHeadlessRequest({mode:'prepare',platform:'qianchuan',accountId,action:pair[0],params});
    const prepared=await tasks.prepare(operation,taskInput(accountId,params));reply(res,200,{ok:true,data:prepared});return true;
   }
   if(req.method==='GET'&&readActions[p]){
    const params=Object.fromEntries([...url.searchParams].filter(([k])=>!['advertiser_id','workbench'].includes(k)));
    normalizeHeadlessRequest({mode:'read',platform:'qianchuan',accountId,action:readActions[p],params});
    let data;
    if(p.endsWith('/context')){const plan=await planContext(accountId,params.ad_id);data={accountId,ad_id:params.ad_id,plan,commissionIncluded:plan.delivery_setting?.alliance_commision_switch==='ON'?true:plan.delivery_setting?.alliance_commision_switch==='OFF'?false:null,starTaskMaterialSwitch:plan.delivery_setting?.star_task_material_switch??null,costItemsRaw:plan.delivery_setting?.overall_roi_cost_items??null};}
    else if(['/api/chengfang/tasks','/api/chengfang/task','/api/chengfang/receipt'].includes(p)){
     const input=taskInput(accountId,params);data=await tasks[p.endsWith('/tasks')?'list':p.endsWith('/task')?'get':'receipt'](input);
     if(data.task){const metrics=data.task.metrics||{},scene=data.marketing_goal==='LIVE_PROM_GOODS'?'live':'video',period=data.planType==='OVERALL_PROJECT'?'chengfang':'uni';
      data={...data,scope:{level:'task',accountId,ad_id:params.ad_id,task_id:params.task_id,scene,period},summary:{cost:null,orders:num(metrics.total_pay_order_count_for_roi2_assist),payment_roi:num(metrics.total_prepay_and_pay_order_roi2_assist),net_roi:num(metrics.total_prepay_and_pay_settle_roi2_1h_assist)},complete:true,observedAt:now(),epoch:JSON.stringify([data.planType,data.task.smart_bid_type,data.task.roi2_goal]),money_units:{stat_cost_for_roi2_assist:'platform_raw_unit_unconfirmed'},metricsScope:'task_total'};
     }
    }else{
     const plan=await planContext(accountId,params.ad_id),input={accountId,...params,...rangeFor(params),planContext:plan};
     data=p.endsWith('/fields')?await reports.fields(input):await reports.get(input);
     if(p.endsWith('/diagnose')){
      const found=await get('/open_api/v1.0/qianchuan/account/balance/get/',{advertiser_id:accountId});
      const balance=found?.code===0?num(found.data?.account_general_valid):null,scope={level:'account',accountId};
      const accountDiagnostics=diagnoseChengfang({scope,evidence:balance===null?{}:{balanceYuan:{value:balance/100000,source:'/open_api/v1.0/qianchuan/account/balance/get/#account_general_valid',observedAt:now(),scope,units:'yuan'}}});
      let scopeDiagnostics=null;
      if(plan&&['plan','material'].includes(params.level)){
       const scope={level:params.level,accountId,planId:params.ad_id,...(params.material_id?{materialId:params.material_id}:{})},periodKey=data.dataPeriod+':'+input.startTime+':'+input.endTime,evidence={};
       const budgetDayMatches=plan.delivery_setting?.budget_mode==='BUDGET_MODE_DAY'&&input.startTime.slice(0,10)===input.endTime.slice(0,10)&&input.startTime.endsWith('00:00:00');
       if(params.level==='plan'&&budgetDayMatches&&num(plan.delivery_setting?.budget)!==null)evidence.planBudgetYuan={value:plan.delivery_setting.budget,source:'/open_api/v1.0/qianchuan/uni_promotion/ad/detail/#delivery_setting.budget',observedAt:now(),scope,units:'yuan',periodKey};
       if(params.level==='plan'&&num(data.summary.cost)!==null)evidence.planSpendYuan={value:data.summary.cost,source:data.topic,observedAt:now(),scope,units:'yuan',periodKey};
       scopeDiagnostics=diagnoseChengfang({scope,evidence});
      }
      data={...data,accountDiagnostics,scopeDiagnostics};
     }
    }
    reply(res,200,{ok:true,data});return true;
   }
   if(req.method==='POST'&&writeActions[p]){
    const body=await readBody(req),{advertiser_id,...params}=body;if(advertiser_id!==accountId)throw fail('投放请求与本次授权账户不一致');
    const [action,operation]=writeActions[p];normalizeHeadlessRequest({mode:'execute',platform:'qianchuan',accountId,action,params});
    const record=await tasks.execute(operation,{...taskInput(accountId,params),...(precondition()?{expectedConfigurationHash:precondition()}:{})},{deadline:deadline()});
    reply(res,200,{ok:true,data:{...record,verified:record.status==='verified',submitted:record.accepted===true,executionAttempted:record.attempts>0&&!['expired','not_submitted'].includes(record.status)}});return true;
   }
   throw fail('未注册的乘方请求方法或路径');
  }catch(e){reply(res,e.statusCode||400,{ok:false,error:e.message,code:e.code||'CHENGFANG_REQUEST_FAILED',...(typeof e.requestDispatched==='boolean'?{requestDispatched:e.requestDispatched}:{})});return true;}
 };
}
