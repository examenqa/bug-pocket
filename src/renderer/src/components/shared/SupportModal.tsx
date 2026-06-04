import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FeedbackPayload } from '../../../../shared/types';

export type SupportModalMode = 'bug' | 'feature';

interface SupportModalProps {
  mode: SupportModalMode;
  open: boolean;
  onClose: () => void;
}

function stripImageDataUrlPrefix(value: string): string {
  return value.replace(/^data:image\/(png|jpe?g);base64,/i, '');
}

function supportTypeForMode(mode: SupportModalMode): FeedbackPayload['type'] {
  return mode === 'feature' ? 'Feature' : 'Bug';
}

function titleForMode(mode: SupportModalMode): string {
  return mode === 'feature' ? 'Request a Feature' : 'Report a Bug';
}

export function SupportModal({ mode, open, onClose }: SupportModalProps) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setEmail('');
    setImageBase64('');
    setImagePreviewUrl('');
    setIsSubmitting(false);
    setSent(false);
    setError('');
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onClose, open]);

  if (!open) return null;

  const attachFile = (file: File | null): void => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Please attach a PNG or JPEG image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      setImagePreviewUrl(dataUrl);
      setImageBase64(stripImageDataUrlPrefix(dataUrl));
      setError('');
    };
    reader.onerror = () => setError('Could not read the selected image.');
    reader.readAsDataURL(file);
  };

  const removeImage = (): void => {
    setImageBase64('');
    setImagePreviewUrl('');
  };

  const submit = async (): Promise<void> => {
    const cleanedMessage = message.trim();
    if (!cleanedMessage) {
      setError('Please add a short message before sending.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    const result = await window.bugPocket.sendFeedback({
      type: supportTypeForMode(mode),
      message: cleanedMessage,
      user_email: email.trim() || undefined,
      image_base64: imageBase64 || undefined
    });
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error || 'Could not send feedback.');
      return;
    }
    setSent(true);
    window.setTimeout(onClose, 800);
  };

  return createPortal(
    <div className="support-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose(); }}>
      <section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="support-modal-title">
        <header>
          <div>
            <h2 id="support-modal-title">{titleForMode(mode)}</h2>
            <p>Submit a bug report or feature request directly to the team.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close support form" disabled={isSubmitting} onClick={onClose}>x</button>
        </header>

        <label>
          <span>Message</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What should we know?" disabled={isSubmitting || sent} autoFocus />
        </label>

        <label>
          <span>Email <em>optional</em></span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" disabled={isSubmitting || sent} />
        </label>

        <div className="support-screenshot-row">
          <div>
            <strong>Image</strong>
            <p>{imageBase64 ? 'Image attached for support context.' : 'Optional. Attach a PNG or JPEG.'}</p>
          </div>
          <div className="support-screenshot-actions">
            {imageBase64 && <button type="button" disabled={isSubmitting || sent} onClick={removeImage}>Remove</button>}
            <label className="support-file-button">
              Attach Image
              <input type="file" accept="image/png,image/jpeg" disabled={isSubmitting || sent} onChange={(event) => attachFile(event.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
        {imagePreviewUrl && <img className="support-screenshot-preview" src={imagePreviewUrl} alt="Attached support image preview" />}

        {error && <p className="support-modal-error" role="alert">{error}</p>}
        {sent && <p className="support-modal-success" role="status">Sent!</p>}

        <footer>
          <button type="button" disabled={isSubmitting} onClick={onClose}>Cancel</button>
          <button className="primary" type="button" disabled={isSubmitting || sent || !message.trim()} onClick={() => void submit()}>{isSubmitting ? 'Sending...' : sent ? 'Sent' : 'Send'}</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}