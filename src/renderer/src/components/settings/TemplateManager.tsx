import React, { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import type { ReportTemplate } from '../../../../shared/types';

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

  useEffect(() => {
    setName(selected?.name ?? '');
    setTemplateText(selected?.template_text ?? '');
  }, [selected?.id]);

  return (
    <div className="panel template-panel">
      <h2>Report Templates</h2>
      <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(Number(event.target.value))}>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <textarea value={templateText} onChange={(event) => setTemplateText(event.target.value)} />
      <button className="primary" onClick={async () => { await window.bugPocket.saveTemplate(selected?.id ?? null, name, templateText); await refresh(); }}><Save size={16} /> Save Template</button>
    </div>
  );
}
