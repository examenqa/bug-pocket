import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type ToastVariant = 'success' | 'info' | 'error';

interface ToastBannerProps {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  onClose: () => void;
}

interface ParsedToastMessage {
  userMessage: string;
  rawDetails: string | null;
}

function parseToastMessage(message: string, variant: ToastVariant): ParsedToastMessage {
  if (variant !== 'error') return { userMessage: message, rawDetails: null };

  const normalizedMessage = message.replace(/^Error:\s*/i, '').trim();
  try {
    const parsed = JSON.parse(normalizedMessage) as { userMessage?: unknown; rawDetails?: unknown };
    return {
      userMessage: typeof parsed.userMessage === 'string' && parsed.userMessage.trim() ? parsed.userMessage : message,
      rawDetails: typeof parsed.rawDetails === 'string' && parsed.rawDetails.trim() ? parsed.rawDetails : null
    };
  } catch {
    return { userMessage: message, rawDetails: null };
  }
}

export function ToastBanner({ message, variant = 'success', durationMs, onClose }: ToastBannerProps) {
  const timeoutRef = useRef<number | null>(null);
  const effectiveDuration = durationMs ?? (variant === 'error' ? 4000 : 2400);
  const parsedMessage = parseToastMessage(message, variant);

  const clearTimer = (): void => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const startTimer = (): void => {
    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      onClose();
    }, effectiveDuration);
  };

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [message, variant, effectiveDuration, onClose]);

  return (
    <div
      className={`toast ${variant}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
    >
      <button className="toast-close" type="button" aria-label="Dismiss notification" onClick={onClose}>
        <X size={16} />
      </button>
      <span className="toast-message">{parsedMessage.userMessage}</span>
      {parsedMessage.rawDetails && (
        <details className="toast-details">
          <summary>Technical Details</summary>
          <pre>{parsedMessage.rawDetails}</pre>
        </details>
      )}
    </div>
  );
}