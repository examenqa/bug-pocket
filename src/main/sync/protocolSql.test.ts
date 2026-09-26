import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const pg = new PGlite();
const user = randomUUID(), workspace = randomUUID(), foreignWorkspace = randomUUID();
const schema = readFileSync(new URL('../../../supabase/schema-install.sql', import.meta.url), 'utf8')
  .replace('create extension if not exists pgcrypto;', '-- gen_random_uuid is built into PostgreSQL');
before(async () => {
  await pg.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
  `);
  await pg.exec(schema);
  await pg.exec(schema);
  await pg.query("insert into auth.users(id,email,email_confirmed_at) values($1,'fixture@example.com',now())",[user]);
  await pg.query("insert into workspaces(id,name) values($1,'A'),($2,'B')",[workspace,foreignWorkspace]);
  await pg.query("insert into workspace_members(workspace_id,user_id,role,user_code) values($1,$2,'owner','USR')",[workspace,user]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  await pg.exec('set role authenticated');
});
after(async () => { await pg.close(); });

async function mutate(id:string, revision:number, mutation='UPDATE', body:Record<string,unknown>={}, op=randomUUID(), predecessor:string|null=null, kind='bug', ws=workspace) {
  const result=await pg.query<{result:{applied:boolean;row:Record<string,any>}}>(
    'select public.apply_sync_mutation($1,$2,$3,$4,$5,$6,$7,$8) as result',
    [ws,kind,id,op,revision,predecessor,mutation,JSON.stringify(body)]);
  return result.rows[0].result;
}

test('PostgreSQL installer repeats and assigns issue identity only to its owners',async()=>{
  const result=await pg.query<{table_name:string;column_name:string}>("select table_name,column_name from information_schema.columns where table_schema='public' and column_name in ('issue_key','issue_prefix','issue_user_code','issue_number','user_code')");
  assert.ok(result.rows.some(r=>r.table_name==='bugs'&&r.column_name==='issue_key'));
  assert.ok(result.rows.some(r=>r.table_name==='applications'&&r.column_name==='issue_prefix'));
  assert.ok(result.rows.some(r=>r.table_name==='workspace_members'&&r.column_name==='user_code'));
  assert.ok(!result.rows.some(r=>r.table_name==='modules'));
});
test('server revision rejects stale updates and stale deletes regardless of client clocks',async()=>{
  const id=randomUUID();
  assert.equal((await mutate(id,0,'INSERT',{note:'A'})).applied,true);
  const newer=await mutate(id,1,'UPDATE',{note:'B',updated_at:'1900-01-01',revision:9000});
  assert.equal(newer.row.revision,2);
  assert.equal((await mutate(id,1,'UPDATE',{note:'stale A',updated_at:'2999-01-01'})).applied,false);
  const deletion=await mutate(id,1,'DELETE');
  assert.equal(deletion.applied,false);
  assert.equal(deletion.row.note,'B');
});
test('terminal tombstone rejects resurrection and duplicate event replay is idempotent',async()=>{
  const id=randomUUID(),op=randomUUID();
  const first=await mutate(id,0,'INSERT',{note:'original'},op);
  assert.equal(first.row.issue_key,'BUG-USR-'+first.row.issue_number);
  const replay=await mutate(id,0,'INSERT',{note:'original'},op);
  assert.equal(replay.row.revision,1);
  assert.equal(replay.row.issue_key,first.row.issue_key);
  const deleted=await mutate(id,1,'DELETE');
  assert.equal(deleted.applied,true);
  assert.ok(deleted.row.deleted_at);
  assert.equal((await mutate(id,2,'UPDATE',{note:'resurrect'})).applied,false);
  const oldReplay=await mutate(id,0,'INSERT',{note:'original'},op);
  assert.ok(oldReplay.row.deleted_at);
});
test('offline predecessor chain proceeds only until interrupted by another writer',async()=>{
  const id=randomUUID(),op=randomUUID();
  await mutate(id,0,'INSERT',{note:'one'},op);
  const secondOp=randomUUID();
  assert.equal((await mutate(id,0,'UPDATE',{note:'two'},secondOp,op)).applied,true);
  await mutate(id,2,'UPDATE',{note:'other device'});
  const stale=await mutate(id,0,'UPDATE',{note:'three'},randomUUID(),secondOp);
  assert.equal(stale.applied,false);
  assert.equal(stale.row.note,'other device');
});
test('delete before first upload retains a tombstone and cannot be retried as creation',async()=>{
  const id=randomUUID();
  assert.equal((await mutate(id,0,'DELETE')).applied,true);
  assert.equal((await mutate(id,0,'INSERT',{note:'late'})).applied,false);
});
test('RPC and direct-write privileges preserve workspace and server authority',async()=>{
  await assert.rejects(mutate(randomUUID(),0,'INSERT',{note:'cross'},randomUUID(),null,'bug',foreignWorkspace),/write access/);
  await assert.rejects(pg.query("insert into bugs(id,workspace_id) values($1,$2)",[randomUUID(),workspace]),/permission denied/);
  await assert.rejects(pg.query('update bugs set revision=999'),/permission denied/);
  await assert.rejects(pg.query('select * from sync_operation_receipts'),/permission denied/);
  await pg.exec('reset role');
  await pg.query("insert into applications(id,workspace_id,name,issue_prefix) values($1,$2,'Foreign','FOR')",[foreignWorkspace,foreignWorkspace]);
  await pg.exec('set role authenticated');
  await assert.rejects(mutate(randomUUID(),0,'INSERT',{application_id:foreignWorkspace}),/cross-workspace/);
});
test('taxonomy writes use the same revisions and tombstones as reports',async()=>{
  const id=randomUUID();
  const first=await mutate(id,0,'INSERT',{name:'App',issue_prefix:'APP'},randomUUID(),null,'application');
  assert.equal(first.applied,true);
  await mutate(id,1,'UPDATE',{name:'New',issue_prefix:'APP'},randomUUID(),null,'application');
  assert.equal((await mutate(id,1,'UPDATE',{name:'Old',issue_prefix:'APP'},randomUUID(),null,'application')).applied,false);
  assert.equal((await mutate(id,2,'DELETE',{},randomUUID(),null,'application')).applied,true);
  assert.equal((await mutate(id,3,'UPDATE',{name:'Revive',issue_prefix:'APP'},randomUUID(),null,'application')).applied,false);
});

test('report tombstones cascade to attachments and reject late offline attachments',async()=>{
  const bug=randomUUID(),attachment=randomUUID(),late=randomUUID();
  await mutate(bug,0,'INSERT',{note:'parent'});
  await mutate(attachment,0,'INSERT',{bug_id:bug,content_hash:'a'.repeat(64),file_extension:'.png',mime_type:'image/png'},randomUUID(),null,'attachment');
  await mutate(bug,1,'DELETE');
  const stale=await mutate(attachment,1,'UPDATE',{bug_id:bug},randomUUID(),null,'attachment');
  assert.equal(stale.applied,false);assert.ok(stale.row.deleted_at);assert.equal(stale.row.revision,2);
  const lateResult=await mutate(late,0,'INSERT',{bug_id:bug},randomUUID(),null,'attachment');
  assert.ok(lateResult.row.deleted_at);
  assert.equal((await mutate(late,1,'UPDATE',{bug_id:bug},randomUUID(),null,'attachment')).applied,false);
});
test('RPC rejects missing revisions, malformed bodies and anonymous callers',async()=>{
  await assert.rejects(mutate(randomUUID(),null as unknown as number,'INSERT',{}),/Invalid sync mutation/);
  await assert.rejects(mutate(randomUUID(),0,'INSERT',[] as unknown as Record<string,unknown>),/Invalid sync mutation/);
  await pg.exec('set role anon');
  try {await assert.rejects(mutate(randomUUID(),0,'INSERT',{}),/permission denied/);}
  finally {await pg.exec('set role authenticated');}
});
