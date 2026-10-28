import test from 'node:test';import assert from 'node:assert/strict';
import {scopedObservation,monitorReadRequest} from './managed-observation.mjs';
import {createManagedRunner,validateManagedPolicy} from './managed-core.mjs';
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
