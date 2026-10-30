import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Crop,
  Grid,
  Type,
  PenTool,
  Sliders,
  Sparkles,
  Upload,
  Download,
  Undo2,
  Redo2,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  RefreshCw,
  Check,
  X,
  Square,
  Circle,
  ArrowRight,
  Eraser,
  Image as ImageIcon,
  Layers,
  FolderOpen,
} from 'lucide-react';
import { FileItem, DocumentFormat } from '../../types';
import { saveProcessedFile } from '../../utils/historyDb';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';
import { canvasToBmpBlob, canvasToIcoBlob } from '../../utils/formatConversionUtils';

interface ImageEditorSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

type EditorTool = 'adjust' | 'filter' | 'crop' | 'mosaic' | 'markup' | 'text';
type MarkupShape = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'circle';

interface FilterAdjustments {
  brightness: number;
  contrast: number;
  saturate: number;
  blur: number;
  sepia: number;
  grayscale: number;
  invert: number;
  hueRotate: number;
}

const DEFAULT_ADJUSTMENTS: FilterAdjustments = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  blur: 0,
  sepia: 0,
  grayscale: 0,
  invert: 0,
  hueRotate: 0,
};

export const ImageEditorSuite: React.FC<ImageEditorSuiteProps> = ({
  lang,
  sharedFile,
  fileList = [],
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [activeTool, setActiveTool] = useState<EditorTool>('adjust');
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [pendingPromptFile, setPendingPromptFile] = useState<File | null>(null);

  // Canvas & History State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [baseImageElement, setBaseImageElement] = useState<CanvasImageSource | null>(null);
  const [canvasBgMode, setCanvasBgMode] = useState<'checkerboard' | 'white' | 'dark'>('checkerboard');
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });
  const loadedSharedFileRef = useRef<File | null>(null);

  const getSourceWidth = (el: CanvasImageSource | null): number => {
    if (!el) return canvasSize.width;
    if ('naturalWidth' in el && (el as HTMLImageElement).naturalWidth) {
      return (el as HTMLImageElement).naturalWidth;
    }
    return (el as HTMLCanvasElement).width || canvasSize.width;
  };

  const getSourceHeight = (el: CanvasImageSource | null): number => {
    if (!el) return canvasSize.height;
    if ('naturalHeight' in el && (el as HTMLImageElement).naturalHeight) {
      return (el as HTMLImageElement).naturalHeight;
    }
    return (el as HTMLCanvasElement).height || canvasSize.height;
  };

  // Adjustments & Filter State
  const [adjustments, setAdjustments] = useState<FilterAdjustments>(DEFAULT_ADJUSTMENTS);
  const [activePreset, setActivePreset] = useState<string>('none');

  // Crop State (normalized 0..1 coordinates on canvas)
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0.1,
    y: 0.1,
    w: 0.8,
    h: 0.8,
  });
  const [cropAspect, setCropAspect] = useState<number | null>(null);

  // Mosaic State
  const [mosaicMode, setMosaicMode] = useState<'brush' | 'rect'>('rect');
  const [mosaicSize, setMosaicSize] = useState<number>(16);

  // Markup State
  const [markupShape, setMarkupShape] = useState<MarkupShape>('pen');
  const [markupColor, setMarkupColor] = useState<string>('#ef4444');
  const [markupStrokeWidth, setMarkupStrokeWidth] = useState<number>(5);

  // Text State
  const [textInput, setTextInput] = useState<string>(lang === 'ja' ? 'サンプルテキスト' : 'Sample Text');
  const [textColor, setTextColor] = useState<string>('#ffffff');
  const [textBgColor, setTextBgColor] = useState<string>('#0f172a');
  const [textUseBg, setTextUseBg] = useState<boolean>(true);
  const [textFontSize, setTextFontSize] = useState<number>(32);
  const [textPos, setTextPos] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  // Export Format
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg' | 'webp' | 'bmp' | 'ico'>('png');

  // Pointer interaction state
  const isDrawingRef = useRef<boolean>(false);
  const startPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Load image into editor
  const loadImageFile = useCallback((file: File) => {
    setCurrentFile(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = 1600;
      const maxH = 1600;
      let w = img.naturalWidth || 800;
      let h = img.naturalHeight || 600;
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      setCanvasSize({ width: w, height: h });

      const offCanvas = document.createElement('canvas');
      offCanvas.width = w;
      offCanvas.height = h;
      const ctx = offCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = offCanvas.toDataURL('image/png');
        setHistory([dataUrl]);
        setHistoryIndex(0);
        setAdjustments(DEFAULT_ADJUSTMENTS);
        setBaseImageElement(offCanvas);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, []);

  // Helper to extract an image File from a queue item (either source file or converted blob)
  const getImageFileFromItem = useCallback((item: FileItem): File | null => {
    if (item.file && (item.file.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|svg|ico)$/i.test(item.file.name))) {
      return item.file;
    }
    if (item.resultBlob && item.resultName && /\.(png|jpe?g|webp|bmp|gif|svg|ico)$/i.test(item.resultName)) {
      return new File([item.resultBlob], item.resultName, { type: item.type || 'image/png' });
    }
    if (item.file) {
      return item.file;
    }
    return null;
  }, []);

  const availableImageItems = useMemo(() => {
    return fileList.filter((f) => {
      const isImgExt = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'ico'].includes(f.format?.toLowerCase());
      const isImgType = f.type?.startsWith('image/');
      const isImgName = /\.(png|jpe?g|webp|bmp|gif|svg|ico)$/i.test(f.name);
      const hasImgResult = f.resultBlob && f.resultName && /\.(png|jpe?g|webp|bmp|gif|svg|ico)$/i.test(f.resultName);
      return isImgExt || isImgType || isImgName || hasImgResult;
    });
  }, [fileList]);

  // Auto load sharedFile or first image from fileList if available
  useEffect(() => {
    if (
      sharedFile &&
      sharedFile !== loadedSharedFileRef.current &&
      (sharedFile.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|svg|ico)$/i.test(sharedFile.name))
    ) {
      loadedSharedFileRef.current = sharedFile;
      loadImageFile(sharedFile);
    } else if (availableImageItems.length > 0 && !currentFile && !loadedSharedFileRef.current) {
      const firstItem = availableImageItems[0];
      const imgFile = getImageFileFromItem(firstItem);
      if (imgFile) {
        setSelectedFileId(firstItem.id);
        loadImageFile(imgFile);
      }
    }
  }, [sharedFile, availableImageItems, currentFile, loadImageFile, getImageFileFromItem]);

  // Build CSS filter string from adjustments
  const getFilterString = useCallback((adj: FilterAdjustments) => {
    return `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%) blur(${adj.blur}px) sepia(${adj.sepia}%) grayscale(${adj.grayscale}%) invert(${adj.invert}%) hue-rotate(${adj.hueRotate}deg)`;
  }, []);

  // Render current base image + live adjustments + active tool overlay
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseImageElement) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = getSourceWidth(baseImageElement);
    const h = getSourceHeight(baseImageElement);
    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.filter = getFilterString(adjustments);
    ctx.drawImage(baseImageElement, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Sync overlay canvas dimensions
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      const octx = overlay.getContext('2d');
      if (octx) {
        octx.clearRect(0, 0, overlay.width, overlay.height);

        // Draw Crop Overlay if crop tool is active
        if (activeTool === 'crop') {
          const cx = Math.round(cropRect.x * overlay.width);
          const cy = Math.round(cropRect.y * overlay.height);
          const cw = Math.round(cropRect.w * overlay.width);
          const ch = Math.round(cropRect.h * overlay.height);

          octx.fillStyle = 'rgba(15, 23, 42, 0.55)';
          octx.fillRect(0, 0, overlay.width, overlay.height);
          octx.clearRect(cx, cy, cw, ch);

          octx.strokeStyle = '#3b82f6';
          octx.lineWidth = Math.max(2, Math.round(overlay.width / 300));
          octx.strokeRect(cx, cy, cw, ch);

          // Rule of thirds grid lines
          octx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          octx.lineWidth = 1;
          octx.beginPath();
          octx.moveTo(cx + cw / 3, cy);
          octx.lineTo(cx + cw / 3, cy + ch);
          octx.moveTo(cx + (cw * 2) / 3, cy);
          octx.lineTo(cx + (cw * 2) / 3, cy + ch);
          octx.moveTo(cx, cy + ch / 3);
          octx.lineTo(cx + cw, cy + ch / 3);
          octx.moveTo(cx, cy + (ch * 2) / 3);
          octx.lineTo(cx + cw, cy + (ch * 2) / 3);
          octx.stroke();
        }

        // Draw live Text preview if text tool is active
        if (activeTool === 'text' && textInput.trim()) {
          const tx = Math.round(textPos.x * overlay.width);
          const ty = Math.round(textPos.y * overlay.height);
          const scaledFontSize = Math.max(14, Math.round((textFontSize * overlay.width) / 800));
          octx.font = `bold ${scaledFontSize}px sans-serif`;
          octx.textAlign = 'center';
          octx.textBaseline = 'middle';

          const metrics = octx.measureText(textInput);
          const padX = Math.round(scaledFontSize * 0.5);
          const padY = Math.round(scaledFontSize * 0.35);
          const boxW = metrics.width + padX * 2;
          const boxH = scaledFontSize + padY * 2;

          if (textUseBg) {
            octx.fillStyle = textBgColor;
            octx.beginPath();
            octx.roundRect(tx - boxW / 2, ty - boxH / 2, boxW, boxH, 8);
            octx.fill();
          }

          octx.fillStyle = textColor;
          octx.fillText(textInput, tx, ty);
        }
      }
    }
  }, [baseImageElement, canvasSize, adjustments, activeTool, cropRect, textInput, textPos, textFontSize, textColor, textBgColor, textUseBg, getFilterString]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Push new snapshot to history (accepts HTMLCanvasElement directly or data URL)
  const pushHistorySnapshot = (source: HTMLCanvasElement | string) => {
    if (typeof source !== 'string') {
      const off = document.createElement('canvas');
      off.width = source.width;
      off.height = source.height;
      const ctx = off.getContext('2d');
      if (ctx) ctx.drawImage(source, 0, 0);
      setBaseImageElement(off);
      setCanvasSize({ width: off.width, height: off.height });
      const dataUrl = off.toDataURL('image/png');
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        return [...sliced, dataUrl];
      });
      setHistoryIndex((prev) => prev + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setBaseImageElement(img);
      setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight });
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        return [...sliced, source];
      });
      setHistoryIndex((prev) => prev + 1);
    };
    img.src = source;
  };

  // Commit current CSS filter adjustments into base image
  const handleCommitAdjustments = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setActivePreset('none');
    pushHistorySnapshot(canvas);
    if (onShowToast) onShowToast(lang === 'ja' ? '色調・フィルタを画像に適用しました' : 'Adjustments applied');
  };

  // Undo / Redo
  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const nextIdx = historyIndex - 1;
    const url = history[nextIdx];
    const img = new Image();
    img.onload = () => {
      setBaseImageElement(img);
      setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight });
      setHistoryIndex(nextIdx);
      setAdjustments(DEFAULT_ADJUSTMENTS);
    };
    img.src = url;
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIdx = historyIndex + 1;
    const url = history[nextIdx];
    const img = new Image();
    img.onload = () => {
      setBaseImageElement(img);
      setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight });
      setHistoryIndex(nextIdx);
      setAdjustments(DEFAULT_ADJUSTMENTS);
    };
    img.src = url;
  };

  // Rotate 90 deg or Flip
  const handleTransform = (type: 'rotate90' | 'flipH' | 'flipV') => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const off = document.createElement('canvas');
    const ctx = off.getContext('2d');
    if (!ctx) return;

    if (type === 'rotate90') {
      off.width = canvas.height;
      off.height = canvas.width;
      ctx.translate(off.width / 2, off.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    } else if (type === 'flipH') {
      off.width = canvas.width;
      off.height = canvas.height;
      ctx.translate(off.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(canvas, 0, 0);
    } else {
      off.width = canvas.width;
      off.height = canvas.height;
      ctx.translate(0, off.height);
      ctx.scale(1, -1);
      ctx.drawImage(canvas, 0, 0);
    }

    setAdjustments(DEFAULT_ADJUSTMENTS);
    pushHistorySnapshot(off);
  };

  // Execute Crop
  const handleApplyCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cx = Math.max(0, Math.round(cropRect.x * canvas.width));
    const cy = Math.max(0, Math.round(cropRect.y * canvas.height));
    const cw = Math.max(10, Math.min(canvas.width - cx, Math.round(cropRect.w * canvas.width)));
    const ch = Math.max(10, Math.min(canvas.height - cy, Math.round(cropRect.h * canvas.height)));

    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setCropRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    pushHistorySnapshot(off);
    if (onShowToast) onShowToast(lang === 'ja' ? '画像を切り取りました' : 'Image cropped');
  };

  // Stamp text onto base image
  const handleStampText = () => {
    const canvas = canvasRef.current;
    if (!canvas || !textInput.trim()) return;

    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(canvas, 0, 0);

    const tx = Math.round(textPos.x * off.width);
    const ty = Math.round(textPos.y * off.height);
    const scaledFontSize = Math.max(14, Math.round((textFontSize * off.width) / 800));
    ctx.font = `bold ${scaledFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(textInput);
    const padX = Math.round(scaledFontSize * 0.5);
    const padY = Math.round(scaledFontSize * 0.35);
    const boxW = metrics.width + padX * 2;
    const boxH = scaledFontSize + padY * 2;

    if (textUseBg) {
      ctx.fillStyle = textBgColor;
      ctx.beginPath();
      ctx.roundRect(tx - boxW / 2, ty - boxH / 2, boxW, boxH, 8);
      ctx.fill();
    }

    ctx.fillStyle = textColor;
    ctx.fillText(textInput, tx, ty);

    setAdjustments(DEFAULT_ADJUSTMENTS);
    pushHistorySnapshot(off);
    if (onShowToast) onShowToast(lang === 'ja' ? 'テキストを画像に追加しました' : 'Text added to image');
  };

  // Helper: Pixelate a rectangular region on a canvas context
  const pixelateRegion = (
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    blockSize: number
  ) => {
    const x = Math.max(0, Math.floor(Math.min(rx, rx + rw)));
    const y = Math.max(0, Math.floor(Math.min(ry, ry + rh)));
    const w = Math.min(sourceCanvas.width - x, Math.ceil(Math.abs(rw)));
    const h = Math.min(sourceCanvas.height - y, Math.ceil(Math.abs(rh)));
    if (w <= 0 || h <= 0) return;

    const step = Math.max(4, Math.round((blockSize * sourceCanvas.width) / 800));
    const imgData = ctx.getImageData(x, y, w, h);
    const data = imgData.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const sampleX = Math.min(w - 1, px + Math.floor(step / 2));
        const sampleY = Math.min(h - 1, py + Math.floor(step / 2));
        const idx = (sampleY * w + sampleX) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(x + px, y + py, Math.min(step, w - px), Math.min(step, h - py));
      }
    }
  };

  // Get canvas pixel coordinates from mouse/touch event
  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return { x: 0, y: 0, normX: 0, normY: 0 };
    const rect = overlay.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0 : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0 : e.clientY;
    const normX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return {
      x: Math.round(normX * overlay.width),
      y: Math.round(normY * overlay.height),
      normX,
      normY,
    };
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!baseImageElement) return;
    const pt = getCanvasPoint(e);

    if (activeTool === 'text') {
      setTextPos({ x: pt.normX, y: pt.normY });
      return;
    }

    isDrawingRef.current = true;
    startPointRef.current = { x: pt.x, y: pt.y };
    lastPointRef.current = { x: pt.x, y: pt.y };

    if (activeTool === 'crop') {
      setCropRect({ x: pt.normX, y: pt.normY, w: 0.05, h: 0.05 });
    } else if (activeTool === 'mosaic' && mosaicMode === 'brush') {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const bSize = Math.max(24, Math.round((mosaicSize * 2.5 * canvas.width) / 800));
        pixelateRegion(ctx, canvas, pt.x - bSize / 2, pt.y - bSize / 2, bSize, bSize, mosaicSize);
      }
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !baseImageElement) return;
    const pt = getCanvasPoint(e);
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!canvas || !overlay) return;

    if (activeTool === 'crop') {
      const startNormX = startPointRef.current.x / overlay.width;
      const startNormY = startPointRef.current.y / overlay.height;
      const minX = Math.min(startNormX, pt.normX);
      const minY = Math.min(startNormY, pt.normY);
      let w = Math.max(0.05, Math.abs(pt.normX - startNormX));
      let h = Math.max(0.05, Math.abs(pt.normY - startNormY));
      if (cropAspect) {
        h = Math.min(1 - minY, (w * overlay.width) / (cropAspect * overlay.height));
      }
      setCropRect({ x: minX, y: minY, w, h });
      return;
    }

    if (activeTool === 'mosaic') {
      const ctx = canvas.getContext('2d');
      const octx = overlay.getContext('2d');
      if (!ctx || !octx) return;

      if (mosaicMode === 'brush') {
        const bSize = Math.max(24, Math.round((mosaicSize * 2.5 * canvas.width) / 800));
        pixelateRegion(ctx, canvas, pt.x - bSize / 2, pt.y - bSize / 2, bSize, bSize, mosaicSize);
      } else {
        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.strokeStyle = '#3b82f6';
        octx.lineWidth = 2;
        octx.setLineDash([6, 4]);
        octx.strokeRect(
          startPointRef.current.x,
          startPointRef.current.y,
          pt.x - startPointRef.current.x,
          pt.y - startPointRef.current.y
        );
        octx.setLineDash([]);
      }
      return;
    }

    if (activeTool === 'markup') {
      const ctx = canvas.getContext('2d');
      const octx = overlay.getContext('2d');
      if (!ctx || !octx) return;

      const scaledWidth = Math.max(2, Math.round((markupStrokeWidth * canvas.width) / 800));

      if (markupShape === 'pen' || markupShape === 'highlighter') {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = markupColor;
        ctx.lineWidth = markupShape === 'highlighter' ? scaledWidth * 3.5 : scaledWidth;
        ctx.globalAlpha = markupShape === 'highlighter' ? 0.35 : 1.0;
        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        ctx.restore();
        lastPointRef.current = { x: pt.x, y: pt.y };
      } else {
        octx.clearRect(0, 0, overlay.width, overlay.height);
        drawMarkupShape(octx, markupShape, startPointRef.current.x, startPointRef.current.y, pt.x, pt.y, markupColor, scaledWidth);
      }
    }
  };

  const drawMarkupShape = (
    ctx: CanvasRenderingContext2D,
    shape: MarkupShape,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    lineWidth: number
  ) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape === 'rect') {
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (shape === 'circle') {
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === 'arrow') {
      const headLen = Math.max(12, lineWidth * 3.5);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  const handlePointerUp = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !baseImageElement) return;
    isDrawingRef.current = false;

    const pt = getCanvasPoint(e);
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!canvas || !overlay) return;

    const ctx = canvas.getContext('2d');
    const octx = overlay.getContext('2d');
    if (!ctx || !octx) return;

    if (activeTool === 'mosaic') {
      if (mosaicMode === 'rect') {
        octx.clearRect(0, 0, overlay.width, overlay.height);
        pixelateRegion(
          ctx,
          canvas,
          startPointRef.current.x,
          startPointRef.current.y,
          pt.x - startPointRef.current.x,
          pt.y - startPointRef.current.y,
          mosaicSize
        );
      }
      setAdjustments(DEFAULT_ADJUSTMENTS);
      pushHistorySnapshot(canvas);
      return;
    }

    if (activeTool === 'markup') {
      const scaledWidth = Math.max(2, Math.round((markupStrokeWidth * canvas.width) / 800));
      if (markupShape !== 'pen' && markupShape !== 'highlighter') {
        octx.clearRect(0, 0, overlay.width, overlay.height);
        drawMarkupShape(ctx, markupShape, startPointRef.current.x, startPointRef.current.y, pt.x, pt.y, markupColor, scaledWidth);
      }
      setAdjustments(DEFAULT_ADJUSTMENTS);
      pushHistorySnapshot(canvas);
    }
  };

  // Apply Filter Preset
  const applyFilterPreset = (presetId: string) => {
    setActivePreset(presetId);
    switch (presetId) {
      case 'none':
        setAdjustments(DEFAULT_ADJUSTMENTS);
        break;
      case 'vivid':
        setAdjustments({ ...DEFAULT_ADJUSTMENTS, contrast: 120, saturate: 145, brightness: 105 });
        break;
      case 'mono':
        setAdjustments({ ...DEFAULT_ADJUSTMENTS, grayscale: 100, contrast: 115 });
        break;
      case 'sepia':
        setAdjustments({ ...DEFAULT_ADJUSTMENTS, sepia: 85, contrast: 105, brightness: 98 });
        break;
      case 'document':
        setAdjustments({ ...DEFAULT_ADJUSTMENTS, grayscale: 100, contrast: 165, brightness: 112 });
        break;
      case 'warm':
        setAdjustments({ ...DEFAULT_ADJUSTMENTS, sepia: 25, saturate: 120, brightness: 105 });
        break;
      case 'cool':
        setAdjustments({ ...DEFAULT_ADJUSTMENTS, hueRotate: 190, saturate: 90, contrast: 110 });
        break;
      case 'invert':
        setAdjustments({ ...DEFAULT_ADJUSTMENTS, invert: 100 });
        break;
    }
  };

  // Export & Save Image (supports PNG, JPG, WebP, BMP, ICO)
  const handleExportImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !currentFile) return;

    let exportCanvas = canvas;
    if (exportFormat === 'jpg' || exportFormat === 'bmp') {
      const whiteCanvas = document.createElement('canvas');
      whiteCanvas.width = canvas.width;
      whiteCanvas.height = canvas.height;
      const wctx = whiteCanvas.getContext('2d');
      if (wctx) {
        wctx.fillStyle = '#ffffff';
        wctx.fillRect(0, 0, whiteCanvas.width, whiteCanvas.height);
        wctx.drawImage(canvas, 0, 0);
        exportCanvas = whiteCanvas;
      }
    }

    const baseName = currentFile.name.substring(0, currentFile.name.lastIndexOf('.')) || currentFile.name;
    const resultName = `Edited_${baseName}.${exportFormat}`;

    const finishExport = async (blob: Blob, mime: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`imgedit_${Date.now()}`, currentFile.name, resultName, blob, exportFormat);

      if (onResultReady) {
        onResultReady({
          id: `res_imgedit_${Date.now()}`,
          name: resultName,
          file: new File([blob], resultName, { type: mime }),
          size: blob.size,
          type: mime,
          format: exportFormat as DocumentFormat,
          targetFormat: exportFormat as DocumentFormat,
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? '画像の保存が完了しました' : 'Image Saved', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を保存しました` : `Saved "${resultName}"`);
    };

    if (exportFormat === 'bmp') {
      try {
        const bmpBlob = canvasToBmpBlob(exportCanvas);
        await finishExport(bmpBlob, 'image/bmp');
      } catch (e: any) {
        console.error('BMP export failed:', e);
        if (onShowToast) onShowToast(lang === 'ja' ? 'BMPへの変換に失敗しました' : 'Failed to export BMP');
      }
      return;
    }

    if (exportFormat === 'ico') {
      try {
        const icoBlob = await canvasToIcoBlob(exportCanvas, [16, 32, 48, 64, 128, 256]);
        await finishExport(icoBlob, 'image/x-icon');
      } catch (e: any) {
        console.error('ICO export failed:', e);
        if (onShowToast) onShowToast(lang === 'ja' ? 'ICOアイコンへの変換に失敗しました' : 'Failed to export ICO');
      }
      return;
    }

    const mimeMap: Record<'png' | 'jpg' | 'webp', string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      webp: 'image/webp',
    };
    const mime = mimeMap[exportFormat];

    exportCanvas.toBlob(
      async (blob) => {
        if (!blob) return;
        await finishExport(blob, mime);
      },
      mime,
      0.92
    );
  };

  const tools: { id: EditorTool; labelJa: string; labelEn: string; icon: any }[] = [
    { id: 'adjust', labelJa: '色調・コントラスト', labelEn: 'Adjust & Contrast', icon: Sliders },
    { id: 'filter', labelJa: 'フィルタ効果', labelEn: 'Filters', icon: Sparkles },
    { id: 'crop', labelJa: '切り取り・回転', labelEn: 'Crop & Rotate', icon: Crop },
    { id: 'mosaic', labelJa: 'モザイク・ぼかし', labelEn: 'Mosaic & Blur', icon: Grid },
    { id: 'markup', labelJa: 'マークアップ描画', labelEn: 'Markup & Draw', icon: PenTool },
    { id: 'text', labelJa: '文字追加', labelEn: 'Add Text', icon: Type },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Add To Queue Confirmation Modal */}
      <AddToQueuePromptModal
        file={pendingPromptFile}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (!pendingPromptFile) return;
          if (onAddFiles) onAddFiles([pendingPromptFile]);
          loadImageFile(pendingPromptFile);
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={() => {
          if (!pendingPromptFile) return;
          loadImageFile(pendingPromptFile);
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'このタブのみに読み込みました' : 'Loaded into this tab only');
          }
          setPendingPromptFile(null);
        }}
      />

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            setPendingPromptFile(e.target.files[0]);
            e.target.value = '';
          }
        }}
      />

      {/* Top Tool Selector Bar */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
        {tools.map((t) => {
          const Icon = t.icon;
          const isActive = activeTool === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                isActive
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? t.labelJa : t.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* Loaded Files Selector from Main Queue */}
      <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {lang === 'ja' ? '読み込み済みファイルから画像を選択:' : 'Select Image from Queue:'}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold">
              {availableImageItems.length} {lang === 'ja' ? '件利用可能' : 'available'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedFileId}
            onChange={(e) => {
              const id = e.target.value;
              if (id === '__upload_new__') {
                fileInputRef.current?.click();
                return;
              }
              setSelectedFileId(id);
              const found = availableImageItems.find((f) => f.id === id);
              if (found) {
                const imgFile = getImageFileFromItem(found);
                if (imgFile) loadImageFile(imgFile);
              }
            }}
            className="main-select text-xs py-2 w-full sm:max-w-md mb-0"
          >
            <option value="">{lang === 'ja' ? '-- アップロードされた画像を選択 --' : '-- Select Uploaded Image --'}</option>
            <option value="__upload_new__">
              {lang === 'ja' ? '📁 ＋ 新しい画像を端末からアップロード...' : '📁 + Upload New Image File...'}
            </option>
            {availableImageItems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({(f.size / 1024).toFixed(1)} KB)
              </option>
            ))}
          </select>

          {/* Quick Switch Chips */}
          {availableImageItems.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
              {availableImageItems.map((f) => {
                const isCurrent = currentFile && (f.file === currentFile || f.name === currentFile.name);
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setSelectedFileId(f.id);
                      const imgFile = getImageFileFromItem(f);
                      if (imgFile) loadImageFile(imgFile);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition whitespace-nowrap ${
                      isCurrent
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                    }`}
                  >
                    <ImageIcon className="w-3 h-3 opacity-70" />
                    <span className="max-w-[130px] truncate">{f.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {!currentFile ? (
        <div className="flex flex-col gap-4">
          {availableImageItems.length > 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-blue-600" />
                    <span>{lang === 'ja' ? 'アップロード済みのファイルから画像を選択' : 'Select from Uploaded Images'}</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {lang === 'ja'
                      ? 'すでに読み込まれている以下の画像をクリックすると、すぐに編集を開始できます。'
                      : 'Click any loaded image below to open it directly in the editor.'}
                  </p>
                </div>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-sm btn-primary flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '端末から別の画像を開く' : 'Upload from Device'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {availableImageItems.map((item) => {
                  const imgFile = getImageFileFromItem(item);
                  const previewSrc = item.previewUrl || (imgFile ? URL.createObjectURL(imgFile) : undefined);
                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setSelectedFileId(item.id);
                        if (imgFile) loadImageFile(imgFile);
                      }}
                      className="group cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-md p-3 flex flex-col gap-2 transition"
                    >
                      <div className="w-full h-28 rounded-lg bg-slate-200 dark:bg-slate-700/60 flex items-center justify-center overflow-hidden">
                        {previewSrc ? (
                          <img
                            src={previewSrc}
                            alt={item.name}
                            className="w-full h-full object-contain group-hover:scale-105 transition duration-200"
                          />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate group-hover:text-blue-600">
                          {item.name}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {(item.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFileId(item.id);
                          if (imgFile) loadImageFile(imgFile);
                        }}
                        className="mt-1 w-full py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition"
                      >
                        {lang === 'ja' ? '編集を開始' : 'Edit Image'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-2xl p-12 flex flex-col items-center justify-center text-center cursor-pointer bg-white/60 dark:bg-slate-900/60 transition"
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center mb-3">
                <Sliders className="w-7 h-7" />
              </div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-base">
                {lang === 'ja' ? '編集する画像ファイルを選択' : 'Select an image to edit'}
              </h4>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                {lang === 'ja'
                  ? '切り取り（トリミング）、モザイク処理、文字入れ、矢印・枠線のマークアップ、コントラスト調整、フィルタ加工がブラウザ内で完結します。'
                  : 'Crop, pixelate/mosaic, add text, draw markup annotations, and adjust contrast & filters entirely in your browser.'}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 8 Cols: Interactive Canvas Viewport */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
            {/* Top Action Bar (Undo/Redo, Dimensions, Export) */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                  title={lang === 'ja' ? '元に戻す (Undo)' : 'Undo'}
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                  title={lang === 'ja' ? 'やり直す (Redo)' : 'Redo'}
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-500 ml-2 font-mono">
                  {canvasSize.width} × {canvasSize.height} px
                </span>
              </div>

              {/* Canvas Background Color Mode Switcher */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                <span className="text-[10px] text-slate-500 px-1 font-medium">{lang === 'ja' ? '背景:' : 'BG:'}</span>
                <button
                  type="button"
                  onClick={() => setCanvasBgMode('checkerboard')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                    canvasBgMode === 'checkerboard'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                  title={lang === 'ja' ? '市松模様（透過背景）' : 'Checkerboard (Transparent)'}
                >
                  🏁
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasBgMode('white')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                    canvasBgMode === 'white'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                  title={lang === 'ja' ? '白色背景' : 'White background'}
                >
                  ⬜
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasBgMode('dark')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                    canvasBgMode === 'dark'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                  title={lang === 'ja' ? '暗色背景' : 'Dark background'}
                >
                  ⬛
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                >
                  <option value="png">PNG (.png)</option>
                  <option value="jpg">JPEG (.jpg)</option>
                  <option value="webp">WebP (.webp)</option>
                  <option value="bmp">BMP (.bmp)</option>
                  <option value="ico">ICO (.ico)</option>
                </select>

                <button
                  onClick={handleExportImage}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '画像を出力・保存' : 'Export & Save'}</span>
                </button>
              </div>
            </div>

            {/* Canvas Container */}
            <div
              className={`relative rounded-xl overflow-hidden flex items-center justify-center min-h-[360px] max-h-[580px] p-2 select-none transition-colors border border-slate-200 dark:border-slate-800 ${
                canvasBgMode === 'white'
                  ? 'bg-white'
                  : canvasBgMode === 'dark'
                  ? 'bg-slate-950'
                  : 'checkerboard-bg'
              }`}
            >
              <div className="relative inline-block max-w-full max-h-[540px]">
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-[540px] w-auto h-auto object-contain block rounded shadow-md"
                />
                <canvas
                  ref={overlayCanvasRef}
                  onMouseDown={handlePointerDown}
                  onMouseMove={handlePointerMove}
                  onMouseUp={handlePointerUp}
                  onMouseLeave={handlePointerUp}
                  onTouchStart={handlePointerDown}
                  onTouchMove={handlePointerMove}
                  onTouchEnd={handlePointerUp}
                  className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500 text-center">
              {activeTool === 'crop' &&
                (lang === 'ja'
                  ? '画像上をドラッグして切り取り範囲を指定し、「切り取りを実行」を押してください。'
                  : 'Drag on the image to select crop region, then click Apply Crop.')}
              {activeTool === 'mosaic' &&
                (lang === 'ja'
                  ? '隠したい個人情報や顔の上をドラッグするとモザイク処理が適用されます。'
                  : 'Drag over sensitive areas on the image to pixelate/mosaic.')}
              {activeTool === 'markup' &&
                (lang === 'ja'
                  ? '画像上をドラッグしてペン・蛍光ペン・矢印・枠線を描画できます。'
                  : 'Drag on the image to draw pen strokes, arrows, or shapes.')}
              {activeTool === 'text' &&
                (lang === 'ja'
                  ? '画像上の配置したい場所をクリックして位置を合わせ、「文字を画像に確定」を押してください。'
                  : 'Click anywhere on the image to position the text, then click Stamp Text.')}
            </p>
          </div>

          {/* Right 4 Cols: Active Tool Inspector Controls */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col gap-4">
            {/* 1. Adjust & Contrast */}
            {activeTool === 'adjust' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                    {lang === 'ja' ? '色調・コントラスト調整' : 'Color & Contrast'}
                  </h3>
                  <button
                    onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
                    className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                  >
                    {lang === 'ja' ? 'リセット' : 'Reset'}
                  </button>
                </div>

                {[
                  { key: 'brightness', labelJa: '明るさ (Brightness)', min: 30, max: 200, unit: '%' },
                  { key: 'contrast', labelJa: 'コントラスト (Contrast)', min: 30, max: 220, unit: '%' },
                  { key: 'saturate', labelJa: '彩度 (Saturation)', min: 0, max: 250, unit: '%' },
                  { key: 'hueRotate', labelJa: '色相 (Hue)', min: 0, max: 360, unit: '°' },
                  { key: 'blur', labelJa: '全体ぼかし (Blur)', min: 0, max: 20, unit: 'px' },
                ].map((item) => (
                  <div key={item.key}>
                    <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      <span>{item.labelJa}</span>
                      <span className="font-mono">
                        {(adjustments as any)[item.key]}
                        {item.unit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={item.min}
                      max={item.max}
                      value={(adjustments as any)[item.key]}
                      onChange={(e) =>
                        setAdjustments((prev) => ({
                          ...prev,
                          [item.key]: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>
                ))}

                <button
                  onClick={handleCommitAdjustments}
                  className="mt-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{lang === 'ja' ? '調整を確定する' : 'Apply Adjustments'}</span>
                </button>
              </div>
            )}

            {/* 2. Filters */}
            {activeTool === 'filter' && (
              <div className="flex flex-col gap-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                  {lang === 'ja' ? 'ワンクリック・フィルタ効果' : 'Filter Presets'}
                </h3>

                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { id: 'none', labelJa: 'オリジナル (標準)', labelEn: 'Original' },
                    { id: 'vivid', labelJa: '鮮やか (Vivid)', labelEn: 'Vivid' },
                    { id: 'document', labelJa: '書類くっきり (白黒強調)', labelEn: 'Document Scan' },
                    { id: 'mono', labelJa: 'モノクロ (B&W)', labelEn: 'Monochrome' },
                    { id: 'sepia', labelJa: 'セピア (レトロ)', labelEn: 'Sepia' },
                    { id: 'warm', labelJa: 'ウォーム (暖色)', labelEn: 'Warm' },
                    { id: 'cool', labelJa: 'クール (寒色)', labelEn: 'Cool' },
                    { id: 'invert', labelJa: '階調反転 (ネガ)', labelEn: 'Invert' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyFilterPreset(p.id)}
                      className={`p-3 rounded-xl text-xs font-bold border text-left transition ${
                        activePreset === p.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {lang === 'ja' ? p.labelJa : p.labelEn}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleCommitAdjustments}
                  className="mt-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{lang === 'ja' ? 'フィルタを画像に確定' : 'Apply Filter'}</span>
                </button>
              </div>
            )}

            {/* 3. Crop & Rotate */}
            {activeTool === 'crop' && (
              <div className="flex flex-col gap-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                  {lang === 'ja' ? '切り取り（トリミング）・回転・反転' : 'Crop, Rotate & Flip'}
                </h3>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                    {lang === 'ja' ? 'アスペクト比 (縦横比)' : 'Aspect Ratio'}
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: lang === 'ja' ? '自由' : 'Free', val: null },
                      { label: '1:1', val: 1 },
                      { label: '16:9', val: 16 / 9 },
                      { label: '4:3', val: 4 / 3 },
                    ].map((r) => (
                      <button
                        key={r.label}
                        onClick={() => {
                          setCropAspect(r.val);
                          if (r.val) {
                            setCropRect({ x: 0.1, y: 0.1, w: 0.6, h: Math.min(0.8, 0.6 / r.val) });
                          }
                        }}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition ${
                          cropAspect === r.val
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleApplyCrop}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <Crop className="w-4 h-4" />
                  <span>{lang === 'ja' ? '選択範囲で切り取りを実行' : 'Apply Crop'}</span>
                </button>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                    {lang === 'ja' ? '回転・反転' : 'Rotate & Flip'}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleTransform('rotate90')}
                      className="flex flex-col items-center gap-1 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <RotateCw className="w-4 h-4 text-blue-600" />
                      <span>{lang === 'ja' ? '90°回転' : 'Rotate 90°'}</span>
                    </button>
                    <button
                      onClick={() => handleTransform('flipH')}
                      className="flex flex-col items-center gap-1 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <FlipHorizontal className="w-4 h-4 text-blue-600" />
                      <span>{lang === 'ja' ? '左右反転' : 'Flip H'}</span>
                    </button>
                    <button
                      onClick={() => handleTransform('flipV')}
                      className="flex flex-col items-center gap-1 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <FlipVertical className="w-4 h-4 text-blue-600" />
                      <span>{lang === 'ja' ? '上下反転' : 'Flip V'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Mosaic & Pixelate */}
            {activeTool === 'mosaic' && (
              <div className="flex flex-col gap-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                  {lang === 'ja' ? 'モザイク・個人情報保護' : 'Mosaic & Privacy Blur'}
                </h3>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMosaicMode('rect')}
                    className={`p-2.5 rounded-xl text-xs font-bold border transition ${
                      mosaicMode === 'rect'
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {lang === 'ja' ? '矩形ドラッグ選択' : 'Rectangle Area'}
                  </button>
                  <button
                    onClick={() => setMosaicMode('brush')}
                    className={`p-2.5 rounded-xl text-xs font-bold border transition ${
                      mosaicMode === 'brush'
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {lang === 'ja' ? 'なぞりブラシ' : 'Brush Stroke'}
                  </button>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    <span>{lang === 'ja' ? 'モザイクの粗さ (粒度)' : 'Mosaic Block Size'}</span>
                    <span className="font-mono">{mosaicSize} px</span>
                  </div>
                  <input
                    type="range"
                    min="6"
                    max="40"
                    step="2"
                    value={mosaicSize}
                    onChange={(e) => setMosaicSize(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                  {lang === 'ja'
                    ? 'プレビュー画像の上をマウスまたは指でドラッグすると、その部分に即座にモザイク処理がかかります。間違えた場合は「元に戻す」ボタンで戻せます。'
                    : 'Drag directly over the image preview to apply pixelation mosaic. Use Undo to revert.'}
                </div>
              </div>
            )}

            {/* 5. Markup & Draw */}
            {activeTool === 'markup' && (
              <div className="flex flex-col gap-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                  {lang === 'ja' ? 'マークアップ・図形描画' : 'Markup & Annotations'}
                </h3>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'pen', labelJa: 'ペン', labelEn: 'Pen', icon: PenTool },
                    { id: 'highlighter', labelJa: '蛍光ペン', labelEn: 'Marker', icon: Eraser },
                    { id: 'arrow', labelJa: '矢印', labelEn: 'Arrow', icon: ArrowRight },
                    { id: 'rect', labelJa: '四角枠', labelEn: 'Box', icon: Square },
                    { id: 'circle', labelJa: '丸枠', labelEn: 'Circle', icon: Circle },
                  ].map((s) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setMarkupShape(s.id as MarkupShape)}
                        className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs font-bold transition ${
                          markupShape === s.id
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{lang === 'ja' ? s.labelJa : s.labelEn}</span>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                    {lang === 'ja' ? '描画カラー' : 'Color'}
                  </label>
                  <div className="flex items-center gap-2">
                    {['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ffffff', '#0f172a'].map((c) => (
                      <button
                        key={c}
                        onClick={() => setMarkupColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-7 h-7 rounded-full border-2 transition ${
                          markupColor === c ? 'border-blue-600 scale-110' : 'border-slate-300 dark:border-slate-700'
                        }`}
                      />
                    ))}
                    <input
                      type="color"
                      value={markupColor}
                      onChange={(e) => setMarkupColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border border-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    <span>{lang === 'ja' ? '線の太さ' : 'Stroke Width'}</span>
                    <span className="font-mono">{markupStrokeWidth} px</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="24"
                    value={markupStrokeWidth}
                    onChange={(e) => setMarkupStrokeWidth(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            )}

            {/* 6. Add Text */}
            {activeTool === 'text' && (
              <div className="flex flex-col gap-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                  {lang === 'ja' ? '文字・ラベルの追加' : 'Add Text Overlay'}
                </h3>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {lang === 'ja' ? 'テキスト内容' : 'Text Content'}
                  </label>
                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    <span>{lang === 'ja' ? '文字サイズ' : 'Font Size'}</span>
                    <span className="font-mono">{textFontSize} pt</span>
                  </div>
                  <input
                    type="range"
                    min="14"
                    max="96"
                    value={textFontSize}
                    onChange={(e) => setTextFontSize(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      {lang === 'ja' ? '文字色' : 'Text Color'}
                    </label>
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-full h-8 rounded border border-slate-200 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      {lang === 'ja' ? '背景色' : 'Background'}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={textUseBg}
                        onChange={(e) => setTextUseBg(e.target.checked)}
                        className="accent-blue-600"
                      />
                      <input
                        type="color"
                        value={textBgColor}
                        disabled={!textUseBg}
                        onChange={(e) => setTextBgColor(e.target.value)}
                        className="w-full h-8 rounded border border-slate-200 cursor-pointer disabled:opacity-40"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleStampText}
                  className="mt-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{lang === 'ja' ? '現在の位置に文字を確定' : 'Stamp Text onto Image'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
