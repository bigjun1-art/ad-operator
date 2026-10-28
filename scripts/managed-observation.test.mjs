import test from 'node:test';import assert from 'node:assert/strict';
import {scopedObservation,monitorReadRequest} from './managed-observation.mjs';
import {createManagedRunner,validateManagedPolicy,refreshProposalStatuses,assertProposalExecutable} from './managed-core.mjs';
const account='7777000000000001',plan='7777000000000002',material='7777000000000003',task='7777000000000004';
const monitor={level:'material',scene:'video',period:'chengfang',ad_id:plan,material_id:material};
const policy=()=>({platform:'qianchuan',accountId:account,mode:'managed',explicitManagedAuthorization:true,userInstruction:'隔离测试：按单素材表现执行已授权任务动作',expiresAt:'2030-01-02T00:00:00Z',intervalSeconds:60,maxObservedCost:1000,maxActionsPerDay:3,entityIds:[plan],taskIds:[task],materialIds:[material],allowedActions:['boost.status.set'],monitor,rules:[{id:'pause-task',metric:'marketing_roi',operator:'lte',threshold:2,consecutiveObservations:2,action:{name:'boost.status.set',params:{ad_id:plan,task_id:task,opt_type:'PAUSE',requestKey:'fixture-pause'}}}]});
const snapshot=(cost,roi,at,extra={})=>({ok:true,data:{scope:{...monitor,accountId:account},summary:{cost,orders:1,marketing_roi:roi},complete:true,epoch:'first',observedAt:at,...extra}});
test('minute deltas bind exact scope and reset when counters, date or product epoch change',()=>{
 let time=Date.parse('2030-01-01T00:00:00Z');const p=policy(),a=scopedObservation(snapshot(100,2,time),p,null,time);
 const b=scopedObservation(snapshot(130,2,time+60000),p,a,time+60000);assert.equal(b.summary.cost_per_minute,30);
 const c=scopedObservation(snapshot(5,2,time+120000),p,b,time+120000);assert.equal(c.reset,true);assert.equal(c.baselineAt,time+120000);assert.equal(c.summary.cost_delta,null);
 const d=scopedObservation(snapshot(10,2,time+180000,{epoch:'changed'}),p,c,time+180000);assert.equal(d.baselineAt,time+180000);assert.equal(d.summary.cost_delta,null);
 assert.throws(()=>scopedObservation(snapshot(15,2,time+240000,{scope:{...monitor,accountId:'7777000000000099'}}),p,d,time+240000),/账户/);
});
test('missing ROI breaks consecutive observations and cannot trigger single-material action',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z'),step=0,writes=0;const seq=[1,null,1,1],p=policy();
 const runner=createManagedRunner(p,{now:()=>time,read:async()=>snapshot(10+step,seq[step++],time),prepare:async()=>({prepared:{before:{task:{budget:100}}}}),execute:async()=>{writes++;return {ok:true,data:{verified:true}};}});
 for(let i=0;i<3;i++){await runner.tick();time+=60000;}assert.equal(writes,0);await runner.tick();assert.equal(writes,1);
});
test('task changes require bound material, task and plan IDs',()=>{
 const p=policy();p.allowedActions=['boost.update'];p.maxSingleBudget=100;p.maxAdditionalBudget=200;p.rules[0].action={name:'boost.update',params:{ad_id:plan,task_id:task,material_ids:['7777000000000099'],requestKey:'fixture-update'}};
 assert.throws(()=>validateManagedPolicy(p),/素材/);
 p.rules[0].action.params.material_ids=[material];assert.equal(validateManagedPolicy(p).monitor.material_id,material);
});
test('scoped read uses marketing report and never substitutes account overview',()=>{
 assert.equal(monitorReadRequest(policy()).action,'marketing.report.get');const p=policy();p.monitor={level:'task',scene:'live',period:'uni',ad_id:plan,task_id:task};const r=monitorReadRequest(p);assert.equal(r.action,'boost.task.get');assert.equal(r.params.task_id,task);assert.equal(r.params.level,undefined);
});
test('configured observation window and action cooldown apply before another rule can execute',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z'),cost=1,writes=0;const p=policy();p.minActionIntervalSeconds=120;p.rules[0].consecutiveObservations=1;p.rules[0].minObservationSeconds=120;p.rules.push({...structuredClone(p.rules[0]),id:'second',action:{...structuredClone(p.rules[0].action),params:{...p.rules[0].action.params,requestKey:'fixture-second'}}});
 const runner=createManagedRunner(p,{now:()=>time,read:async()=>snapshot(cost++,1,time),prepare:async()=>({}),execute:async()=>{writes++;return {ok:true,data:{verified:true}};}});
 await runner.tick();time+=60000;await runner.tick();assert.equal(writes,0);time+=60000;await runner.tick();assert.equal(writes,1);time+=60000;assert.equal((await runner.tick()).status,'cooldown');time+=60000;await runner.tick();assert.equal(writes,2);
});


