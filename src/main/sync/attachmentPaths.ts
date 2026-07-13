import { resolve, sep } from 'node:path';

const sha256Pattern = /^[a-f0-9]{64}$/i;
const safeAttachmentExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);

export class AttachmentMetadataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentMetadataValidationError';
  }
}

export interface AttachmentDownloadTarget {
  extension: string;
  storageKey: string;
  localPath: string;
}

export interface ValidatedAttachmentMetadata {
  contentHash: string | null;
  extension: string;
}

export function validateAttachmentMetadata(
  contentHash: unknown,
  fileExtension: unknown
): ValidatedAttachmentMetadata {
  let validatedHash: string | null = null;
  if (contentHash !== null && contentHash !== undefined) {
    if (typeof contentHash !== 'string' || !sha256Pattern.test(contentHash)) {
      throw new AttachmentMetadataValidationError(
        'Invalid attachment content_hash: expected exactly 64 hexadecimal SHA-256 characters.'
      );
    }
    validatedHash = contentHash;
  }

  const extensionValue = fileExtension === null || fileExtension === undefined ? 'png' : fileExtension;
  if (typeof extensionValue !== 'string') {
    throw new AttachmentMetadataValidationError(
      'Invalid attachment file_extension: expected png, jpg, jpeg, or webp.'
    );
  }
  const extensionWithoutDot = extensionValue.startsWith('.') ? extensionValue.slice(1) : extensionValue;
  const normalizedExtension = extensionWithoutDot.toLowerCase();
  if (!safeAttachmentExtensions.has(normalizedExtension)) {
    throw new AttachmentMetadataValidationError(
      'Invalid attachment file_extension: expected png, jpg, jpeg, or webp.'
    );
  }

  return { contentHash: validatedHash, extension: `.${normalizedExtension}` };
}

export function normalizeAttachmentExtension(value: string): string {
  return validateAttachmentMetadata(null, value).extension;
}

export function resolveAttachmentFilePath(
  attachmentsDirectory: string,
  contentHash: string | null,
  fileExtension: string
): string {
  if (contentHash === null) return '';
  const metadata = validateAttachmentMetadata(contentHash, fileExtension);
  const attachmentsRoot = resolve(attachmentsDirectory);
  const targetPath = resolve(attachmentsRoot, `${metadata.contentHash}${metadata.extension}`);
  const sandboxPrefix = attachmentsRoot.endsWith(sep) ? attachmentsRoot : `${attachmentsRoot}${sep}`;
  if (!targetPath.startsWith(sandboxPrefix)) {
    throw new AttachmentMetadataValidationError(
      'Invalid attachment path: resolved target escapes the attachments directory.'
    );
  }
  return targetPath;
}

export function buildAttachmentDownloadTarget(
  attachmentsDirectory: string,
  workspaceId: string,
  contentHash: string,
  fileExtension: string
): AttachmentDownloadTarget {
  const metadata = validateAttachmentMetadata(contentHash, fileExtension);
  if (!metadata.contentHash) {
    throw new AttachmentMetadataValidationError('Invalid attachment content_hash: a hash is required for download.');
  }
  return {
    extension: metadata.extension,
    storageKey: `${workspaceId}/${metadata.contentHash}${metadata.extension}`,
    localPath: resolveAttachmentFilePath(attachmentsDirectory, metadata.contentHash, metadata.extension)
  };
}
