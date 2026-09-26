import assert from 'node:assert/strict';
import test from 'node:test';
import { withAiDeadline, AI_REQUEST_TIMEOUT_MS, AiCancelledError, AiTimeoutError } from '../../shared/aiRequest';
import { AiRequestRegistry } from './aiRequestRegistry';
import { OperationBarrier } from '../OperationBarrier';
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }

test('AI timeout aborts the provider and settles even when it ignores cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let signal!:AbortSignal;const pending=deferred<string>();
  const request=withAiDeadline(async value=>{signal=value;return pending.promise;});
  const rejected=assert.rejects(request,AiTimeoutError);
  t.mock.timers.tick(AI_REQUEST_TIMEOUT_MS);await rejected;assert.equal(signal.aborted,true);
  pending.resolve('late');await Promise.resolve();t.mock.timers.reset();
});
test('explicit cancellation settles promptly and retains its distinct reason',async()=>{
  const controller=new AbortController();let signal!:AbortSignal;
  const request=withAiDeadline(async value=>{signal=value;return new Promise<string>(()=>{});},controller.signal);
  controller.abort(new AiCancelledError());await assert.rejects(request,AiCancelledError);assert.equal(signal.aborted,true);
});
test('provider failure remains distinct from intentional cancellation',async()=>{
  const registry=new AiRequestRegistry();
  assert.deepEqual(await registry.run(1,'a',async()=>{throw new Error('provider unavailable');}),{status:'failed',message:'provider unavailable'});
});
test('a newer owner request supersedes an older one and a late answer cannot become authoritative',async()=>{
  const registry=new AiRequestRegistry(),old=deferred<string>();
  const first=registry.run(1,'a',()=>old.promise);
  const second=registry.run(1,'b',async()=> 'new');
  assert.equal((await first).status,'cancelled');assert.deepEqual(await second,{status:'completed',value:'new'});
  old.resolve('old');await Promise.resolve();
});
test('cancellation is scoped to sender and request identity',async()=>{
  const registry=new AiRequestRegistry(),a=deferred<string>(),b=deferred<string>();
  const first=registry.run(1,'same',()=>a.promise),second=registry.run(2,'same',()=>b.promise);
  registry.cancel(1,'outdated');registry.cancel(1,'same');
  assert.equal((await first).status,'cancelled');b.resolve('other window');assert.equal((await second).status,'completed');a.resolve('late');
});
test('shutdown cancels AI before the operation barrier drains',async()=>{
  const registry=new AiRequestRegistry(),barrier=new OperationBarrier();let signal!:AbortSignal;
  const pending=barrier.acquire(()=>registry.run(1,'a',async s=>{signal=s;return new Promise<string>(()=>{});}));
  registry.cancelAll();await barrier.drain();assert.equal(barrier.activeCount,0);assert.equal(signal.aborted,true);assert.equal((await pending).status,'cancelled');
});
