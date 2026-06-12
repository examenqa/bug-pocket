import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Attachment } from '../../../shared/types';

type AnnotationMode = 'arrow' | 'freehand' | 'text' | 'blur';

interface ScreenshotAnnotatorProps {
  activeAttachmentId?: number;
  imageDataUrl: string;
  fileName?: string;
  saveLabel?: string;
  showSaveButton?: boolean;
  versionHistory?: Attachment[];
  versionPreviews?: Record<number, string>;
  onSelectVersion?: (attachment: Attachment) => void;
  onSave: (dataUrl: string) => Promise<void>;
}

export interface ScreenshotAnnotatorHandle {
  save: () => Promise<void>;
}

interface Point {
  x: number;
  y: number;
}

interface TextDraft {
  point: Point;
  text: string;
  caretVisible: boolean;
}

function annotationColor(): string {
  if (typeof window === 'undefined') return 'rgb(229, 57, 53)';
  return getComputedStyle(document.documentElement).getPropertyValue('--annotation-red').trim() || 'rgb(229, 57, 53)';
}
const strokeShadow = 'rgba(6, 27, 66, 0.18)';

export const ScreenshotAnnotator = forwardRef<ScreenshotAnnotatorHandle, ScreenshotAnnotatorProps>(function ScreenshotAnnotator(
  { activeAttachmentId, imageDataUrl, fileName, saveLabel = 'Save annotated copy', showSaveButton = true, versionHistory = [], versionPreviews = {}, onSelectVersion, onSave },
  ref
) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const startPoint = useRef<Point | null>(null);
  const historyRef = useRef<string[]>([]);
  const [mode, setMode] = useState<AnnotationMode>('arrow');
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);

  const getContext = (canvas = canvasRef.current): CanvasRenderingContext2D | null => {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return null;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = annotationColor();
    ctx.fillStyle = annotationColor();
    ctx.shadowColor = strokeShadow;
    ctx.shadowBlur = 1;
    ctx.font = '700 18px system-ui, sans-serif';
    return ctx;
  };

  const pushHistory = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    historyRef.current = [...historyRef.current, canvas.toDataURL('image/png')].slice(-30);
    setCanUndo(historyRef.current.length > 1);
  };

  const resetHistory = (): void => {
    const canvas = canvasRef.current;
    historyRef.current = canvas ? [canvas.toDataURL('image/png')] : [];
    setCanUndo(false);
  };

  const restoreHistoryImage = (dataUrl: string): void => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const image = new Image();
    image.onload = () => {
      clearCanvas(canvas);
      ctx.drawImage(image, 0, 0, canvas.width / getDpr(), canvas.height / getDpr());
    };
    image.src = dataUrl;
  };

  const undo = (): void => {
    clearTextDraft();
    clearCanvas(previewCanvasRef.current);
    if (historyRef.current.length <= 1) return;
    historyRef.current = historyRef.current.slice(0, -1);
    const previous = historyRef.current[historyRef.current.length - 1];
    restoreHistoryImage(previous);
    setCanUndo(historyRef.current.length > 1);
  };

  useEffect(() => {
    clearCanvas(canvasRef.current);
    clearCanvas(previewCanvasRef.current);
    historyRef.current = [];
    setCanUndo(false);

    const resizeCanvas = (): void => {
      const image = imageRef.current;
      const canvas = canvasRef.current;
      const previewCanvas = previewCanvasRef.current;
      if (!image || !canvas || !previewCanvas) return;
      const rect = image.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      resizeDrawingCanvas(canvas, width, height, true);
      resizeDrawingCanvas(previewCanvas, width, height, false);
      if (!historyRef.current.length) resetHistory();
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (imageRef.current) observer.observe(imageRef.current);
    window.addEventListener('resize', resizeCanvas);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [imageDataUrl]);

  useEffect(() => {
    if (!textDraft) return;
    renderTextDraft(textDraft);
    const timer = window.setInterval(() => {
      setTextDraft((current) => (current ? { ...current, caretVisible: !current.caretVisible } : current));
    }, 520);
    return () => window.clearInterval(timer);
  }, [textDraft?.point.x, textDraft?.point.y, textDraft?.text]);

  useEffect(() => {
    if (textDraft) renderTextDraft(textDraft);
  }, [textDraft?.caretVisible]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = imageRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const drawArrow = (from: Point, to: Point, canvas = canvasRef.current): void => {
    const ctx = getContext(canvas);
    if (!ctx) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 8) return;

    const angle = Math.atan2(dy, dx);
    const headLength = Math.min(24, Math.max(15, length * 0.22));
    const headWidth = Math.min(18, Math.max(11, headLength * 0.72));
    const shaftEnd = {
      x: to.x - Math.cos(angle) * (headLength * 0.7),
      y: to.y - Math.sin(angle) * (headLength * 0.7)
    };
    const left = {
      x: to.x - Math.cos(angle) * headLength + Math.cos(angle - Math.PI / 2) * headWidth,
      y: to.y - Math.sin(angle) * headLength + Math.sin(angle - Math.PI / 2) * headWidth
    };
    const right = {
      x: to.x - Math.cos(angle) * headLength + Math.cos(angle + Math.PI / 2) * headWidth,
      y: to.y - Math.sin(angle) * headLength + Math.sin(angle + Math.PI / 2) * headWidth
    };

    ctx.save();
    ctx.lineWidth = 5;
    ctx.shadowBlur = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(shaftEnd.x, shaftEnd.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(left.x, left.y);
    ctx.quadraticCurveTo(shaftEnd.x, shaftEnd.y, right.x, right.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const drawText = (text: string, point: Point, canvas = canvasRef.current): void => {
    const ctx = getContext(canvas);
    if (!ctx) return;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillText(text, point.x, point.y);
    ctx.restore();
  };

  const prepareFreehandContext = (): CanvasRenderingContext2D | null => {
    const ctx = getContext();
    if (!ctx) return null;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    return ctx;
  };

  const drawBlur = (from: Point, to: Point, canvas = canvasRef.current, previewOnly = false): void => {
    const image = imageRef.current;
    const ctx = getContext(canvas);
    if (!image || !canvas || !ctx) return;
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);
    if (width < 6 || height < 6) return;

    ctx.save();
    ctx.shadowBlur = 0;
    if (!previewOnly) {
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.filter = 'blur(8px)';
      ctx.drawImage(image, 0, 0, canvas.width / getDpr(), canvas.height / getDpr());
      ctx.filter = 'none';
    }
    if (previewOnly) {
      ctx.strokeStyle = 'rgba(229, 57, 53, 0.72)';
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(x, y, width, height);
    }
    ctx.restore();
  };

  const renderTextDraft = (draft: TextDraft): void => {
    const canvas = previewCanvasRef.current;
    const ctx = getContext(canvas);
    if (!canvas || !ctx) return;
    clearCanvas(canvas);
    if (draft.text) drawText(draft.text, draft.point, canvas);
    if (!draft.caretVisible) return;
    const width = draft.text ? ctx.measureText(draft.text).width : 0;
    const caretX = draft.point.x + width + 2;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = annotationColor();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(caretX, draft.point.y - 20);
    ctx.lineTo(caretX, draft.point.y + 5);
    ctx.stroke();
    ctx.restore();
  };

  const clearTextDraft = (): void => {
    setTextDraft(null);
    clearCanvas(previewCanvasRef.current);
  };

  const commitTextDraft = (): void => {
    if (!textDraft) return;
    const text = textDraft.text.trim();
    if (text) {
      drawText(text, textDraft.point);
      pushHistory();
    }
    clearTextDraft();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromEvent(event);
    event.currentTarget.focus({ preventScroll: true });
    if (mode === 'text') {
      commitTextDraft();
      setTextDraft({ point, text: '', caretVisible: true });
      return;
    }
    commitTextDraft();
    event.currentTarget.setPointerCapture(event.pointerId);
    startPoint.current = point;
    if (mode === 'freehand') {
      const ctx = getContext();
      ctx?.beginPath();
      ctx?.moveTo(point.x, point.y);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!startPoint.current) return;
    const point = pointFromEvent(event);
    if (mode === 'arrow') {
      clearCanvas(previewCanvasRef.current);
      drawArrow(startPoint.current, point, previewCanvasRef.current);
      return;
    }
    if (mode === 'blur') {
      clearCanvas(previewCanvasRef.current);
      drawBlur(startPoint.current, point, previewCanvasRef.current, true);
      return;
    }
    if (mode !== 'freehand') return;
    const ctx = getContext();
    if (!ctx) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!startPoint.current) return;
    const point = pointFromEvent(event);
    clearCanvas(previewCanvasRef.current);
    if (mode === 'arrow') {
      drawArrow(startPoint.current, point);
      pushHistory();
    }
    if (mode === 'blur') {
      drawBlur(startPoint.current, point);
      pushHistory();
    }
    if (mode === 'freehand') pushHistory();
    startPoint.current = null;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (mode !== 'text' || !textDraft) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') {
      commitTextDraft();
      return;
    }
    if (event.key === 'Escape') {
      clearTextDraft();
      return;
    }
    if (event.key === 'Backspace') {
      setTextDraft((current) => (current ? { ...current, text: current.text.slice(0, -1), caretVisible: true } : current));
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      setTextDraft((current) => (current ? { ...current, text: `${current.text}${event.key}`, caretVisible: true } : current));
    }
  };

  const saveAnnotatedImage = async (): Promise<void> => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    commitTextDraft();
    const merged = document.createElement('canvas');
    merged.width = canvas.width;
    merged.height = canvas.height;
    const ctx = merged.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, merged.width, merged.height);
    ctx.drawImage(canvas, 0, 0);
    setSaving(true);
    try {
      await onSave(merged.toDataURL('image/png'));
      clearCanvas(canvas);
      clearCanvas(previewCanvasRef.current);
      resetHistory();
    } finally {
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save: saveAnnotatedImage
  }));

  const selectMode = (tool: AnnotationMode): void => {
    if (tool !== 'text') commitTextDraft();
    setMode(tool);
  };

  return (
    <div className="annotator">
      <div className="annotator-toolbar" aria-label="Annotation tools">
        {(['arrow', 'freehand', 'text', 'blur'] as AnnotationMode[]).map((tool) => (
          <button key={tool} className={mode === tool ? 'active' : ''} onClick={() => selectMode(tool)}>
            {tool === 'freehand' ? 'Freehand' : tool === 'blur' ? 'Mask' : tool[0].toUpperCase() + tool.slice(1)}
          </button>
        ))}
        <button disabled={!canUndo} onClick={undo}>
          Undo
        </button>
        {showSaveButton && (
          <button className="annotator-save" disabled={saving} onClick={() => void saveAnnotatedImage()}>
            {saving ? 'Saving...' : saveLabel}
          </button>
        )}
      </div>
      {activeAttachmentId && (
        <div className="annotator-version-history" aria-label="Version History">
          <div>
            <strong>Version History</strong>
            <span>{versionHistory.length > 1 ? `${versionHistory.length} versions` : 'No previous edits'}</span>
          </div>
          {versionHistory.length > 0 ? (
            <div className="annotator-version-strip">
              {versionHistory.map((attachment, index) => (
                <button
                  className={attachment.id === activeAttachmentId ? 'active' : ''}
                  key={attachment.id}
                  onClick={() => onSelectVersion?.(attachment)}
                  type="button"
                >
                  {versionPreviews[attachment.id] ? <img src={versionPreviews[attachment.id]} alt={`Version ${index + 1}`} /> : <span>{index + 1}</span>}
                  <small>{index === 0 ? 'Original' : `Edit ${index}`}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="annotator-version-empty">Version history will appear here after you save annotated copies.</p>
          )}
        </div>
      )}
      <div className={mode === 'text' ? 'annotator-canvas-wrap text-mode' : 'annotator-canvas-wrap'}>
        <img ref={imageRef} src={imageDataUrl} alt={fileName ?? 'Attachment preview'} onLoad={() => window.dispatchEvent(new Event('resize'))} />
        <canvas ref={canvasRef} aria-hidden="true" />
        <canvas
          ref={previewCanvasRef}
          aria-label="Annotation canvas"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
});

function getDpr(): number {
  return window.devicePixelRatio || 1;
}

function resizeDrawingCanvas(canvas: HTMLCanvasElement, width: number, height: number, preserve: boolean): void {
  const dpr = getDpr();
  const nextWidth = Math.max(1, Math.round(width * dpr));
  const nextHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width === nextWidth && canvas.height === nextHeight) return;

  const previous = document.createElement('canvas');
  previous.width = canvas.width;
  previous.height = canvas.height;
  previous.getContext('2d')?.drawImage(canvas, 0, 0);

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (preserve && previous.width && previous.height) {
    ctx.drawImage(previous, 0, 0, previous.width / dpr, previous.height / dpr, 0, 0, width, height);
  }
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
