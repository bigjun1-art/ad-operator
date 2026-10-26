const invalid=message=>{throw Object.assign(Error('随心推报表未完整核实：'+message),{code:'SUIXIN_REPORT_INCOMPLETE',statusCode:502});};
export function checkedSuixinCore(row,{cost='stat_cost',gmv='pay_order_amount',orders='pay_order_count'}={}){
 const value=field=>{const raw=row?.[field];if(!['number','string'].includes(typeof raw)||String(raw).trim()===''||!Number.isFinite(Number(raw))||Number(raw)<0)invalid('核心指标缺失或无效 '+field);return Number(raw);};
 const out={cost:value(cost),gmv:value(gmv),orders:value(orders)};
 if(!Number.isSafeInteger(out.orders)||out.cost>Number.MAX_SAFE_INTEGER/100||out.gmv>Number.MAX_SAFE_INTEGER/100)invalid('金额或订单数超出安全精度范围');
 return out;
}
export function checkedSuixinOrderPage(response){
 const data=response?.data,rows=data?.list??data?.order_list;
 if(!Array.isArray(rows))invalid('订单库存未返回list');
 if(data.fail_list!==undefined&&(!Array.isArray(data.fail_list)||data.fail_list.length))invalid('订单库存包含失败项');
 const more=data.page_info?.has_more;
 if(![false,true,0,1,'0','1'].includes(more))invalid('订单库存缺少明确has_more分页标志');
 return {rows,hasMore:[true,1,'1'].includes(more),cursor:data.page_info.cursor};
}
