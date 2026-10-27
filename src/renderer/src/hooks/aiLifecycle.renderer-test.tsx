import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAiTriage } from './useAiTriage';
import { AiSettings } from '../components/settings/AiSettings';
import type { AiByokConfig, AiConfigSaveInput, BugDetails, SettingsData } from '../../../shared/types';
import type { AiRequestResult } from '../../../shared/aiRequest';
declare global { interface Window { aiLifecycleResult?: { passed:string[];error?:string }; } }
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const passed:string[]=[];
function equal(a:unknown,b:unknown,message:string){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(message+JSON.stringify({a,b}));}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
const initial={id:1,title:'original',note:'tester note',steps_to_reproduce:'old steps',expected_result:'expected',actual_result:'actual',severity:'Medium',status:'Draft',attachments:[]} as unknown as BugDetails;
const settings={applications:[],modules:[],currentWorkspaceId:'A'} as unknown as SettingsData;
let shutdown:(()=>void)|undefined;
let api!:ReturnType<typeof useAiTriage>, current:BugDetails|null=initial, setReport!:React.Dispatch<React.SetStateAction<BugDetails|null>>;
let ref!:React.MutableRefObject<BugDetails|null>,toasts:string[]=[],dirty=0,cancelled:string[]=[],pending:Array<ReturnType<typeof deferred<AiRequestResult<string>>>>=[];
window.bugPocket={onAppShutdownStarted:(callback:()=>void)=>{shutdown=callback;return ()=>{shutdown=undefined;};},onDetailsFlushRequest:()=>()=>{},getAiConfig:async()=>({hasApiKey:true}),cancelAiRequest:async(id:string)=>{cancelled.push(id);},triageBug:async()=>{const item=deferred<AiRequestResult<string>>();pending.push(item);return item.promise;}} as unknown as typeof window.bugPocket;
function Host(){const [bug,setBug]=useState<BugDetails|null>(initial);ref=useRef(bug);current=bug;setReport=setBug;api=useAiTriage({bug,bugRef:ref,settings,developerReadOnly:false,setBug,markDirty:()=>{dirty++;},showToast:message=>{toasts.push(message);}});return <span>{bug?.title}</span>;}
async function verifySelectedProviderCredentialRemoval() {
 const container = document.createElement('div'); document.body.append(container);
 const saved: AiByokConfig = { provider: 'Custom/Local', baseUrl: 'http://localhost:11434/v1', modelId: 'saved-model', customSystemPrompt: 'saved prompt', hasApiKey: true, configuredProviders: { 'Custom/Local': true, OpenAI: true, OpenRouter: false, Gemini: false, Grok: false } };
 const original = JSON.parse(JSON.stringify(saved)) as AiByokConfig;
 const calls: AiConfigSaveInput[] = []; let refreshes = 0;
 window.bugPocket = { getAiConfig: async () => ({ ...saved, configuredProviders: { ...saved.configuredProviders } }), saveAiConfig: async (input: AiConfigSaveInput) => { calls.push(input); saved.configuredProviders = { ...saved.configuredProviders, [input.provider]: false }; return { ...saved, configuredProviders: { ...saved.configuredProviders } }; } } as unknown as typeof window.bugPocket;
 const root = createRoot(container);
 try {
  await act(async () => root.render(<AiSettings mutationReady refresh={async () => { refreshes++; }} />));
  const provider = container.querySelector('select')!;
  await act(async () => { provider.value = 'OpenAI'; provider.dispatchEvent(new Event('change', { bubbles: true })); });
  const inputs = container.querySelectorAll<HTMLInputElement>('.ai-processing-grid input');
  const prompt = container.querySelector('textarea')!;
  const key = container.querySelector<HTMLInputElement>('#ai-api-key-input')!;
  const button = (text: string) => Array.from(container.querySelectorAll('button')).find(item => item.textContent === text)!;
  await act(async () => button('Edit Context').click());
  await act(async () => {
   const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
   setValue.call(inputs[0], 'https://draft.example.test/v1'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
   setValue.call(inputs[1], 'unsaved-model'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
   setValue.call(key, 'discard-this-unsaved-key'); key.dispatchEvent(new Event('input', { bubbles: true }));
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'unsaved prompt'); prompt.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Clear Key').click());
  equal(provider.value, 'OpenAI', 'clear preserves the selected provider instead of jumping to the persisted provider');
  equal(inputs[0].value, 'https://draft.example.test/v1', 'clear preserves the draft endpoint');
  equal(inputs[1].value, 'unsaved-model', 'clear preserves the draft model');
  equal(prompt.value, 'unsaved prompt', 'clear preserves the draft prompt');
  equal(prompt.readOnly, false, 'clear preserves prompt editing state');
  equal(key.value, '', 'clear discards transient replacement credentials');
  equal(button('Clear Key').disabled, true, 'cleared provider has no saved key');
  equal(container.textContent?.includes('OpenAI API key cleared.'), true, 'success identifies the selected provider');
  equal(calls, [{ provider: 'OpenAI', baseUrl: '', modelId: '', apiKeyOperation: { action: 'clear' }, customSystemPrompt: '' }], 'clear sends only the selected key operation without draft settings or credentials');
  equal(saved, { ...original, configuredProviders: { ...original.configuredProviders, OpenAI: false } }, 'clear leaves persisted active settings and other provider keys unchanged');
  equal(refreshes, 1, 'clear refreshes settings');
  await act(async () => button('Cancel').click());
  equal(prompt.value, original.customSystemPrompt, 'clear preserves the pre-edit prompt for Cancel');
  passed.push('AI settings clears a different provider key without replacing selection or unsaved nonsecret fields');
 } finally { await act(async () => root.unmount()); container.remove(); }
}
async function verifyCredentialRemoval() {
 const container = document.createElement('div'); document.body.append(container);
 for (const scenario of ['insecure legacy', 'empty', 'overlong']) {
  const saved: AiByokConfig = { provider: 'Custom/Local', baseUrl: 'http://remote.example.test/v1', modelId: 'saved-model', customSystemPrompt: 'saved prompt', hasApiKey: true, configuredProviders: { 'Custom/Local': true, OpenAI: true, OpenRouter: false, Gemini: false, Grok: false } };
  const calls: AiConfigSaveInput[] = []; let refreshes = 0;
  window.bugPocket = { getAiConfig: async () => saved, saveAiConfig: async (input: AiConfigSaveInput) => { calls.push(input); return { ...saved, hasApiKey: false, configuredProviders: { ...saved.configuredProviders, 'Custom/Local': false } }; } } as unknown as typeof window.bugPocket;
  const root = createRoot(container);
  try {
   await act(async () => root.render(<AiSettings mutationReady refresh={async () => { refreshes++; }} />));
   const inputs = container.querySelectorAll<HTMLInputElement>('.ai-processing-grid input');
   await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(inputs[0], scenario === 'empty' ? '' : scenario === 'overlong' ? 'x'.repeat(2049) : 'http://remote.example.test/v1'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(inputs[1], scenario === 'overlong' ? 'x'.repeat(501) : ''); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
   });
   const clear = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Clear'));
   if (!clear || clear.disabled) throw new Error('Credential removal must remain available');
   await act(async () => clear.click());
   equal(calls.length, 1, 'clear reaches main process despite invalid fields');
   equal(calls[0].apiKeyOperation, { action: 'clear' }, 'explicit clear operation');
   equal(calls[0].baseUrl, '', 'clear omits irrelevant endpoint edits');
   equal(calls[0].modelId, '', 'clear omits irrelevant model edits');
   equal(calls[0].customSystemPrompt, '', 'clear omits irrelevant prompt edits');
   equal(refreshes, 1, 'successful clear refreshes settings');
   equal(inputs[0].value, scenario === 'empty' ? '' : scenario === 'overlong' ? 'x'.repeat(2049) : 'http://remote.example.test/v1', 'draft endpoint remains after clear');
   equal(inputs[1].value, scenario === 'overlong' ? 'x'.repeat(501) : '', 'draft model remains after clear');
   equal(container.textContent?.includes('API key cleared.'), true, 'clear success is visible');
   passed.push(`AI settings clears credentials with ${scenario} endpoint/model fields`);
  } finally { await act(async () => root.unmount()); }
 }
 container.remove();
}
async function run(){
 const container=document.createElement('div');document.body.append(container);let root=createRoot(container);
 async function reset(){await act(async()=>root.unmount());root=createRoot(container);pending=[];toasts=[];dirty=0;cancelled=[];await act(async()=>root.render(<Host/>));}
 async function start(){let done!:Promise<void>;await act(async()=>{done=api.triageWithLocalAi();await Promise.resolve();});return {done};}
 async function edit(field:keyof BugDetails,value:string){await act(async()=>{api.noteUserEdit(field);const next={...ref.current!,[field]:value};ref.current=next;setReport(next);});}
 async function complete(index:number,value:unknown){await act(async()=>pending[index].resolve({status:'completed',value:JSON.stringify(value)}));}
 await act(async()=>root.render(<Host/>));
 await start();await edit('severity','High');await complete(0,{title:'generated'});equal(current?.severity,'High','unrelated edit');equal(current?.title,'generated','explicit AI works');passed.push('AI preserves unrelated edits and applies only generated fields');
 await reset();await start();await edit('title','human');await complete(0,{title:'AI',expectedResult:'new expected'});equal(current?.title,'human','same-field conflict');equal(current?.expected_result,'new expected','unmodified target merges');passed.push('AI preserves newer target-field edits');
 await reset();await start();await edit('title','temporary');await edit('title','original');await complete(0,{title:'AI'});equal(current?.title,'original','edit then revert version');passed.push('AI respects edit versions even after reverting a value');
 await reset();const a=await start(),b=await start();await complete(1,{title:'B'});await complete(0,{title:'A'});await a.done;await b.done;equal(current?.title,'B','newer request wins');equal(cancelled.length,1,'older transport cancelled');passed.push('superseded late AI response cannot replace newer result');
 await reset();const c=await start();await act(async()=>api.cancelAi());await c.done;equal(api.triaging,false,'cancel loading');await complete(0,{title:'late'});equal(current?.title,'original','late cancellation');equal(toasts.length,0,'silent cancellation');passed.push('explicit cancellation clears busy state and ignores late success');
 await reset();await start();await act(async()=>pending[0].resolve({status:'timed_out',message:'AI timed out'}));equal(api.triaging,false,'timeout loading');equal(toasts,['AI timed out'],'timeout distinct');passed.push('timeout clears busy state and reports timeout');
 await reset();await start();await act(async()=>pending[0].resolve({status:'failed',message:'provider unavailable'}));equal(api.triaging,false,'failure loading');equal(toasts.length,1,'provider failure visible');equal(toasts[0].includes('provider unavailable'),true,'provider failure distinct');passed.push('provider failure is distinct from cancellation');
 await reset();await start();await act(async()=>setReport({...initial,id:2}));await complete(0,{title:'old report'});equal(current?.id,2,'navigation id');equal(current?.title,'original','navigation ignores result');passed.push('report navigation invalidates pending AI');
 await reset();await start();await act(async()=>shutdown?.());await complete(0,{title:'after shutdown'});equal(current?.title,'original','shutdown ignores late result');equal(api.triaging,false,'shutdown clears busy state');passed.push('shutdown invalidates renderer result before draft flush');
 await reset();await start();const before=dirty;await act(async()=>root.unmount());await complete(0,{title:'unmounted'});equal(dirty,before,'unmount no mutation');equal(cancelled.length,1,'unmount cancels transport');passed.push('unmount cancels AI and blocks late mutation');
 await verifySelectedProviderCredentialRemoval();
 await verifyCredentialRemoval();
}
void run().then(()=>{window.aiLifecycleResult={passed};}).catch(error=>{window.aiLifecycleResult={passed,error:error.stack||String(error)};});
