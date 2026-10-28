import {createCurrencyVerifiedReportClient} from './report-currency-service.mjs';
import {buildChengfangMetrics} from './chengfang-policy.mjs';

export const CHENGFANG_PERIODS=Object.freeze({chengfang:'OVER_ALL_DATA',uni:'UNI_DATA',combined:'ALL_DATA'});
export const CHENGFANG_TOPICS=Object.freeze({video:{account:'OVERALL_ROI_PRODUCT_PROJECT',plan:'OVERALL_ROI_PRODUCT_PROJECT',material:'OVERALL_ROI_PRODUCT_MATERIAL'},live:{account:'OVERALL_ROI_LIVE_AWEME',anchor:'OVERALL_ROI_LIVE_AWEME',material:'OVERALL_ROI_LIVE_MATERIAL_VIDEO'}});
const error=(message,code='CHENGFANG_REPORT_SCOPE')=>Object.assign(Error(message),{code,statusCode:400});
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const exact=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v);
const label=s=>String(s||'').replace(/[\s（）()·_]/g,'').toLowerCase();
const LABELS={
 marketing_roi:['综合营销ROI','综合ROI'],cost:['整体消耗','消耗'],marketing_cost:['综合成本'],net_gmv:['净成交金额','整体净成交金额'],estimated_commission:['预估达人佣金成本','预估联盟达人佣金成本','预估达人佣金'],estimated_leader_service_fee:['预估团长服务费','预估团长服务费成本'],orders:['整体支付订单数','支付订单数','成交订单数'],payment_roi:['整体支付ROI','支付ROI'],net_roi:['净成交ROI','整体净成交ROI'],ctr:['点击率','整体点击率'],
};
const FIELDS={cost:['stat_cost','stat_cost_for_roi2'],orders:['total_pay_order_count_for_roi2'],payment_roi:['total_prepay_and_pay_order_roi2'],net_roi:['total_prepay_and_pay_settle_roi2_1h']};
export function discoverChengfangFields(config){
 const mapped={},ambiguous={};
 for(const [kind,names]of Object.entries(LABELS)){
  let candidates=[];for(const name of names){candidates=(config.metrics||[]).filter(m=>label(name)===label(m.name));if(candidates.length)break;}
  if(!candidates.length)candidates=(config.metrics||[]).filter(m=>(FIELDS[kind]||[]).includes(m.field));
  if(candidates.length===1)mapped[kind]=candidates[0];else if(candidates.length>1)ambiguous[kind]=candidates;
 }
 return {mapped,ambiguous,dimensions:config.dimensions||[],queryLimit:config.query_limit||{}};
}
function dimension(config,role){
 const aliases={plan:['ad_id','plan_id'],material:['material_id','video_material_id'],anchor:['anchor_id']},names={plan:['计划ID','广告计划ID'],material:['素材ID','视频素材ID'],anchor:['主播ID']};
 const found=(config.dimensions||[]).filter(d=>aliases[role]?.includes(d.field)||names[role]?.map(label).includes(label(d.name)));
 if(found.length!==1)throw error('当前报表配置未唯一提供'+role+'的精确ID维度');return found[0];
}
function readCell(row,metric,{money=false,ratio=false,proof}={}){
 if(!metric)return {value:null,raw:null,unit:null,status:'field_unavailable'};
 const cell=row.sourceCells?.[metric.field],raw=cell?.rawValue??row[metric.field],n=numeric(raw),unit=Number(metric.unit);
 if(n===null||n<0)return {value:null,raw,unit:metric.unit,status:'value_unavailable'};
 if(money){
  if(proof&&['official_config','reconciled','zero_invariant'].includes(proof.status)&&numeric(row[metric.field])!==null)return {value:numeric(row[metric.field]),raw,unit:metric.unit,status:proof.status,normalizedUnit:'yuan',unitEvidence:proof};
  if(![1,2,3].includes(unit)||unit!==3&&cell?.source!=='Value')return {value:null,raw,unit:metric.unit,status:'unit_unconfirmed'};
  return {value:n/({1:100000,2:100,3:1}[unit]),raw,unit:metric.unit,status:'official_config',normalizedUnit:'yuan'};
 }
 if(ratio&&unit!==0)return {value:null,raw,unit:metric.unit,status:'ratio_unit_unconfirmed'};
 return {value:n,raw,unit:metric.unit,status:'official_config',normalizedUnit:ratio?'ratio':unit===4?'count':unit===10?'percent':'number'};
}
export function createChengfangReport({get,now=Date.now}={}){
 const client=createCurrencyVerifiedReportClient({get,now,ttl:0});
 async function settings(input){
  const {accountId,scene,level='account',period='chengfang'}=input;
  if(!exact(accountId)||!CHENGFANG_TOPICS[scene]?.[level]||!CHENGFANG_PERIODS[period])throw error('请明确账户、直播或商品、数据期间和可用统计层级');
  const topic=CHENGFANG_TOPICS[scene][level],dataPeriod=CHENGFANG_PERIODS[period];
  const config=await client.getConfig({advertiserId:accountId,app:'qianchuan_pc',topic,dataPeriod});
  return {config,topic,dataPeriod,fields:discoverChengfangFields(config)};
 }
 return {
  async fields(input){const {config,topic,dataPeriod,fields}=await settings(input);return {topic,dataPeriod,...fields,metrics:config.metrics||[],source:'https://open.oceanengine.com/labels/12/docs/1823296280645708'};},
  async get(input){
   const {accountId,scene,level='account',period='chengfang',startTime,endTime,planContext}=input;
   const {config,topic,dataPeriod,fields}=await settings(input),filters=[],dimensions=(config.dimensions||[]).filter(d=>d.is_required&&!d.filter_only).map(d=>d.field),identities=[];
   const bind=(role,id)=>{
    if(!exact(id))throw error('查询需要精确'+role+'ID');const d=dimension(config,role);
    if(d.filterable!==true&&d.filter_only!==true)throw error('当前报表维度不支持精确筛选：'+d.field);
    filters.push({field:d.field,operator:7,values:[id]});if(!d.filter_only&&!dimensions.includes(d.field))dimensions.push(d.field);identities.push({role,id,field:d.field,filterOnly:d.filter_only===true});
   };
   if(input.ad_id)bind('plan',input.ad_id);
   if(level==='plan'&&!input.ad_id)throw error('计划报表需要ad_id');
   if(level==='material'){bind('material',input.material_id);if(!input.ad_id)throw error('单素材跟踪需要同时指定计划ID');}
   if(level==='anchor'){
    try{bind('anchor',input.anchor_id);}catch(e){
     const room=(Array.isArray(planContext?.room_info)?planContext.room_info:[]).find(r=>String(r.anchor_id)===input.anchor_id),d=(config.dimensions||[]).find(d=>d.field==='anchor_name'&&d.filterable===true);
     if(!exact(input.anchor_id)||!room?.anchor_name||!d)throw e;
     filters.push({field:d.field,operator:7,values:[room.anchor_name]});if(!dimensions.includes(d.field))dimensions.push(d.field);identities.push({role:'anchor',id:input.anchor_id,field:'anchor_id'});
    }
   }
   if(!dimensions.length){const d=(config.dimensions||[]).find(d=>!d.filter_only);if(!d)throw error('报表没有可读取的维度');dimensions.push(d.field);}
   const metrics=[...new Set(Object.values(fields.mapped).map(m=>m.field))];if(!metrics.length)throw error('当前主题未返回可绑定的投放指标','CHENGFANG_METRICS_UNAVAILABLE');
   const rows=await client.query({advertiserId:accountId,app:'qianchuan_pc',topic,dataPeriod,dimensions,metrics,filters,startTime,endTime,orderBy:[{field:metrics[0],type:2}],requiredMoneyFields:fields.mapped.cost?[fields.mapped.cost.field]:[]});
   const commission=planContext?.delivery_setting?.alliance_commision_switch,costItems=planContext?.delivery_setting?.overall_roi_cost_items;
   const contradictory=commission==='OFF'&&Array.isArray(costItems)&&costItems.includes(4);
   const commissionIncluded=period==='uni'?false:contradictory?null:commission==='ON'?true:commission==='OFF'?false:Array.isArray(costItems)&&costItems.includes(4)?true:null;
   const parsed=rows.map(row=>{
    for(const identity of identities){const v=row[identity.field]??(identity.role==='plan'?row.ad_id:null);if(v===undefined&&identity.filterOnly)continue;if(String(v)!==identity.id)throw error('报表返回的'+identity.role+'ID与本次查询不一致','CHENGFANG_OBJECT_MISMATCH');}
    const cells=Object.fromEntries(Object.entries(fields.mapped).map(([kind,m])=>[kind,readCell(row,m,{money:['cost','marketing_cost','net_gmv','estimated_commission','estimated_leader_service_fee'].includes(kind),ratio:['marketing_roi','payment_roi','net_roi'].includes(kind),proof:rows.unitEvidence?.[m.field]})]));
    if(cells.ctr&&cells.ctr.normalizedUnit!=='percent')cells.ctr={...cells.ctr,value:null,status:'percent_unit_unconfirmed'};
    const feePolicyChanged=startTime.slice(0,10)<'2026-08-01'&&endTime.slice(0,10)>='2026-08-01';
    const inputMetrics={period,commissionIncluded,includeLeaderServiceFee:commissionIncluded===false?false:fields.mapped.estimated_leader_service_fee?true:null,effectiveDate:feePolicyChanged?null:endTime.slice(0,10),costYuan:cells.cost?.value??null,netGmvYuan:cells.net_gmv?.value??null,estimatedCommissionYuan:cells.estimated_commission?.value??null,estimatedLeaderServiceFeeYuan:cells.estimated_leader_service_fee?.value??null,officialMarketingRoi:cells.marketing_roi?.value??null,units:{costYuan:cells.cost?.normalizedUnit,netGmvYuan:cells.net_gmv?.normalizedUnit,estimatedCommissionYuan:cells.estimated_commission?.normalizedUnit,estimatedLeaderServiceFeeYuan:cells.estimated_leader_service_fee?.normalizedUnit,officialMarketingRoi:cells.marketing_roi?.normalizedUnit},source:{topic,dataPeriod,fields:fields.mapped,startTime,endTime,feePolicyChanged}};
    const marketing=buildChengfangMetrics(inputMetrics);
    if(period==='chengfang'&&(contradictory||Array.isArray(costItems)&&costItems.some(v=>v===1||v===2))){marketing.calculated_marketing_roi=null;marketing.issues.push(contradictory?'cost_configuration_conflict':'additional_cost_components_unmapped');}
    return {...Object.fromEntries(dimensions.map(d=>[d,row[d]])),...(row.anchor_id?{anchor_id:String(row.anchor_id)}:{}),cost:cells.cost?.value??null,orders:cells.orders?.value??null,payment_roi:period==='uni'?cells.payment_roi?.value??null:null,net_roi:period==='uni'?cells.net_roi?.value??null:null,marketing_roi:marketing.marketing_roi,calculated_marketing_roi:marketing.calculated_marketing_roi,ctr:cells.ctr?.value??null,marketing,cells};
   });
   const scope={level,accountId,scene,period,...(input.ad_id?{ad_id:input.ad_id}:{}),...(input.anchor_id?{anchor_id:input.anchor_id}:{}),...(input.material_id?{material_id:input.material_id}:{})};
   const completeSum=key=>parsed.length&&parsed.every(r=>typeof r[key]==='number')?parsed.reduce((n,r)=>n+r[key],0):null;
   const summary={cost:completeSum('cost'),orders:completeSum('orders'),marketing_roi:parsed.length===1?parsed[0].marketing_roi:null,calculated_marketing_roi:parsed.length===1?parsed[0].calculated_marketing_roi:null,payment_roi:parsed.length===1?parsed[0].payment_roi:null,net_roi:parsed.length===1?parsed[0].net_roi:null,ctr:parsed.length===1?parsed[0].ctr:null};
   let accountRatioSource=null;
   if(level==='account'&&period==='chengfang'&&parsed.length>1&&fields.mapped.marketing_roi&&Number(fields.mapped.marketing_roi.unit)===0){
    const field=fields.mapped.marketing_roi.field;
    try{const q={adlab_scene:'OVERALL_PROJECT',data_period:dataPeriod,marketing_goal:scene==='live'?'LIVE_PROM_GOODS':'VIDEO_PROM_GOODS',order_platform:'QIANCHUAN',start_time:startTime,end_time:endTime,fields:[field]};
     const response=await get('/open_api/v1.0/qianchuan/report/all_promotion/get/',{advertiserId:accountId,app:'qianchuan_pc',allPages:false,fresh:true,query:q});
     if(response?.code!==0)throw error('账户综合营销ROI未取得平台成功响应');const cell=response.data?.[field],value=numeric(cell&&typeof cell==='object'?cell.Value??cell.value??cell.ValueStr??cell.value_str:cell);
     if(value===null||value<0)throw error('账户综合营销ROI字段未返回有效数值');summary.marketing_roi=value;accountRatioSource={path:'/open_api/v1.0/qianchuan/report/all_promotion/get/',field,query:q};
    }catch(e){accountRatioSource={field,status:'unavailable',reason:e.message};}
   }
   return {scope,rows:parsed,summary,complete:true,topic,dataPeriod,fields,observedAt:now(),range:{startTime,endTime},epoch:JSON.stringify([period,planContext?.adlab_scene??null,commission??null,planContext?.delivery_setting?.overall_roi_cost_items??null,planContext?.modify_time??null]),metricBasis:{marketing_roi:'official_config_bound_field',calculated_marketing_roi:'calculated_from_confirmed_cost_components',accountRatioSource}};
  },
 };
}
