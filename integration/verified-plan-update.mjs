import {planConfigurationHash,assertConfigurationHash} from './execution-preconditions.mjs';
const id=v=>typeof v==='string'&&/^\d{1,20}$/.test(v);
const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const same=(a,b)=>typeof a===typeof b&&(typeof a==='number'?Math.abs(a-b)<1e-6:a===b);
function valueOf(detail,type){return type==='status'?detail.opt_status:numeric(detail.delivery_setting?.[type==='roi'?'roi2_goal':'budget']);}
export async function verifiedPlanUpdate({accountId,planId,type,value,read,write,expectedConfigurationHash}){
 if(!id(accountId)||!id(planId)||!['roi','budget','status'].includes(type))throw Object.assign(Error('账户、计划或操作类型无效'),{statusCode:400});
 if(type==='status'?!['ENABLE','DISABLE','DELETE'].includes(value):!(typeof value==='number'&&Number.isFinite(value)&&value>0))throw Object.assign(Error('操作目标值无效'),{statusCode:400});
 if(type==='budget'&&Math.abs(value*100-Math.round(value*100))>1e-7)throw Object.assign(Error('预算金额最多支持两位小数'),{statusCode:400});
 const fresh=async()=>{const j=await read();const d=j?.data;if(!d||String(d.ad_id)!==planId)throw Error('计划详情回读对象不匹配');return d;};
 const before=await fresh(),from=valueOf(before,type);assertConfigurationHash(expectedConfigurationHash,planConfigurationHash(before));if(type==='roi'&&!before.delivery_setting?.deep_external_action)throw Object.assign(Error('计划优化目标口径未核实，未提交ROI修改'),{statusCode:409});if(from===null||from===undefined)throw Object.assign(Error('计划当前参数未核实，未提交修改'),{statusCode:409});
 if(same(from,value))return{verified:true,unchanged:true,planId,type,from,to:value};
 let response;
 try{response=await write({before});}catch(e){if(['HEADLESS_AUTHORIZATION_EXPIRED','COMMAND_REQUEST_LIMIT'].includes(e.code)&&e.requestDispatched===false)throw e;if(e.code===40000||['API_REQUEST_CONTRACT','API_CONTRACT_UNVERIFIED','OFFICIAL_CONTRACT'].includes(e.code))throw Object.assign(Error('请求未通过平台或本地契约校验：'+e.message),{code:'PLATFORM_WRITE_REJECTED',statusCode:400});throw Object.assign(Error('提交结果未知，须先回读计划核实；未自动重发：'+e.message),{code:'WRITE_RESULT_UNKNOWN',statusCode:502});}
 if(response?.code!==0)throw Object.assign(Error('写入回执未取得明确成功码，结果待核实'),{code:'WRITE_RESULT_UNKNOWN',statusCode:502});
 const rows=response?.data?.results;
 if(Array.isArray(rows)&&rows.length){
  const row=rows.find(r=>String(r.ad_id)===planId);
  if(!row)throw Object.assign(Error('写入回执未包含目标计划，结果待核实'),{code:'WRITE_RESULT_UNKNOWN',statusCode:502});
  if(row.flag===false||row.status==='FAILED')throw Object.assign(Error('平台明确拒绝该计划修改：'+(row.error_message||row.error?.error_message||'单条执行失败')),{code:'PLATFORM_WRITE_REJECTED',statusCode:502});
 }
 try{const after=await fresh();if(!same(valueOf(after,type),value))throw Error('计划目标值尚未回读确认');if(type==='roi'&&before.delivery_setting?.deep_external_action!==after.delivery_setting?.deep_external_action)throw Error('优化目标口径已变化');return{verified:true,unchanged:false,planId,type,from,to:value,platformReceipt:response?.data??{}};}catch(e){throw Object.assign(Error('提交后结果待核实，未自动重发：'+e.message),{code:'WRITE_RESULT_UNKNOWN',statusCode:502});}
}
