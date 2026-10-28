import {createHash} from 'node:crypto';

export const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const evidenceHash=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function observationMaxAgeMs(policy){
 const seconds=policy.maxDataAgeSeconds??Math.max(60,policy.intervalSeconds*3);
 if(!Number.isInteger(seconds)||seconds<1||seconds>86400)throw Error('数据有效时长需要1至86400秒的整数');
 return seconds*1000;
}
export function assertObservationFresh(data,policy,now=Date.now()){
 const observedAt=data?.observedAt,maxAgeMs=observationMaxAgeMs(policy);
 const valid=typeof observedAt==='number'&&Number.isFinite(observedAt)&&observedAt>0;
 const ageMs=valid?now-observedAt:null;
 const code=data?.observationTimeUnknown===true?'OBSERVATION_TIME_UNKNOWN':!valid?'OBSERVATION_TIME_MISSING':ageMs<0?'OBSERVATION_TIME_FUTURE':ageMs>=maxAgeMs?'OBSERVATION_STALE':null;
 const integrity={status:code===null?'ok':code==='OBSERVATION_STALE'?'stale':'unknown',observedAt:valid?observedAt:null,checkedAt:now,ageMs,maxAgeMs,expiresAt:valid?observedAt+maxAgeMs:null,errorCode:code};
 if(code){
  const message={OBSERVATION_TIME_UNKNOWN:'监控数据的来源时间未确认',OBSERVATION_TIME_MISSING:'监控数据缺少有效观察时间',OBSERVATION_TIME_FUTURE:'监控数据观察时间晚于当前时间',OBSERVATION_STALE:'监控数据已超过允许有效时长'}[code];
  throw Object.assign(Error(message),{code,integrity});
 }
 return integrity;
}

const active=proposal=>['proposed','authorized'].includes(proposal.status);
export function refreshProposalStatuses(proposals,{now=Date.now(),policyDigest,scopeKey,evidenceDigest}={}){
 for(const proposal of proposals){
  if(!proposal.status)proposal.status='proposed';
  if(!active(proposal))continue;
  const expiresAt=Date.parse(proposal.expiresAt);
  if(!Number.isFinite(expiresAt)||now>=expiresAt){proposal.status='expired';proposal.expiredAt=new Date(now).toISOString();proposal.reason='建议或其证据有效期已结束';continue;}
  if(policyDigest!==undefined&&proposal.policyDigest!==policyDigest||scopeKey!==undefined&&proposal.scopeKey!==scopeKey||evidenceDigest!==undefined&&proposal.evidenceDigest!==evidenceDigest){proposal.status='superseded';proposal.supersededAt=new Date(now).toISOString();proposal.reason='建议绑定的策略、范围或证据已变化';}
 }
 return proposals;
}
export function assertProposalExecutable(proposal,expected={}){
 if(!proposal||typeof proposal!=='object')throw Error('缺少待执行建议');
 refreshProposalStatuses([proposal],expected);
 if(!active(proposal))throw Object.assign(Error('建议已过期或失效，不能执行'),{code:'PROPOSAL_NOT_EXECUTABLE'});
 for(const field of ['intentHash','preconditionHash'])if(expected[field]!==undefined&&proposal[field]!==expected[field])throw Object.assign(Error('建议与本次操作意图或配置不一致'),{code:'PROPOSAL_BINDING_MISMATCH'});
 if(!proposal.id||!proposal.scopeKey||!proposal.evidenceDigest||!proposal.policyDigest||!proposal.intentHash)throw Object.assign(Error('建议缺少绑定证据'),{code:'PROPOSAL_BINDING_MISSING'});
 return proposal;
}
