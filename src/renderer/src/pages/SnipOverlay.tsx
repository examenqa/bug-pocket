import React, { useEffect, useRef, useState } from 'react';

function normalizeRect(startX: number, startY: number, endX: number, endY: number) {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  };
}

function pngBytesToDataUrl(pngBytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const rendererBytes = new Uint8Array(pngBytes.byteLength);
    rendererBytes.set(pngBytes);
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Screenshot bytes could not be decoded.'));
    reader.readAsDataURL(new Blob([rendererBytes.buffer], { type: 'image/png' }));
  });
}

export function SnipOverlay() {
  const [source, setSource] = useState('');
  const [drag, setDrag] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pointerDownRef = useRef(false);

  useEffect(() => {
    let active = true;
    const applyScreenshotBytes = (pngBytes: Uint8Array | null): void => {
      if (!pngBytes?.byteLength) return;
      void pngBytesToDataUrl(pngBytes).then((dataUrl) => {
        if (active) setSource(dataUrl);
      });
    };
    void window.bugPocket.getScreenshotSource().then(applyScreenshotBytes);
    const unsubscribe = window.bugPocket.onScreenshotSource(applyScreenshotBytes);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  const rect = drag ? normalizeRect(drag.startX, drag.startY, drag.endX, drag.endY) : null;

  const finishFullScreen = async (): Promise<void> => {
    if (!source || isFinishing) return;
    setIsFinishing(true);
    await window.bugPocket.completeScreenshotCapture(source);
  };

  const finish = async (selection = drag): Promise<void> => {
    const finalRect = selection ? normalizeRect(selection.startX, selection.startY, selection.endX, selection.endY) : null;
    if (!source || !finalRect || finalRect.width < 8 || finalRect.height < 8 || isFinishing) return;
    setIsFinishing(true);
    const image = new Image();
    image.onload = async () => {
      const scaleX = image.naturalWidth / window.innerWidth;
      const scaleY = image.naturalHeight / window.innerHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(finalRect.width * scaleX);
      canvas.height = Math.round(finalRect.height * scaleY);
      const context = canvas.getContext('2d');
      context?.drawImage(
        image,
        finalRect.left * scaleX,
        finalRect.top * scaleY,
        finalRect.width * scaleX,
        finalRect.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );
      await window.bugPocket.completeScreenshotCapture(canvas.toDataURL('image/png'));
    };
    image.src = source;
  };

  const updateDragEnd = (clientX: number, clientY: number): void => {
    setDrag((current) => (current ? { ...current, endX: clientX, endY: clientY } : current));
  };

  return (
    <div
      ref={overlayRef}
      className="snip-overlay"
      onPointerDown={(event) => {
        if (isFinishing) return;
        overlayRef.current?.focus();
        pointerDownRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ startX: event.clientX, startY: event.clientY, endX: event.clientX, endY: event.clientY });
      }}
      onPointerMove={(event) => {
        if (pointerDownRef.current && drag && !isFinishing) updateDragEnd(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        const selection = drag ? { ...drag, endX: event.clientX, endY: event.clientY } : null;
        pointerDownRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (selection) setDrag(selection);
        void finish(selection);
      }}
      onPointerCancel={(event) => {
        pointerDownRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          void window.bugPocket.cancelScreenshotCapture();
          return;
        }
        if (event.altKey && event.key.toLowerCase() === 'c') {
          event.preventDefault();
          void finishFullScreen();
        }
      }}
      tabIndex={0}
    >
      {source && <img src={source} />}
      <div className="snip-dim" />
      {rect && <div className="snip-selection" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />}
      <div className="snip-hint">
        Drag to capture area.
        <span><kbd>Alt+C</kbd> captures full screen.</span>
        <span><kbd>Esc</kbd> cancels.</span>
      </div>
    </div>
  );
}
