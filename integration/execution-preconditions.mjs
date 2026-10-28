import {createHash} from 'node:crypto';
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
export const configurationHash=value=>createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
export const planConfigurationHash=detail=>configurationHash({ad_id:String(detail.ad_id),marketing_goal:detail.marketing_goal,opt_status:detail.opt_status,delivery_setting:detail.delivery_setting,aweme_id:detail.aweme_id,room_info:detail.room_info});
export function assertConfigurationHash(expected,actual){
 if(expected!==undefined&&(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||expected!==actual))throw Object.assign(Error('准备后投放配置已变化，当前动作未提交'),{code:'PREPARED_CONFIGURATION_CHANGED',statusCode:409,requestDispatched:false});
}
