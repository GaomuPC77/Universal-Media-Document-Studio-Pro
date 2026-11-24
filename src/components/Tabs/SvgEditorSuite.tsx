import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MousePointer2,
  Square,
  Circle,
  Minus,
  PenTool,
  Type,
  Layers,
  Sliders,
  Code,
  Eye,
  Columns,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Copy,
  Check,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Upload,
  FolderOpen,
  EyeOff,
  Minimize2,
  AlignLeft,
  Plus,
  CopyPlus,
  Palette,
  Waypoints,
} from 'lucide-react';
import { FileItem, DocumentFormat } from '../../types';
import { saveProcessedFile } from '../../utils/historyDb';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';
import {
  SVG_TEMPLATES,
  SvgDocumentInfo,
  SvgElementInfo,
  SvgVertexHandle,
  parseSvgSafe,
  inspectSvgDocument,
  buildRenderableSvgWithIds,
  updateSvgCanvasConfig,
  updateSvgElementProps,
  moveSvgElement,
  addSvgShape,
  reorderSvgElement,
  duplicateSvgElement,
  deleteSvgElement,
  replaceSvgColor,
  transformEntireSvg,
  formatSvgMarkup,
  minifySvgMarkup,
  exportSvgToRasterBlob,
  normalizeColorToHex,
  getSvgElementVertices,
  moveSvgElementVertex,
  insertSvgElementVertex,
  deleteSvgElementVertex,
} from '../../utils/svgUtils';

interface SvgEditorSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

type SvgTool = 'select' | 'nodes' | 'rect' | 'ellipse' | 'line' | 'path' | 'text';
type SvgViewMode = 'visual' | 'split' | 'code';
type InspectorTab = 'props' | 'layers' | 'canvas';
type SvgExportFormat = 'svg' | 'png' | 'jpg' | 'webp';

interface ProjectedVertexHandle extends SvgVertexHandle {
  leftPct: number;
  topPct: number;
  anchorLeftPct?: number;
  anchorTopPct?: number;
}

const MAX_HISTORY = 50;

