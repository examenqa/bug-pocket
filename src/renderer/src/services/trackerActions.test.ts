import assert from 'node:assert/strict';
import test from 'node:test';
import { openTrackerIssue } from './reports';
import type { BugDetails,ReportTemplate } from '../../../shared/types';
const bug={title:'Report',note:'Notes',issue_url:'',environment:'Production',steps_to_reproduce:'',attachments:[]} as unknown as BugDetails;
const template={template_text:'{{title}}: {{note}}'} as ReportTemplate;
for(const platform of ['Jira','Linear'] as const) for(const hasApiKey of [true,false]) {
  test(`${platform} export uses local formatting with AI key present=${hasApiKey}`,async()=>{
    let aiCalls=0;const opened:string[]=[];
    const bridge={getAiConfig:async()=>{aiCalls++;return {hasApiKey};},processIssueWithByokAi:async()=>{aiCalls++;},openExternalUrl:async(url:string)=>{opened.push(url);}};
    await openTrackerIssue(platform,bug,template,{jiraWorkspaceUrl:'https://team.atlassian.net'},bridge);
    assert.equal(aiCalls,0);assert.equal(opened.length,1);assert.match(decodeURIComponent(opened[0]).replace(/\+/g,' '),/Report: Notes/);
  });
}
test('missing or invalid Jira configuration fails before external or AI calls',async()=>{
  let calls=0;const bridge={openExternalUrl:async()=>{calls++;},getAiConfig:async()=>{calls++;}};
  for(const jiraWorkspaceUrl of ['', 'not-a-url'])await assert.rejects(openTrackerIssue('Jira',bug,template,{jiraWorkspaceUrl},bridge),/Configure your Jira/);
  assert.equal(calls,0);
});
