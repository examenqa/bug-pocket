import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import type { Attachment, BugDetails } from '../../../shared/types';
import { getEntryDisplay } from '../utils/display';
import { loadAttachmentLineage, SpotlightState } from '../utils/spotlight';

interface UseAttachmentSpotlightOptions {
  bugId: number;
  bug: BugDetails | null;
  setBug: Dispatch<SetStateAction<BugDetails | null>>;
}

export function useAttachmentSpotlight({ bugId, bug, setBug }: UseAttachmentSpotlightOptions) {
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<number, string>>({});
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);
  const currentSpotlightAttachment = spotlight?.attachments[spotlight.index] ?? null;
  const currentSpotlightPreview = currentSpotlightAttachment ? spotlight?.previews[currentSpotlightAttachment.id] ?? '' : '';

  const attachmentKey = bug?.attachments.map((attachment) => attachment.id).join(',') ?? '';
  useEffect(() => {
    if (!bug) {
      setAttachmentPreviews({});
      return;
    }
    let cancelled = false;
    Promise.all(
      bug.attachments.map(async (attachment) => {
        const dataUrl = (await window.bugPocket.getAttachmentPreview(attachment.id)) as string;
        return [attachment.id, dataUrl] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setAttachmentPreviews(Object.fromEntries(entries.filter(([, dataUrl]) => dataUrl)));
    });
    return () => {
      cancelled = true;
    };
  }, [bugId, attachmentKey]);

  const loadSpotlightPreview = async (attachment: Attachment): Promise<void> => {
    setSpotlight((current) => (current ? { ...current, loading: true, error: '' } : current));
    const [dataUrl, lineageData] = await Promise.all([
      window.bugPocket.getAttachmentPreview(attachment.id) as Promise<string>,
      loadAttachmentLineage(attachment.id)
    ]);
    setSpotlight((current) => {
      if (!current) return current;
      return {
        ...current,
        previews: { ...current.previews, [attachment.id]: dataUrl },
        lineage: lineageData.lineage,
        lineagePreviews: { ...current.lineagePreviews, ...lineageData.lineagePreviews },
        loading: false,
        error: dataUrl ? '' : 'Preview unavailable.'
      };
    });
  };

  const openAttachmentSpotlight = async (index: number): Promise<void> => {
    if (!bug?.attachments.length) return;
    const boundedIndex = Math.max(0, Math.min(index, bug.attachments.length - 1));
    const previews = { ...attachmentPreviews };
    const attachment = bug.attachments[boundedIndex];
    setSpotlight({
      bugId: bug.id,
      bugTitle: getEntryDisplay(bug).title,
      attachments: bug.attachments,
      index: boundedIndex,
      previews,
      lineage: [],
      lineagePreviews: {},
      loading: !previews[attachment.id],
      error: ''
    });
    await loadSpotlightPreview(attachment);
  };

  const showSpotlightIndex = (nextIndex: number): void => {
    if (!spotlight?.attachments.length) return;
    const boundedIndex = Math.max(0, Math.min(nextIndex, spotlight.attachments.length - 1));
    const attachment = spotlight.attachments[boundedIndex];
    setSpotlight((current) => (current
      ? { ...current, index: boundedIndex, loading: !current.previews[attachment.id], error: '' }
      : current));
    void loadSpotlightPreview(attachment);
  };

  const saveSpotlightAnnotation = async (dataUrl: string): Promise<void> => {
    if (!bug || !spotlight || !currentSpotlightAttachment) return;
    const created = (await window.bugPocket.saveAnnotatedAttachment(currentSpotlightAttachment.id, dataUrl)) as Attachment;
    const updatedBug = await window.bugPocket.getBug(bug.id);
    const lineageData = await loadAttachmentLineage(created.id);
    if (updatedBug) setBug(updatedBug);
    setAttachmentPreviews((current) => ({ ...current, [created.id]: dataUrl }));
    setSpotlight((current) => {
      if (!current) return current;
      return {
        ...current,
        attachments: [created, ...current.attachments.filter((attachment) => attachment.id !== currentSpotlightAttachment.id)],
        index: 0,
        previews: { ...current.previews, [created.id]: dataUrl },
        lineage: lineageData.lineage,
        lineagePreviews: { ...current.lineagePreviews, ...lineageData.lineagePreviews, [created.id]: dataUrl },
        loading: false,
        error: ''
      };
    });
  };

  const selectSpotlightVersion = async (attachment: Attachment): Promise<void> => {
    if (!spotlight) return;
    const nextIndex = spotlight.attachments.findIndex((item) => item.id === attachment.id);
    if (nextIndex >= 0) {
      showSpotlightIndex(nextIndex);
      return;
    }
    setSpotlight((current) => current ? {
      ...current,
      attachments: [attachment, ...current.attachments],
      index: 0,
      previews: { ...current.previews, ...current.lineagePreviews },
      loading: !current.lineagePreviews[attachment.id],
      error: ''
    } : current);
    if (!spotlight.lineagePreviews[attachment.id]) await loadSpotlightPreview(attachment);
  };

  useEffect(() => {
    if (!spotlight) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSpotlight(null);
      }
      if (event.key === 'ArrowLeft') showSpotlightIndex(spotlight.index - 1);
      if (event.key === 'ArrowRight') showSpotlightIndex(spotlight.index + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [spotlight]);

  return {
    attachmentPreviews,
    closeSpotlight: () => setSpotlight(null),
    currentSpotlightAttachment,
    currentSpotlightPreview,
    openAttachmentSpotlight,
    saveSpotlightAnnotation,
    selectSpotlightVersion,
    showSpotlightIndex,
    spotlight
  };
}
