import { PDFDocument, rgb, degrees, StandardFonts, PDFPage, LineCapStyle } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import {
  PdfPageInfo,
  SignatureStampPlacement,
  RedactionBox,
  PdfTextBoxAnnotation,
  PdfMarkupAnnotation,
} from '../types';

// Set up pdf.js worker and cMap support
try {
  if (typeof window !== 'undefined') {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version || '4.10.38'}/build/pdf.worker.min.mjs`;
  }
} catch (e) {
  console.warn('PDF.js worker setup warning:', e);
}

const getDocumentOptions = (data: Uint8Array) => ({
  data,
  useSystemFonts: true,
  cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version || '4.10.38'}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version || '4.10.38'}/standard_fonts/`,
});

/**
 * Load PDF and get page thumbnails and metadata
 */
export async function getPdfPages(file: File | ArrayBuffer | Blob): Promise<PdfPageInfo[]> {
  const data = file instanceof Blob ? await file.arrayBuffer() : file;
  const loadingTask = pdfjsLib.getDocument(getDocumentOptions(new Uint8Array(data)));
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const pages: PdfPageInfo[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await (page as any).render({
      canvasContext: ctx,
      viewport: viewport,
      canvas: canvas,
    }).promise;

    const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.85);
    const originalViewport = page.getViewport({ scale: 1.0 });

    pages.push({
      pageNumber: i,
      thumbnailUrl,
      width: originalViewport.width,
      height: originalViewport.height,
      rotation: page.rotate || 0,
      selected: false,
    });
  }

  return pages;
}

/**
 * Extract structured text and lines from PDF
 */
export async function extractPdfText(file: File | ArrayBuffer | Blob): Promise<string> {
  const data = file instanceof Blob ? await file.arrayBuffer() : file;
  const loadingTask = pdfjsLib.getDocument(getDocumentOptions(new Uint8Array(data)));
  const pdfDoc = await loadingTask.promise;
  let fullText = '';

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];

    if (!items || items.length === 0) continue;

    // Group items by Y position (lines) to maintain document layout
    items.sort((a, b) => {
      const yA = a.transform ? a.transform[5] : 0;
      const yB = b.transform ? b.transform[5] : 0;
      if (Math.abs(yA - yB) > 4) {
        return yB - yA;
      }
      const xA = a.transform ? a.transform[4] : 0;
      const xB = b.transform ? b.transform[4] : 0;
      return xA - xB;
    });

    let lines: string[] = [];
    let currentLine: string[] = [];
    let lastY: number | null = null;

    for (const item of items) {
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      const str = item.str || '';
      if (lastY === null || Math.abs(y - lastY) > 4) {
        if (currentLine.length > 0) {
          lines.push(currentLine.join(' '));
          currentLine = [];
        }
        lastY = y;
      }
      if (str.trim()) {
        currentLine.push(str);
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine.join(' '));
    }

    fullText += lines.join('\n') + '\n\n';
  }

  return fullText.trim();
}

/**
 * Extract 2D matrix rows from PDF for tabular spreadsheet export
 */
export async function extractPdfTableRows(file: File | ArrayBuffer | Blob): Promise<string[][]> {
  const data = file instanceof Blob ? await file.arrayBuffer() : file;
  const loadingTask = pdfjsLib.getDocument(getDocumentOptions(new Uint8Array(data)));
  const pdfDoc = await loadingTask.promise;
  const allRows: string[][] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];

    if (!items || items.length === 0) continue;

    items.sort((a, b) => {
      const yA = a.transform ? a.transform[5] : 0;
      const yB = b.transform ? b.transform[5] : 0;
      if (Math.abs(yA - yB) > 5) {
        return yB - yA;
      }
      const xA = a.transform ? a.transform[4] : 0;
      const xB = b.transform ? b.transform[4] : 0;
      return xA - xB;
    });

    let currentLineCells: string[] = [];
    let lastY: number | null = null;
    let lastX: number | null = null;

    for (const item of items) {
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      const x = item.transform ? Math.round(item.transform[4]) : 0;
      const str = (item.str || '').trim();

      if (!str) continue;

      if (lastY === null || Math.abs(y - lastY) > 5) {
        if (currentLineCells.length > 0) {
          allRows.push(currentLineCells);
          currentLineCells = [];
        }
        lastY = y;
        lastX = x;
        currentLineCells.push(str);
      } else {
        // If there is significant horizontal gap or delimiter, treat as new cell
        const gap = lastX !== null ? x - lastX : 0;
        if (gap > 35 || str.includes('\t') || str.includes(',')) {
          currentLineCells.push(str);
        } else {
          // Merge with previous cell or split if space
          if (currentLineCells.length > 0) {
            currentLineCells[currentLineCells.length - 1] += ' ' + str;
          } else {
            currentLineCells.push(str);
          }
        }
        lastX = x;
      }
    }
    if (currentLineCells.length > 0) {
      allRows.push(currentLineCells);
    }
  }

  return allRows.length > 0 ? allRows : [['No data extracted']];
}

