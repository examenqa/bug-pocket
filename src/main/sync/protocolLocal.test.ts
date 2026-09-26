import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { BugPocketDatabase } from '../database';
import { SyncEngine } from './syncService';
import { installSyncIdentity } from './localSyncIdentity';
import type { BugUpdateInput } from '../../shared/types';

const input=(note:string, ids:number[]=[])=>({entry_type:'Bug',application_id:null,module_id:null,environment_id:null,user_role_id:null,note,attachment_ids:ids});
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'bug-pocket-protocol-'));
  let db=new BugPocketDatabase(dir);
  return {get db(){return db;}, restart(){db.close();db=new BugPocketDatabase(dir);},
    close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
const native=(db:BugPocketDatabase)=>(db as unknown as {workspaceDb:Database.Database|null;localDb:Database.Database}).workspaceDb ?? (db as unknown as {localDb:Database.Database}).localDb;
function edit(db:BugPocketDatabase,id:number,note:string) {
  const bug=db.getBug(id)!;
  return db.updateBug(id,{...bug,note} as unknown as BugUpdateInput);
}
function engine(db:BugPocketDatabase) {
  return new SyncEngine(db,()=>{}) as unknown as {drainSyncQueue(client:unknown,workspace:string):Promise<void>};
}
// SQL tests execute the real RPC. This transport double models acknowledgements/lost responses.
function server() {
  const rows=new Map<string,Record<string,any>>(), receipts=new Map<string,boolean>();
  return {rows, async rpc(_name:string,p:any) {
    const old=rows.get(p.entity_uuid);
    const applied=receipts.get(p.operation_uuid) ?? (!old?.deleted_at && ((old?.revision??0)===p.expected_revision || (p.predecessor_uuid && old?.last_operation===p.predecessor_uuid)));
    if (!receipts.has(p.operation_uuid)&&applied) rows.set(p.entity_uuid,{...old,...p.body,id:p.entity_uuid,revision:(old?.revision??0)+1,last_operation:p.operation_uuid,deleted_at:p.mutation==='DELETE'?'2026-01-01':null});
    receipts.set(p.operation_uuid,Boolean(applied));
    return {error:null,data:{applied:Boolean(applied),row:rows.get(p.entity_uuid)}};
  }};
}

test('independent first rows have different durable UUIDs for bugs, attachments and taxonomy',()=>{
  const a=fixture(),b=fixture();
  try {
    for (const f of [a,b]) f.db.connectToWorkspace('same-workspace');
    for (const kind of ['bug','attachment','application','module','environment'] as const) {
      const make=(f:ReturnType<typeof fixture>):number|string=>{
        if(kind==='bug')return f.db.createQuickBug(input('first')).id;
        if(kind==='attachment')return f.db.createAttachment('a'.repeat(64),'.png');
        if(kind==='application')return f.db.addApplication('App','Description','APP').id;
        if(kind==='module')return f.db.addModule('Module',null).id;
        return f.db.addEnvironment('Custom').id;
      };
      const ai=make(a),bi=make(b);
      if(kind==='bug'||kind==='attachment')assert.equal(ai,bi);
      const au=a.db.getSyncIdentity(kind,ai),bu=b.db.getSyncIdentity(kind,bi);
      assert.notEqual(au,bu);
      a.restart();assert.equal(a.db.getSyncIdentity(kind,ai),au);
    }
  } finally {a.close();b.close();}
});
test('migration retains established remote identities and gives never-synced rows fresh IDs',()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('migration');
    const first=f.db.createQuickBug(input('known')),second=f.db.createQuickBug(input('offline'));
    const known=randomUUID();
    native(f.db).prepare('UPDATE bugs SET remote_id=? WHERE id=?').run(known,first.id);
    native(f.db).exec('DELETE FROM sync_identity');
    installSyncIdentity(native(f.db));
    assert.equal(f.db.getSyncIdentity('bug',first.id),known);
    assert.notEqual(f.db.getSyncIdentity('bug',second.id),known);
    const stable=f.db.getSyncIdentity('bug',second.id);f.restart();
    assert.equal(f.db.getSyncIdentity('bug',second.id),stable);
  } finally {f.close();}
});
test('offline create/edit/delete intents survive restart and transmit after session restoration',async()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('offline');f.db.setCloudSyncSessionActive(false);
    const bug=f.db.createQuickBug(input('offline create'));edit(f.db,bug.id,'offline edit');
    const doomed=f.db.createQuickBug(input('offline delete'));f.db.deleteBug(doomed.id);
    const queued=f.db.getPendingSyncQueue(100);
    assert.equal(queued.filter(e=>e.entity_type==='bug').length,4);
    f.restart();assert.equal(f.db.getBug(bug.id)?.note,'offline edit');
    assert.deepEqual(f.db.getPendingSyncQueue(100),queued);
    f.db.setCloudSyncSessionActive(true);
    const cloud=server();await engine(f.db).drainSyncQueue(cloud,'offline');
    assert.equal(f.db.getPendingSyncQueue(100).length,0);
    assert.equal(cloud.rows.get(f.db.getSyncIdentity('bug',bug.id))?.note,'offline edit');
    assert.ok(cloud.rows.get(f.db.getSyncIdentity('bug',doomed.id))?.deleted_at);
    f.db.connectToWorkspace('');f.db.createQuickBug(input('local only'));
    assert.equal(f.db.getPendingSyncQueue(100).length,0);
  } finally {f.close();}
});
test('mutation and outbox are atomic when queue insertion fails',()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('atomic');
    native(f.db).exec("CREATE TRIGGER fail_queue BEFORE INSERT ON sync_queue BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    assert.throws(()=>f.db.createQuickBug(input('must roll back')),/disk full/);
    assert.equal(f.db.getTotalBugCount(),0);
    assert.throws(()=>f.db.addApplication('Atomic','desc','ATM'),/disk full/);
    assert.equal((native(f.db).prepare("SELECT count(*) n FROM applications WHERE name='Atomic'").get() as {n:number}).n,0);
  } finally {f.close();}
});
test('stale queue rejection reconciles newer cloud state, archives local intent and stops retrying',async()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('conflict');const bug=f.db.createQuickBug(input('A'));
    const cloud=server(),worker=engine(f.db);await worker.drainSyncQueue(cloud,'conflict');
    edit(f.db,bug.id,'stale A');edit(f.db,bug.id,'dependent stale A');
    const id=f.db.getSyncIdentity('bug',bug.id);
    cloud.rows.set(id,{...cloud.rows.get(id),note:'newer B',revision:2,last_operation:randomUUID()});
    await worker.drainSyncQueue(cloud,'conflict');
    assert.equal(f.db.getBug(bug.id)?.note,'newer B');
    assert.equal(f.db.getPendingSyncQueue().length,0);
    assert.equal((native(f.db).prepare('SELECT count(*) n FROM sync_conflicts').get() as {n:number}).n,2);
    await worker.drainSyncQueue(cloud,'conflict');assert.equal(cloud.rows.get(id)?.note,'newer B');
  } finally {f.close();}
});
test('lost acknowledgement retries the same operation without changing identity or revision',async()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('retry');const bug=f.db.createQuickBug(input('durable'));
    const cloud=server(),worker=engine(f.db);let fail=true;
    const transport={async rpc(name:string,p:unknown){const result=await cloud.rpc(name,p);if(fail){fail=false;throw new Error('network dropped');}return result;}};
    const op=f.db.getPendingSyncQueue()[0].op_id;
    await worker.drainSyncQueue(transport,'retry');
    f.restart();assert.equal(f.db.getPendingSyncQueue()[0].op_id,op);
    await engine(f.db).drainSyncQueue(transport,'retry');
    assert.equal(f.db.getPendingSyncQueue().length,0);
    assert.equal(cloud.rows.get(f.db.getSyncIdentity('bug',bug.id))?.revision,1);
  } finally {f.close();}
});
test('pending capture pins its origin; same numeric IDs in another workspace cannot adopt it',()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('A');const context=f.db.beginCapture();
    const aid=f.db.createAttachment('a'.repeat(64),'.png','image/png','snip',true);
    assert.throws(()=>f.db.connectToWorkspace('B'),/Save or cancel/);
    f.restart(); // Recovery can mount another workspace, but stale context cannot be interpreted there.
    f.db.connectToWorkspace('B');const bid=f.db.createAttachment('b'.repeat(64),'.png','image/png','snip',true);
    assert.equal(aid,bid);
    assert.throws(()=>f.db.createQuickBug({...input('wrong',[aid]),capture_context:context}),/another workspace/);
    assert.equal(f.db.getTotalBugCount(),0);
    assert.equal(f.db.listPendingCaptures()[0].contentHash,'b'.repeat(64));
    f.db.connectToWorkspace('A');
    assert.deepEqual(f.db.beginCapture(),context);
    const saved=f.db.createQuickBug({...input('origin',[aid]),capture_context:context});f.db.finishCapture(context);
    assert.equal(f.db.getBug(saved.id)?.attachments[0].content_hash,'a'.repeat(64));
    f.db.connectToWorkspace('B');const other=f.db.beginCapture();
    f.db.discardPendingCaptures();f.db.finishCapture(other);
    f.db.connectToWorkspace('A');assert.equal(f.db.getBug(saved.id)?.attachments.length,1);
  } finally {f.close();}
});
test('remote tombstone defeats stale offline queued update without resurrecting a report',async()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('deleted');const bug=f.db.createQuickBug(input('original'));
    const cloud=server(),worker=engine(f.db);await worker.drainSyncQueue(cloud,'deleted');
    edit(f.db,bug.id,'offline edit');
    const id=f.db.getSyncIdentity('bug',bug.id);
    cloud.rows.set(id,{...cloud.rows.get(id),revision:2,deleted_at:'2026-01-01',last_operation:randomUUID()});
    await worker.drainSyncQueue(cloud,'deleted');
    assert.equal(f.db.getBug(bug.id),null);assert.equal(f.db.getPendingSyncQueue().length,0);
    assert.ok(cloud.rows.get(id)?.deleted_at);
  } finally {f.close();}
});

