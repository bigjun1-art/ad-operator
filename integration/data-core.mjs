/** Local transport: exact identifiers, bounded requests, no implicit credential changes. */
// 强制按字符串序列化（绕过 _id 纯数字串→裸整数的自动转换；用于官方要求字符串的字段，如创建单元的 aweme_id）
export class RawString { constructor(v){ this.value = String(v); } }
export function raw(v){ return new RawString(v); }
export function parseExactJSON(text) {
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
    if (token[0] === '"' || /[.eE]/.test(token)) return token;
    return Number.isSafeInteger(Number(token)) ? token : JSON.stringify(token);
  }));
}
export function stringifyExact(value) {
  return JSON.stringify(value, (key, v) => {
    if (v instanceof RawString) return v.value; // 保持带引号字符串，不再走下方 _id→整数规则
    if (typeof v === 'bigint') return `__INTEGER_${v}__`;
    if ((/(?:^|_)ids?$/.test(key)) && typeof v === 'string' && /^\d+$/.test(v)) return `__INTEGER_${v}__`;
    if (/(?:^|_)ids$/.test(key) && Array.isArray(v)) return v.map(x => /^\d+$/.test(String(x)) ? `__INTEGER_${x}__` : x);
    return v;
  }).replace(/"__INTEGER_(-?\d+)__"/g, '$1');
}
export function createTransport({tokenFor, fetchImpl = fetch, timeout = 20000, concurrency = 2, ttl = 45000, minInterval = 0, endpointIntervals = {}, refreshFor, requestContext}) {
  const refreshJobs=new Map(), authVersions=new Map();
  let mutationGeneration=0, requestSequence=0;
  const latestReads=new Map();
  let actualNextStart=0;const actualEndpointStarts=new Map();
  let nextStart=0; const endpointStarts=new Map(); const cooldowns = new Map(); let active = 0; const waiters = [], cache = new Map(), pending = new Map();
  async function limited(fn) {
    if (active >= concurrency) await new Promise(resolve => waiters.push(resolve));
    else active++;
    try { return await fn(); } finally { const next = waiters.shift(); if (next) next(); else active--; }
  }
  async function call(method, endpoint, {advertiserId, query = {}, body = {}, app = 'suixin', signal, authRetry = false, fresh = false, writeDeadline} = {}) {
    const assertWriteDeadline=()=>{if(method==='POST'&&writeDeadline!==undefined&&(!Number.isSafeInteger(writeDeadline)||Date.now()>=writeDeadline))throw Object.assign(new Error('本次对话投流授权已到期，未向平台提交修改'),{code:'HEADLESS_AUTHORIZATION_EXPIRED',statusCode:403,requestDispatched:false,responseCodeValid:false,platformRejectionConfirmed:false});};
    assertWriteDeadline();
    if(signal?.aborted) throw Object.assign(new Error("请求已取消"),{requestDispatched:false,responseCodeValid:false,platformRejectionConfirmed:false});
    const authVersion=authVersions.get(app)||0;
    const params = new URLSearchParams();
    const payload = {...(method === 'GET' ? query : body)};
    if (advertiserId && payload.advertiser_id == null) payload.advertiser_id = String(advertiserId);
    if (method === 'GET') for (const [k,v] of Object.entries(payload)) if (v != null) params.set(k, typeof v === 'object' ? stringifyExact({[k]:v}).slice(JSON.stringify(k).length+2,-1) : String(v));
    const url = `https://api.oceanengine.com${endpoint}${params.size ? '?' + params : ''}`;
    const key = app + '|' + url;
    const accountId = String(payload.advertiser_id ?? payload.local_account_id ?? '');
    // 官方频控维度：40100=全平台开发者合计的接口总频控，40110=当前开发者接口频控，
    // 40130=当前客户接口频控。不同 endpoint 保持隔离。
    const platformBucket = 'platform|' + endpoint;
    const endpointBucket = 'endpoint|' + app + '|' + endpoint;
    const accountBucket = endpointBucket + '|account|' + accountId;
    const checkCooldown = () => {
      for (const bucket of [platformBucket,endpointBucket,accountBucket]) {
        const state = cooldowns.get(bucket);
        if (!state) continue;
        if (Date.now() >= state.until) { cooldowns.delete(bucket); continue; }
        const seconds = Math.ceil((state.until-Date.now())/1000);
        const origin=state.message?`；上游原始消息：${state.message}`:'';
        throw Object.assign(new Error(`接口 ${endpoint} 暂时限流（${state.code}）${origin}；${seconds} 秒后可刷新；其他接口仍可使用`), {
          code:state.code,retryAfter:seconds,rateLimited:true,upstreamMessage:state.message,rateHeaders:{...(state.rateHeaders||{})}
        });
      }
    };
    if (method === 'GET' && !fresh) {
      const c = cache.get(key); if (c && Date.now()-c.ts < ttl) return structuredClone(c.value);
      if (pending.has(key)) return structuredClone(await pending.get(key));
    }
    const readGeneration=mutationGeneration, readSequence=++requestSequence;
    let postStarted=false,responseCodeValid=false,platformRejectionConfirmed=false;
    if(method==='GET'){latestReads.set(key,readSequence);if(fresh)cache.delete(key);}
    const job = limited(async () => {
      assertWriteDeadline();
      if(signal?.aborted) throw new Error("请求已取消");
      checkCooldown();
      const paceKey=app+'|'+endpoint;
      const now=Date.now(), globalAt=Math.max(now,nextStart);
      const startedAt=Math.max(globalAt,endpointStarts.get(paceKey)||0);
      // 单接口的长间隔不能把其他 endpoint 或其他应用一并推迟。
      const delay=startedAt-now; nextStart=globalAt+minInterval;
      endpointStarts.set(paceKey,startedAt+Number(endpointIntervals[endpoint]||0));
      if(delay) await new Promise(r=>setTimeout(r,method==='POST'&&writeDeadline!==undefined?Math.min(delay,Math.max(0,writeDeadline-Date.now())):delay));
      assertWriteDeadline();
      checkCooldown();
      if(signal?.aborted) throw new Error("请求已取消");
      const token = tokenFor(app);
      if (!token) throw new Error('授权信息不可用，请检查应用授权状态');
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeout);
      let commandContext, commandAttempt, attemptHttpStatus, attemptResponseCode, attemptRequestId, attemptSucceeded=false;
      const cancel=()=>ctrl.abort();signal?.addEventListener("abort",cancel,{once:true});
      try {
        const postBody=method==='POST'?stringifyExact(payload):undefined;
        // Recheck actual dispatch spacing when delayed timers resume together.
        for(;;){assertWriteDeadline();const remaining=Math.max(actualNextStart,actualEndpointStarts.get(paceKey)||0)-Date.now();if(remaining<=0)break;await new Promise(r=>setTimeout(r,method==='POST'&&writeDeadline!==undefined?Math.min(remaining,Math.max(0,writeDeadline-Date.now())):remaining));if(signal?.aborted||ctrl.signal.aborted)throw new Error("请求已取消");}
        if(signal?.aborted||ctrl.signal.aborted)throw new Error("请求已取消");
        assertWriteDeadline();
        commandContext=requestContext?.();
        commandAttempt=commandContext?.reserveAttempt({method,endpoint});
        const dispatchedAt=Date.now();actualNextStart=dispatchedAt+minInterval;actualEndpointStarts.set(paceKey,dispatchedAt+Number(endpointIntervals[endpoint]||0));
        if(method==='POST')postStarted=true;
        const response = await fetchImpl(url, {method, headers:{'Access-Token':token, 'content-type':'application/json'}, signal:ctrl.signal, ...(method === 'POST' ? {body:postBody} : {})});
        attemptHttpStatus=response.status;
        attemptRequestId=response.headers?.get?.('X-Request-Id') ?? response.headers?.get?.('X-Tt-Logid');
        const result = parseExactJSON(await response.text());
        attemptRequestId=result?.request_id ?? result?.requestId ?? attemptRequestId;
        responseCodeValid=!!result&&typeof result==='object'&&!Array.isArray(result)&&Object.hasOwn(result,'code')&&((typeof result.code==='number'&&Number.isSafeInteger(result.code))||(typeof result.code==='string'&&/^-?\d+$/.test(result.code.trim())&&Number.isSafeInteger(Number(result.code))));
        const code = responseCodeValid?Number(result.code):-1;
        if(responseCodeValid)attemptResponseCode=code;
        platformRejectionConfirmed=response.status===200&&responseCodeValid&&code!==0;
        if (!response.ok || !responseCodeValid || code !== 0) {
          if ([40100,40110,40130].includes(code) || response.status === 429) {
            const header = name => response.headers?.get?.(name);
            const rateHeaders = Object.fromEntries([
              ['x-ratelimit-dimension',header('X-RateLimit-Dimension')],
              ['x-ratelimit-limit',header('X-RateLimit-Limit')],
              ['x-ratelimit-remaining',header('X-RateLimit-Remaining')],
              ['x-ratelimit-retryin',header('X-RateLimit-RetryIn')],
              ['retry-after',header('Retry-After')],
              ['x-tt-logid',header('X-Tt-Logid')],
              ['x-request-id',header('X-Request-Id')],
            ].filter(([,value])=>value!=null));
            const retry = Number(rateHeaders['x-ratelimit-retryin'] || rateHeaders['retry-after']);
            const dimension = rateHeaders['x-ratelimit-dimension'];
            // 40100 官方允许在开发者配额内重试或错峰；无响应头时仅作短保护。
            // 40110 的 QPM 惩罚窗口官方为 5 分钟；40130/HTTP 429 无头时保守等待 60 秒。
            const seconds = Number.isFinite(retry) && retry > 0 ? retry : code===40100 ? 2 : code===40110 || dimension === 'developer_qpm' ? 300 : 60;
            const bucket = code===40100 ? platformBucket : code===40130 ? accountBucket : endpointBucket;
            const safeMessage=String(result?.message || '请求失败').replace(/(?:access_token|refresh_token|secret|cookie)\s*[:=]\s*\S+/gi, '[敏感信息已省略]');
            cooldowns.set(bucket, {
              until:Date.now()+seconds*1000,code,message:safeMessage,rateHeaders
            });
            const error = new Error(`接口 ${endpoint} 返回 HTTP ${response.status} / code ${code}：${safeMessage}`);
            error.code=code;error.status=response.status;error.retryAfter=seconds;error.rateLimited=true;
            error.upstreamMessage=safeMessage;error.rateHeaders=rateHeaders;
            throw error;
          }
          const error = new Error(`接口 ${endpoint} 返回 HTTP ${response.status} / code ${code}：${String(result?.message || '请求失败').replace(/(?:access_token|refresh_token|secret|cookie)\s*[:=]\s*\S+/gi, '[敏感信息已省略]')}`);
          error.code = code; error.status = response.status; throw error;
        }
        result.fetchedAt=Date.now();
        const source=Object.hasOwn(result,'sourceObservedAt')?result.sourceObservedAt:Object.hasOwn(result,'observedAt')?result.observedAt:
          result.data&&Object.hasOwn(result.data,'sourceObservedAt')?result.data.sourceObservedAt:result.data&&Object.hasOwn(result.data,'observedAt')?result.data.observedAt:undefined;
        result.sourceObservedAt=source===undefined?result.fetchedAt:source;
        result.observationTimeBasis ??= source===undefined?'response_received':'source_provided';
        attemptSucceeded=true;
        return result;
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort",cancel);
        if(commandAttempt!==undefined)commandContext.record(commandAttempt,{responseCode:attemptResponseCode,httpStatus:attemptHttpStatus,requestId:attemptRequestId,outcome:attemptSucceeded?'success':'error'});
      }
    });
    if (method === 'GET') pending.set(key, job);
    try { const result = await job; if (method === 'GET') { if(readGeneration===mutationGeneration && latestReads.get(key)===readSequence){cache.set(key,{ts:Date.now(),value:result}); if(cache.size>1000) cache.delete(cache.keys().next().value);} } else { mutationGeneration++; cache.clear(); pending.clear(); latestReads.clear(); } return structuredClone(result); }
    catch(error) {
      // These flags are established here, rather than inferred from a synthetic code or an AbortError.
      if(method==='POST')error.requestDispatched=postStarted;
      error.responseCodeValid=responseCodeValid;error.platformRejectionConfirmed=platformRejectionConfirmed;
      // 回执不明时也让旧快照失效；不重发写请求。明确参数拒绝没有提交结果歧义。
      if(method==='POST'&&postStarted&&error.code!==40000){mutationGeneration++;cache.clear();pending.clear();latestReads.clear();}
      if(method==='GET' && error.code===40102 && refreshFor && !authRetry && !signal?.aborted){
        if(pending.get(key)===job)pending.delete(key);
        if((authVersions.get(app)||0)===authVersion){
          if(!refreshJobs.has(app)) refreshJobs.set(app,Promise.resolve().then(()=>refreshFor(app)).then(()=>{authVersions.set(app,authVersion+1);}).finally(()=>refreshJobs.delete(app)));
          await refreshJobs.get(app);
        }
        return await call(method,endpoint,{advertiserId,query,body,app,signal,authRetry:true,fresh});
      }
      throw error;
    }
    finally { if(method === 'GET'){if(pending.get(key)===job) pending.delete(key);if(latestReads.get(key)===readSequence)latestReads.delete(key);} }
  }
  return {get:(p,o)=>call('GET',p,o), post:(p,o)=>call('POST',p,o)};
}
// Stable object serialization keeps exact string IDs and all report dimensions intact.
function paginationIdentity(value) {
  if (Array.isArray(value)) return '['+value.map(paginationIdentity).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+paginationIdentity(value[k])).join(',')+'}';
  return typeof value==='bigint' ? 'bigint:'+String(value) : JSON.stringify(value);
}
export async function collectPages(get, endpoint, options = {}, maxPages = 500) {
  const {strict=false, strictPagination=false, identityOf, ...requestOptions}=options;
  const strictMode=strict || strictPagination;
  const size=Number(options.query?.page_size ?? 50);
  if(!Number.isSafeInteger(size)||size<1||!Number.isSafeInteger(maxPages)||maxPages<1)throw new TypeError('分页大小和上限必须为正安全整数');
  if(identityOf!==undefined&&typeof identityOf!=='function')throw new TypeError('identityOf must be a function');
  let output, key, count=0, expectedTotal, expectedPages, lastSignature;
  const seen=new Set(), sourcePages=[], observationTimes=[];
  const fail=message=>{throw Object.assign(new Error(`接口 ${endpoint} ${message}`),{code:'PAGINATION_INCOMPLETE',complete:false,sourcePages:structuredClone(sourcePages),requestIds:sourcePages.map(p=>p.requestId)});};
  const readInteger=(objects,names,label)=>{
    let value;
    for(const object of objects)for(const name of names)if(Object.hasOwn(object,name)){
      const raw=object[name];
      if(!((typeof raw==='number')||(typeof raw==='string'&&/^\d+$/.test(raw)))||!Number.isSafeInteger(Number(raw))||Number(raw)<0)fail(`分页${label}无效`);
      const parsed=Number(raw);
      if(value!==undefined&&value!==parsed)fail(`分页${label}字段互相矛盾`);
      value=parsed;
    }
    return value;
  };
  for(let page=1;page<=maxPages;page++) {
    const result=await get(endpoint,{...requestOptions,query:{...requestOptions.query,page,page_size:size}});
    const data=result.data||{}, info=data.page_info||{};
    const requestId=result.request_id ?? result.requestId ?? null;
    sourcePages.push({page,requestId,pageInfo:structuredClone(info),...(result.fetchedAt===undefined?{}:{fetchedAt:result.fetchedAt}),...(result.sourceObservedAt===undefined?{}:{observedAt:result.sourceObservedAt})});
    if(Object.hasOwn(result,'sourceObservedAt'))observationTimes.push(result.sourceObservedAt);
    if(result.complete===false||result.partial===true||result.truncated===true||data.complete===false||data.partial===true||data.truncated===true)fail('上游返回不完整分页');
    key ??= ['task_list','aweme_id_list','ad_list','order_list','promotion_list','project_list','data_list','rows','room_list','advertiser_list','account_list','adv_id_list','audiences_list','retargeting_tags','video_list','list','records','material_list','ad_material_infos'].find(k=>Array.isArray(data[k]));
    if(!key){if(strictMode)fail('缺少分页记录列表');return result;}
    if(!Array.isArray(data[key]))fail('分页记录列表缺失');
    const rows=data[key];sourcePages.at(-1).rowCount=rows.length;
    const returnedPage=readInteger([info],['page','page_number','current_page'],'页码');
    const returnedSize=readInteger([info],['page_size'],'每页条数');
    const infoTotal=readInteger([info],['total_number','total'],'总条数'), dataTotal=readInteger([data],['total'],'总条数');
    if(infoTotal!==undefined&&dataTotal!==undefined&&infoTotal!==dataTotal)fail('分页总条数字段互相矛盾');
    const total=infoTotal ?? dataTotal;
    const totalPages=readInteger([info],['total_page','total_pages'],'总页数');
    if(strictMode&&[returnedPage,returnedSize,total,totalPages].some(v=>v===undefined))fail('严格分页缺少页码、每页条数、总页数或总条数');
    if(returnedPage!==undefined&&returnedPage!==page)fail(`分页页码未推进：请求 ${page}，返回 ${returnedPage}`);
    if(returnedSize!==undefined&&(returnedSize<1||returnedSize!==size))fail('分页每页条数与请求不一致');
    if(total!==undefined){if(expectedTotal!==undefined&&total!==expectedTotal)fail('分页总条数发生变化');expectedTotal=total;}
    if(totalPages!==undefined){if(expectedPages!==undefined&&totalPages!==expectedPages)fail('分页总页数发生变化');expectedPages=totalPages;}
    if(expectedPages===0&&(page!==1||rows.length||expectedTotal>0))fail('分页空结果与总量矛盾');
    if(expectedPages>0&&page>expectedPages)fail('分页页码超过总页数');
    const signature=paginationIdentity(rows);
    if(page>1&&rows.length&&signature===lastSignature)fail('分页未推进，汇总已停止');
    lastSignature=signature;
    if(!output)output={...result,data:{...data,[key]:[]}};
    for(const row of rows){
      // Exact rows are the compatible default; business keys require an explicit dimension-aware identityOf.
      const identity=identityOf ? identityOf(row) : row;
      if(identityOf&&(identity===undefined||identity===null||identity===''))fail('分页记录身份为空');
      const serialized=paginationIdentity(identity);
      if(seen.has(serialized))fail('分页记录身份重复，汇总已停止');
      seen.add(serialized);
    }
    output.data[key].push(...rows);count+=rows.length;
    if(expectedTotal!==undefined&&count>expectedTotal)fail(`分页记录超过总条数：${count}/${expectedTotal}`);
    if(rows.length===0&&expectedPages!==undefined&&page<expectedPages)fail('分页提前结束：总页数尚未完成');
    if(expectedPages!==undefined&&page<expectedPages&&expectedTotal!==undefined&&count>=expectedTotal)fail('分页总页数与总条数矛盾');
    const finished=expectedPages!==undefined ? page>=expectedPages : expectedTotal!==undefined ? count>=expectedTotal||rows.length===0 : rows.length<size;
    if(finished){
      if(expectedTotal!==undefined&&count!==expectedTotal)fail(`分页提前结束：${count}/${expectedTotal}`);
      output.data.page_info={...info,page:1,total_number:count,total_page:1,source_pages:page};
      output.sourcePages=sourcePages;output.requestIds=sourcePages.map(p=>p.requestId);output.complete=true;
      if(observationTimes.length<sourcePages.length)output.observationTimeUnknown=true;
      if(observationTimes.length){const invalid=observationTimes.findIndex(time=>typeof time!=='number'||!Number.isFinite(time));output.sourceObservedAt=invalid<0?Math.min(...observationTimes):observationTimes[invalid];}
      if(result.fetchedAt!==undefined)output.fetchedAt=result.fetchedAt;
      return output;
    }
  }
  fail('超过分页上限，未返回不完整汇总');
}