/**
 * Convert PDF pages to high-res images
 */
export async function convertPdfToImages(
  file: File | ArrayBuffer | Blob,
  options: {
    format: 'png' | 'jpg' | 'webp';
    dpi?: number;
    pages?: number[];
    quality?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<{ name: string; blob: Blob; pageNumber: number }[]> {
  const data = file instanceof Blob ? await file.arrayBuffer() : file;
  const loadingTask = pdfjsLib.getDocument(getDocumentOptions(new Uint8Array(data)));
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const dpi = options.dpi || 150;
  const scale = dpi / 72; // default 72 DPI
  const results: { name: string; blob: Blob; pageNumber: number }[] = [];

  const targetPages =
    options.pages && options.pages.length > 0
      ? options.pages
      : Array.from({ length: numPages }, (_, i) => i + 1);

  for (let index = 0; index < targetPages.length; index++) {
    const pageNum = targetPages[index];
    if (pageNum < 1 || pageNum > numPages) continue;

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await (page as any).render({
      canvasContext: ctx,
      viewport: viewport,
      canvas: canvas,
    }).promise;

    const mimeType = options.format === 'jpg' ? 'image/jpeg' : `image/${options.format}`;
    const blob: Blob = await new Promise((resolve) => {
      canvas.toBlob(
        (b) => resolve(b || new Blob()),
        mimeType,
        options.quality || 0.92
      );
    });

    results.push({
      name: `page_${pageNum}.${options.format}`,
      blob,
      pageNumber: pageNum,
    });

    if (options.onProgress) {
      options.onProgress(index + 1, targetPages.length);
    }
  }

  return results;
}

/**
 * Merge multiple PDF files into one
 */
export async function mergePdfs(pdfBuffers: ArrayBuffer[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return await mergedPdf.save();
}

/**
 * Split PDF into single pages or ranges
 */
export async function splitPdf(
  pdfBuffer: ArrayBuffer,
  ranges: { start: number; end: number }[]
): Promise<Uint8Array[]> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const results: Uint8Array[] = [];

  for (const range of ranges) {
    const subDoc = await PDFDocument.create();
    const pageIndices: number[] = [];

    for (let i = range.start - 1; i < range.end; i++) {
      if (i >= 0 && i < srcDoc.getPageCount()) {
        pageIndices.push(i);
      }
    }

    if (pageIndices.length > 0) {
      const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach((page) => subDoc.addPage(page));
      results.push(await subDoc.save());
    }
  }

  return results;
}

/**
 * Apply rotation and reorganization to PDF
 */
export async function organizePdf(
  pdfBuffer: ArrayBuffer,
  pageActions: { [pageIndex: number]: { rotate?: number; delete?: boolean } }
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  const pageCount = srcDoc.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    const action = pageActions[i + 1];
    if (action?.delete) continue;

    const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
    if (action?.rotate) {
      const currentRotation = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees((currentRotation + action.rotate) % 360));
    }
    outDoc.addPage(copiedPage);
  }

  return await outDoc.save();
}

/**
 * Add Text Watermark to PDF
 */
export async function addWatermarkToPdf(
  pdfBuffer: ArrayBuffer,
  text: string,
  options?: {
    color?: { r: number; g: number; b: number };
    opacity?: number;
    fontSize?: number;
    rotation?: number;
  }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  const color = options?.color || { r: 0.6, g: 0.6, b: 0.6 };
  const opacity = options?.opacity !== undefined ? options.opacity : 0.25;
  const fontSize = options?.fontSize || 42;
  const rotationDegrees = options?.rotation !== undefined ? options.rotation : 45;

  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);

    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2 - textHeight / 2,
      size: fontSize,
      font: font,
      color: rgb(color.r, color.g, color.b),
      opacity: opacity,
      rotate: degrees(rotationDegrees),
    });
  }

  return await doc.save();
}