test('offline taxonomy and attachment intents survive session loss and restart',async()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('offline-all');f.db.setCloudSyncSessionActive(true);
    const app=f.db.addApplication('Offline app','context','OFA');
    f.db.setCloudSyncSessionActive(false);
    const module=f.db.addModule('Offline module',app.id),env=f.db.addEnvironment('Offline env');
    const attachment=f.db.createAttachment('c'.repeat(64),'.png','image/png','snip',true);
    const bug=f.db.createQuickBug({...input('offline',[attachment]),application_id:app.id,module_id:module.id,environment_id:env.id});
    const queued=f.db.getPendingSyncQueue(100);
    for(const kind of ['application','module','environment','bug','attachment'])assert.ok(queued.some(e=>e.entity_type===kind),kind);
    f.restart();assert.deepEqual(f.db.getPendingSyncQueue(100),queued);
    const cloud={...server(),storage:{from:()=>({exists:async()=>({data:true,error:null})})}};
    await engine(f.db).drainSyncQueue(cloud,'offline-all');
    assert.equal(f.db.getPendingSyncQueue(100).length,0);
    assert.equal(cloud.rows.get(f.db.getSyncIdentity('attachment',attachment))?.bug_id,f.db.getSyncIdentity('bug',bug.id));
  } finally {f.close();}
});
test('pull maps legacy taxonomy IDs and rejects older revisions without consulting clocks',()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('legacy-tax');const db=native(f.db);
    db.prepare("INSERT INTO applications(id,name,issue_prefix,is_active,is_synced,created_at,updated_at) VALUES('7','Legacy','LEG',1,1,'2000','2000')").run();
    const uuid=f.db.getSyncIdentity('application','7');
    f.db.upsertRemoteApplication({id:uuid,name:'Cloud',issue_prefix:'LEG',revision:2,updated_at:'1900'});
    assert.equal((db.prepare("SELECT name FROM applications WHERE id='7'").get() as {name:string}).name,'Cloud');
    assert.equal(f.db.upsertRemoteApplication({id:uuid,name:'Stale',revision:1,updated_at:'2999'}),false);
    const bug=randomUUID();f.db.upsertRemoteBug({id:bug,note:'Cloud bug',application_id:uuid,revision:2});
    const local=db.prepare('SELECT id,application_id FROM bugs WHERE remote_id=?').get(bug) as {id:number;application_id:string};
    assert.equal(local.application_id,'7');
    f.db.upsertRemoteBug({id:bug,note:'stale',revision:1,updated_at:'2999'});
    assert.equal(f.db.getBug(local.id)?.note,'Cloud bug');
    f.db.upsertRemoteBug({id:bug,revision:3,deleted_at:'2026'});
    assert.equal(f.db.upsertRemoteBug({id:bug,note:'revive',revision:2}),false);
    assert.equal(f.db.getBug(local.id),null);
  } finally {f.close();}
});
test('a rejected stale local delete restores the same numeric row and durable identity',async()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('delete-conflict');const bug=f.db.createQuickBug(input('A'));
    const cloud=server();await engine(f.db).drainSyncQueue(cloud,'delete-conflict');
    const id=f.db.getSyncIdentity('bug',bug.id);
    f.db.deleteBug(bug.id);
    cloud.rows.set(id,{...cloud.rows.get(id),revision:2,note:'B newer',last_operation:randomUUID()});
    await engine(f.db).drainSyncQueue(cloud,'delete-conflict');
    assert.equal(f.db.getPendingSyncQueue().length,0);assert.equal(f.db.getBug(bug.id)?.note,'B newer');
    assert.equal(f.db.getSyncIdentity('bug',bug.id),id);
  } finally {f.close();}
});