test('task stop-only rules can use exact task counts without a missing money boundary',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z'),n=0;const p=policy();p.monitor={level:'task',scene:'live',period:'chengfang',ad_id:plan,task_id:task};p.rules[0].metric='orders';p.rules[0].operator='gte';p.rules[0].threshold=1;delete p.maxObservedCost;
 assert.equal(validateManagedPolicy(p).maxObservedCost,undefined);
 const runner=createManagedRunner(p,{now:()=>time,read:async()=>({ok:true,data:{scope:{...p.monitor,accountId:account},summary:{cost:null,orders:++n},complete:true,observedAt:time,epoch:'task'}}),prepare:async()=>({}),execute:async()=>({ok:true,data:{status:'receipt_only'}})});
 await runner.tick();time+=60000;const r=await runner.tick();assert.equal(r.actions.length,1);assert.equal(r.status,'needs_reconciliation');
 const withMoney={...p,maxObservedCost:100};const guarded=createManagedRunner(withMoney,{now:()=>time,read:async()=>({ok:true,data:{scope:{...p.monitor,accountId:account},summary:{cost:null,orders:1},complete:true,observedAt:time,epoch:'task'}})});assert.equal((await guarded.tick()).status,'read_error');
});


test('strict less-than preserves the threshold boundary',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z'),v=2,writes=0;const p=policy();p.rules[0].operator='lt';p.rules[0].consecutiveObservations=1;
 const runner=createManagedRunner(p,{now:()=>time,read:async()=>snapshot(10,v,time),prepare:async()=>({}),execute:async()=>{writes++;return {ok:true,data:{verified:true}};}});
 await runner.tick();assert.equal(writes,0);time+=60000;v=1.99;await runner.tick();assert.equal(writes,1);
});

test('missing, stale and future observations block actions while retaining collection health',async()=>{
 const time=Date.parse('2030-01-01T00:00:00Z');
 for(const [observedAt,code] of [[undefined,'OBSERVATION_TIME_MISSING'],[time-180000,'OBSERVATION_STALE'],[time+1,'OBSERVATION_TIME_FUTURE']]){
  let prepared=0,writes=0;const p=policy();p.rules[0].consecutiveObservations=1;
  const runner=createManagedRunner(p,{now:()=>time,read:async()=>snapshot(10,1,observedAt),prepare:async()=>{prepared++;return {};},execute:async()=>writes++});
  const state=await runner.tick();assert.equal(state.status,'read_error');assert.equal(prepared,0);assert.equal(writes,0);assert.equal(state.health.collection.errorCode,code);assert.equal(state.lastSnapshot,null);
 }
});

test('failed freshness never replaces the last good snapshot or advances consecutive hits',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z'),oldAt=time,writes=0,step=0;
 const runner=createManagedRunner(policy(),{now:()=>time,read:async()=>snapshot(10,1,step++===0?time:oldAt),prepare:async()=>({}),execute:async()=>writes++});
 const first=await runner.tick();time+=181000;const second=await runner.tick();
 assert.equal(second.status,'read_error');assert.equal(second.health.collection.status,'stale');assert.equal(second.health.collection.lastCompleteAt,first.health.collection.lastCompleteAt);assert.equal(second.health.collection.lastAttemptAt,time);assert.deepEqual(second.lastSnapshot,first.lastSnapshot);assert.deepEqual(second.ruleObservations,{});assert.equal(writes,0);
});

