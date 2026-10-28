import {createHash} from 'node:crypto';
import {configurationHash,assertConfigurationHash} from './execution-preconditions.mjs';

const BASE='/open_api/v1.0/qianchuan/';
export const CHENGFANG_TASK_PATHS=Object.freeze({detail:BASE+'uni_promotion/ad/detail/',plans:BASE+'uni_promotion/list/',materials:BASE+'uni_promotion/ad/material/get/',gray:BASE+'tools/gray/',list:BASE+'uni_promotion/ad/control_task/list/',create:BASE+'uni_promotion/ad/control_task/create/',update:BASE+'uni_promotion/ad/control_task/update/',status:BASE+'uni_promotion/ad/control_task/status/update/'});
const OBJECTIVES={payment_roi:'AD_CONVERT_TYPE_LIVE_PAY_ROI',net_roi:'AD_CONVERT_TYPE_LIVE_PURE_PAY_ROI'};
const exact=value=>typeof value==='string'&&/^\d{1,20}$/.test(value);
const decimal=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&Math.abs(value*100-Math.round(value*100))<1e-7;
const validIds=value=>Array.isArray(value)&&value.length>0&&value.length<=20&&value.every(exact)&&new Set(value).size===value.length;
const sameIds=(left,right)=>validIds(left)&&validIds(right)&&JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
function scope(input) {
  assert(exact(input?.accountId)&&exact(input?.ad_id),'账户及计划须为精确字符串 ID');
  for(const key of ['startTime','endTime'])assert(typeof input[key]==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input[key])&&!Number.isNaN(Date.parse(input[key].replace(' ','T')+'+08:00')),'查询起止时间须为 yyyy-MM-dd HH:mm:ss');
  assert(input.startTime<=input.endTime,'查询起止时间顺序无效');
  for(const key of ['startTime','endTime']){
    const text=input[key],stamp=Date.parse(text.replace(' ','T')+'Z');
    assert(Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,19).replace('T',' ')===text,'查询时间不是有效日历时间');
  }
  assert(Date.parse(input.endTime.replace(' ','T')+'Z')-Date.parse(input.startTime.replace(' ','T')+'Z')<=180*86400000,'计划类型查询范围不得超过 180 天');
}
function responseData(response) {
  assert(response?.code===0,`平台请求未成功：${response?.message??response?.code??'缺少返回码'}`);
  assert(response.data&&typeof response.data==='object','平台响应缺少 data');
  const normalize=(value,key='')=>{
    if(typeof value==='number'&&(/(?:^|_)id$/.test(key)||/(?:^|_)ids$/.test(key))){assert(Number.isSafeInteger(value)&&value>=0,'平台数字ID精度不可靠');return String(value);}
    if(Array.isArray(value))return value.map(v=>normalize(v,/(?:^|_)ids$/.test(key)?key:''));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v,k)]));return value;
  };
  return normalize(response.data);
}
/** Inject get(path,query), post(path,body), and an explicit durable store.
 * No credential access, retries, or account capability overrides occur here. */
