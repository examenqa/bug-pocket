import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAiTriage } from './useAiTriage';
import type { BugDetails, SettingsData } from '../../../shared/types';
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
}
void run().then(()=>{window.aiLifecycleResult={passed};}).catch(error=>{window.aiLifecycleResult={passed,error:error.stack||String(error)};});
