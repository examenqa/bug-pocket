import { existsSync } from 'node:fs';
import type { AiTriageBugPayload } from '../../shared/types';
import type { BugPocketDatabase } from '../database';

const attachmentIdPattern = /^[1-9]\d*$/;

export function resolveVerifiedTriageAttachmentPath(
  database: BugPocketDatabase,
  payload: Pick<AiTriageBugPayload, 'attachment_id'>
): string | undefined {
  if (payload.attachment_id === undefined) return undefined;
  if (!attachmentIdPattern.test(payload.attachment_id)) {
    throw new Error('AI attachment ID is invalid.');
  }

  const attachmentId = Number(payload.attachment_id);
  if (!Number.isSafeInteger(attachmentId)) throw new Error('AI attachment ID is outside the supported range.');
  const attachment = database.getAttachment(attachmentId);
  if (!attachment?.content_hash) throw new Error('The selected AI attachment is unavailable.');

  const attachmentPath = database.resolveAttachmentPath(attachment.content_hash, attachment.file_extension);
  if (!attachmentPath || !existsSync(attachmentPath)) throw new Error('The selected AI attachment file is missing.');
  return attachmentPath;
}
