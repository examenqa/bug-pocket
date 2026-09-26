import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { BugPocketDatabase } from '../database';
import { createBackupArchive, restoreBackupArchive } from './backupService';

const input = (note:string, attachment_ids:number[] = []) => ({entry_type:'Bug',application_id:null,module_id:null,environment_id:null,user_role_id:null,note,attachment_ids});
interface Manifest { archived_attachments:Array<{file_name:string;content_hash:string;file_size:number}> }
function files(directory:string, prefix=''):Array<{name:string;bytes:Buffer}> {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const name=prefix+entry.name, path=join(directory,entry.name);
    return entry.isDirectory() ? files(path,name+'/') : [{name,bytes:readFileSync(path)}];
  });
}
async function repack(directory:string, path:string):Promise<void> {
  const { ZipArchive } = await import('archiver') as unknown as {ZipArchive:new(options:unknown)=>{
    append(bytes:Buffer,options:{name:string}):void; pipe(output:NodeJS.WritableStream):void;
    on(event:string,callback:(error:Error)=>void):void;finalize():Promise<void>;
  }};
  await new Promise<void>((resolve,reject)=>{
    const output=createWriteStream(path), archive=new ZipArchive({zlib:{level:9}});
    output.on('close',resolve); output.on('error',reject); archive.on('error',reject); archive.pipe(output);
    for(const entry of files(directory)) archive.append(entry.bytes,{name:entry.name});
    void archive.finalize().catch(reject);
  });
}

for (const scenario of ['valid lowercase','valid uppercase','tampered byte','wrong hash','missing attachment','malformed hash','second attachment corrupt'] as const) {
  test('real exported archive: '+scenario, async()=>{
    const root=mkdtempSync(join(tmpdir(),'bug-pocket-restore-integrity-'));
    const sourceDir=join(root,'source'),liveDir=join(root,'live'),extracted=join(root,'extracted');
    mkdirSync(extracted);
    const source=new BugPocketDatabase(sourceDir);
    let live=new BugPocketDatabase(liveDir);
    try {
      const payloads=[Buffer.from('local screenshot bytes'),Buffer.from('workspace screenshot bytes')];
      for(let i=0;i<payloads.length;i++) {
        if(i===1)source.connectToWorkspace('integrity');
        let hash=createHash('sha256').update(payloads[i]).digest('hex');
        if(scenario==='valid uppercase')hash=hash.toUpperCase();
        const attachment=source.createAttachment(hash,'.png');
        writeFileSync(source.resolveAttachmentPath(hash,'.png'),payloads[i]);
        source.createQuickBug(input('archived '+i,[attachment]));
      }
      const liveHash=createHash('sha256').update('live blob').digest('hex');
      const liveAttachment=live.createAttachment(liveHash,'.png');
      writeFileSync(live.resolveAttachmentPath(liveHash,'.png'),'live blob');
      live.createQuickBug(input('live local',[liveAttachment]));
      live.connectToWorkspace('live');
      const liveBug=live.createQuickBug(input('live workspace'));
      live.checkpoint();
      const before=files(liveDir);
      const original=join(root,'original.bugpocket'),candidate=join(root,'candidate.bugpocket');
      const exported=await createBackupArchive(original,source,root);
      assert.equal(exported.success,true,exported.error);
      const extraction=await import('extract-zip');
      await extraction.default(original,{dir:extracted});
      const manifestPath=join(extracted,'manifest.json');
      const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as Manifest;
      assert.equal(manifest.archived_attachments.length,2);
      const entry=manifest.archived_attachments[scenario==='second attachment corrupt'?1:0];
      const attachmentPath=join(extracted,'attachments',entry.file_name);
      if(scenario==='tampered byte'||scenario==='second attachment corrupt') {
        const bytes=readFileSync(attachmentPath); bytes[0]^=1; writeFileSync(attachmentPath,bytes);
      } else if(scenario==='wrong hash') {
        entry.content_hash='f'.repeat(64); entry.file_name=entry.content_hash+'.png';
        renameSync(attachmentPath,join(extracted,'attachments',entry.file_name));
      } else if(scenario==='missing attachment') rmSync(attachmentPath);
      else if(scenario==='malformed hash') entry.content_hash='not-a-sha256';
      writeFileSync(manifestPath,JSON.stringify(manifest));
      await repack(extracted,candidate);
      let beforeCommit=false;
      const restore=()=>restoreBackupArchive(candidate,liveDir,{
        beforeCommit:()=>{beforeCommit=true;live.close();},
        afterCommit:()=>{live=new BugPocketDatabase(liveDir,{restoring:true});live.applyAfterRestorePatch();},
        beforeRollback:()=>live.close()
      });
      if(scenario.startsWith('valid')) {
        await restore(); assert.equal(beforeCommit,true);
        assert.equal(live.getCurrentWorkspaceId(),'integrity'); assert.equal(live.getBug(1)?.note,'archived 1');
        for(const item of manifest.archived_attachments) {
          const bytes=readFileSync(join(liveDir,'attachments',item.file_name));
          assert.equal(createHash('sha256').update(bytes).digest('hex'),item.content_hash.toLowerCase());
        }
        live.connectToWorkspace(''); assert.equal(live.getBug(1)?.note,'archived 0');
      } else {
        const message=scenario==='missing attachment'?/missing declared attachment/:scenario==='malformed hash'?/64 hexadecimal/:/SHA-256 integrity/;
        await assert.rejects(restore,message);
        assert.equal(beforeCommit,false,'validation must not close live handles');
        assert.deepEqual(files(liveDir),before,'all live database, sidecar and attachment bytes remain unchanged');
        assert.equal(live.getBug(liveBug.id)?.note,'live workspace','existing handle remains usable');
        live.connectToWorkspace(''); assert.equal(live.getBug(1)?.note,'live local');
      }
      assert.equal(existsSync(join(liveDir,'.staging_restore')),false);
      assert.equal(existsSync(join(liveDir,'.restore_rollback')),false);
    } finally {source.close();live.close();rmSync(root,{recursive:true,force:true});}
  });
}