test('capture tokens expire on completion and explicit local captures cannot cross into a cloud workspace',()=>{
  const f=fixture();
  try {
    const origin=f.db.beginCapture();assert.equal(origin.workspaceId,null);
    assert.throws(()=>f.db.connectToWorkspace('A'),/Save or cancel/);
    assert.throws(()=>f.db.disconnectWorkspace(),/Save or cancel/);
    f.db.finishCapture(origin);const next=f.db.beginCapture();
    assert.notEqual(next.draftId,origin.draftId);
    assert.throws(()=>f.db.assertCaptureContext(origin),/older draft/);
    f.db.finishCapture(next);f.db.connectToWorkspace('A');
    assert.throws(()=>f.db.assertCaptureContext(origin),/another workspace/);
  } finally {f.close();}
});
test('legacy queued retries with uncertain identity remain quarantined after restart',()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('legacy-queue');const bug=f.db.createQuickBug(input('legacy'));
    const sql=native(f.db), event=f.db.getPendingSyncQueue()[0],payload=JSON.parse(event.payload);
    delete payload._sync;
    sql.prepare('UPDATE sync_queue SET payload=?,retry_count=1 WHERE id=?').run(JSON.stringify(payload),event.id);
    sql.exec('DELETE FROM sync_identity');
    f.restart();
    assert.equal(JSON.parse(f.db.getPendingSyncQueue()[0].payload)._sync.uncertain,1);
    assert.equal(f.db.getBug(bug.id)?.note,'legacy');
  } finally {f.close();}
});

test('migration retains deleted legacy references without preventing the workspace from opening',()=>{
  const f=fixture();
  try {
    f.db.connectToWorkspace('legacy-missing-reference');const bug=f.db.createQuickBug(input('legacy'));
    const event=f.db.getPendingSyncQueue()[0],payload=JSON.parse(event.payload);delete payload._sync;
    payload.application_id='missing-old-application';
    native(f.db).prepare('UPDATE sync_queue SET payload=? WHERE id=?').run(JSON.stringify(payload),event.id);
    f.restart();
    assert.equal(f.db.getBug(bug.id)?.note,'legacy');
    assert.equal(f.db.getPendingSyncQueue().length,0);
    const retained=native(f.db).prepare('SELECT payload,last_error FROM sync_queue WHERE id=?').get(event.id) as {payload:string;last_error:string};
    assert.equal(retained.payload,JSON.stringify(payload));assert.match(retained.last_error,/references need review/);
  } finally {f.close();}
});
