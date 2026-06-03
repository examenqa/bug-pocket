import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ToastBanner, type ToastVariant } from './ToastBanner';

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children, suppressToast = false }: { children: React.ReactNode; suppressToast?: boolean }) {
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const showToast = useCallback((message: string, variant: ToastVariant = 'success'): void => {
    setToast({ message, variant });
  }, []);

  useEffect(() => window.bugPocket.onToast((message, variant = 'success') => {
    showToast(message, variant);
  }), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && !suppressToast && (
        <ToastBanner message={toast.message} variant={toast.variant} onClose={closeToast} />
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue['showToast'] {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider.');
  return context.showToast;
}
