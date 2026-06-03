import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { ReportTemplate } from '../../../../shared/types';

const availableTemplateTokens = [
  '{{title}}',
  '{{bugNote}}',
  '{{stepsToReproduce}}',
  '{{expectedResult}}',
  '{{actualResult}}',
  '{{note}}',
  '{{steps}}',
  '{{expected}}',
  '{{actual}}',
  '{{application}}',
  '{{module}}',
  '{{environment}}',
  '{{browser}}',
  '{{device}}',
  '{{user_role}}',
  '{{severity}}',
  '{{status}}',
  '{{issue_id}}'
];

const defaultTemplateTextByName: Record<string, string> = {
  'Quick Report': `🚨 *[{{severity}}] {{title}}*
*Context:* {{application}} > {{module}} | {{environment}} | {{user_role}}

*Note:* {{note}}`,
  'Full Bug Report': `Issue Title:
{{title}}

Summary:
{{note}}

Entry Type:
{{entry_type}}

Application:
{{application}}

Module:
{{module}}

Environment:
{{environment}}

Device:
{{device}}

Browser:
{{browser}}

User Role:
{{user_role}}

Steps to Reproduce:
{{steps}}

Expected Result:
{{expected}}

Actual Result:
{{actual}}

Status:
{{status}}

Severity:
{{severity}}

Reported:
{{reported}}

Issue ID:
{{issue_id}}

Attachments:
{{attachments}}`,
  'Linear Format': `{{title}}

{{note}}

Application: {{application}}
Module: {{module}}
Environment: {{environment}}
User Role: {{user_role}}
Device: {{device}}
Browser: {{browser}}
Severity: {{severity}}
Attachments:
{{attachments}}`,
  'Jira Format': `{{title}}

Summary:
{{note}}

Application: {{application}}
Module: {{module}}
Environment: {{environment}}
User Role: {{user_role}}
Device: {{device}}
Browser: {{browser}}

Steps to Reproduce:
{{steps}}

Expected Result:
{{expected}}

Actual Result:
{{actual}}

Severity: {{severity}}
Attachments:
{{attachments}}`
};

export function TemplateManager({
  templates,
  refresh
}: {
  templates: ReportTemplate[];
  refresh: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(templates[0]?.id ?? null);
  const selected = useMemo(() => templates.find((template) => template.id === selectedId) ?? templates[0], [templates, selectedId]);
  const [name, setName] = useState(selected?.name ?? '');
  const [templateText, setTemplateText] = useState(selected?.template_text ?? '');
  const selectedTemplateName = selected?.name ?? '';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setName(selected?.name ?? '');
    setTemplateText(selected?.template_text ?? '');
  }, [selected?.id]);

  const insertToken = (token: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    document.execCommand('insertText', false, token);
  };

  const resetToDefault = (): void => {
    const defaultText = defaultTemplateTextByName[selectedTemplateName];
    if (!defaultText) return;
    setTemplateText(defaultText);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(0, 0);
    }, 0);
  };

  return (
    <div className="panel template-panel">
      <h2>Report Templates</h2>
      <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(Number(event.target.value))}>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <p className="settings-helper template-token-helper">Template variables insert at your cursor. Unrecognized tokens remain as raw text in the final export.</p>
      <div className="template-token-toolbar" aria-label="Template variables">
        {availableTemplateTokens.map((token) => (
          <button key={token} type="button" className="template-token-pill" onClick={() => insertToken(token)}>+ {token}</button>
        ))}
      </div>
      <textarea ref={textareaRef} value={templateText} onChange={(event) => setTemplateText(event.target.value)} />
      <div className="template-action-row">
        <button className="primary" onClick={async () => { await window.bugPocket.saveTemplate(selected?.id ?? null, name, templateText); await refresh(); }}><Save size={16} /> Save Template</button>
        <button type="button" onClick={resetToDefault} disabled={!defaultTemplateTextByName[selectedTemplateName]}>Reset to Default</button>
      </div>
    </div>
  );
}

