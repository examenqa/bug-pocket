import type { Attachment, AttachmentLineage } from '../../../shared/types';

export interface SpotlightState {
  bugId: number;
  bugTitle: string;
  attachments: Attachment[];
  index: number;
  previews: Record<number, string>;
  lineage: Attachment[];
  lineagePreviews: Record<number, string>;
  loading: boolean;
  error: string;
}

export async function loadAttachmentLineage(attachmentId: number): Promise<{ lineage: Attachment[]; lineagePreviews: Record<number, string> }> {
  const lineage = (await window.bugPocket.getAttachmentLineage(attachmentId)) as AttachmentLineage['versions'];
  const entries = await Promise.all(
    lineage.map(async (attachment) => {
      const dataUrl = (await window.bugPocket.getAttachmentPreview(attachment.id)) as string;
      return [attachment.id, dataUrl] as const;
    })
  );
  return {
    lineage,
    lineagePreviews: Object.fromEntries(entries.filter(([, dataUrl]) => dataUrl))
  };
}