/**
 * Extract or manipulate specific pages from PDF
 */
export async function manipulatePdfPages(
  pdfBuffer: ArrayBuffer,
  options: {
    keepPageIndices?: number[];
    pageRotations?: { [index: number]: number };
    deleteIndices?: number[];
  }
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  const totalPages = srcDoc.getPageCount();

  let targetIndices: number[] = [];
  if (options.keepPageIndices && options.keepPageIndices.length > 0) {
    targetIndices = options.keepPageIndices.filter((idx) => idx >= 0 && idx < totalPages);
  } else {
    targetIndices = Array.from({ length: totalPages }, (_, i) => i);
    if (options.deleteIndices && options.deleteIndices.length > 0) {
      const deleteSet = new Set(options.deleteIndices);
      targetIndices = targetIndices.filter((idx) => !deleteSet.has(idx));
    }
  }

  for (const idx of targetIndices) {
    const [copiedPage] = await outDoc.copyPages(srcDoc, [idx]);
    if (options.pageRotations && options.pageRotations[idx]) {
      const currentRot = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees((currentRot + options.pageRotations[idx]) % 360));
    }
    outDoc.addPage(copiedPage);
  }

  return await outDoc.save();
}

/**
 * Apply watermarks and page numbers to PDF
 */
export async function enhancePdf(
  pdfBuffer: ArrayBuffer,
  options: {
    watermarkText?: string;
    watermarkOpacity?: number;
    watermarkAngle?: number;
    watermarkFontSize?: number;
    watermarkColor?: { r: number; g: number; b: number };
    pageNumbering?: {
      enabled: boolean;
      format: 'page_of_total' | 'page_only' | 'dash_page_dash' | string;
      position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-center' | string;
      startNumber: number;
      fontSize?: number;
    };
  }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const total = pages.length;

  for (let i = 0; i < total; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();

    // Watermark
    if (options.watermarkText) {
      const fontSize = options.watermarkFontSize || 48;
      const opacity = options.watermarkOpacity !== undefined ? options.watermarkOpacity : 0.2;
      const angle = options.watermarkAngle !== undefined ? options.watermarkAngle : 45;
      const color = options.watermarkColor || { r: 0.6, g: 0.6, b: 0.6 };

      const textWidth = boldFont.widthOfTextAtSize(options.watermarkText, fontSize);
      const textHeight = boldFont.heightAtSize(fontSize);

      page.drawText(options.watermarkText, {
        x: width / 2 - textWidth / 2,
        y: height / 2 - textHeight / 2,
        size: fontSize,
        font: boldFont,
        color: rgb(color.r, color.g, color.b),
        opacity: opacity,
        rotate: degrees(angle),
      });
    }

    // Page Numbering
    if (options.pageNumbering?.enabled) {
      const pageNum = (options.pageNumbering.startNumber || 1) + i;
      let text = `${pageNum}`;
      if (options.pageNumbering.format === 'page_of_total') {
        text = `${pageNum} / ${total}`;
      } else if (options.pageNumbering.format === 'dash_page_dash') {
        text = `- ${pageNum} -`;
      }

      const numFontSize = options.pageNumbering.fontSize || 10;
      const textWidth = font.widthOfTextAtSize(text, numFontSize);
      let posX = width / 2 - textWidth / 2;
      let posY = 24;

      if (options.pageNumbering.position === 'bottom-right') {
        posX = width - textWidth - 36;
        posY = 24;
      } else if (options.pageNumbering.position === 'bottom-left') {
        posX = 36;
        posY = 24;
      } else if (options.pageNumbering.position === 'top-center') {
        posX = width / 2 - textWidth / 2;
        posY = height - 36;
      } else if (options.pageNumbering.position === 'top-right') {
        posX = width - textWidth - 36;
        posY = height - 36;
      }

      page.drawText(text, {
        x: posX,
        y: posY,
        size: numFontSize,
        font: font,
        color: rgb(0.2, 0.2, 0.2),
        opacity: 0.8,
      });
    }
  }

  return await doc.save();
}

