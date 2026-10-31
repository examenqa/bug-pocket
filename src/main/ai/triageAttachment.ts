import { existsSync } from 'node:fs';
import { AiPublicError } from '../../shared/aiError';
import type { AiTriageBugPayload } from '../../shared/types';
import type { BugPocketDatabase } from '../database';

const attachmentIdPattern = /^[1-9]\d*$/;

export function resolveVerifiedTriageAttachmentPath(
  database: BugPocketDatabase,
  payload: Pick<AiTriageBugPayload, 'attachment_id'>
): string | undefined {
  if (payload.attachment_id === undefined) return undefined;
  if (!attachmentIdPattern.test(payload.attachment_id)) {
    throw new AiPublicError('AI_ATTACHMENT_INVALID');
  }

  const attachmentId = Number(payload.attachment_id);
  if (!Number.isSafeInteger(attachmentId)) throw new AiPublicError('AI_ATTACHMENT_INVALID');
  const attachment = database.getAttachment(attachmentId);
  if (!attachment?.content_hash) throw new AiPublicError('AI_ATTACHMENT_UNAVAILABLE');

  const attachmentPath = database.resolveAttachmentPath(attachment.content_hash, attachment.file_extension);
  if (!attachmentPath || !existsSync(attachmentPath)) throw new AiPublicError('AI_ATTACHMENT_MISSING');
  return attachmentPath;
}