test('configured data age and the write boundary prevent preparing with expired evidence',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z'),writes=0;const p=policy();p.maxDataAgeSeconds=10;p.rules[0].consecutiveObservations=1;
 const runner=createManagedRunner(p,{now:()=>time,read:async()=>snapshot(10,1,time),prepare:async()=>{time+=10000;return {};},execute:async()=>writes++});
 const state=await runner.tick();assert.equal(state.health.collection.errorCode,'OBSERVATION_STALE');assert.equal(state.status,'read_error');assert.equal(writes,0);
 for(const invalid of [0,1.5,86401])assert.throws(()=>validateManagedPolicy({...p,maxDataAgeSeconds:invalid}),/数据有效/);
});

test('freshness is checked again after persisting a pending write',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z'),writes=0;const p=policy();p.maxDataAgeSeconds=1;p.rules[0].consecutiveObservations=1;
 const runner=createManagedRunner(p,{now:()=>time,read:async()=>snapshot(10,1,time),prepare:async()=>({}),persist:async state=>{if(state.actions.at(-1)?.status==='submitting')time+=1000;},execute:async()=>writes++});
 const state=await runner.tick();assert.equal(writes,0);assert.equal(state.status,'not_submitted');assert.equal(state.actions[0].attempted,false);assert.equal(state.health.collection.errorCode,'OBSERVATION_STALE');
});

test('recommendations bind evidence and policy with stable IDs, and expire at the earlier deadline',async()=>{
 let time=Date.parse('2030-01-01T00:00:00Z');const p=policy();p.mode='recommend';p.maxDataAgeSeconds=30;p.rules[0].consecutiveObservations=1;p.expiresAt=new Date(time+20000).toISOString();
 const deps={now:()=>time,read:async()=>snapshot(10,1,time),prepare:async()=>({prepared:{intentHash:'fixture-intent',preconditionHash:'fixture-configuration'}}),execute:async()=>{throw Error('recommend must not execute');}};
 const first=createManagedRunner(p,deps),second=createManagedRunner(p,deps);await first.tick();await second.tick();
 const proposal=first.state.proposals[0];assert.equal(proposal.id,second.state.proposals[0].id);assert.equal(proposal.status,'proposed');assert.equal(proposal.expiresAt,p.expiresAt);assert.equal(proposal.intentHash,'fixture-intent');assert.equal(proposal.preconditionHash,'fixture-configuration');for(const key of ['scopeKey','evidenceDigest','policyDigest','createdAt'])assert.ok(proposal[key]);
 assertProposalExecutable(proposal,{now:time,intentHash:'fixture-intent',preconditionHash:'fixture-configuration'});
 assert.throws(()=>assertProposalExecutable(structuredClone(proposal),{now:time,intentHash:'changed'}),/意图/);
 const changed=structuredClone(proposal);refreshProposalStatuses([changed],{now:time,policyDigest:'changed'});assert.equal(changed.status,'superseded');
 time+=20000;assert.equal((await first.tick()).proposals[0].status,'expired');assert.throws(()=>assertProposalExecutable(proposal,{now:time}),/过期/);
});

test('recommendation validity is capped by evidence age even when policy remains active',async()=>{
 const time=Date.parse('2030-01-01T00:00:00Z'),p=policy();p.mode='recommend';p.maxDataAgeSeconds=20;p.rules[0].consecutiveObservations=1;
 const runner=createManagedRunner(p,{now:()=>time,read:async()=>snapshot(10,1,time-5000),prepare:async()=>({})});await runner.tick();
 const proposal=runner.state.proposals[0];assert.equal(Date.parse(proposal.expiresAt),time+15000);refreshProposalStatuses([proposal],{now:time+15000});assert.equal(proposal.status,'expired');
 const legacy={ruleId:'old',at:time,prepared:{}};refreshProposalStatuses([legacy],{now:time});assert.equal(legacy.status,'expired');
});

test('unknown dependency time blocks a fresh-looking observation',async()=>{
 const {assertObservationFresh}=await import('./observation-integrity.mjs');const now=Date.now();assert.throws(()=>assertObservationFresh({observedAt:now,observationTimeUnknown:true},{intervalSeconds:60},now),{code:'OBSERVATION_TIME_UNKNOWN'});
});