export const SvgEditorSuite: React.FC<SvgEditorSuiteProps> = ({
  lang,
  sharedFile,
  fileList = [],
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [svgCode, setSvgCode] = useState<string>(SVG_TEMPLATES[0].svg);
  const [codeDraft, setCodeDraft] = useState<string>(SVG_TEMPLATES[0].svg);
  const [fileName, setFileName] = useState<string>('artwork.svg');
  const [selectedQueueId, setSelectedQueueId] = useState<string>('');
  const [pendingPromptFile, setPendingPromptFile] = useState<File | null>(null);

  const [history, setHistory] = useState<string[]>([SVG_TEMPLATES[0].svg]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  const [activeTool, setActiveTool] = useState<SvgTool>('select');
  const [viewMode, setViewMode] = useState<SvgViewMode>('split');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('props');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [bgMode, setBgMode] = useState<'checkerboard' | 'white' | 'dark'>('checkerboard');
  const [zoom, setZoom] = useState<number>(1);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Default drawing styles
  const [drawFill, setDrawFill] = useState<string>('#3b82f6');
  const [drawFillNone, setDrawFillNone] = useState<boolean>(false);
  const [drawStroke, setDrawStroke] = useState<string>('#1e293b');
  const [drawStrokeNone, setDrawStrokeNone] = useState<boolean>(false);
  const [drawStrokeWidth, setDrawStrokeWidth] = useState<number>(3);
  const [drawRectRx, setDrawRectRx] = useState<number>(8);
  const [newTextValue, setNewTextValue] = useState<string>(lang === 'ja' ? 'テキスト' : 'Label');
  const [newTextSize, setNewTextSize] = useState<number>(32);

  // Export configuration
  const [exportFormat, setExportFormat] = useState<SvgExportFormat>('svg');
  const [rasterScale, setRasterScale] = useState<number>(2);

  // ViewBox form inputs (synced on document change)
  const [vbX, setVbX] = useState<string>('0');
  const [vbY, setVbY] = useState<string>('0');
  const [vbW, setVbW] = useState<string>('512');
  const [vbH, setVbH] = useState<string>('512');
  const [attrW, setAttrW] = useState<string>('512');
  const [attrH, setAttrH] = useState<string>('512');

  // Selection box rect in percentage (0..100) over artboard
  const [selectionBoxPct, setSelectionBoxPct] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [projectedVertices, setProjectedVertices] = useState<ProjectedVertexHandle[]>([]);
  const [activeVertexIdx, setActiveVertexIdx] = useState<number | null>(null);

  // Interactive drawing / dragging draft state
  const [dragOffsetPx, setDragOffsetPx] = useState<{ x: number; y: number } | null>(null);
  const [shapeDraft, setShapeDraft] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    points?: Array<{ x: number; y: number }>;
  } | null>(null);

  const dragStateRef = useRef<{
    mode: 'move' | 'draw';
    startClientX: number;
    startClientY: number;
    startSvgX: number;
    startSvgY: number;
    path?: string;
    points?: Array<{ x: number; y: number }>;
  } | null>(null);

  const vertexDragRef = useRef<{
    path: string;
    vertexIndex: number;
    startSvgCode: string;
    ctmInverse: DOMMatrix | null;
    moved: boolean;
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const artboardBoxRef = useRef<HTMLDivElement>(null);
  const loadedSharedRef = useRef<File | null>(null);
  const svgCodeRef = useRef<string>(svgCode);
  svgCodeRef.current = svgCode;

  const docInfo: SvgDocumentInfo = useMemo(() => inspectSvgDocument(svgCode), [svgCode]);

  const selectedElement: SvgElementInfo | null = useMemo(() => {
    if (!selectedPath) return null;
    return docInfo.elements.find((el) => el.path === selectedPath) || null;
  }, [docInfo.elements, selectedPath]);

  const elementVertices: SvgVertexHandle[] = useMemo(() => {
    if (!selectedPath || !docInfo.valid) return [];
    return getSvgElementVertices(svgCode, selectedPath);
  }, [svgCode, selectedPath, docInfo.valid]);

  // Sync ViewBox form fields when docInfo updates
  useEffect(() => {
    if (docInfo.valid) {
      setVbX(String(docInfo.viewBox.x));
      setVbY(String(docInfo.viewBox.y));
      setVbW(String(docInfo.viewBox.w));
      setVbH(String(docInfo.viewBox.h));
      setAttrW(docInfo.widthAttr);
      setAttrH(docInfo.heightAttr);
    }
  }, [docInfo.valid, docInfo.viewBox.x, docInfo.viewBox.y, docInfo.viewBox.w, docInfo.viewBox.h, docInfo.widthAttr, docInfo.heightAttr]);

  // Available SVG items from global queue
  const availableSvgItems = useMemo(() => {
    return fileList.filter((f) => {
      const ext = f.format?.toLowerCase();
      const isSvgName = /\.svg$/i.test(f.name);
      const isSvgMime = f.type === 'image/svg+xml';
      const hasSvgResult = f.resultBlob && f.resultName && /\.svg$/i.test(f.resultName);
      return ext === 'svg' || isSvgName || isSvgMime || hasSvgResult;
    });
  }, [fileList]);

  const commitSvgChange = useCallback(
    (nextSvg: string, nextSelectedPath?: string | null) => {
      setSvgCode(nextSvg);
      setCodeDraft(nextSvg);
      if (nextSelectedPath !== undefined) {
        setSelectedPath(nextSelectedPath);
      }
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        const updated = [...sliced, nextSvg];
        if (updated.length > MAX_HISTORY) {
          updated.shift();
          return updated;
        }
        return updated;
      });
      setHistoryIndex((prev) => Math.min(MAX_HISTORY - 1, prev + 1));
    },
    [historyIndex]
  );

  const loadSvgFile = useCallback(async (file: File) => {
    try {
      const raw = await file.text();
      const parsed = parseSvgSafe(raw);
      if ('error' in parsed) {
        if (onShowToast) {
          onShowToast(
            lang === 'ja'
              ? `SVGの読み込みエラー: ${parsed.error}`
              : `SVG parse error: ${parsed.error}`
          );
        }
        return;
      }
      const formatted = formatSvgMarkup(raw);
      setFileName(file.name.endsWith('.svg') ? file.name : `${file.name}.svg`);
      setSvgCode(formatted);
      setCodeDraft(formatted);
      setHistory([formatted]);
      setHistoryIndex(0);
      setSelectedPath(null);
      setZoom(1);
    } catch (err: any) {
      console.error('Failed to read SVG file:', err);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? 'SVGファイルの読み込みに失敗しました' : 'Failed to load SVG file');
      }
    }
  }, [lang, onShowToast]);

  // Auto-load shared SVG file when dropped or selected globally
  useEffect(() => {
    if (
      sharedFile &&
      sharedFile !== loadedSharedRef.current &&
      (sharedFile.type === 'image/svg+xml' || /\.svg$/i.test(sharedFile.name))
    ) {
      loadedSharedRef.current = sharedFile;
      loadSvgFile(sharedFile);
    } else if (availableSvgItems.length > 0 && !loadedSharedRef.current && svgCode === SVG_TEMPLATES[0].svg && history.length === 1) {
      const first = availableSvgItems[0];
      const targetFile =
        first.resultBlob && first.resultName && /\.svg$/i.test(first.resultName)
          ? new File([first.resultBlob], first.resultName, { type: 'image/svg+xml' })
          : first.file;
      if (targetFile) {
        setSelectedQueueId(first.id);
        loadedSharedRef.current = targetFile;
        loadSvgFile(targetFile);
      }
    }
  }, [sharedFile, availableSvgItems, loadSvgFile, svgCode, history.length]);

  // Safely mount parsed SVG DOM into host without dangerouslySetInnerHTML
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const renderable = buildRenderableSvgWithIds(svgCode);
    if (!renderable) {
      host.replaceChildren();
      return;
    }
    const parsed = parseSvgSafe(renderable);
    if ('error' in parsed) {
      host.replaceChildren();
      return;
    }
    const imported = document.importNode(parsed.svgEl, true);
    host.replaceChildren(imported);
  }, [svgCode, viewMode]);

  // Update selection bounding box overlay + projected vertex handles
  const refreshSelectionOverlay = useCallback(() => {
    if (!selectedPath || !svgHostRef.current || !artboardBoxRef.current) {
      setSelectionBoxPct(null);
      setProjectedVertices([]);
      return;
    }
    const targetEl = svgHostRef.current.querySelector<SVGGraphicsElement>(
      `[data-edit-path="${CSS.escape(selectedPath)}"]`
    );
    if (!targetEl) {
      setSelectionBoxPct(null);
      setProjectedVertices([]);
      return;
    }
    const hostRect = artboardBoxRef.current.getBoundingClientRect();
    const elRect = targetEl.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) {
      setSelectionBoxPct(null);
      setProjectedVertices([]);
      return;
    }
    setSelectionBoxPct({
      left: ((elRect.left - hostRect.left) / hostRect.width) * 100,
      top: ((elRect.top - hostRect.top) / hostRect.height) * 100,
      width: Math.max(1, (elRect.width / hostRect.width) * 100),
      height: Math.max(1, (elRect.height / hostRect.height) * 100),
    });

    if (activeTool === 'nodes' && elementVertices.length > 0) {
      let ctm: DOMMatrix | null = null;
      try {
        ctm = targetEl.getScreenCTM();
      } catch {
        ctm = null;
      }
      const vb = docInfo.viewBox;
      const mapPt = (lx: number, ly: number) => {
        if (ctm) {
          const sp = new DOMPoint(lx, ly).matrixTransform(ctm);
          return {
            leftPct: ((sp.x - hostRect.left) / hostRect.width) * 100,
            topPct: ((sp.y - hostRect.top) / hostRect.height) * 100,
          };
        }
        return {
          leftPct: ((lx - vb.x) / vb.w) * 100,
          topPct: ((ly - vb.y) / vb.h) * 100,
        };
      };

      setProjectedVertices(
        elementVertices.map((v) => {
          const pos = mapPt(v.x, v.y);
          const anchorPos =
            v.anchorX !== undefined && v.anchorY !== undefined ? mapPt(v.anchorX, v.anchorY) : undefined;
          return {
            ...v,
            leftPct: pos.leftPct,
            topPct: pos.topPct,
            anchorLeftPct: anchorPos?.leftPct,
            anchorTopPct: anchorPos?.topPct,
          };
        })
      );
    } else {
      setProjectedVertices([]);
    }
  }, [selectedPath, activeTool, elementVertices, docInfo.viewBox]);

  useEffect(() => {
    const raf = requestAnimationFrame(refreshSelectionOverlay);
    window.addEventListener('resize', refreshSelectionOverlay);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', refreshSelectionOverlay);
    };
  }, [refreshSelectionOverlay, svgCode, zoom, viewMode, activeTool]);

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIdx = historyIndex - 1;
    const prevSvg = history[nextIdx];
    setHistoryIndex(nextIdx);
    setSvgCode(prevSvg);
    setCodeDraft(prevSvg);
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIdx = historyIndex + 1;
    const nextSvg = history[nextIdx];
    setHistoryIndex(nextIdx);
    setSvgCode(nextSvg);
    setCodeDraft(nextSvg);
  }, [history, historyIndex]);

  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  // Keyboard Undo/Redo shortcuts (Ctrl+Z / Ctrl+Y / Cmd+Shift+Z) scoped to visible editor
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable)
      ) {
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedoRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Client pointer to SVG viewBox coordinate mapping
  const clientToSvgPoint = useCallback(
    (clientX: number, clientY: number) => {
      const box = artboardBoxRef.current;
      const vb = docInfo.viewBox;
      if (!box) return { x: 0, y: 0 };
      const rect = box.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
      const x = vb.x + ((clientX - rect.left) / rect.width) * vb.w;
      const y = vb.y + ((clientY - rect.top) / rect.height) * vb.h;
      return { x, y };
    },
    [docInfo.viewBox]
  );

  // Start dragging an individual vertex handle
  const handleVertexMouseDown = (e: React.MouseEvent<HTMLButtonElement>, vertexIndex: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selectedPath || !svgHostRef.current) return;
    const targetEl = svgHostRef.current.querySelector<SVGGraphicsElement>(
      `[data-edit-path="${CSS.escape(selectedPath)}"]`
    );
    let ctmInverse: DOMMatrix | null = null;
    if (targetEl) {
      try {
        const ctm = targetEl.getScreenCTM();
        if (ctm) ctmInverse = ctm.inverse();
      } catch {
        ctmInverse = null;
      }
    }
    setActiveVertexIdx(vertexIndex);
    vertexDragRef.current = {
      path: selectedPath,
      vertexIndex,
      startSvgCode: svgCodeRef.current,
      ctmInverse,
      moved: false,
    };

    const onWindowMouseMove = (ev: MouseEvent) => {
      const drag = vertexDragRef.current;
      if (!drag) return;
      let localPt: { x: number; y: number };
      if (drag.ctmInverse) {
        const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(drag.ctmInverse);
        localPt = { x: p.x, y: p.y };
      } else {
        localPt = clientToSvgPoint(ev.clientX, ev.clientY);
      }
      const nextSvg = moveSvgElementVertex(
        svgCodeRef.current,
        drag.path,
        drag.vertexIndex,
        localPt.x,
        localPt.y
      );
      drag.moved = true;
      setSvgCode(nextSvg);
      setCodeDraft(nextSvg);
    };

    const onWindowMouseUp = () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      const drag = vertexDragRef.current;
      vertexDragRef.current = null;
      if (drag && drag.moved && svgCodeRef.current !== drag.startSvgCode) {
        commitSvgChange(svgCodeRef.current, drag.path);
      }
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
  };

  const hitTestSvgElement = (clientX: number, clientY: number): string | null => {
    const host = svgHostRef.current;
    if (!host) return null;
    const elementsAtPoint = document.elementsFromPoint(clientX, clientY);
    for (const el of elementsAtPoint) {
      if (!host.contains(el)) continue;
      const hit = el.closest('[data-edit-path]');
      if (hit && host.contains(hit)) {
        const path = hit.getAttribute('data-edit-path');
        if (path) return path;
      }
    }
    return null;
  };

  const handleArtboardDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!docInfo.valid) return;
    const hitPath = hitTestSvgElement(e.clientX, e.clientY);
    if (hitPath) {
      setSelectedPath(hitPath);
      setActiveVertexIdx(null);
      setActiveTool('nodes');
      setInspectorTab('props');
    }
  };

  const handleArtboardPointerDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!docInfo.valid || e.button !== 0) return;
    const svgPt = clientToSvgPoint(e.clientX, e.clientY);

    if (activeTool === 'nodes') {
      const hitPath = hitTestSvgElement(e.clientX, e.clientY);
      setSelectedPath(hitPath);
      setActiveVertexIdx(null);
      if (hitPath) {
        setInspectorTab('props');
      }
      return;
    }

    if (activeTool === 'select') {
      const hitPath = hitTestSvgElement(e.clientX, e.clientY);
      setSelectedPath(hitPath);
      setActiveVertexIdx(null);
      if (hitPath) {
        setInspectorTab('props');
        dragStateRef.current = {
          mode: 'move',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startSvgX: svgPt.x,
          startSvgY: svgPt.y,
          path: hitPath,
        };
        setDragOffsetPx({ x: 0, y: 0 });
      }
      return;
    }

    if (activeTool === 'text') {
      const content = newTextValue.trim() || (lang === 'ja' ? 'テキスト' : 'Text');
      const fill = drawFillNone ? '#0f172a' : drawFill;
      const { svg, path } = addSvgShape(svgCode, {
        kind: 'text',
        x: svgPt.x,
        y: svgPt.y,
        text: content,
        fontSize: newTextSize,
        fill,
      });
      commitSvgChange(svg, path);
      setActiveTool('select');
      setInspectorTab('props');
      return;
    }

    // Start shape/path drawing
    const pts = activeTool === 'path' ? [svgPt] : undefined;
    dragStateRef.current = {
      mode: 'draw',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startSvgX: svgPt.x,
      startSvgY: svgPt.y,
      points: pts,
    };
    setShapeDraft({
      x1: svgPt.x,
      y1: svgPt.y,
      x2: svgPt.x,
      y2: svgPt.y,
      points: pts,
    });
  };

  const handleArtboardPointerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;

    if (drag.mode === 'move') {
      setDragOffsetPx({
        x: e.clientX - drag.startClientX,
        y: e.clientY - drag.startClientY,
      });
      return;
    }

    const svgPt = clientToSvgPoint(e.clientX, e.clientY);
    if (activeTool === 'path' && drag.points) {
      const last = drag.points[drag.points.length - 1];
      const dist = Math.hypot(svgPt.x - last.x, svgPt.y - last.y);
      const minStep = Math.max(1, Math.min(docInfo.viewBox.w, docInfo.viewBox.h) * 0.004);
      if (dist >= minStep) {
        const nextPoints = [...drag.points, svgPt];
        drag.points = nextPoints;
        setShapeDraft({
          x1: drag.startSvgX,
          y1: drag.startSvgY,
          x2: svgPt.x,
          y2: svgPt.y,
          points: nextPoints,
        });
      }
    } else {
      setShapeDraft({
        x1: drag.startSvgX,
        y1: drag.startSvgY,
        x2: svgPt.x,
        y2: svgPt.y,
      });
    }
  };

  const handleArtboardPointerUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    dragStateRef.current = null;

    if (drag.mode === 'move' && drag.path) {
      const svgPt = clientToSvgPoint(e.clientX, e.clientY);
      const dx = svgPt.x - drag.startSvgX;
      const dy = svgPt.y - drag.startSvgY;
      setDragOffsetPx(null);
      if (Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) >= 3) {
        const nextSvg = moveSvgElement(svgCode, drag.path, dx, dy);
        commitSvgChange(nextSvg, drag.path);
      }
      return;
    }

    if (drag.mode === 'draw') {
      const svgPt = clientToSvgPoint(e.clientX, e.clientY);
      const draft = shapeDraft;
      setShapeDraft(null);
      const fillVal = drawFillNone ? 'none' : drawFill;
      const strokeVal = drawStrokeNone ? 'none' : drawStroke;
      const minDim = Math.max(4, Math.min(docInfo.viewBox.w, docInfo.viewBox.h) * 0.015);

      if (activeTool === 'rect') {
        const x = Math.min(drag.startSvgX, svgPt.x);
        const y = Math.min(drag.startSvgY, svgPt.y);
        const w = Math.abs(svgPt.x - drag.startSvgX);
        const h = Math.abs(svgPt.y - drag.startSvgY);
        if (w >= minDim || h >= minDim) {
          const { svg, path } = addSvgShape(svgCode, {
            kind: 'rect',
            x,
            y,
            width: Math.max(minDim, w),
            height: Math.max(minDim, h),
            rx: drawRectRx,
            fill: fillVal,
            stroke: strokeVal,
            strokeWidth: drawStrokeWidth,
          });
          commitSvgChange(svg, path);
          setActiveTool('select');
          setInspectorTab('props');
        }
      } else if (activeTool === 'ellipse') {
        const cx = (drag.startSvgX + svgPt.x) / 2;
        const cy = (drag.startSvgY + svgPt.y) / 2;
        const rx = Math.abs(svgPt.x - drag.startSvgX) / 2;
        const ry = Math.abs(svgPt.y - drag.startSvgY) / 2;
        if (rx >= minDim / 2 || ry >= minDim / 2) {
          const { svg, path } = addSvgShape(svgCode, {
            kind: 'ellipse',
            cx,
            cy,
            rx: Math.max(minDim / 2, rx),
            ry: Math.max(minDim / 2, ry),
            fill: fillVal,
            stroke: strokeVal,
            strokeWidth: drawStrokeWidth,
          });
          commitSvgChange(svg, path);
          setActiveTool('select');
          setInspectorTab('props');
        }
      } else if (activeTool === 'line') {
        if (Math.hypot(svgPt.x - drag.startSvgX, svgPt.y - drag.startSvgY) >= minDim) {
          const { svg, path } = addSvgShape(svgCode, {
            kind: 'line',
            x1: drag.startSvgX,
            y1: drag.startSvgY,
            x2: svgPt.x,
            y2: svgPt.y,
            stroke: strokeVal === 'none' ? '#2563eb' : strokeVal,
            strokeWidth: drawStrokeWidth,
          });
          commitSvgChange(svg, path);
          setActiveTool('select');
          setInspectorTab('props');
        }
      } else if (activeTool === 'path' && draft?.points && draft.points.length >= 2) {
        const r = (n: number) => Math.round(n * 10) / 10;
        const d = draft.points
          .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${r(p.x)} ${r(p.y)}`)
          .join(' ');
        const { svg, path } = addSvgShape(svgCode, {
          kind: 'path',
          d,
          fill: 'none',
          stroke: strokeVal === 'none' ? '#2563eb' : strokeVal,
          strokeWidth: drawStrokeWidth,
        });
        commitSvgChange(svg, path);
        setActiveTool('select');
        setInspectorTab('props');
      }
    }
  };

  // Fit viewBox tightly around rendered SVG elements using SVG getBBox()
  const handleFitViewBox = () => {
    const svgEl = svgHostRef.current?.querySelector('svg');
    if (!svgEl) return;
    try {
      const bbox = svgEl.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        const pad = Math.max(4, Math.round(Math.max(bbox.width, bbox.height) * 0.04));
        const x = Math.round((bbox.x - pad) * 10) / 10;
        const y = Math.round((bbox.y - pad) * 10) / 10;
        const w = Math.round((bbox.width + pad * 2) * 10) / 10;
        const h = Math.round((bbox.height + pad * 2) * 10) / 10;
        const nextSvg = updateSvgCanvasConfig(svgCode, {
          x,
          y,
          w,
          h,
          widthAttr: String(Math.round(w)),
          heightAttr: String(Math.round(h)),
        });
        commitSvgChange(nextSvg, selectedPath);
        if (onShowToast) {
          onShowToast(
            lang === 'ja' ? `viewBoxを中身 (${w}×${h}) にフィットしました` : `ViewBox fitted to ${w}×${h}`
          );
        }
      }
    } catch {
      if (onShowToast) {
        onShowToast(lang === 'ja' ? '要素境界を取得できませんでした' : 'Could not compute content bounds');
      }
    }
  };

  const handleApplyCodeDraft = () => {
    const parsed = parseSvgSafe(codeDraft);
    if ('error' in parsed) {
      if (onShowToast) {
        onShowToast(
          lang === 'ja' ? `SVG構文エラー: ${parsed.error}` : `SVG Syntax Error: ${parsed.error}`
        );
      }
      return;
    }
    const formatted = formatSvgMarkup(codeDraft);
    commitSvgChange(formatted, null);
    if (onShowToast) {
      onShowToast(lang === 'ja' ? 'SVGコードを反映しました' : 'Applied SVG code changes');
    }
  };

  const handleFormatCode = () => {
    const formatted = formatSvgMarkup(codeDraft);
    commitSvgChange(formatted, selectedPath);
    if (onShowToast) onShowToast(lang === 'ja' ? 'SVGコードを整形しました' : 'Formatted SVG');
  };

  const handleMinifyCode = () => {
    const minified = minifySvgMarkup(svgCode);
    commitSvgChange(minified, selectedPath);
    if (onShowToast) {
      onShowToast(
        lang === 'ja'
          ? `SVGを軽量化しました (${new Blob([minified]).size} B)`
          : `Minified SVG (${new Blob([minified]).size} B)`
      );
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(svgCode);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1800);
      if (onShowToast) onShowToast(lang === 'ja' ? 'SVGコードをコピーしました' : 'SVG code copied');
    } catch {
      if (onShowToast) onShowToast(lang === 'ja' ? 'コピーに失敗しました' : 'Copy failed');
    }
  };

  const handleExport = async () => {
    if (!docInfo.valid) {
      if (onShowToast) onShowToast(lang === 'ja' ? '有効なSVGコードにしてから出力してください' : 'Fix SVG syntax before exporting');
      return;
    }
    const baseName = fileName.replace(/\.svg$/i, '') || 'artwork';

    try {
      let blob: Blob;
      let mime: string;
      let outName: string;

      if (exportFormat === 'svg') {
        const sanitized = formatSvgMarkup(svgCode);
        blob = new Blob([sanitized], { type: 'image/svg+xml;charset=utf-8' });
        mime = 'image/svg+xml';
        outName = `Edited_${baseName}.svg`;
      } else {
        const res = await exportSvgToRasterBlob(
          svgCode,
          exportFormat,
          rasterScale,
          bgMode === 'dark' ? 'dark' : bgMode === 'white' ? 'white' : 'transparent'
        );
        blob = res.blob;
        mime = exportFormat === 'jpg' ? 'image/jpeg' : exportFormat === 'webp' ? 'image/webp' : 'image/png';
        outName = `Edited_${baseName}.${exportFormat}`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`svg_${Date.now()}`, fileName, outName, blob, exportFormat);

      if (onResultReady) {
        onResultReady({
          id: `res_svg_${Date.now()}`,
          name: outName,
          file: new File([blob], outName, { type: mime }),
          size: blob.size,
          type: mime,
          format: exportFormat as DocumentFormat,
          targetFormat: exportFormat as DocumentFormat,
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName: outName,
        });
      }

      notifyCompletion(lang === 'ja' ? 'SVGの出力が完了しました' : 'SVG Exported', outName);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? `「${outName}」を出力・保存しました` : `Exported "${outName}"`);
      }
    } catch (err: any) {
      console.error('SVG export error:', err);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? '書き出しに失敗しました' : 'Failed to export SVG');
      }
    }
  };

  const codeValidation = useMemo(() => {
    const parsed = parseSvgSafe(codeDraft);
    return 'error' in parsed ? parsed.error : null;
  }, [codeDraft]);

  const toolButtons: Array<{ id: SvgTool; labelJa: string; labelEn: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'select', labelJa: '選択・移動', labelEn: 'Select', icon: MousePointer2 },
    { id: 'nodes', labelJa: '頂点編集', labelEn: 'Edit Nodes', icon: Waypoints },
    { id: 'rect', labelJa: '四角形', labelEn: 'Rect', icon: Square },
    { id: 'ellipse', labelJa: '円・楕円', labelEn: 'Ellipse', icon: Circle },
    { id: 'line', labelJa: '直線', labelEn: 'Line', icon: Minus },
    { id: 'path', labelJa: 'ペン描画', labelEn: 'Path', icon: PenTool },
    { id: 'text', labelJa: 'テキスト', labelEn: 'Text', icon: Type },
  ];

  const draftPathD = useMemo(() => {
    if (!shapeDraft?.points || shapeDraft.points.length < 2) return '';
    return shapeDraft.points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');
  }, [shapeDraft]);

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <AddToQueuePromptModal
        file={pendingPromptFile}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (!pendingPromptFile) return;
          if (onAddFiles) onAddFiles([pendingPromptFile]);
          loadSvgFile(pendingPromptFile);
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '全体キューに追加してSVGを開きました' : 'Added to queue and opened SVG');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={() => {
          if (!pendingPromptFile) return;
          loadSvgFile(pendingPromptFile);
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'SVGエディタに読み込みました' : 'Loaded SVG into editor');
          }
          setPendingPromptFile(null);
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            setPendingPromptFile(e.target.files[0]);
            e.target.value = '';
          }
        }}
      />

      {/* File Source & Starter Template Bar */}
      <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <select
            value={selectedQueueId}
            onChange={(e) => {
              const id = e.target.value;
              if (id === '__upload_svg__') {
                fileInputRef.current?.click();
                return;
              }
              setSelectedQueueId(id);
              const found = availableSvgItems.find((item) => item.id === id);
              if (found) {
                const file =
                  found.resultBlob && found.resultName && /\.svg$/i.test(found.resultName)
                    ? new File([found.resultBlob], found.resultName, { type: 'image/svg+xml' })
                    : found.file;
                if (file) loadSvgFile(file);
              }
            }}
            className="main-select text-xs py-1.5 px-2.5 mb-0 w-auto min-w-[200px]"
            aria-label={lang === 'ja' ? 'SVGファイル選択' : 'Select SVG File'}
          >
            <option value="">
              {availableSvgItems.length > 0
                ? lang === 'ja'
                  ? `-- 読み込み済みSVG (${availableSvgItems.length}件) --`
                  : `-- Queued SVGs (${availableSvgItems.length}) --`
                : lang === 'ja'
                ? '-- SVGファイルを選択 --'
                : '-- Select SVG File --'}
            </option>
            <option value="__upload_svg__">
              {lang === 'ja' ? '+ 端末からSVGを開く...' : '+ Upload SVG from Device...'}
            </option>
            {availableSvgItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({(item.size / 1024).toFixed(1)} KB)
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{lang === 'ja' ? 'SVG読込' : 'Load SVG'}</span>
          </button>

          <select
            value=""
            onChange={(e) => {
              const tpl = SVG_TEMPLATES.find((t) => t.id === e.target.value);
              if (tpl) {
                setFileName(`${tpl.id}.svg`);
                setSelectedQueueId('');
                commitSvgChange(tpl.svg, null);
              }
            }}
            className="main-select text-xs py-1.5 px-2.5 mb-0 w-auto"
            aria-label={lang === 'ja' ? '新規テンプレートから作成' : 'New from template'}
          >
            <option value="">{lang === 'ja' ? '+ 新規テンプレート...' : '+ New Template...'}</option>
            {SVG_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {lang === 'ja' ? t.nameJa : t.nameEn}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums font-mono">
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-mono w-36"
            aria-label={lang === 'ja' ? '出力ファイル名' : 'Filename'}
          />
          <span aria-hidden="true">·</span>
          <span>
            {docInfo.viewBox.w}×{docInfo.viewBox.h}
          </span>
          <span aria-hidden="true">·</span>
          <span>{docInfo.elements.length} {lang === 'ja' ? '要素' : 'nodes'}</span>
          <span aria-hidden="true">·</span>
          <span>{(docInfo.byteSize / 1024).toFixed(2)} KB</span>
        </div>
      </div>

      {/* Main Toolbar: Drawing Tools, View Switcher, History, Zoom & Export */}
      <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        {/* Vector Tool Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
          {toolButtons.map((btn) => {
            const Icon = btn.icon;
            const active = activeTool === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => setActiveTool(btn.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? btn.labelJa : btn.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {[
            { id: 'visual', labelJa: 'ビジュアル', labelEn: 'Visual', icon: Eye },
            { id: 'split', labelJa: '分割', labelEn: 'Split', icon: Columns },
            { id: 'code', labelJa: 'コード', labelEn: 'Code', icon: Code },
          ].map((m) => {
            const Icon = m.icon;
            const active = viewMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setViewMode(m.id as SvgViewMode)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? m.labelJa : m.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* History, Zoom & Export Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
            title={lang === 'ja' ? '元に戻す (Ctrl+Z)' : 'Undo (Ctrl+Z)'}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
            title={lang === 'ja' ? 'やり直す (Ctrl+Y)' : 'Redo (Ctrl+Y)'}
          >
            <Redo2 className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-lg px-1 py-0.5 text-xs">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100))}
              className="p-1 hover:text-blue-600"
              title={lang === 'ja' ? '縮小' : 'Zoom Out'}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums text-[11px] font-semibold">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
              className="p-1 hover:text-blue-600"
              title={lang === 'ja' ? '拡大' : 'Zoom In'}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as SvgExportFormat)}
            className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
            aria-label={lang === 'ja' ? '書き出し形式' : 'Export format'}
          >
            <option value="svg">SVG (.svg)</option>
            <option value="png">PNG (.png)</option>
            <option value="jpg">JPEG (.jpg)</option>
            <option value="webp">WebP (.webp)</option>
          </select>

          {exportFormat !== 'svg' && (
            <select
              value={rasterScale}
              onChange={(e) => setRasterScale(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono font-semibold"
              aria-label={lang === 'ja' ? '書き出し倍率' : 'Raster scale'}
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
              <option value={4}>4x</option>
            </select>
          )}

          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold whitespace-nowrap shrink-0 transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{lang === 'ja' ? '保存・書き出し' : 'Export'}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Grid (8 cols canvas/code + 4 cols inspector) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Interactive Visual Artboard */}
          {viewMode !== 'code' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {activeTool === 'select' &&
                    (lang === 'ja'
                      ? '要素をクリックして選択・ドラッグ移動できます（ダブルクリックで頂点編集）'
                      : 'Click any vector element to select & drag (double-click to edit vertices)')}
                  {activeTool === 'nodes' &&
                    (selectedElement
                      ? lang === 'ja'
                        ? '青い頂点や丸い制御点をドラッグしてパーツの形状を直接変形できます（他パーツのクリックで切替）'
                        : 'Drag square vertices or round control handles to reshape this part (click another part to switch)'
                      : lang === 'ja'
                      ? '頂点を移動・編集したいSVGパーツをクリックして選択してください'
                      : 'Click any SVG vector part on the canvas to edit its vertices')}
                  {activeTool === 'rect' &&
                    (lang === 'ja' ? 'キャンバス上をドラッグして四角形を作成' : 'Drag on canvas to draw rectangle')}
                  {activeTool === 'ellipse' &&
                    (lang === 'ja' ? 'キャンバス上をドラッグして円・楕円を作成' : 'Drag on canvas to draw ellipse')}
                  {activeTool === 'line' &&
                    (lang === 'ja' ? 'キャンバス上をドラッグして直線を作成' : 'Drag on canvas to draw line')}
                  {activeTool === 'path' &&
                    (lang === 'ja' ? 'キャンバス上をなぞってベクターパスを描画' : 'Drag to draw freehand vector path')}
                  {activeTool === 'text' &&
                    (lang === 'ja' ? '配置したい位置をクリックしてテキストを追加' : 'Click on canvas to insert SVG text')}
                </span>

                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  {(
                    [
                      { id: 'checkerboard', labelJa: '透過', labelEn: 'Grid' },
                      { id: 'white', labelJa: '白背景', labelEn: 'White' },
                      { id: 'dark', labelJa: '暗背景', labelEn: 'Dark' },
                    ] as const
                  ).map((bg) => (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => setBgMode(bg.id)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition whitespace-nowrap ${
                        bgMode === bg.id
                          ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                      }`}
                    >
                      {lang === 'ja' ? bg.labelJa : bg.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className={`relative rounded-xl border border-slate-200 dark:border-slate-800 overflow-auto flex items-center justify-center min-h-[380px] max-h-[560px] p-6 select-none ${
                  bgMode === 'white'
                    ? 'bg-white'
                    : bgMode === 'dark'
                    ? 'bg-slate-950'
                    : 'checkerboard-bg'
                }`}
              >
                {docInfo.valid ? (
                  <div
                    ref={artboardBoxRef}
                    onMouseDown={handleArtboardPointerDown}
                    onMouseMove={handleArtboardPointerMove}
                    onMouseUp={handleArtboardPointerUp}
                    onMouseLeave={handleArtboardPointerUp}
                    onDoubleClick={handleArtboardDoubleClick}
                    style={{
                      aspectRatio: `${docInfo.viewBox.w} / ${docInfo.viewBox.h}`,
                      width: `${Math.round(Math.min(540, Math.max(220, docInfo.viewBox.w)) * zoom)}px`,
                      maxWidth: 'none',
                    }}
                    className={`relative shrink-0 shadow-sm ring-1 ring-slate-300/80 dark:ring-slate-700 ${
                      activeTool === 'select' || activeTool === 'nodes' ? 'cursor-default' : 'cursor-crosshair'
                    }`}
                  >
                    {/* Live Sanitized SVG Mount */}
                    <div ref={svgHostRef} className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block" />

                    {/* Draft Drawing Overlay SVG */}
                    {shapeDraft && (
                      <svg
                        viewBox={`${docInfo.viewBox.x} ${docInfo.viewBox.y} ${docInfo.viewBox.w} ${docInfo.viewBox.h}`}
                        className="absolute inset-0 w-full h-full pointer-events-none"
                      >
                        {activeTool === 'rect' && (
                          <rect
                            x={Math.min(shapeDraft.x1, shapeDraft.x2)}
                            y={Math.min(shapeDraft.y1, shapeDraft.y2)}
                            width={Math.abs(shapeDraft.x2 - shapeDraft.x1)}
                            height={Math.abs(shapeDraft.y2 - shapeDraft.y1)}
                            rx={drawRectRx}
                            fill={drawFillNone ? 'none' : drawFill}
                            fillOpacity={0.5}
                            stroke={drawStrokeNone ? '#2563eb' : drawStroke}
                            strokeWidth={drawStrokeWidth}
                            strokeDasharray="6 4"
                          />
                        )}
                        {activeTool === 'ellipse' && (
                          <ellipse
                            cx={(shapeDraft.x1 + shapeDraft.x2) / 2}
                            cy={(shapeDraft.y1 + shapeDraft.y2) / 2}
                            rx={Math.abs(shapeDraft.x2 - shapeDraft.x1) / 2}
                            ry={Math.abs(shapeDraft.y2 - shapeDraft.y1) / 2}
                            fill={drawFillNone ? 'none' : drawFill}
                            fillOpacity={0.5}
                            stroke={drawStrokeNone ? '#2563eb' : drawStroke}
                            strokeWidth={drawStrokeWidth}
                            strokeDasharray="6 4"
                          />
                        )}
                        {activeTool === 'line' && (
                          <line
                            x1={shapeDraft.x1}
                            y1={shapeDraft.y1}
                            x2={shapeDraft.x2}
                            y2={shapeDraft.y2}
                            stroke={drawStrokeNone ? '#2563eb' : drawStroke}
                            strokeWidth={drawStrokeWidth}
                            strokeDasharray="6 4"
                          />
                        )}
                        {activeTool === 'path' && draftPathD && (
                          <path
                            d={draftPathD}
                            fill="none"
                            stroke={drawStrokeNone ? '#2563eb' : drawStroke}
                            strokeWidth={drawStrokeWidth}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                      </svg>
                    )}

                    {/* Selection Bounding Box Overlay */}
                    {selectionBoxPct && (
                      <div
                        style={{
                          left: `${selectionBoxPct.left}%`,
                          top: `${selectionBoxPct.top}%`,
                          width: `${selectionBoxPct.width}%`,
                          height: `${selectionBoxPct.height}%`,
                          transform: dragOffsetPx
                            ? `translate(${dragOffsetPx.x}px, ${dragOffsetPx.y}px)`
                            : undefined,
                        }}
                        className="absolute pointer-events-none border-2 border-dashed border-blue-500 bg-blue-500/5 rounded-[2px]"
                      />
                    )}

                    {/* Per-Part Vertex & Control Point Handles Overlay */}
                    {activeTool === 'nodes' && projectedVertices.length > 0 && (
                      <>
                        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                          {projectedVertices.map((v) =>
                            v.anchorLeftPct !== undefined && v.anchorTopPct !== undefined ? (
                              <line
                                key={`arm_${v.index}`}
                                x1={`${v.anchorLeftPct}%`}
                                y1={`${v.anchorTopPct}%`}
                                x2={`${v.leftPct}%`}
                                y2={`${v.topPct}%`}
                                stroke="#0284c7"
                                strokeWidth={1.5}
                                strokeDasharray="3 3"
                              />
                            ) : null
                          )}
                        </svg>
                        {projectedVertices.map((v) => {
                          const isControl = v.kind === 'control';
                          const isActive = activeVertexIdx === v.index;
                          return (
                            <button
                              key={`vtx_${v.index}`}
                              type="button"
                              onMouseDown={(e) => handleVertexMouseDown(e, v.index)}
                              style={{
                                left: `${v.leftPct}%`,
                                top: `${v.topPct}%`,
                                transform: 'translate(-50%, -50%)',
                              }}
                              title={`${v.label} (${Math.round(v.x * 10) / 10}, ${Math.round(v.y * 10) / 10})`}
                              aria-label={v.label}
                              className={`absolute z-10 border-2 border-white shadow-sm cursor-grab active:cursor-grabbing transition-transform hover:scale-125 ${
                                isControl
                                  ? 'w-2.5 h-2.5 rounded-full bg-sky-500'
                                  : 'w-3 h-3 rounded-[2px] bg-blue-600'
                              } ${isActive ? 'ring-2 ring-amber-400 scale-125' : ''}`}
                            />
                          );
                        })}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-xs text-red-600 dark:text-red-400 max-w-md">
                    <p className="font-bold mb-1">
                      {lang === 'ja' ? 'SVG XMLの構文エラーが検出されました' : 'SVG XML Syntax Error'}
                    </p>
                    <p className="font-mono break-all opacity-80">{docInfo.error}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SVG Markup Code Editor */}
          {viewMode !== 'visual' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <Code className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    {lang === 'ja' ? 'SVGソースコード' : 'SVG Markup Source'}
                  </span>
                  <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                  {codeValidation ? (
                    <span className="text-red-600 dark:text-red-400 font-semibold">
                      {lang === 'ja' ? '構文エラーあり' : 'Syntax error'}
                    </span>
                  ) : (
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                      {lang === 'ja' ? '有効なSVG' : 'Valid SVG'}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleFormatCode}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <AlignLeft className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? '整形' : 'Format'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMinifyCode}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? '軽量化' : 'Minify'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{isCopied ? (lang === 'ja' ? 'コピー済' : 'Copied') : (lang === 'ja' ? 'コピー' : 'Copy')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCodeDraft}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? 'コードを反映' : 'Apply Code'}</span>
                  </button>
                </div>
              </div>

              <textarea
                value={codeDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setCodeDraft(val);
                  const parsed = parseSvgSafe(val);
                  if (!('error' in parsed)) {
                    setSvgCode(val);
                  }
                }}
                spellCheck={false}
                rows={12}
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {codeValidation && (
                <p className="text-[11px] font-mono text-red-600 dark:text-red-400 break-all">
                  {codeValidation}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right 4 Cols: Inspector Panel */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-4">
          {/* Inspector Sub-Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {[
              { id: 'props', labelJa: '要素・スタイル', labelEn: 'Element', icon: Sliders },
              { id: 'layers', labelJa: 'レイヤー・色', labelEn: 'Layers & Colors', icon: Layers },
              { id: 'canvas', labelJa: 'サイズ・変形', labelEn: 'Artboard', icon: Maximize2 },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = inspectorTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInspectorTab(tab.id as InspectorTab)}
                  className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-xs font-semibold whitespace-nowrap transition ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? tab.labelJa : tab.labelEn}</span>
                </button>
              );
            })}
          </div>

          {/* Inspector Tab 1: Element Properties & New Shape Defaults */}
          {inspectorTab === 'props' && (
            <div className="flex flex-col gap-4 text-xs">
              {selectedElement ? (
                <>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 dark:text-slate-100 truncate font-mono">
                        {selectedElement.label}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {lang === 'ja' ? '選択中のベクター要素' : 'Selected element'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveTool(activeTool === 'nodes' ? 'select' : 'nodes')}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold whitespace-nowrap ${
                          activeTool === 'nodes'
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <Waypoints className="w-3 h-3" />
                        <span>
                          {activeTool === 'nodes'
                            ? lang === 'ja'
                              ? '選択モードへ'
                              : 'Select Mode'
                            : lang === 'ja'
                            ? '頂点を編集'
                            : 'Edit Vertices'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPath(null)}
                        className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline whitespace-nowrap"
                      >
                        {lang === 'ja' ? '選択解除' : 'Deselect'}
                      </button>
                    </div>
                  </div>

                  {/* Element ID */}
                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      ID
                    </label>
                    <input
                      type="text"
                      value={selectedElement.id}
                      onChange={(e) =>
                        commitSvgChange(
                          updateSvgElementProps(svgCode, selectedElement.path, { id: e.target.value }),
                          selectedElement.path
                        )
                      }
                      placeholder="layer-id"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>

                  {/* Text content & typography for <text> / <tspan> */}
                  {(selectedElement.tagName === 'text' || selectedElement.tagName === 'tspan') && (
                    <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                      <div>
                        <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                          {lang === 'ja' ? 'テキスト内容' : 'Text Content'}
                        </label>
                        <input
                          type="text"
                          value={selectedElement.textContent || ''}
                          onChange={(e) =>
                            commitSvgChange(
                              updateSvgElementProps(svgCode, selectedElement.path, {
                                textContent: e.target.value,
                              }),
                              selectedElement.path
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                            {lang === 'ja' ? 'サイズ' : 'Font Size'}
                          </label>
                          <input
                            type="number"
                            min={6}
                            max={400}
                            value={parseFloat(selectedElement.fontSize || '24') || 24}
                            onChange={(e) =>
                              commitSvgChange(
                                updateSvgElementProps(svgCode, selectedElement.path, {
                                  fontSize: e.target.value,
                                }),
                                selectedElement.path
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                            {lang === 'ja' ? '太さ' : 'Weight'}
                          </label>
                          <select
                            value={selectedElement.fontWeight === 'bold' || selectedElement.fontWeight === '700' ? 'bold' : 'normal'}
                            onChange={(e) =>
                              commitSvgChange(
                                updateSvgElementProps(svgCode, selectedElement.path, {
                                  fontWeight: e.target.value,
                                }),
                                selectedElement.path
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                          >
                            <option value="normal">{lang === 'ja' ? '標準' : 'Normal'}</option>
                            <option value="bold">{lang === 'ja' ? '太字' : 'Bold'}</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fill & Stroke */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-slate-700 dark:text-slate-300">
                          {lang === 'ja' ? '塗り (Fill)' : 'Fill'}
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedElement.fill === 'none'}
                            onChange={(e) =>
                              commitSvgChange(
                                updateSvgElementProps(svgCode, selectedElement.path, {
                                  fill: e.target.checked ? 'none' : '#3b82f6',
                                }),
                                selectedElement.path
                              )
                            }
                            className="accent-blue-600"
                          />
                          <span>{lang === 'ja' ? 'なし' : 'None'}</span>
                        </label>
                      </div>
                      <input
                        type="color"
                        disabled={selectedElement.fill === 'none'}
                        value={normalizeColorToHex(selectedElement.fill) || '#000000'}
                        onChange={(e) =>
                          commitSvgChange(
                            updateSvgElementProps(svgCode, selectedElement.path, { fill: e.target.value }),
                            selectedElement.path
                          )
                        }
                        className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-40"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-slate-700 dark:text-slate-300">
                          {lang === 'ja' ? '線色 (Stroke)' : 'Stroke'}
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!selectedElement.stroke || selectedElement.stroke === 'none'}
                            onChange={(e) =>
                              commitSvgChange(
                                updateSvgElementProps(svgCode, selectedElement.path, {
                                  stroke: e.target.checked ? 'none' : '#1e293b',
                                  strokeWidth: e.target.checked
                                    ? undefined
                                    : selectedElement.strokeWidth || '2',
                                }),
                                selectedElement.path
                              )
                            }
                            className="accent-blue-600"
                          />
                          <span>{lang === 'ja' ? 'なし' : 'None'}</span>
                        </label>
                      </div>
                      <input
                        type="color"
                        disabled={!selectedElement.stroke || selectedElement.stroke === 'none'}
                        value={normalizeColorToHex(selectedElement.stroke) || '#1e293b'}
                        onChange={(e) =>
                          commitSvgChange(
                            updateSvgElementProps(svgCode, selectedElement.path, {
                              stroke: e.target.value,
                            }),
                            selectedElement.path
                          )
                        }
                        className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-40"
                      />
                    </div>
                  </div>

                  {/* Stroke Width & Opacity */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        <span>{lang === 'ja' ? '線幅' : 'Stroke Width'}</span>
                        <span className="font-mono tabular-nums">
                          {parseFloat(selectedElement.strokeWidth || '0') || 0}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={32}
                        step={0.5}
                        value={parseFloat(selectedElement.strokeWidth || '0') || 0}
                        onChange={(e) =>
                          commitSvgChange(
                            updateSvgElementProps(svgCode, selectedElement.path, {
                              strokeWidth: e.target.value,
                            }),
                            selectedElement.path
                          )
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        <span>{lang === 'ja' ? '不透明度' : 'Opacity'}</span>
                        <span className="font-mono tabular-nums">
                          {Math.round((parseFloat(selectedElement.opacity || '1') || 1) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={parseFloat(selectedElement.opacity || '1') || 1}
                        onChange={(e) =>
                          commitSvgChange(
                            updateSvgElementProps(svgCode, selectedElement.path, {
                              opacity: e.target.value,
                            }),
                            selectedElement.path
                          )
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>

                  {/* Corner Radius for <rect> */}
                  {selectedElement.tagName === 'rect' && (
                    <div>
                      <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        <span>{lang === 'ja' ? '角丸 (rx)' : 'Corner Radius (rx)'}</span>
                        <span className="font-mono tabular-nums">
                          {parseFloat(selectedElement.rx || '0') || 0}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={120}
                        value={parseFloat(selectedElement.rx || '0') || 0}
                        onChange={(e) =>
                          commitSvgChange(
                            updateSvgElementProps(svgCode, selectedElement.path, { rx: e.target.value }),
                            selectedElement.path
                          )
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                  )}

                  {/* Per-Part Vertex Coordinate Inspector */}
                  {elementVertices.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                          <Waypoints className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>
                            {lang === 'ja' ? '頂点・制御点座標' : 'Vertices & Nodes'}
                          </span>
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-500">
                          {elementVertices.length}
                        </span>
                      </div>

                      <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 pr-1">
                        {elementVertices.map((v) => (
                          <div
                            key={`row_${v.index}`}
                            onMouseEnter={() => setActiveVertexIdx(v.index)}
                            onMouseLeave={() => setActiveVertexIdx(null)}
                            className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-[11px] ${
                              activeVertexIdx === v.index
                                ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30'
                            }`}
                          >
                            <span
                              className={`font-mono font-semibold w-14 truncate shrink-0 ${
                                v.kind === 'control'
                                  ? 'text-sky-700 dark:text-sky-400'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                              title={v.label}
                            >
                              {v.label}
                            </span>
                            <input
                              type="number"
                              step="0.5"
                              value={Math.round(v.x * 100) / 100}
                              onChange={(e) => {
                                const nx = parseFloat(e.target.value);
                                if (!Number.isFinite(nx)) return;
                                commitSvgChange(
                                  moveSvgElementVertex(svgCode, selectedElement.path, v.index, nx, v.y),
                                  selectedElement.path
                                );
                              }}
                              aria-label={`${v.label} X`}
                              className="w-14 min-w-0 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums"
                            />
                            <input
                              type="number"
                              step="0.5"
                              value={Math.round(v.y * 100) / 100}
                              onChange={(e) => {
                                const ny = parseFloat(e.target.value);
                                if (!Number.isFinite(ny)) return;
                                commitSvgChange(
                                  moveSvgElementVertex(svgCode, selectedElement.path, v.index, v.x, ny),
                                  selectedElement.path
                                );
                              }}
                              aria-label={`${v.label} Y`}
                              className="w-14 min-w-0 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums"
                            />
                            {v.insertableAfter && (
                              <button
                                type="button"
                                onClick={() =>
                                  commitSvgChange(
                                    insertSvgElementVertex(svgCode, selectedElement.path, v.index),
                                    selectedElement.path
                                  )
                                }
                                title={lang === 'ja' ? 'この後に中間頂点を追加' : 'Insert midpoint vertex after'}
                                className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 shrink-0"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                            {v.removable && (
                              <button
                                type="button"
                                onClick={() =>
                                  commitSvgChange(
                                    deleteSvgElementVertex(svgCode, selectedElement.path, v.index),
                                    selectedElement.path
                                  )
                                }
                                title={lang === 'ja' ? 'この頂点を削除' : 'Delete vertex'}
                                className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reorder, Duplicate, Delete */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const res = reorderSvgElement(svgCode, selectedElement.path, 'front');
                          commitSvgChange(res.svg, res.path);
                        }}
                        className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? '最前面へ' : 'Bring Front'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const res = reorderSvgElement(svgCode, selectedElement.path, 'back');
                          commitSvgChange(res.svg, res.path);
                        }}
                        className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? '最背面へ' : 'Send Back'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const res = duplicateSvgElement(svgCode, selectedElement.path);
                          commitSvgChange(res.svg, res.path);
                        }}
                        className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <CopyPlus className="w-3.5 h-3.5 text-blue-600" />
                        <span>{lang === 'ja' ? '複製' : 'Duplicate'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nextSvg = deleteSvgElement(svgCode, selectedElement.path);
                          commitSvgChange(nextSvg, null);
                        }}
                        className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? '削除' : 'Delete'}</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="pb-2 border-b border-slate-200 dark:border-slate-800">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100">
                      {lang === 'ja' ? '新規描画・追加の初期スタイル' : 'New Shape & Text Style'}
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {lang === 'ja'
                        ? 'キャンバス上の要素をクリックすると個別の色・線幅・テキストを編集できます。'
                        : 'Click any element on the canvas to inspect or edit its properties.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-slate-700 dark:text-slate-300">
                          {lang === 'ja' ? '塗り (Fill)' : 'Fill'}
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={drawFillNone}
                            onChange={(e) => setDrawFillNone(e.target.checked)}
                            className="accent-blue-600"
                          />
                          <span>{lang === 'ja' ? 'なし' : 'None'}</span>
                        </label>
                      </div>
                      <input
                        type="color"
                        disabled={drawFillNone}
                        value={drawFill}
                        onChange={(e) => setDrawFill(e.target.value)}
                        className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-40"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-semibold text-slate-700 dark:text-slate-300">
                          {lang === 'ja' ? '線色 (Stroke)' : 'Stroke'}
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={drawStrokeNone}
                            onChange={(e) => setDrawStrokeNone(e.target.checked)}
                            className="accent-blue-600"
                          />
                          <span>{lang === 'ja' ? 'なし' : 'None'}</span>
                        </label>
                      </div>
                      <input
                        type="color"
                        disabled={drawStrokeNone}
                        value={drawStroke}
                        onChange={(e) => setDrawStroke(e.target.value)}
                        className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-40"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        <span>{lang === 'ja' ? '線幅' : 'Stroke'}</span>
                        <span className="font-mono tabular-nums">{drawStrokeWidth}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={24}
                        value={drawStrokeWidth}
                        onChange={(e) => setDrawStrokeWidth(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        <span>{lang === 'ja' ? '角丸 (四角)' : 'Rect Radius'}</span>
                        <span className="font-mono tabular-nums">{drawRectRx}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={64}
                        value={drawRectRx}
                        onChange={(e) => setDrawRectRx(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex flex-col gap-2">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      {lang === 'ja' ? 'テキスト追加時の初期文字・サイズ' : 'Text Tool Defaults'}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newTextValue}
                        onChange={(e) => setNewTextValue(e.target.value)}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                      />
                      <input
                        type="number"
                        min={8}
                        max={200}
                        value={newTextSize}
                        onChange={(e) => setNewTextSize(Number(e.target.value) || 24)}
                        className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTool('text')}
                      className="inline-flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg bg-slate-900 dark:bg-slate-700 text-white font-semibold hover:opacity-90 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{lang === 'ja' ? 'テキスト配置モードへ切替' : 'Switch to Text Tool'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Inspector Tab 2: Layers Tree & Batch Color Replacement */}
          {inspectorTab === 'layers' && (
            <div className="flex flex-col gap-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    {lang === 'ja' ? '要素ツリー' : 'Vector Elements'}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {docInfo.elements.length} {lang === 'ja' ? '件' : 'items'}
                  </span>
                </div>

                {docInfo.elements.length === 0 ? (
                  <p className="text-slate-500 py-3 text-center">
                    {lang === 'ja' ? '図形・テキスト要素がありません' : 'No vector elements found'}
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto flex flex-col gap-1 pr-1">
                    {docInfo.elements.map((el) => {
                      const isSel = el.path === selectedPath;
                      return (
                        <div
                          key={el.path}
                          onClick={() => {
                            setSelectedPath(el.path);
                            setActiveTool('select');
                          }}
                          style={{ paddingLeft: `${8 + el.depth * 12}px` }}
                          className={`flex items-center justify-between gap-2 py-1.5 pr-2 rounded-lg border cursor-pointer transition ${
                            isSel
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span className="font-mono text-[11px] truncate">{el.label}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                commitSvgChange(
                                  updateSvgElementProps(svgCode, el.path, { hidden: !el.hidden }),
                                  selectedPath
                                );
                              }}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                              title={el.hidden ? (lang === 'ja' ? '表示' : 'Show') : (lang === 'ja' ? '非表示' : 'Hide')}
                            >
                              {el.hidden ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                commitSvgChange(deleteSvgElement(svgCode, el.path), isSel ? null : selectedPath);
                              }}
                              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/60 text-red-600 dark:text-red-400"
                              title={lang === 'ja' ? '削除' : 'Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Batch Palette Color Replacer */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 mb-2">
                  <Palette className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    {lang === 'ja' ? '使用カラーの一括置換' : 'Batch Color Replace'}
                  </span>
                </div>

                {docInfo.palette.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    {lang === 'ja' ? '置換可能なカラーが見つかりません' : 'No colors detected'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                    {docInfo.palette.map((tok) => (
                      <div
                        key={tok.normalizedHex}
                        className="flex items-center justify-between gap-2 p-1.5 rounded-lg border border-slate-200 dark:border-slate-800"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="color"
                            value={tok.normalizedHex}
                            onChange={(e) => {
                              const nextSvg = replaceSvgColor(svgCode, tok.normalizedHex, e.target.value);
                              commitSvgChange(nextSvg, selectedPath);
                            }}
                            className="w-7 h-7 rounded border border-slate-200 dark:border-slate-700 cursor-pointer shrink-0"
                            title={lang === 'ja' ? 'クリックしてこの色を一括変更' : 'Pick replacement color'}
                          />
                          <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200 truncate">
                            {tok.normalizedHex}
                          </span>
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                          ×{tok.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inspector Tab 3: Artboard viewBox & Global Transform */}
          {inspectorTab === 'canvas' && (
            <div className="flex flex-col gap-4 text-xs">
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-2">
                  {lang === 'ja' ? 'ViewBox・サイズ設定' : 'ViewBox & Dimensions'}
                </h4>

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-0.5">min-x</label>
                    <input
                      type="number"
                      value={vbX}
                      onChange={(e) => setVbX(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-0.5">min-y</label>
                    <input
                      type="number"
                      value={vbY}
                      onChange={(e) => setVbY(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-0.5">viewBox width</label>
                    <input
                      type="number"
                      min={1}
                      value={vbW}
                      onChange={(e) => setVbW(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-0.5">viewBox height</label>
                    <input
                      type="number"
                      min={1}
                      value={vbH}
                      onChange={(e) => setVbH(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-0.5">width {lang === 'ja' ? '属性' : 'attr'}</label>
                    <input
                      type="text"
                      value={attrW}
                      onChange={(e) => setAttrW(e.target.value)}
                      placeholder="auto"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-0.5">height {lang === 'ja' ? '属性' : 'attr'}</label>
                    <input
                      type="text"
                      value={attrH}
                      onChange={(e) => setAttrH(e.target.value)}
                      placeholder="auto"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextSvg = updateSvgCanvasConfig(svgCode, {
                        x: Number(vbX) || 0,
                        y: Number(vbY) || 0,
                        w: Math.max(1, Number(vbW) || 800),
                        h: Math.max(1, Number(vbH) || 600),
                        widthAttr: attrW,
                        heightAttr: attrH,
                      });
                      commitSvgChange(nextSvg, selectedPath);
                      if (onShowToast) onShowToast(lang === 'ja' ? 'ViewBoxを更新しました' : 'Updated ViewBox');
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold whitespace-nowrap"
                  >
                    {lang === 'ja' ? 'ViewBox・サイズを適用' : 'Apply ViewBox & Size'}
                  </button>

                  <button
                    type="button"
                    onClick={handleFitViewBox}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-blue-600" />
                    <span>{lang === 'ja' ? '描画中身に合わせて自動トリム' : 'Fit ViewBox to Content'}</span>
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-2">
                  {lang === 'ja' ? '全体回転・反転' : 'Global Transform'}
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => commitSvgChange(transformEntireSvg(svgCode, 'rotate90'), null)}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <RotateCw className="w-4 h-4 text-blue-600" />
                    <span>{lang === 'ja' ? '90°回転' : 'Rotate 90°'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => commitSvgChange(transformEntireSvg(svgCode, 'flipH'), null)}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <FlipHorizontal className="w-4 h-4 text-blue-600" />
                    <span>{lang === 'ja' ? '左右反転' : 'Flip H'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => commitSvgChange(transformEntireSvg(svgCode, 'flipV'), null)}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <FlipVertical className="w-4 h-4 text-blue-600" />
                    <span>{lang === 'ja' ? '上下反転' : 'Flip V'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