function hexToPdfRgb(hex: string) {
  const clean = (hex || '#000000').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
}

function hexToRgbaCss(hex: string, opacity: number): string {
  const clean = (hex || '#ffffff').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}

async function renderTextBoxToPngBytes(box: PdfTextBoxAnnotation): Promise<Uint8Array> {
  const scale = 4; // 4x oversampling for razor-sharp Japanese/Unicode text
  const w = Math.max(20, Math.round(box.width * scale));
  const h = Math.max(16, Math.round(box.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array();

  // Background fill
  if (box.bgColor && box.bgColor !== 'transparent' && box.bgOpacity > 0) {
    ctx.fillStyle = hexToRgbaCss(box.bgColor, box.bgOpacity);
    ctx.fillRect(0, 0, w, h);
  }

  // Border
  if (box.borderWidth > 0 && box.borderColor && box.borderColor !== 'transparent') {
    const bw = box.borderWidth * scale;
    ctx.strokeStyle = box.borderColor;
    ctx.lineWidth = bw;
    ctx.strokeRect(bw / 2, bw / 2, w - bw, h - bw);
  }

  // Typography
  const fontStack =
    box.fontFamily === 'serif'
      ? '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif'
      : box.fontFamily === 'mono'
      ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      : '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", -apple-system, BlinkMacSystemFont, sans-serif';
  const fontSizePx = box.fontSize * scale;
  const weight = box.bold ? '700' : '500';
  ctx.font = `${weight} ${fontSizePx}px ${fontStack}`;
  ctx.fillStyle = box.textColor || '#0f172a';
  ctx.textBaseline = 'top';

  const padX = Math.max(6, 6 * scale);
  const padY = Math.max(5, 5 * scale);
  const maxTextWidth = Math.max(10, w - padX * 2);
  const lineHeight = fontSizePx * 1.35;

  // Wrap lines cleanly character-by-character for CJK + English compatibility
  const rawParagraphs = (box.text || '').split(/\r?\n/);
  const lines: string[] = [];
  for (const para of rawParagraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    let currentLine = '';
    for (const ch of Array.from(para)) {
      const testLine = currentLine + ch;
      if (ctx.measureText(testLine).width > maxTextWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = ch;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  let cursorY = padY;
  for (const line of lines) {
    if (cursorY + fontSizePx * 0.4 > h) break;
    let drawX = padX;
    if (box.align === 'center') {
      ctx.textAlign = 'center';
      drawX = w / 2;
    } else if (box.align === 'right') {
      ctx.textAlign = 'right';
      drawX = w - padX;
    } else {
      ctx.textAlign = 'left';
      drawX = padX;
    }
    ctx.fillText(line, drawX, cursorY);
    cursorY += lineHeight;
  }

  const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b || new Blob()), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderBadgeToPngBytes(markup: PdfMarkupAnnotation): Promise<Uint8Array> {
  const scale = 4;
  const w = Math.max(24, Math.round(markup.width * scale));
  const h = Math.max(18, Math.round(markup.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array();

  const radius = Math.min(8 * scale, h / 2.2);
  const bw = Math.max(1.5, markup.strokeWidth) * scale;

  ctx.globalAlpha = markup.opacity ?? 0.95;
  ctx.beginPath();
  ctx.roundRect(bw / 2, bw / 2, w - bw, h - bw, radius);
  if (markup.fillColor && markup.fillColor !== 'transparent') {
    ctx.fillStyle = markup.fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = markup.strokeColor || '#dc2626';
  ctx.lineWidth = bw;
  ctx.stroke();

  const label = markup.label || '✓';
  const fontSize = Math.max(10, Math.min(markup.height * 0.54, 20)) * scale;
  ctx.font = `700 ${fontSize}px "Noto Sans JP", sans-serif`;
  ctx.fillStyle = markup.strokeColor || '#dc2626';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2 + scale * 0.5);

  const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b || new Blob()), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Add Signature Stamp Images, Redactions, Markups, and Text Boxes to PDF
 * Note: All input annotation coordinates use top-left page origin (matching browser preview).
 */
export async function stampPdf(
  pdfBuffer: ArrayBuffer,
  stamps: SignatureStampPlacement[],
  redactions?: RedactionBox[],
  textBoxes?: PdfTextBoxAnnotation[],
  markups?: PdfMarkupAnnotation[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = doc.getPages();

  // 1. Draw markups (behind stamps/textboxes/redactions or in logical order)
  if (markups && markups.length > 0) {
    for (const m of markups) {
      const pageIndex = m.pageIndex !== undefined ? m.pageIndex : 0;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;
      const page = pages[pageIndex];
      const { height: pageHeight } = page.getSize();

      if (m.kind === 'highlight') {
        page.drawRectangle({
          x: m.x,
          y: pageHeight - m.y - m.height,
          width: m.width,
          height: m.height,
          color: hexToPdfRgb(m.fillColor || m.strokeColor || '#fde047'),
          opacity: m.opacity ?? 0.38,
        });
      } else if (m.kind === 'rect') {
        const hasFill = Boolean(m.fillColor && m.fillColor !== 'transparent');
        page.drawRectangle({
          x: m.x,
          y: pageHeight - m.y - m.height,
          width: m.width,
          height: m.height,
          borderColor: hexToPdfRgb(m.strokeColor || '#dc2626'),
          borderWidth: m.strokeWidth || 2,
          borderOpacity: m.opacity ?? 1,
          ...(hasFill ? { color: hexToPdfRgb(m.fillColor!), opacity: Math.min(m.opacity ?? 1, 0.2) } : {}),
        });
      } else if (m.kind === 'ellipse') {
        const hasFill = Boolean(m.fillColor && m.fillColor !== 'transparent');
        page.drawEllipse({
          x: m.x + m.width / 2,
          y: pageHeight - (m.y + m.height / 2),
          xScale: Math.max(1, m.width / 2),
          yScale: Math.max(1, m.height / 2),
          borderColor: hexToPdfRgb(m.strokeColor || '#dc2626'),
          borderWidth: m.strokeWidth || 2,
          borderOpacity: m.opacity ?? 1,
          ...(hasFill ? { color: hexToPdfRgb(m.fillColor!), opacity: Math.min(m.opacity ?? 1, 0.2) } : {}),
        });
      } else if (m.kind === 'line' || m.kind === 'arrow') {
        const startX = m.x1 ?? m.x;
        const startY = pageHeight - (m.y1 ?? m.y);
        const endX = m.x2 ?? m.x + m.width;
        const endY = pageHeight - (m.y2 ?? m.y + m.height);
        const color = hexToPdfRgb(m.strokeColor || '#dc2626');
        const thickness = m.strokeWidth || 2.5;
        const opacity = m.opacity ?? 1;

        page.drawLine({
          start: { x: startX, y: startY },
          end: { x: endX, y: endY },
          thickness,
          color,
          opacity,
          lineCap: LineCapStyle.Round,
        });

        if (m.kind === 'arrow') {
          const dx = endX - startX;
          const dy = endY - startY;
          if (Math.hypot(dx, dy) > 4) {
            const angle = Math.atan2(dy, dx);
            const headLen = Math.max(10, thickness * 4);
            const wing1Angle = angle + Math.PI * 0.82;
            const wing2Angle = angle - Math.PI * 0.82;
            page.drawLine({
              start: { x: endX, y: endY },
              end: {
                x: endX + headLen * Math.cos(wing1Angle),
                y: endY + headLen * Math.sin(wing1Angle),
              },
              thickness,
              color,
              opacity,
              lineCap: LineCapStyle.Round,
            });
            page.drawLine({
              start: { x: endX, y: endY },
              end: {
                x: endX + headLen * Math.cos(wing2Angle),
                y: endY + headLen * Math.sin(wing2Angle),
              },
              thickness,
              color,
              opacity,
              lineCap: LineCapStyle.Round,
            });
          }
        }
      } else if (m.kind === 'pen' && m.points && m.points.length >= 2) {
        const color = hexToPdfRgb(m.strokeColor || '#dc2626');
        const thickness = m.strokeWidth || 2.5;
        const opacity = m.opacity ?? 1;
        for (let i = 1; i < m.points.length; i++) {
          const p0 = m.points[i - 1];
          const p1 = m.points[i];
          page.drawLine({
            start: { x: p0.x, y: pageHeight - p0.y },
            end: { x: p1.x, y: pageHeight - p1.y },
            thickness,
            color,
            opacity,
            lineCap: LineCapStyle.Round,
          });
        }
      } else if (m.kind === 'badge') {
        const pngBytes = await renderBadgeToPngBytes(m);
        if (pngBytes.length > 0) {
          const img = await doc.embedPng(pngBytes);
          page.drawImage(img, {
            x: m.x,
            y: pageHeight - m.y - m.height,
            width: m.width,
            height: m.height,
          });
        }
      }
    }
  }

  // 2. Draw Text Boxes (high-DPI PNG so Japanese/Unicode fonts render 100% faithfully)
  if (textBoxes && textBoxes.length > 0) {
    for (const box of textBoxes) {
      const pageIndex = box.pageIndex !== undefined ? box.pageIndex : 0;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;
      const page = pages[pageIndex];
      const { height: pageHeight } = page.getSize();
      const pngBytes = await renderTextBoxToPngBytes(box);
      if (pngBytes.length > 0) {
        const img = await doc.embedPng(pngBytes);
        page.drawImage(img, {
          x: box.x,
          y: pageHeight - box.y - box.height,
          width: box.width,
          height: box.height,
        });
      }
    }
  }

  // 3. Draw stamps
  if (stamps && stamps.length > 0) {
    for (const stamp of stamps) {
      const pageIndex = stamp.pageIndex !== undefined ? stamp.pageIndex : 0;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;
      const page = pages[pageIndex];
      const { height: pageHeight } = page.getSize();

      if (stamp.imageUrl) {
        let image;
        if (stamp.imageUrl.includes('image/png') || stamp.imageUrl.startsWith('data:image/png')) {
          image = await doc.embedPng(stamp.imageUrl);
        } else {
          image = await doc.embedJpg(stamp.imageUrl);
        }

        page.drawImage(image, {
          x: stamp.x,
          y: pageHeight - stamp.y - stamp.height,
          width: stamp.width,
          height: stamp.height,
        });
      }
    }
  }

  // 4. Draw blackouts / redactions
  if (redactions && redactions.length > 0) {
    for (const box of redactions) {
      const pageIndex = box.pageIndex !== undefined ? box.pageIndex : 0;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;
      const page = pages[pageIndex];
      const { height: pageHeight } = page.getSize();

      page.drawRectangle({
        x: box.x,
        y: pageHeight - box.y - box.height,
        width: box.width,
        height: box.height,
        color: hexToPdfRgb(box.color || '#000000'),
      });
    }
  }

  return await doc.save();
}

/**
 * Convert Image array to single or multi-page PDF
 */
export async function imagesToPdf(
  images: { name: string; data: ArrayBuffer; type: string }[],
  options?: {
    pageSize?: 'A4' | 'Letter' | 'Fit';
    orientation?: 'portrait' | 'landscape' | 'auto';
    margin?: number;
  }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const margin = options?.margin !== undefined ? options.margin : 20;

  for (const img of images) {
    let embeddedImg;
    if (img.type.includes('png')) {
      embeddedImg = await pdfDoc.embedPng(img.data);
    } else {
      embeddedImg = await pdfDoc.embedJpg(img.data);
    }

    const imgDims = embeddedImg.scale(1.0);
    let pageWidth = 595.28; // A4 pt
    let pageHeight = 841.89;

    if (options?.pageSize === 'Fit') {
      pageWidth = imgDims.width + margin * 2;
      pageHeight = imgDims.height + margin * 2;
    } else if (options?.orientation === 'landscape' || (options?.orientation === 'auto' && imgDims.width > imgDims.height)) {
      pageWidth = 841.89;
      pageHeight = 595.28;
    }

    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const maxDrawWidth = pageWidth - margin * 2;
    const maxDrawHeight = pageHeight - margin * 2;

    const scaleFactor = Math.min(
      maxDrawWidth / imgDims.width,
      maxDrawHeight / imgDims.height,
      1.0
    );

    const drawWidth = imgDims.width * scaleFactor;
    const drawHeight = imgDims.height * scaleFactor;

    const posX = margin + (maxDrawWidth - drawWidth) / 2;
    const posY = margin + (maxDrawHeight - drawHeight) / 2;

    page.drawImage(embeddedImg, {
      x: posX,
      y: posY,
      width: drawWidth,
      height: drawHeight,
    });
  }

  return await pdfDoc.save();
}