export function createChengfangTaskService({get:read,post,store,now=Date.now}={}) {
  assert(typeof read==='function','需要注入 get(path,query)');
  assert(store&&['read','write','findUnresolved','withPlanLock'].every(key=>typeof store[key]==='function'),'需要显式注入持久任务 store');
  async function pages(path,query,key,idOf) {
    const rows=[],seen=new Set();let totalPages,totalNumber;
    for(let page=1;page<=1000;page++) {
      const data=responseData(await read(path,{...query,page,page_size:100})),info=data.page_info;
      assert(Array.isArray(data[key])&&Number.isInteger(info?.total_page)&&info.total_page>=0&&info.total_page<=1000&&Number.isInteger(info.total_number)&&info.total_number>=0&&info.page===page&&info.page_size===100,'列表完整分页信息缺失或无效');
      assert(info.total_number<=info.total_page*100&&!(info.total_page===0&&info.total_number>0),'分页总量矛盾');
      totalPages??=info.total_page;totalNumber??=info.total_number;
      assert(totalPages===info.total_page&&totalNumber===info.total_number,'读取期间分页总量变化');
      for(const row of data[key]) {
        const id=idOf(row);assert(exact(id)&&!seen.has(id),'列表 ID 非精确字符串或跨页重复');seen.add(id);rows.push(row);
      }
      if(page>=totalPages){assert(rows.length===totalNumber,'列表条目数不完整');return rows;}
    }
    throw Error('列表超过分页上限');
  }
  async function plan(input) {
    scope(input);
    const detail=responseData(await read(CHENGFANG_TASK_PATHS.detail,{advertiser_id:input.accountId,ad_id:input.ad_id}));
    assert(detail.ad_id===input.ad_id,'详情计划 ID 缺失或不匹配');
    if(detail.advertiser_id!==undefined)assert(detail.advertiser_id===input.accountId,'详情账户不匹配');
    assert(['LIVE_PROM_GOODS','VIDEO_PROM_GOODS'].includes(detail.marketing_goal),'计划营销目标缺失或不支持');
    const matches=[];
    for(const type of ['OVERALL_PROJECT','UNI_PROJECT']) {
      const rows=await pages(CHENGFANG_TASK_PATHS.plans,{advertiser_id:input.accountId,marketing_goal:detail.marketing_goal,start_time:input.startTime,end_time:input.endTime,adlab_scene:type},'ad_list',row=>row.ad_info?.id);
      for(const row of rows)if(row.ad_info.id===input.ad_id){assert(row.ad_info.adlab_scene===type,'计划产品类型与查询不符');matches.push(row.ad_info);}
    }
    assert(matches.length===1,'不能从官方列表唯一确认计划产品类型');
    return {detail,planType:matches[0].adlab_scene,marketing_goal:detail.marketing_goal};
  }
  async function taskRows(input,context) {
    return pages(CHENGFANG_TASK_PATHS.list,{advertiser_id:input.accountId,ad_id:input.ad_id,marketing_goal:context.marketing_goal,scene:'MATERIAL_ADD_BUDGET',start_time:input.startTime,end_time:input.endTime,fields:['stat_cost_for_roi2_assist','total_pay_order_count_for_roi2_assist','total_prepay_and_pay_order_roi2_assist','total_prepay_and_pay_settle_roi2_1h_assist','show_cnt_for_roi2_assist','click_cnt_for_roi2_assist']},'task_list',row=>row.id);
  }
  function bound(task,input) {
    assert(task,'完整列表中未找到精确任务 ID');
    if(task.advertiser_id!==undefined)assert(task.advertiser_id===input.accountId,'任务账户不符');
    if(task.ad_id!==undefined)assert(task.ad_id===input.ad_id,'任务计划不符');
    return task;
  }
  async function list(input) {const context=await plan(input);return {accountId:input.accountId,ad_id:input.ad_id,planType:context.planType,marketing_goal:context.marketing_goal,tasks:await taskRows(input,context),metricsScope:'task_total'};}
  async function get(input) {assert(exact(input?.task_id),'需要精确 task_id');const result=await list(input);return {...result,task:bound(result.tasks.find(task=>task.id===input.task_id),input)};}
  async function materials(input,material_ids) {
    assert(validIds(material_ids),'素材须为 1～20 个唯一精确 material_id');
    const rows=await pages(CHENGFANG_TASK_PATHS.materials,{advertiser_id:input.accountId,ad_id:input.ad_id,filtering:{material_type:'VIDEO',material_status:'ALL',material_select_type:'ALL',start_date:input.startTime.slice(0,10),end_date:input.endTime.slice(0,10)}},'ad_material_infos',row=>row.material_info?.video_material?.material_id);
    let generic=[];
    if(material_ids.some(id=>!rows.some(row=>row.material_info.video_material.material_id===id))){
      generic=await pages('/open_api/v1.0/qianchuan/ad/material/get/',{advertiser_id:input.accountId,ad_id:input.ad_id,filtering:{material_type:'VIDEO'}},'ad_material_infos',row=>row.material_info?.video_material?.material_id);
    }
    return material_ids.map(id=>{
      const row=rows.find(row=>row.material_info.video_material.material_id===id);
      if(!row){
        const candidate=generic.find(r=>r.material_info?.video_material?.material_id===id);
        assert(candidate,`素材 ${id} 尚未从该计划接口取得精确成员及状态证据`);
        assert(candidate.audit_status==='PASS'&&candidate.material_delivery_type==='DELIVERY_OK'&&candidate.is_del===false,`素材 ${id} 的审核、投放或删除状态不满足追投条件`);
        return {...candidate,evidenceSource:'official_generic_plan_material_contract',evidenceScope:{accountId:input.accountId,ad_id:input.ad_id},statisticsIncluded:false};
      }
      assert(row.audit_status==='PASS'&&row.material_status==='DELIVERY_OK'&&row.is_delete===false,`素材 ${id} 审核、投放或删除状态不满足要求`);
      return {...row,evidenceSource:'official_uni_plan_material_contract',evidenceScope:{accountId:input.accountId,ad_id:input.ad_id},statisticsIncluded:true};
    });
  }
  function roiNames(task,objective) {
    const name=task.deep_external_action_name;
    const allowed=objective==='net_roi'?['净成交ROI','净成交支付ROI']:['支付ROI','成交ROI'];
    const enumValue=task.deep_external_action;
    assert(enumValue===OBJECTIVES[objective]||enumValue===undefined&&allowed.includes(name),'任务支付/净成交目标无法精确核对');
    assert(task.external_action==='AD_CONVERT_TYPE_LIVE_SUCCESSORDER_PAY'||task.external_action===undefined&&['直播间支付','直播间购买','直播间成交','直播间购买（直播间成交）'].includes(task.external_action_name),'任务成交目标无法精确核对');
  }
  async function prepare(operation,input) {
    assert(['create','update','status'].includes(operation),'不支持的任务操作');scope(input);
    assert(typeof input.requestKey==='string'&&input.requestKey.trim()&&input.requestKey.length<=200,'需要不超过 200 字的 requestKey');
    const context=await plan(input),setting=context.detail.delivery_setting??{};
    let task=null,body={advertiser_id:input.accountId};
    const evidence={planType:context.planType,marketing_goal:context.marketing_goal,coverage:context.planType==='OVERALL_PROJECT'?'document_coverage_unconfirmed':'documented',accountLiveTest:false};
    if(operation!=='create') {
      assert(exact(input.task_id),'需要精确 task_id');
      task=bound((await taskRows(input,context)).find(task=>task.id===input.task_id),input);
    }
    if(operation==='status') {
      assert(['PAUSE','ENABLE','DISABLE'].includes(input.opt_type),'状态仅支持 PAUSE、ENABLE、DISABLE');
      body={...body,task_ids:[input.task_id],opt_type:input.opt_type};
    }else {
      const budget=input.budget??(operation==='update'?task.budget:undefined);
      assert(decimal(budget),'预算须为正数元金额且最多两位小数');
      assert(setting.budget_mode==='BUDGET_MODE_INFINITE'||decimal(setting.budget)&&budget<=setting.budget,'预算不得超过当前计划预算，计划预算须有真实证据');
      const name=operation==='create'?input.name:input.name??task.name;
      assert(typeof name==='string'&&[...name].length>=1&&[...name].length<=50,'任务名称需要 1～50 字');
      body={...body,name,budget};
      if(operation==='create') {
        if(input.executionMode==='managed'&&context.planType==='OVERALL_PROJECT'){
          const proof=typeof store.findVerifiedCreates==='function'?await store.findVerifiedCreates(input.accountId,input.ad_id):[];
          assert(proof.some(r=>r.prepared.evidence.planType===context.planType&&r.prepared.evidence.marketing_goal===context.marketing_goal&&r.prepared.input.objective===input.objective),'本计划该场景和目标尚无已核实MAPI创建记录，托管创建未开启');
        }
        assert(input.objective==='volume'||Object.hasOwn(OBJECTIVES,input.objective),'需要 volume、payment_roi 或 net_roi 目标');
        const live=context.marketing_goal==='LIVE_PROM_GOODS';
        assert(live||input.objective==='volume','商品追投 ROI 创建缺少官方准确目标组合，不能套用直播枚举');
        assert(setting.smart_bid_type==='SMART_BID_CUSTOM','当前计划不是官方支持的全域控成本计划');
        if(input.objective!=='volume')assert(setting.external_action==='AD_CONVERT_TYPE_LIVE_SUCCESSORDER_PAY'&&setting.deep_external_action===OBJECTIVES[input.objective],'当前计划支付/净成交目标不匹配');
        if(live){
        const gray=responseData(await read(CHENGFANG_TASK_PATHS.gray,{advertiser_id:input.accountId,gray_keys:['assist_pure_roi_allcut']}));
        const entries=gray.success_list?.filter(row=>row.gray_key==='assist_pure_roi_allcut'),entry=entries?.[0];
        assert(entries?.length===1&&typeof entry.in_gray==='boolean'&&typeof entry.in_whitelist==='boolean'&&(gray.error_list===undefined||Array.isArray(gray.error_list)&&gray.error_list.length===0),'净成交白名单查询未得到明确结果');
        assert(input.objective==='volume'||!(entry.in_gray||entry.in_whitelist)||input.objective==='net_roi','当前白名单只支持净成交 ROI');
        evidence.gray=entry;
        }
        if(input.objective!=='volume')assert(decimal(input.roi2_goal),'ROI 目标须为正数且最多两位小数');
        else assert(input.roi2_goal===undefined,'放量追投不支持 ROI 目标');
        evidence.materials=await materials(input,input.material_ids);
        if(live)assert(input.duration===undefined,'直播控成本素材追投不支持 duration');
        else assert(Number.isFinite(input.duration)&&input.duration>=0.5&&input.duration<=24&&Number.isInteger(input.duration*2),'商品素材追投 duration 必填，须为 0.5～24 小时且步进 0.5');
        body={...body,ad_id:input.ad_id,scene:'MATERIAL_ADD_BUDGET',material_type:'VIDEO',material_ids:[...input.material_ids]};
        if(live)body.smart_bid_type=input.objective==='volume'?'SMART_BID_CONSERVATIVE':'SMART_BID_CUSTOM';
        else body.duration=input.duration;
        if(input.objective!=='volume')Object.assign(body,{external_action:setting.external_action,deep_external_action:OBJECTIVES[input.objective],roi2_goal:input.roi2_goal});
      }else {
        body.task_id=input.task_id;
        if(input.objective!==undefined){assert(input.objective==='volume'||Object.hasOwn(OBJECTIVES,input.objective),'目标无效');if(input.objective!=='volume'){assert(context.marketing_goal==='LIVE_PROM_GOODS','商品 ROI 目标枚举未明确');roiNames(task,input.objective);}else if(context.marketing_goal==='LIVE_PROM_GOODS')assert(task.smart_bid_type==='SMART_BID_CONSERVATIVE','任务不是放量追投');}
        if(input.roi2_goal!==undefined){assert(context.marketing_goal==='LIVE_PROM_GOODS'&&task.smart_bid_type==='SMART_BID_CUSTOM','该场景不支持修改 ROI');assert(input.objective!==undefined,'修改 ROI 必须明确目标');assert(decimal(input.roi2_goal),'ROI 目标须为正数且最多两位小数');body.roi2_goal=input.roi2_goal;}
        if(input.material_ids!==undefined){evidence.materials=await materials(input,input.material_ids);body.material_ids=[...input.material_ids];}
        if(input.duration!==undefined){assert(context.marketing_goal!=='LIVE_PROM_GOODS'||setting.smart_bid_type!=='SMART_BID_CUSTOM','直播控成本素材追投不支持 duration');assert(Number.isFinite(input.duration)&&input.duration>=0.5&&input.duration<=24&&Number.isInteger(input.duration*2),'更新设置 duration 须为 0.5～24 小时且步进 0.5');body.duration=input.duration;}
        for(const key of ['external_action','deep_external_action','smart_bid_type'])assert(input[key]===undefined,'修改设置不支持修改目标枚举或追投方式');
      }
    }
    const configuration={planType:context.planType,marketing_goal:context.marketing_goal,plan:{ad_id:input.ad_id,budget:setting.budget,budget_mode:setting.budget_mode,smart_bid_type:setting.smart_bid_type,external_action:setting.external_action,deep_external_action:setting.deep_external_action,alliance_commision_switch:setting.alliance_commision_switch,overall_roi_cost_items:setting.overall_roi_cost_items},task:task?{id:task.id,name:task.name,budget:task.budget,roi2_goal:task.roi2_goal,duration:task.duration,smart_bid_type:task.smart_bid_type,external_action_name:task.external_action_name,deep_external_action_name:task.deep_external_action_name,material_ids:task.material_list?.map(r=>r.material_id).sort()}:null};
    return {operation,accountId:input.accountId,ad_id:input.ad_id,requestKey:input.requestKey,input:clone(input),body,evidence,before:task,configurationHash:configurationHash(configuration),preparedAt:now()};
  }
  function verify(record,task) {
    const {body,operation,input,before}=record.prepared;
    if(operation==='status') {
      assert(task.name===before.name&&task.budget===before.budget&&task.roi2_goal===before.roi2_goal,'状态操作回读名称、预算或目标不一致');
      assert(sameIds(task.material_list?.map(row=>row.material_id),before.material_list?.map(row=>row.material_id)),'状态操作回读素材集合不一致');
      assert(task.deep_external_action_name===before.deep_external_action_name&&task.external_action_name===before.external_action_name&&task.deep_external_action===before.deep_external_action&&task.external_action===before.external_action,'状态操作回读转化目标不一致');
      if(body.opt_type==='PAUSE')return 'receipt_only';
      assert(task.task_status===(body.opt_type==='ENABLE'?'PROCESSING':'DISABLE'),'任务状态回读未确认');return 'verified';
    }
    assert(task.name===body.name&&task.budget===body.budget,'任务名称或预算回读不一致');
    const expectedMaterials=body.material_ids??before?.material_list?.map(row=>row.material_id);
    assert(sameIds(task.material_list?.map(row=>row.material_id),expectedMaterials),'任务素材集合回读不一致或缺失');
    const expectedRoi=body.roi2_goal??before?.roi2_goal;
    if(expectedRoi!==undefined)assert(task.roi2_goal===expectedRoi,'ROI 目标回读不一致');
    if(operation==='update')for(const key of ['smart_bid_type','external_action','deep_external_action','external_action_name','deep_external_action_name'])assert(task[key]===before[key],'修改设置后的出价方式或转化目标不一致');
    if(body.duration!==undefined)assert(task.duration===body.duration,'任务时长回读不一致');
    if(input.objective!==undefined&&input.objective!=='volume')roiNames(task,input.objective);
    if(operation==='create'&&body.smart_bid_type!==undefined)assert(task.smart_bid_type===body.smart_bid_type,'追投方式回读不一致');
    return 'verified';
  }
  async function reconcile(input) {
    scope(input);assert(typeof input.requestKey==='string','需要 requestKey');
    return store.withPlanLock(input.accountId,input.ad_id,async()=>{
      const record=await store.read(input.accountId,input.ad_id,input.requestKey);assert(record,'找不到本地任务回执');
      if(!['unknown','accepted','submitting','receipt_only'].includes(record.status))return record;
      if(!exact(record.task_id)){record.status='unknown';record.reason='未取得精确任务 ID，不能按名称推测或重发';await store.write(record);return record;}
      try{
        const result=await get({...record.prepared.input,startTime:input.startTime,endTime:input.endTime,task_id:record.task_id});
        const checked=verify(record,result.task);
        record.readback={task:result.task,planType:result.planType,metricsScope:'task_total',checkedAt:now()};
        // Without a successful operation receipt, an unchanged paused task does
        // not establish that the requested action was accepted.
        record.status=checked==='receipt_only'&&!record.accepted?'unknown':checked;
        record.reason=record.status==='receipt_only'?'平台已受理暂停；官方无独立暂停状态枚举':record.status==='unknown'?'暂停缺少受理回执，无法由列表状态确认':null;
        if(record.status==='verified'&&record.prepared.operation==='status'){
          for(const old of await store.findUnresolved(input.accountId,input.ad_id))if(old.requestKey!==record.requestKey&&old.status==='receipt_only'&&old.accepted===true&&old.task_id===record.task_id&&old.prepared?.operation==='status'&&old.prepared.body.opt_type==='PAUSE'){
            old.status='superseded';old.supersededBy=record.requestKey;old.updatedAt=now();await store.write(old);
          }
        }
      }catch(error){record.status='unknown';record.reason=error.message;}
      record.updatedAt=now();await store.write(record);return record;
    });
  }
  async function execute(operation,input,{deadline}={}) {
    scope(input);assert(typeof input.requestKey==='string'&&input.requestKey.trim(),'需要 requestKey');
    const {startTime:_start,endTime:_end,executionMode:_mode,expectedConfigurationHash:_expected,...effect}=input;
    const fingerprint=digest({operation,input:effect});
    const checkDeadline=()=>assert(deadline===undefined||typeof deadline==='number'&&Number.isFinite(deadline)&&now()<deadline,'任务执行期限已过');
    let dispatched=false,result;
    try{result=await store.withPlanLock(input.accountId,input.ad_id,async()=>{
      const prior=await store.read(input.accountId,input.ad_id,input.requestKey);
      if(prior){assert(prior.fingerprint===fingerprint,'requestKey 已用于不同内容');return {...prior,deduplicated:true};}
      checkDeadline();
      const unresolved=await store.findUnresolved(input.accountId,input.ad_id);
      const explicitStatusContinuation=operation==='status'&&['ENABLE','DISABLE'].includes(input.opt_type)&&unresolved.every(r=>r.status==='receipt_only'&&r.accepted===true&&r.task_id===input.task_id&&r.prepared?.operation==='status'&&r.prepared.body.opt_type==='PAUSE');
      assert(unresolved.length===0||explicitStatusContinuation,'同计划存在受理未核实或未知结果，须先 reconcile');
      assert(typeof post==='function','需要注入 post(path,body)');
      const prepared=await prepare(operation,input);checkDeadline();assertConfigurationHash(input.expectedConfigurationHash,prepared.configurationHash);
      const record={accountId:input.accountId,ad_id:input.ad_id,requestKey:input.requestKey,fingerprint,prepared,status:'submitting',createdAt:now(),updatedAt:now(),task_id:operation==='create'?null:input.task_id,attempts:1};
      const before=prepared.before,b=prepared.body;
      const unchanged=operation==='update'&&before&&before.name===b.name&&before.budget===b.budget&&(b.roi2_goal===undefined||before.roi2_goal===b.roi2_goal)&&(b.duration===undefined||before.duration===b.duration)&&(b.material_ids===undefined||sameIds(before.material_list?.map(r=>r.material_id),b.material_ids));
      if(unchanged){record.status='verified';record.attempts=0;record.unchanged=true;record.readback={task:clone(before),planType:prepared.evidence.planType,metricsScope:'task_total',checkedAt:now()};await store.write(record);return record;}
      await store.write(record);
      try {
        checkDeadline();
      }catch(error){record.status='expired';record.reason=error.message;await store.write(record);return record;}
      try {
        dispatched=true;const originalResponse=await post(CHENGFANG_TASK_PATHS[operation],clone(prepared.body));record.receipt=clone(originalResponse);const response=originalResponse?.code===0?{...originalResponse,data:responseData(originalResponse)}:originalResponse;
        if(response?.code!==0){record.status=typeof response?.code==='number'?'failed':'unknown';record.reason=response?.message??'未取得平台成功回执';}
        else if(operation==='create') {
          if(exact(response.data?.id)){record.task_id=response.data.id;record.accepted=true;record.status='accepted';}
          else {record.status='unknown';record.reason='创建回执缺少精确 data.id';}
        }else if(operation==='update') {
          if(response.data?.failed_infos!==undefined&&!Array.isArray(response.data.failed_infos)){record.status='unknown';record.reason='修改回执 failed_infos 类型无效';}
          else if(response.data.failed_infos?.length){record.status='failed';record.reason='修改回执含 failed_infos';}
          else {record.status='accepted';record.accepted=true;}
        }else {
          const successes=response.data?.task_ids,errors=response.data?.errors;
          if(!Array.isArray(successes)||!Array.isArray(errors)||successes.some(id=>!exact(id))||errors.some(row=>!exact(row.task_id))){record.status='unknown';record.reason='状态回执的成功 ID 或错误项缺失/不精确';}
          else if(errors.some(row=>row.task_id===input.task_id)){record.status='failed';record.reason=errors.find(row=>row.task_id===input.task_id).error_message??'状态操作失败';}
          else if(successes.length!==1||successes[0]!==input.task_id||errors.length){record.status='unknown';record.reason='状态回执未逐项确认目标任务';}
          else {record.status='accepted';record.accepted=true;}
        }
      }catch(error){record.status=error.requestDispatched===false?'not_submitted':error.platformRejectionConfirmed===true?'failed':'unknown';record.requestDispatched=error.requestDispatched;record.reason=error.message;}
      record.updatedAt=now();await store.write(record);return record;
    });}catch(e){if(!dispatched&&e.requestDispatched!==true)e.requestDispatched=false;throw e;}
    if(result.status==='accepted')return reconcile({...input});
    return result;
  }
  return {list,get,prepare,execute,receipt:reconcile,reconcile};
}
