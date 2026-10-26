import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateManagedPolicy,createManagedRunner,monitoringSummary} from './managed-core.mjs';
import {startManaged,managedStatus,stopManaged,reconcileManaged} from './managed.mjs';
import {invokeBackend} from './config.mjs';
const fixtureAccount='7777000000000001',fixturePlan='7777000000000002';
const policy=(extra={})=>({platform:'qianchuan',accountId:fixtureAccount,mode:'managed',explicitManagedAuthorization:true,userInstruction:'测试隔离驱动：明确开启托管',expiresAt:new Date(Date.now()+60000).toISOString(),intervalSeconds:15,maxObservedCost:500,maxSingleBudget:300,maxActionsPerDay:3,scope:{dim:'all',scene:'video'},entityIds:[fixturePlan],allowedActions:['plan.status.set'],rules:[{id:'pause-on-cost',metric:'cost',operator:'gte',threshold:100,action:{name:'plan.status.set',params:{ad_id:fixturePlan,opt_status:'DISABLE'}}}],...extra});
const result=(extra={})=>({ok:true,data:{summary:{cost:120,orders:2,payment_roi:2.25,cash_return_ratio:1.48,...extra}}});
test('explicit continuous authorization, deadline, bounded objects and platform scope are required',()=>{
 for(const patch of [{explicitManagedAuthorization:false},{expiresAt:'2000-01-01'},{entityIds:['7777000000000003']},{platform:'local',scope:{dim:'all'}}])assert.throws(()=>validateManagedPolicy(policy(patch)));
 assert.equal(validateManagedPolicy(policy()).accountId,fixtureAccount);
});
test('recommend mode never executes, managed fixed rule executes only once',async()=>{
 for(const mode of ['recommend','managed']){let writes=0;const r=createManagedRunner(policy({mode}),{read:async()=>result(),prepare:async()=>({prepared:{}}),execute:async()=>{writes++;return {ok:true,data:{verified:true}};}});await r.tick();await r.tick();assert.equal(writes,mode==='managed'?1:0);assert.equal(r.state.completedRuleIds.length,1);}
});
test('official ROI absence does not substitute a cash return value',async()=>{
 let writes=0;const p=policy();p.rules[0].metric='payment_roi';p.rules[0].operator='lte';p.rules[0].threshold=2;
 const r=createManagedRunner(p,{read:async()=>result({payment_roi:null}),prepare:async()=>({}),execute:async()=>{writes++;}});await r.tick();assert.equal(writes,0);
});
test('expiration while preparing cancels mutation, without touching ads',async()=>{
 let clock=Date.now(),writes=0;const p=policy({expiresAt:new Date(clock+1000).toISOString()});const r=createManagedRunner(p,{now:()=>clock,read:async()=>result(),prepare:async()=>{clock+=2000;return {};},execute:async()=>writes++});await r.tick();assert.equal(writes,0);assert.equal(r.state.status,'expired');
});
test('uncertain and rejected results stop further rules and preserve recovery state',async()=>{
 for(const response of [{ok:true,data:{status:'unknown'}},{ok:true,data:{status:'rejected'}}]){let writes=0;const r=createManagedRunner(policy(),{read:async()=>result(),prepare:async()=>({}),execute:async()=>{writes++;return response;}});await r.tick();await r.tick();assert.equal(writes,1);assert.equal(r.state.status,'needs_reconciliation');assert.equal(r.state.completedRuleIds.length,0);}
});
test('cost boundary permits only explicitly authorized pause, not budget increases',async()=>{
 let writes=0;const r=createManagedRunner(policy({maxObservedCost:100}),{read:async()=>result(),prepare:async()=>({}),execute:async()=>{writes++;return {ok:true,data:{verified:true}};}});await r.tick();assert.equal(writes,1);assert.equal(r.state.status,'cost_limit_reached');
});
test('local standard summary accepts its actual shape but does not invent official ROI',()=>{const s=monitoringSummary({ok:true,data:{cost:20,order:2,roi:1.5,complete:true}},'local');assert.equal(s.orders,2);assert.equal(s.payment_roi,null);});
test('persisted submitting state never resumes writes automatically',async()=>{const r=createManagedRunner(policy(),{state:{version:1,actions:[{status:'submitting'}],completedRuleIds:[],proposals:[]},read:async()=>{throw Error('must not read');}});assert.equal((await r.tick()).status,'needs_reconciliation');});
test('a backend-proven unsent failure is preserved through the wrapper and does not become unknown',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ad-operator-unsent-'));await writeFile(path.join(directory,'headless-runtime.mjs'),"export async function runHeadless(){throw Object.assign(Error('expired'),{code:'HEADLESS_AUTHORIZATION_EXPIRED',requestDispatched:false});}");
 let observed;try{await invokeBackend({backendRoot:directory},{mode:'execute',platform:'qianchuan',accountId:fixtureAccount,action:'plan.status.set',params:{}});}catch(e){observed=e;}
 assert.equal(observed.requestDispatched,false);const r=createManagedRunner(policy(),{read:async()=>result(),prepare:async()=>({}),execute:async()=>{throw observed;}});await r.tick();assert.equal(r.state.status,'not_submitted');assert.equal(r.state.actions[0].attempted,false);
});
test('preparation crossing the business midnight re-reads before it can submit',async()=>{
 let now=Date.parse('2030-01-01T15:59:59Z'),writes=0;
 const p=policy({expiresAt:'2030-01-02T16:00:00Z'}),r=createManagedRunner(p,{now:()=>now,read:async()=>result(),prepare:async()=>{now+=2000;return {};},execute:async()=>writes++});
 await r.tick();assert.equal(r.state.status,'day_boundary_recheck');assert.equal(writes,0);
});
test('a read crossing the business midnight cannot use yesterday totals to write today',async()=>{
 let now=Date.parse('2030-01-01T15:59:59Z'),writes=0;
 const r=createManagedRunner(policy({expiresAt:'2030-01-02T16:00:00Z'}),{now:()=>now,read:async()=>{now+=2000;return result();},prepare:async()=>({}),execute:async()=>writes++});
 await r.tick();assert.equal(writes,0);assert.equal(r.state.status,'day_boundary_recheck');
});
test('owned process lifecycle starts, reports and stops with an isolated backend; no real account calls',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ad-operator-lifecycle-'));
 await writeFile(path.join(directory,'headless-actions.mjs'),'export function normalizeHeadlessRequest(v){return v;}');
 await writeFile(path.join(directory,'headless-runtime.mjs'),'export async function runHeadless(){return {ok:true,data:{summary:{cost:0,orders:0}}};}');
 const config={backendRoot:directory,stateRoot:path.join(directory,'state')},p=policy();let session;
 await assert.rejects(()=>startManaged(config,p),/confirm-managed/);
 try{session=await startManaged(config,p,{confirmed:true});let s;for(let n=0;n<40;n++){s=await managedStatus(config,session.sessionId);if(s.status==='running')break;await new Promise(r=>setTimeout(r,50));}assert.equal(s.processRunning,true);assert.equal(s.status,'running');assert.equal(s.actions.length,0);const stopped=await stopManaged(config,session.sessionId);assert.equal(stopped.stopped,true);assert.equal((await managedStatus(config,session.sessionId)).processRunning,false);}
 finally{if(session)await stopManaged(config,session.sessionId);}
});
test('unknown write remains blocked across a new session, and read-only reconciliation can release it',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ad-operator-unknown-')),count=path.join(directory,'writes.txt');
 await writeFile(path.join(directory,'headless-actions.mjs'),'export function normalizeHeadlessRequest(v){return v;}');
 await writeFile(path.join(directory,'headless-runtime.mjs'),`import {appendFileSync} from 'node:fs';export async function runHeadless(i){if(i.mode==='read')return {ok:true,data:i.action==='plan.detail'?{opt_status:'DISABLE'}:{summary:{cost:200,orders:1}}};if(i.mode==='prepare')return {ok:true,prepared:{platform:i.platform,accountId:i.accountId,action:i.action,intentHash:'fixture'}};appendFileSync(${JSON.stringify(count)},'write\\n');return {ok:true,data:{status:'unknown'}};}`);
 const config={backendRoot:directory,stateRoot:path.join(directory,'state')},p=policy();const first=await startManaged(config,p,{confirmed:true});
 try{
  let s;for(let n=0;n<80;n++){s=await managedStatus(config,first.sessionId);if(s.status==='needs_reconciliation'&&!s.processRunning)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(s.status,'needs_reconciliation');assert.equal(s.processRunning,false);
  const second=await startManaged(config,p,{confirmed:true});try{for(let n=0;n<60;n++){s=await managedStatus(config,second.sessionId);if(s.status==='blocked')break;await new Promise(r=>setTimeout(r,50));}assert.equal(s.status,'blocked');assert.equal((await readFile(count,'utf8')).match(/write/g).length,1);}finally{await stopManaged(config,second.sessionId);}
  assert.equal((await reconcileManaged(config,first.sessionId)).status,'reconciled');assert.equal((await readFile(count,'utf8')).match(/write/g).length,1);
 }finally{await stopManaged(config,first.sessionId);}
});
test('expiry aborts an in-flight slow read and exits instead of waiting for backend timeout',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ad-operator-expiry-'));
 await writeFile(path.join(directory,'headless-actions.mjs'),'export function normalizeHeadlessRequest(v){return v;}');
 await writeFile(path.join(directory,'headless-runtime.mjs'),'export async function runHeadless(){await new Promise(r=>setTimeout(r,4000));return {ok:true,data:{summary:{cost:0,orders:0}}};}');
 const config={backendRoot:directory,stateRoot:path.join(directory,'state')},deadline=Date.now()+1500,session=await startManaged(config,policy({expiresAt:new Date(deadline).toISOString()}),{confirmed:true});
 try{let s;for(let n=0;n<65;n++){s=await managedStatus(config,session.sessionId);if(!s.processRunning)break;await new Promise(r=>setTimeout(r,50));}assert.equal(s.processRunning,false);assert.equal(s.status,'expired');assert.ok(Date.now()<deadline+1500);assert.equal(s.actions.length,0);}finally{await stopManaged(config,session.sessionId);}
});
