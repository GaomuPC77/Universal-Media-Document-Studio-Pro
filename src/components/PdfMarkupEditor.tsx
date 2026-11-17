import React, { useState, useRef, useEffect } from 'react';
import {
  MousePointer2,
  Type,
  Highlighter,
  PenTool,
  Square,
  Circle,
  ArrowUpRight,
  Minus,
  Stamp,
  Shield,
  Download,
  RefreshCw,
  Trash2,
  Undo2,
  CheckSquare,
  ZoomIn,
  ZoomOut,
  Bold,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import {
  PdfPageInfo,
  SignatureStampPlacement,
  RedactionBox,
  PdfTextBoxAnnotation,
  PdfMarkupAnnotation,
  FileItem,
} from '../types';
import { stampPdf } from '../utils/pdfUtils';
import { saveProcessedFile } from '../utils/historyDb';
import { notifyCompletion } from '../utils/notification';

export type MarkupToolId =
  | 'select'
  | 'textbox'
  | 'highlight'
  | 'pen'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'badge'
  | 'stamp'
  | 'redact';

interface PdfMarkupEditorProps {
  lang: 'ja' | 'en';
  pdfFile: File;
  pdfPages: PdfPageInfo[];
  stampImageUrl?: string;
  enableStampTool?: boolean;
  initialTool?: MarkupToolId;
  exportFilePrefix?: string;
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
}

type SelectedRef =
  | { kind: 'textbox'; id: string }
  | { kind: 'markup'; id: string }
  | { kind: 'stamp'; id: string }
  | { kind: 'redact'; id: string }
  | null;

interface HistorySnapshot {
  textBoxes: PdfTextBoxAnnotation[];
  markups: PdfMarkupAnnotation[];
  stamps: SignatureStampPlacement[];
  redactions: RedactionBox[];
}

export const PdfMarkupEditor: React.FC<PdfMarkupEditorProps> = ({
  lang,
  pdfFile,
  pdfPages,
  stampImageUrl = '',
  enableStampTool = true,
  initialTool = 'textbox',
  exportFilePrefix = 'Annotated_',
  onResultReady,
  onShowToast,
}) => {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [zoom, setZoom] = useState(0.9);
  const [activeTool, setActiveTool] = useState<MarkupToolId>(initialTool);

  const [textBoxes, setTextBoxes] = useState<PdfTextBoxAnnotation[]>([]);
  const [markups, setMarkups] = useState<PdfMarkupAnnotation[]>([]);
  const [stamps, setStamps] = useState<SignatureStampPlacement[]>([]);
  const [redactions, setRedactions] = useState<RedactionBox[]>([]);
  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);

  const [selected, setSelected] = useState<SelectedRef>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Active tool defaults
  const [markupColor, setMarkupColor] = useState('#dc2626');
  const [highlightColor, setHighlightColor] = useState('#fde047');
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [markupOpacity, setMarkupOpacity] = useState(0.42);
  const [badgePreset, setBadgePreset] = useState('✓ 確認済');

  // Default TextBox properties (also used for new textboxes)
  const [defaultText, setDefaultText] = useState(lang === 'ja' ? 'ここにテキストを入力' : 'Enter text here');
  const [defaultFontSize, setDefaultFontSize] = useState(14);
  const [defaultFontFamily, setDefaultFontFamily] = useState<'sans' | 'serif' | 'mono'>('sans');
  const [defaultBold, setDefaultBold] = useState(false);
  const [defaultTextColor, setDefaultTextColor] = useState('#0f172a');
  const [defaultBgColor, setDefaultBgColor] = useState('#ffffff');
  const [defaultBgOpacity, setDefaultBgOpacity] = useState(0.92);
  const [defaultBorderColor, setDefaultBorderColor] = useState('#2563eb');
  const [defaultBorderWidth, setDefaultBorderWidth] = useState(1);
  const [defaultAlign, setDefaultAlign] = useState<'left' | 'center' | 'right'>('left');

  // Interactive drag / draw state
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [draftShape, setDraftShape] = useState<{
    kind: MarkupToolId;
    startX: number;
    startY: number;
    currX: number;
    currY: number;
    points?: Array<{ x: number; y: number }>;
  } | null>(null);

  const [dragOp, setDragOp] = useState<{
    mode: 'move' | 'resize';
    targetKind: 'textbox' | 'markup' | 'stamp' | 'redact';
    targetId: string;
    startPointerX: number;
    startPointerY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    origX1?: number;
    origY1?: number;
    origX2?: number;
    origY2?: number;
    origPoints?: Array<{ x: number; y: number }>;
  } | null>(null);

  // Reset annotations when PDF file changes
  useEffect(() => {
    setTextBoxes([]);
    setMarkups([]);
    setStamps([]);
    setRedactions([]);
    setUndoStack([]);
    setSelected(null);
    setCurrentPageIndex(0);
  }, [pdfFile]);

  const currentPage = pdfPages[currentPageIndex];

  const pushUndo = () => {
    setUndoStack((prev) => [
      ...prev.slice(-24),
      { textBoxes: [...textBoxes], markups: [...markups], stamps: [...stamps], redactions: [...redactions] },
    ]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setTextBoxes(prev.textBoxes);
    setMarkups(prev.markups);
    setStamps(prev.stamps);
    setRedactions(prev.redactions);
    setUndoStack((s) => s.slice(0, -1));
    setSelected(null);
  };

  const toPageCoords = (clientX: number, clientY: number) => {
    const el = canvasWrapRef.current;
    if (!el || !currentPage) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const scaleX = currentPage.width / rect.width;
    const scaleY = currentPage.height / rect.height;
    return {
      x: Math.max(0, Math.min(currentPage.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(currentPage.height, (clientY - rect.top) * scaleY)),
    };
  };

  const handleSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!currentPage) return;
    if (activeTool === 'select') {
      setSelected(null);
      return;
    }

    const { x, y } = toPageCoords(e.clientX, e.clientY);

    if (activeTool === 'stamp') {
      if (!stampImageUrl) {
        if (onShowToast) {
          onShowToast(
            lang === 'ja'
              ? '先に「電子印鑑作成」または「手書き署名」タブで印影を作成してください。'
              : 'Create a Hanko or Signature first in the other sub-tab.'
          );
        }
        return;
      }
      pushUndo();
      const id = `stp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setStamps((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          x: Math.max(0, x - 40),
          y: Math.max(0, y - 40),
          width: 80,
          height: 80,
          imageUrl: stampImageUrl,
          rotation: 0,
        },
      ]);
      setSelected({ kind: 'stamp', id });
      return;
    }

    if (activeTool === 'badge') {
      pushUndo();
      const id = `bdg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const estW = Math.max(66, badgePreset.length * 14 + 22);
      const estH = 28;
      setMarkups((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          kind: 'badge',
          x: Math.max(0, x - estW / 2),
          y: Math.max(0, y - estH / 2),
          width: estW,
          height: estH,
          strokeColor: markupColor,
          fillColor: '#ffffff',
          strokeWidth: 1.8,
          opacity: 0.95,
          label: badgePreset,
        },
      ]);
      setSelected({ kind: 'markup', id });
      return;
    }

    // Drag-to-draw tools: textbox, highlight, pen, rect, ellipse, arrow, line, redact
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraftShape({
      kind: activeTool,
      startX: x,
      startY: y,
      currX: x,
      currY: y,
      points: activeTool === 'pen' ? [{ x, y }] : undefined,
    });
  };

  const handleSurfacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!currentPage) return;
    const { x, y } = toPageCoords(e.clientX, e.clientY);

    if (dragOp) {
      const dx = x - dragOp.startPointerX;
      const dy = y - dragOp.startPointerY;

      if (dragOp.targetKind === 'textbox') {
        setTextBoxes((prev) =>
          prev.map((tb) => {
            if (tb.id !== dragOp.targetId) return tb;
            if (dragOp.mode === 'move') {
              return {
                ...tb,
                x: Math.max(0, Math.min(currentPage.width - tb.width, dragOp.origX + dx)),
                y: Math.max(0, Math.min(currentPage.height - tb.height, dragOp.origY + dy)),
              };
            }
            return {
              ...tb,
              width: Math.max(48, Math.min(currentPage.width - tb.x, dragOp.origW + dx)),
              height: Math.max(24, Math.min(currentPage.height - tb.y, dragOp.origH + dy)),
            };
          })
        );
      } else if (dragOp.targetKind === 'stamp') {
        setStamps((prev) =>
          prev.map((s) => {
            if (s.id !== dragOp.targetId) return s;
            if (dragOp.mode === 'move') {
              return {
                ...s,
                x: Math.max(0, Math.min(currentPage.width - s.width, dragOp.origX + dx)),
                y: Math.max(0, Math.min(currentPage.height - s.height, dragOp.origY + dy)),
              };
            }
            return {
              ...s,
              width: Math.max(24, dragOp.origW + dx),
              height: Math.max(24, dragOp.origH + dy),
            };
          })
        );
      } else if (dragOp.targetKind === 'redact') {
        setRedactions((prev) =>
          prev.map((r) => {
            if (r.id !== dragOp.targetId) return r;
            if (dragOp.mode === 'move') {
              return {
                ...r,
                x: Math.max(0, Math.min(currentPage.width - r.width, dragOp.origX + dx)),
                y: Math.max(0, Math.min(currentPage.height - r.height, dragOp.origY + dy)),
              };
            }
            return {
              ...r,
              width: Math.max(20, dragOp.origW + dx),
              height: Math.max(12, dragOp.origH + dy),
            };
          })
        );
      } else if (dragOp.targetKind === 'markup') {
        setMarkups((prev) =>
          prev.map((m) => {
            if (m.id !== dragOp.targetId) return m;
            if (dragOp.mode === 'move') {
              if (m.kind === 'pen' && dragOp.origPoints) {
                return {
                  ...m,
                  x: dragOp.origX + dx,
                  y: dragOp.origY + dy,
                  points: dragOp.origPoints.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
                };
              }
              if ((m.kind === 'line' || m.kind === 'arrow') && dragOp.origX1 !== undefined && dragOp.origY1 !== undefined && dragOp.origX2 !== undefined && dragOp.origY2 !== undefined) {
                return {
                  ...m,
                  x: dragOp.origX + dx,
                  y: dragOp.origY + dy,
                  x1: dragOp.origX1 + dx,
                  y1: dragOp.origY1 + dy,
                  x2: dragOp.origX2 + dx,
                  y2: dragOp.origY2 + dy,
                };
              }
              return {
                ...m,
                x: Math.max(0, Math.min(currentPage.width - m.width, dragOp.origX + dx)),
                y: Math.max(0, Math.min(currentPage.height - m.height, dragOp.origY + dy)),
              };
            }
            return {
              ...m,
              width: Math.max(16, dragOp.origW + dx),
              height: Math.max(12, dragOp.origH + dy),
            };
          })
        );
      }
      return;
    }

    if (!draftShape) return;
    setDraftShape((prev) => {
      if (!prev) return null;
      if (prev.kind === 'pen') {
        const last = prev.points?.[prev.points.length - 1];
        if (last && Math.hypot(x - last.x, y - last.y) < 2) return prev;
        return { ...prev, currX: x, currY: y, points: [...(prev.points || []), { x, y }] };
      }
      return { ...prev, currX: x, currY: y };
    });
  };

  const handleSurfacePointerUp = () => {
    if (dragOp) {
      setDragOp(null);
      return;
    }
    if (!draftShape || !currentPage) return;

    const minX = Math.min(draftShape.startX, draftShape.currX);
    const minY = Math.min(draftShape.startY, draftShape.currY);
    const rawW = Math.abs(draftShape.currX - draftShape.startX);
    const rawH = Math.abs(draftShape.currY - draftShape.startY);
    const isClickOnly = rawW < 8 && rawH < 8;

    pushUndo();

    if (draftShape.kind === 'textbox') {
      const boxW = isClickOnly ? 190 : Math.max(80, rawW);
      const boxH = isClickOnly ? 52 : Math.max(32, rawH);
      const id = `tb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setTextBoxes((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          x: isClickOnly ? Math.min(minX, Math.max(0, currentPage.width - boxW)) : minX,
          y: isClickOnly ? Math.min(minY, Math.max(0, currentPage.height - boxH)) : minY,
          width: boxW,
          height: boxH,
          text: defaultText,
          fontSize: defaultFontSize,
          fontFamily: defaultFontFamily,
          bold: defaultBold,
          textColor: defaultTextColor,
          bgColor: defaultBgColor,
          bgOpacity: defaultBgOpacity,
          borderColor: defaultBorderColor,
          borderWidth: defaultBorderWidth,
          align: defaultAlign,
        },
      ]);
      setSelected({ kind: 'textbox', id });
      setActiveTool('select');
    } else if (draftShape.kind === 'highlight') {
      const w = isClickOnly ? 140 : Math.max(18, rawW);
      const h = isClickOnly ? 18 : Math.max(10, rawH);
      const id = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setMarkups((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          kind: 'highlight',
          x: minX,
          y: isClickOnly ? Math.max(0, minY - h / 2) : minY,
          width: w,
          height: h,
          strokeColor: highlightColor,
          fillColor: highlightColor,
          strokeWidth: 0,
          opacity: markupOpacity,
        },
      ]);
      setSelected({ kind: 'markup', id });
    } else if (draftShape.kind === 'rect' || draftShape.kind === 'ellipse') {
      const w = isClickOnly ? 120 : Math.max(16, rawW);
      const h = isClickOnly ? 64 : Math.max(16, rawH);
      const id = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setMarkups((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          kind: draftShape.kind as 'rect' | 'ellipse',
          x: isClickOnly ? Math.max(0, minX - w / 2) : minX,
          y: isClickOnly ? Math.max(0, minY - h / 2) : minY,
          width: w,
          height: h,
          strokeColor: markupColor,
          fillColor: 'transparent',
          strokeWidth,
          opacity: 0.95,
        },
      ]);
      setSelected({ kind: 'markup', id });
    } else if (draftShape.kind === 'line' || draftShape.kind === 'arrow') {
      const x1 = draftShape.startX;
      const y1 = draftShape.startY;
      const x2 = isClickOnly ? Math.min(currentPage.width, x1 + 100) : draftShape.currX;
      const y2 = isClickOnly ? y1 : draftShape.currY;
      const id = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setMarkups((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          kind: draftShape.kind as 'line' | 'arrow',
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.max(10, Math.abs(x2 - x1)),
          height: Math.max(10, Math.abs(y2 - y1)),
          x1,
          y1,
          x2,
          y2,
          strokeColor: markupColor,
          strokeWidth,
          opacity: 0.95,
        },
      ]);
      setSelected({ kind: 'markup', id });
    } else if (draftShape.kind === 'pen' && draftShape.points && draftShape.points.length >= 2) {
      const xs = draftShape.points.map((p) => p.x);
      const ys = draftShape.points.map((p) => p.y);
      const pxMin = Math.min(...xs);
      const pyMin = Math.min(...ys);
      const id = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setMarkups((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          kind: 'pen',
          x: pxMin,
          y: pyMin,
          width: Math.max(8, Math.max(...xs) - pxMin),
          height: Math.max(8, Math.max(...ys) - pyMin),
          points: draftShape.points,
          strokeColor: markupColor,
          strokeWidth,
          opacity: 0.95,
        },
      ]);
      setSelected({ kind: 'markup', id });
    } else if (draftShape.kind === 'redact') {
      const w = isClickOnly ? 120 : Math.max(20, rawW);
      const h = isClickOnly ? 26 : Math.max(12, rawH);
      const id = `red_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setRedactions((prev) => [
        ...prev,
        {
          id,
          pageIndex: currentPageIndex,
          x: isClickOnly ? Math.max(0, minX - w / 2) : minX,
          y: isClickOnly ? Math.max(0, minY - h / 2) : minY,
          width: w,
          height: h,
          color: '#000000',
        },
      ]);
      setSelected({ kind: 'redact', id });
    }

    setDraftShape(null);
  };

  const startItemDrag = (
    e: React.PointerEvent,
    mode: 'move' | 'resize',
    targetKind: 'textbox' | 'markup' | 'stamp' | 'redact',
    targetId: string,
    orig: { x: number; y: number; w: number; h: number; x1?: number; y1?: number; x2?: number; y2?: number; points?: Array<{ x: number; y: number }> }
  ) => {
    e.stopPropagation();
    setSelected({ kind: targetKind, id: targetId });
    pushUndo();
    const { x, y } = toPageCoords(e.clientX, e.clientY);
    setDragOp({
      mode,
      targetKind,
      targetId,
      startPointerX: x,
      startPointerY: y,
      origX: orig.x,
      origY: orig.y,
      origW: orig.w,
      origH: orig.h,
      origX1: orig.x1,
      origY1: orig.y1,
      origX2: orig.x2,
      origY2: orig.y2,
      origPoints: orig.points,
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    pushUndo();
    if (selected.kind === 'textbox') setTextBoxes((prev) => prev.filter((x) => x.id !== selected.id));
    if (selected.kind === 'markup') setMarkups((prev) => prev.filter((x) => x.id !== selected.id));
    if (selected.kind === 'stamp') setStamps((prev) => prev.filter((x) => x.id !== selected.id));
    if (selected.kind === 'redact') setRedactions((prev) => prev.filter((x) => x.id !== selected.id));
    setSelected(null);
  };

  const clearCurrentPageAnnotations = () => {
    pushUndo();
    setTextBoxes((prev) => prev.filter((x) => x.pageIndex !== currentPageIndex));
    setMarkups((prev) => prev.filter((x) => x.pageIndex !== currentPageIndex));
    setStamps((prev) => prev.filter((x) => x.pageIndex !== currentPageIndex));
    setRedactions((prev) => prev.filter((x) => x.pageIndex !== currentPageIndex));
    setSelected(null);
  };

  const selectedTextBox =
    selected?.kind === 'textbox' ? textBoxes.find((b) => b.id === selected.id) || null : null;

  const updateSelectedTextBox = (patch: Partial<PdfTextBoxAnnotation>) => {
    if (!selectedTextBox) return;
    setTextBoxes((prev) => prev.map((b) => (b.id === selectedTextBox.id ? { ...b, ...patch } : b)));
  };

  const handleExportPdf = async () => {
    if (!pdfFile) return;
    setIsExporting(true);
    const resultName = `${exportFilePrefix}${pdfFile.name}`;
    try {
      const buf = await pdfFile.arrayBuffer();
      const outBytes = await stampPdf(buf, stamps, redactions, textBoxes, markups);
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      await saveProcessedFile(`pdf_annot_${Date.now()}`, pdfFile.name, resultName, blob, 'pdf');

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      if (onResultReady) {
        onResultReady({
          id: `res_annot_${Date.now()}`,
          name: resultName,
          file: new File([blob], resultName, { type: 'application/pdf' }),
          size: blob.size,
          type: 'application/pdf',
          format: 'pdf',
          targetFormat: 'pdf',
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName,
        });
      }
      notifyCompletion(lang === 'ja' ? 'PDF注釈・マークアップ出力完了' : 'Annotated PDF Saved', resultName);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? `「${resultName}」を保存しました` : `Saved "${resultName}"`);
      }
    } catch (err) {
      console.error('Failed to export annotated PDF:', err);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? 'PDFの出力に失敗しました' : 'Failed to export PDF');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const totalCount = textBoxes.length + markups.length + stamps.length + redactions.length;

  const toolButtons: Array<{ id: MarkupToolId; labelJa: string; labelEn: string; icon: React.FC<any> }> = [
    { id: 'select', labelJa: '選択・移動', labelEn: 'Select', icon: MousePointer2 },
    { id: 'textbox', labelJa: 'テキスト枠', labelEn: 'Text Box', icon: Type },
    { id: 'highlight', labelJa: '蛍光マーカー', labelEn: 'Highlight', icon: Highlighter },
    { id: 'pen', labelJa: 'フリーハンド', labelEn: 'Pen', icon: PenTool },
    { id: 'rect', labelJa: '四角枠', labelEn: 'Rect', icon: Square },
    { id: 'ellipse', labelJa: '丸囲み', labelEn: 'Circle', icon: Circle },
    { id: 'arrow', labelJa: '矢印', labelEn: 'Arrow', icon: ArrowUpRight },
    { id: 'line', labelJa: '直線', labelEn: 'Line', icon: Minus },
    { id: 'badge', labelJa: '定型注釈', labelEn: 'Badge', icon: CheckSquare },
    ...(enableStampTool ? [{ id: 'stamp' as const, labelJa: '印鑑・署名', labelEn: 'Stamp', icon: Stamp }] : []),
    { id: 'redact', labelJa: '黒塗り', labelEn: 'Redact', icon: Shield },
  ];

  // Helper to build SVG path string for freehand points
  const pointsToSvgPath = (pts?: Array<{ x: number; y: number }>) => {
    if (!pts || pts.length === 0) return '';
    return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Main Annotation Toolbar */}
      <div className="p-3 bg-slate-100 dark:bg-slate-800/90 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Tool Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            {toolButtons.map((t) => {
              const Icon = t.icon;
              const isActive = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTool(t.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? t.labelJa : t.labelEn}</span>
                </button>
              );
            })}
          </div>

          {/* Undo, Clear, Export */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
              title={lang === 'ja' ? '直前の操作を元に戻す' : 'Undo'}
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? '戻す' : 'Undo'}</span>
            </button>
            <button
              onClick={clearCurrentPageAnnotations}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? '現ページ消去' : 'Clear Page'}</span>
            </button>
            <button
              onClick={handleExportPdf}
              disabled={isExporting}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer whitespace-nowrap"
            >
              {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>
                {lang === 'ja' ? `PDF出力 (${totalCount}件)` : `Export PDF (${totalCount})`}
              </span>
            </button>
          </div>
        </div>

        {/* Contextual Tool Options Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
          {/* Style controls for active markup or highlight */}
          <div className="flex flex-wrap items-center gap-3">
            {activeTool === 'highlight' && (
              <>
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {lang === 'ja' ? 'マーカー色:' : 'Highlight:'}
                </span>
                <div className="flex items-center gap-1.5">
                  {['#fde047', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setHighlightColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-5 h-5 rounded-full border border-slate-300 cursor-pointer ${
                        highlightColor === c ? 'ring-2 ring-blue-600 ring-offset-1' : ''
                      }`}
                    />
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 mb-0">
                  <span>{lang === 'ja' ? '濃さ:' : 'Opacity:'}</span>
                  <input
                    type="range"
                    min="0.15"
                    max="0.7"
                    step="0.05"
                    value={markupOpacity}
                    onChange={(e) => setMarkupOpacity(parseFloat(e.target.value))}
                    className="w-20 accent-blue-600"
                  />
                </label>
              </>
            )}

            {['pen', 'rect', 'ellipse', 'arrow', 'line', 'badge'].includes(activeTool) && (
              <>
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {lang === 'ja' ? '描画色:' : 'Color:'}
                </span>
                <div className="flex items-center gap-1.5">
                  {['#dc2626', '#2563eb', '#16a34a', '#d97706', '#0f172a', '#7c3aed'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setMarkupColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-5 h-5 rounded-full border border-white/50 cursor-pointer ${
                        markupColor === c ? 'ring-2 ring-blue-600 ring-offset-1' : ''
                      }`}
                    />
                  ))}
                </div>
                {activeTool !== 'badge' ? (
                  <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 mb-0">
                    <span>{lang === 'ja' ? '太さ:' : 'Width:'}</span>
                    <select
                      value={strokeWidth}
                      onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    >
                      <option value={1.5}>1.5 pt</option>
                      <option value={2.5}>2.5 pt</option>
                      <option value={4}>4 pt</option>
                      <option value={6}>6 pt</option>
                    </select>
                  </label>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {['✓ 確認済', '重要', '要修正', '承認', '✓'].map((lbl) => (
                      <button
                        key={lbl}
                        onClick={() => setBadgePreset(lbl)}
                        className={`px-2 py-0.5 rounded border text-xs font-bold cursor-pointer ${
                          badgePreset === lbl
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTool === 'textbox' && (
              <span className="text-slate-600 dark:text-slate-300">
                {lang === 'ja'
                  ? 'PDFページ上をクリックまたはドラッグしてテキストボックスを配置してください。'
                  : 'Click or drag on the PDF page to place a text box.'}
              </span>
            )}

            {activeTool === 'select' && (
              <span className="text-slate-600 dark:text-slate-300">
                {selected
                  ? lang === 'ja'
                    ? '選択中: ドラッグで移動、右下の青いハンドルでサイズ変更できます。'
                    : 'Selected: Drag to move or use bottom-right handle to resize.'
                  : lang === 'ja'
                  ? '配置済みのテキスト・マークアップをクリックして移動・リサイズ・編集します。'
                  : 'Click any annotation on the page to move, resize, or edit it.'}
              </span>
            )}

            {activeTool === 'redact' && (
              <span className="text-slate-600 dark:text-slate-300">
                {lang === 'ja'
                  ? '隠したい範囲をドラッグ（またはクリック）して黒塗りマスキングを配置します。'
                  : 'Drag or click over sensitive areas to place blackout redactions.'}
              </span>
            )}
          </div>

          {/* Page Switcher & Zoom Controls */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))))}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 w-11 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                disabled={currentPageIndex === 0}
                onClick={() => setCurrentPageIndex((p) => Math.max(0, p - 1))}
                className="px-2 py-1 rounded bg-white dark:bg-slate-900 disabled:opacity-40 font-bold border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                ‹
              </button>
              <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                {currentPageIndex + 1} / {pdfPages.length}
              </span>
              <button
                disabled={currentPageIndex >= pdfPages.length - 1}
                onClick={() => setCurrentPageIndex((p) => Math.min(pdfPages.length - 1, p + 1))}
                className="px-2 py-1 rounded bg-white dark:bg-slate-900 disabled:opacity-40 font-bold border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* TextBox Inspector Panel (shown when TextBox tool active OR a TextBox is selected) */}
      {(selectedTextBox || activeTool === 'textbox') && (
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800 dark:text-slate-100">
              {selectedTextBox
                ? lang === 'ja'
                  ? '選択中のテキストボックスを編集'
                  : 'Edit Selected Text Box'
                : lang === 'ja'
                ? '新規テキストボックスの初期設定'
                : 'New Text Box Defaults'}
            </span>
            {selectedTextBox && (
              <button
                onClick={deleteSelected}
                className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? 'このテキストボックスを削除' : 'Delete Text Box'}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
            <div className="md:col-span-5">
              <label className="text-[11px] text-slate-500 mb-1 block">
                {lang === 'ja' ? 'テキスト内容（日本語・改行対応）' : 'Text Content (Multiline)'}
              </label>
              <textarea
                rows={2}
                value={selectedTextBox ? selectedTextBox.text : defaultText}
                onChange={(e) => {
                  const val = e.target.value;
                  if (selectedTextBox) updateSelectedTextBox({ text: val });
                  else setDefaultText(val);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-7 flex flex-wrap items-end gap-2.5">
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? '書体' : 'Font'}</label>
                <select
                  value={selectedTextBox ? selectedTextBox.fontFamily : defaultFontFamily}
                  onChange={(e) => {
                    const val = e.target.value as 'sans' | 'serif' | 'mono';
                    if (selectedTextBox) updateSelectedTextBox({ fontFamily: val });
                    else setDefaultFontFamily(val);
                  }}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value="sans">{lang === 'ja' ? 'ゴシック' : 'Sans'}</option>
                  <option value="serif">{lang === 'ja' ? '明朝体' : 'Serif'}</option>
                  <option value="mono">{lang === 'ja' ? '等幅' : 'Mono'}</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? 'サイズ' : 'Size'}</label>
                <input
                  type="number"
                  min={8}
                  max={64}
                  value={selectedTextBox ? selectedTextBox.fontSize : defaultFontSize}
                  onChange={(e) => {
                    const val = Math.max(8, Math.min(64, parseInt(e.target.value, 10) || 14));
                    if (selectedTextBox) updateSelectedTextBox({ fontSize: val });
                    else setDefaultFontSize(val);
                  }}
                  className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? '文字色' : 'Text'}</label>
                <input
                  type="color"
                  value={selectedTextBox ? selectedTextBox.textColor : defaultTextColor}
                  onChange={(e) => {
                    if (selectedTextBox) updateSelectedTextBox({ textColor: e.target.value });
                    else setDefaultTextColor(e.target.value);
                  }}
                  className="w-8 h-8 rounded border border-slate-200 dark:border-slate-700 bg-white cursor-pointer"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? '背景色' : 'Bg'}</label>
                <select
                  value={
                    (selectedTextBox ? selectedTextBox.bgOpacity : defaultBgOpacity) === 0
                      ? 'transparent'
                      : selectedTextBox
                      ? selectedTextBox.bgColor
                      : defaultBgColor
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'transparent') {
                      if (selectedTextBox) updateSelectedTextBox({ bgOpacity: 0 });
                      else setDefaultBgOpacity(0);
                    } else {
                      if (selectedTextBox) updateSelectedTextBox({ bgColor: v, bgOpacity: 0.92 });
                      else {
                        setDefaultBgColor(v);
                        setDefaultBgOpacity(0.92);
                      }
                    }
                  }}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value="transparent">{lang === 'ja' ? '透明' : 'Transparent'}</option>
                  <option value="#ffffff">{lang === 'ja' ? '白' : 'White'}</option>
                  <option value="#fef9c3">{lang === 'ja' ? '淡黄色(付箋)' : 'Yellow Note'}</option>
                  <option value="#eff6ff">{lang === 'ja' ? '淡青色' : 'Light Blue'}</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">{lang === 'ja' ? '枠線' : 'Border'}</label>
                <select
                  value={selectedTextBox ? selectedTextBox.borderWidth : defaultBorderWidth}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (selectedTextBox) updateSelectedTextBox({ borderWidth: val });
                    else setDefaultBorderWidth(val);
                  }}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value={0}>{lang === 'ja' ? 'なし' : 'None'}</option>
                  <option value={1}>1 pt</option>
                  <option value={2}>2 pt</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const next = !(selectedTextBox ? selectedTextBox.bold : defaultBold);
                    if (selectedTextBox) updateSelectedTextBox({ bold: next });
                    else setDefaultBold(next);
                  }}
                  className={`p-1.5 rounded border cursor-pointer ${
                    (selectedTextBox ? selectedTextBox.bold : defaultBold)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                  title="Bold"
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                {(['left', 'center', 'right'] as const).map((al) => {
                  const AlIcon = al === 'left' ? AlignLeft : al === 'center' ? AlignCenter : AlignRight;
                  const active = (selectedTextBox ? selectedTextBox.align : defaultAlign) === al;
                  return (
                    <button
                      key={al}
                      onClick={() => {
                        if (selectedTextBox) updateSelectedTextBox({ align: al });
                        else setDefaultAlign(al);
                      }}
                      className={`p-1.5 rounded border cursor-pointer ${
                        active
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <AlIcon className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selected non-textbox deletion bar */}
      {selected && selected.kind !== 'textbox' && (
        <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between text-xs">
          <span className="text-slate-600 dark:text-slate-300">
            {lang === 'ja' ? '選択中の注釈アイテムをドラッグして位置調整できます。' : 'Drag the selected annotation to reposition.'}
          </span>
          <button
            onClick={deleteSelected}
            className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{lang === 'ja' ? '選択アイテムを削除' : 'Delete Selected'}</span>
          </button>
        </div>
      )}

      {/* Interactive PDF Page Viewport */}
      <div className="flex justify-center p-4 bg-slate-200 dark:bg-slate-950 rounded-2xl overflow-auto min-h-[480px]">
        {currentPage && (
          <div
            ref={canvasWrapRef}
            onPointerDown={handleSurfacePointerDown}
            onPointerMove={handleSurfacePointerMove}
            onPointerUp={handleSurfacePointerUp}
            className={`relative bg-white shadow-2xl rounded select-none touch-none ${
              activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
            }`}
            style={{
              width: `${currentPage.width * zoom}px`,
              height: `${currentPage.height * zoom}px`,
              minWidth: `${currentPage.width * zoom}px`,
              minHeight: `${currentPage.height * zoom}px`,
            }}
          >
            <img
              src={currentPage.thumbnailUrl}
              alt={`PDF Page ${currentPageIndex + 1}`}
              className="w-full h-full object-contain pointer-events-none"
              draggable={false}
            />

            {/* Vector SVG Overlay for Pen, Line, Arrow, Rect, Ellipse, Highlight, and Live Draft */}
            <svg
              viewBox={`0 0 ${currentPage.width} ${currentPage.height}`}
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              <defs>
                {markups
                  .filter((m) => m.pageIndex === currentPageIndex && m.kind === 'arrow')
                  .map((m) => (
                    <marker
                      key={`arr_${m.id}`}
                      id={`arrow_${m.id}`}
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill={m.strokeColor} />
                    </marker>
                  ))}
              </defs>

              {markups
                .filter((m) => m.pageIndex === currentPageIndex)
                .map((m) => {
                  const isSel = selected?.kind === 'markup' && selected.id === m.id;
                  if (m.kind === 'highlight') {
                    return (
                      <rect
                        key={m.id}
                        x={m.x}
                        y={m.y}
                        width={m.width}
                        height={m.height}
                        fill={m.fillColor || m.strokeColor}
                        fillOpacity={m.opacity}
                        stroke={isSel ? '#2563eb' : 'none'}
                        strokeWidth={isSel ? 1.5 : 0}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={(e) =>
                          startItemDrag(e, 'move', 'markup', m.id, { x: m.x, y: m.y, w: m.width, h: m.height })
                        }
                      />
                    );
                  }
                  if (m.kind === 'rect') {
                    return (
                      <rect
                        key={m.id}
                        x={m.x}
                        y={m.y}
                        width={m.width}
                        height={m.height}
                        fill="none"
                        stroke={m.strokeColor}
                        strokeWidth={m.strokeWidth}
                        strokeOpacity={m.opacity}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={(e) =>
                          startItemDrag(e, 'move', 'markup', m.id, { x: m.x, y: m.y, w: m.width, h: m.height })
                        }
                      />
                    );
                  }
                  if (m.kind === 'ellipse') {
                    return (
                      <ellipse
                        key={m.id}
                        cx={m.x + m.width / 2}
                        cy={m.y + m.height / 2}
                        rx={m.width / 2}
                        ry={m.height / 2}
                        fill="none"
                        stroke={m.strokeColor}
                        strokeWidth={m.strokeWidth}
                        strokeOpacity={m.opacity}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={(e) =>
                          startItemDrag(e, 'move', 'markup', m.id, { x: m.x, y: m.y, w: m.width, h: m.height })
                        }
                      />
                    );
                  }
                  if (m.kind === 'line' || m.kind === 'arrow') {
                    return (
                      <line
                        key={m.id}
                        x1={m.x1 ?? m.x}
                        y1={m.y1 ?? m.y}
                        x2={m.x2 ?? m.x + m.width}
                        y2={m.y2 ?? m.y + m.height}
                        stroke={m.strokeColor}
                        strokeWidth={m.strokeWidth}
                        strokeOpacity={m.opacity}
                        strokeLinecap="round"
                        markerEnd={m.kind === 'arrow' ? `url(#arrow_${m.id})` : undefined}
                        className="pointer-events-auto cursor-move"
                        onPointerDown={(e) =>
                          startItemDrag(e, 'move', 'markup', m.id, {
                            x: m.x,
                            y: m.y,
                            w: m.width,
                            h: m.height,
                            x1: m.x1,
                            y1: m.y1,
                            x2: m.x2,
                            y2: m.y2,
                          })
                        }
                      />
                    );
                  }
                  if (m.kind === 'pen') {
                    return (
                      <path
                        key={m.id}
                        d={pointsToSvgPath(m.points)}
                        fill="none"
                        stroke={m.strokeColor}
                        strokeWidth={m.strokeWidth}
                        strokeOpacity={m.opacity}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="pointer-events-auto cursor-move"
                        onPointerDown={(e) =>
                          startItemDrag(e, 'move', 'markup', m.id, {
                            x: m.x,
                            y: m.y,
                            w: m.width,
                            h: m.height,
                            points: m.points,
                          })
                        }
                      />
                    );
                  }
                  return null;
                })}

              {/* Live Draft Preview */}
              {draftShape && (
                <>
                  {draftShape.kind === 'pen' && draftShape.points && (
                    <path
                      d={pointsToSvgPath(draftShape.points)}
                      fill="none"
                      stroke={markupColor}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {(draftShape.kind === 'line' || draftShape.kind === 'arrow') && (
                    <line
                      x1={draftShape.startX}
                      y1={draftShape.startY}
                      x2={draftShape.currX}
                      y2={draftShape.currY}
                      stroke={markupColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray="4 3"
                    />
                  )}
                  {draftShape.kind === 'ellipse' && (
                    <ellipse
                      cx={(draftShape.startX + draftShape.currX) / 2}
                      cy={(draftShape.startY + draftShape.currY) / 2}
                      rx={Math.abs(draftShape.currX - draftShape.startX) / 2}
                      ry={Math.abs(draftShape.currY - draftShape.startY) / 2}
                      fill="none"
                      stroke={markupColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray="4 3"
                    />
                  )}
                  {['rect', 'highlight', 'textbox', 'redact'].includes(draftShape.kind) && (
                    <rect
                      x={Math.min(draftShape.startX, draftShape.currX)}
                      y={Math.min(draftShape.startY, draftShape.currY)}
                      width={Math.abs(draftShape.currX - draftShape.startX)}
                      height={Math.abs(draftShape.currY - draftShape.startY)}
                      fill={
                        draftShape.kind === 'highlight'
                          ? highlightColor
                          : draftShape.kind === 'redact'
                          ? '#000000'
                          : 'rgba(37, 99, 235, 0.08)'
                      }
                      fillOpacity={draftShape.kind === 'highlight' ? markupOpacity : draftShape.kind === 'redact' ? 0.7 : 1}
                      stroke={draftShape.kind === 'rect' ? markupColor : '#2563eb'}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}
                </>
              )}
            </svg>

            {/* Markup Badges (HTML boxes for crisp resize & drag) */}
            {markups
              .filter((m) => m.pageIndex === currentPageIndex && m.kind === 'badge')
              .map((m) => {
                const isSel = selected?.kind === 'markup' && selected.id === m.id;
                return (
                  <div
                    key={m.id}
                    onPointerDown={(e) =>
                      startItemDrag(e, 'move', 'markup', m.id, { x: m.x, y: m.y, w: m.width, h: m.height })
                    }
                    style={{
                      left: `${(m.x / currentPage.width) * 100}%`,
                      top: `${(m.y / currentPage.height) * 100}%`,
                      width: `${(m.width / currentPage.width) * 100}%`,
                      height: `${(m.height / currentPage.height) * 100}%`,
                      borderColor: m.strokeColor,
                      color: m.strokeColor,
                      backgroundColor: m.fillColor || '#ffffff',
                    }}
                    className={`absolute border-2 rounded-lg flex items-center justify-center font-bold text-xs cursor-move select-none ${
                      isSel ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                    }`}
                  >
                    <span className="truncate px-1">{m.label}</span>
                  </div>
                );
              })}

            {/* Text Boxes */}
            {textBoxes
              .filter((tb) => tb.pageIndex === currentPageIndex)
              .map((tb) => {
                const isSel = selected?.kind === 'textbox' && selected.id === tb.id;
                const fontClass =
                  tb.fontFamily === 'serif'
                    ? 'font-serif'
                    : tb.fontFamily === 'mono'
                    ? 'font-mono'
                    : 'font-sans';
                return (
                  <div
                    key={tb.id}
                    onPointerDown={(e) =>
                      startItemDrag(e, 'move', 'textbox', tb.id, { x: tb.x, y: tb.y, w: tb.width, h: tb.height })
                    }
                    style={{
                      left: `${(tb.x / currentPage.width) * 100}%`,
                      top: `${(tb.y / currentPage.height) * 100}%`,
                      width: `${(tb.width / currentPage.width) * 100}%`,
                      height: `${(tb.height / currentPage.height) * 100}%`,
                      fontSize: `${tb.fontSize * zoom}px`,
                      fontWeight: tb.bold ? 700 : 500,
                      color: tb.textColor,
                      backgroundColor: tb.bgOpacity > 0 ? tb.bgColor : 'transparent',
                      opacity: 1,
                      borderColor: tb.borderWidth > 0 ? tb.borderColor : isSel ? '#2563eb' : 'transparent',
                      borderWidth: `${Math.max(tb.borderWidth * zoom, isSel ? 1.5 : 0)}px`,
                      borderStyle: 'solid',
                      textAlign: tb.align,
                    }}
                    className={`absolute overflow-hidden cursor-move p-1 leading-snug whitespace-pre-wrap break-words ${fontClass} ${
                      isSel ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-1 hover:ring-blue-400/60'
                    }`}
                  >
                    {tb.text}

                    {isSel && (
                      <>
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSelected();
                          }}
                          className="absolute -top-2.5 -right-2.5 bg-rose-600 text-white rounded-full p-0.5 shadow cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <div
                          onPointerDown={(e) =>
                            startItemDrag(e, 'resize', 'textbox', tb.id, {
                              x: tb.x,
                              y: tb.y,
                              w: tb.width,
                              h: tb.height,
                            })
                          }
                          className="absolute bottom-0 right-0 w-3 h-3 bg-blue-600 cursor-nwse-resize"
                        />
                      </>
                    )}
                  </div>
                );
              })}

            {/* Stamps */}
            {stamps
              .filter((s) => s.pageIndex === currentPageIndex)
              .map((s) => {
                const isSel = selected?.kind === 'stamp' && selected.id === s.id;
                return (
                  <div
                    key={s.id}
                    onPointerDown={(e) =>
                      startItemDrag(e, 'move', 'stamp', s.id, { x: s.x, y: s.y, w: s.width, h: s.height })
                    }
                    style={{
                      left: `${(s.x / currentPage.width) * 100}%`,
                      top: `${(s.y / currentPage.height) * 100}%`,
                      width: `${(s.width / currentPage.width) * 100}%`,
                      height: `${(s.height / currentPage.height) * 100}%`,
                    }}
                    className={`absolute cursor-move group ${
                      isSel ? 'ring-2 ring-blue-500' : 'border border-blue-400/40'
                    }`}
                  >
                    <img src={s.imageUrl} alt="stamp" className="w-full h-full object-contain pointer-events-none" />
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        pushUndo();
                        setStamps((prev) => prev.filter((item) => item.id !== s.id));
                        setSelected(null);
                      }}
                      className="absolute -top-2 -right-2 bg-rose-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    {isSel && (
                      <div
                        onPointerDown={(e) =>
                          startItemDrag(e, 'resize', 'stamp', s.id, { x: s.x, y: s.y, w: s.width, h: s.height })
                        }
                        className="absolute bottom-0 right-0 w-3 h-3 bg-blue-600 cursor-nwse-resize"
                      />
                    )}
                  </div>
                );
              })}

            {/* Redactions */}
            {redactions
              .filter((r) => r.pageIndex === currentPageIndex)
              .map((r) => {
                const isSel = selected?.kind === 'redact' && selected.id === r.id;
                return (
                  <div
                    key={r.id}
                    onPointerDown={(e) =>
                      startItemDrag(e, 'move', 'redact', r.id, { x: r.x, y: r.y, w: r.width, h: r.height })
                    }
                    style={{
                      left: `${(r.x / currentPage.width) * 100}%`,
                      top: `${(r.y / currentPage.height) * 100}%`,
                      width: `${(r.width / currentPage.width) * 100}%`,
                      height: `${(r.height / currentPage.height) * 100}%`,
                    }}
                    className={`absolute bg-black cursor-move group ${isSel ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        pushUndo();
                        setRedactions((prev) => prev.filter((item) => item.id !== r.id));
                        setSelected(null);
                      }}
                      className="absolute -top-2 -right-2 bg-rose-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    {isSel && (
                      <div
                        onPointerDown={(e) =>
                          startItemDrag(e, 'resize', 'redact', r.id, { x: r.x, y: r.y, w: r.width, h: r.height })
                        }
                        className="absolute bottom-0 right-0 w-3 h-3 bg-blue-600 cursor-nwse-resize"
                      />
                    )}
                  </div>
                );
              })}

            {/* Resize handle for box-shaped markups (highlight, rect, ellipse, badge) */}
            {selected?.kind === 'markup' &&
              (() => {
                const m = markups.find((x) => x.id === selected.id && x.pageIndex === currentPageIndex);
                if (!m || !['highlight', 'rect', 'ellipse', 'badge'].includes(m.kind)) return null;
                return (
                  <div
                    onPointerDown={(e) =>
                      startItemDrag(e, 'resize', 'markup', m.id, { x: m.x, y: m.y, w: m.width, h: m.height })
                    }
                    style={{
                      left: `${((m.x + m.width) / currentPage.width) * 100}%`,
                      top: `${((m.y + m.height) / currentPage.height) * 100}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    className="absolute w-3.5 h-3.5 bg-blue-600 border border-white rounded-xs cursor-nwse-resize shadow"
                  />
                );
              })()}
          </div>
        )}
      </div>
    </div>
  );
};
