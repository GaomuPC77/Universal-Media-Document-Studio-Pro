import { PDFDocument, rgb, degrees, StandardFonts, PDFPage } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { PdfPageInfo, SignatureStampPlacement, RedactionBox } from '../types';

// Set up pdf.js worker fallback
try {
  if (typeof window !== 'undefined') {
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
  }
} catch (e) {
  console.warn('PDF.js worker setup warning:', e);
}

/**
 * Load PDF and get page thumbnails and metadata
 */
export async function getPdfPages(file: File | ArrayBuffer): Promise<PdfPageInfo[]> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
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
 * Extract plain text from PDF
 */
export async function extractPdfText(file: File | ArrayBuffer): Promise<string> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  const pdfDoc = await loadingTask.promise;
  let fullText = '';

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      // @ts-ignore
      .map((item: any) => item.str || '')
      .join(' ');
    fullText += `--- Page ${i} ---\n` + pageText + '\n\n';
  }

  return fullText.trim();
}

/**
 * Convert PDF pages to high-res images
 */
export async function convertPdfToImages(
  file: File | ArrayBuffer,
  options: {
    format: 'png' | 'jpg' | 'webp';
    dpi?: number;
    pages?: number[];
    quality?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<{ name: string; blob: Blob; pageNumber: number }[]> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const dpi = options.dpi || 150;
  const scale = dpi / 72; // default 72 DPI
  const results: { name: string; blob: Blob; pageNumber: number }[] = [];

  const targetPages = options.pages && options.pages.length > 0
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

    // Fill white background for jpg
    if (options.format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    await (page as any).render({
      canvasContext: ctx,
      viewport: viewport,
      canvas: canvas,
    }).promise;

    const mimeType = options.format === 'png' ? 'image/png' : options.format === 'webp' ? 'image/webp' : 'image/jpeg';
    const quality = options.quality !== undefined ? options.quality : 0.92;

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b || new Blob()), mimeType, quality);
    });

    results.push({
      name: `page_${String(pageNum).padStart(3, '0')}.${options.format === 'jpg' ? 'jpg' : options.format}`,
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
 * Merge multiple PDFs into one
 */
export async function mergePdfs(pdfBuffers: ArrayBuffer[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return await mergedPdf.save();
}

/**
 * Split or delete pages from a PDF
 */
export async function manipulatePdfPages(
  fileBuffer: ArrayBuffer,
  options: {
    keepPageIndices?: number[]; // 0-indexed
    rotations?: { [pageIndex: number]: number }; // angle to rotate in degrees
  }
): Promise<Uint8Array> {
  const srcPdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
  const newPdf = await PDFDocument.create();

  const indicesToKeep = options.keepPageIndices || srcPdf.getPageIndices();
  const copiedPages = await newPdf.copyPages(srcPdf, indicesToKeep);

  copiedPages.forEach((page, idx) => {
    const originalIndex = indicesToKeep[idx];
    if (options.rotations && options.rotations[originalIndex]) {
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees((currentRotation + options.rotations[originalIndex]) % 360));
    }
    newPdf.addPage(page);
  });

  return await newPdf.save();
}

/**
 * Add Watermark, Page Numbers, Stamps, or Redactions to PDF
 */
export async function enhancePdf(
  fileBuffer: ArrayBuffer,
  options: {
    watermarkText?: string;
    watermarkOpacity?: number;
    watermarkColor?: string; // hex
    watermarkAngle?: number;
    watermarkFontSize?: number;
    pageNumbering?: {
      enabled: boolean;
      format: 'page_of_total' | 'page_only' | 'dash_page_dash';
      position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-center';
      startNumber?: number;
      fontSize?: number;
    };
    stamps?: SignatureStampPlacement[];
    redactions?: RedactionBox[];
  }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const totalPages = pdfDoc.getPageCount();

  // Load stamp images into PDF
  const embeddedStamps: { [id: string]: any } = {};
  if (options.stamps && options.stamps.length > 0) {
    for (const stamp of options.stamps) {
      if (!embeddedStamps[stamp.imageUrl]) {
        try {
          const imgBytes = await fetch(stamp.imageUrl).then((r) => r.arrayBuffer());
          const isPng = stamp.imageUrl.includes('image/png') || stamp.imageUrl.startsWith('data:image/png');
          const embedded = isPng ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
          embeddedStamps[stamp.imageUrl] = embedded;
        } catch (e) {
          console.error('Failed to embed stamp image:', e);
        }
      }
    }
  }

  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();

    // 1. Apply Watermark
    if (options.watermarkText) {
      const text = options.watermarkText;
      const fontSize = options.watermarkFontSize || 48;
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const textHeight = font.heightAtSize(fontSize);
      const angle = options.watermarkAngle !== undefined ? options.watermarkAngle : 45;
      const opacity = options.watermarkOpacity !== undefined ? options.watermarkOpacity : 0.25;

      page.drawText(text, {
        x: width / 2 - (textWidth / 2) * Math.cos((angle * Math.PI) / 180),
        y: height / 2 - (textHeight / 2) * Math.sin((angle * Math.PI) / 180),
        size: fontSize,
        font: font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: opacity,
        rotate: degrees(angle),
      });
    }

    // 2. Apply Page Numbers
    if (options.pageNumbering && options.pageNumbering.enabled) {
      const numStart = options.pageNumbering.startNumber || 1;
      const curNum = i + numStart;
      let label = '';
      if (options.pageNumbering.format === 'page_of_total') {
        label = `Page ${curNum} of ${totalPages + numStart - 1}`;
      } else if (options.pageNumbering.format === 'dash_page_dash') {
        label = `- ${curNum} -`;
      } else {
        label = `${curNum}`;
      }

      const numFontSize = options.pageNumbering.fontSize || 10;
      const numWidth = font.widthOfTextAtSize(label, numFontSize);
      let posX = width / 2 - numWidth / 2;
      let posY = 20;

      if (options.pageNumbering.position === 'bottom-right') {
        posX = width - numWidth - 30;
        posY = 20;
      } else if (options.pageNumbering.position === 'bottom-left') {
        posX = 30;
        posY = 20;
      } else if (options.pageNumbering.position === 'top-right') {
        posX = width - numWidth - 30;
        posY = height - 30;
      } else if (options.pageNumbering.position === 'top-center') {
        posX = width / 2 - numWidth / 2;
        posY = height - 30;
      }

      page.drawText(label, {
        x: posX,
        y: posY,
        size: numFontSize,
        font: font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }

    // 3. Apply Stamps / Signatures for this page
    if (options.stamps) {
      const pageStamps = options.stamps.filter((s) => s.pageIndex === i);
      for (const stamp of pageStamps) {
        const embeddedImg = embeddedStamps[stamp.imageUrl];
        if (embeddedImg) {
          // Convert browser coordinates to PDF coordinates (PDF y is from bottom)
          const pdfY = height - stamp.y - stamp.height;
          page.drawImage(embeddedImg, {
            x: stamp.x,
            y: pdfY,
            width: stamp.width,
            height: stamp.height,
            rotate: degrees(stamp.rotation || 0),
          });
        }
      }
    }

    // 4. Apply Redactions (Blackout boxes)
    if (options.redactions) {
      const pageRedactions = options.redactions.filter((r) => r.pageIndex === i);
      for (const r of pageRedactions) {
        const pdfY = height - r.y - r.height;
        page.drawRectangle({
          x: r.x,
          y: pdfY,
          width: r.width,
          height: r.height,
          color: rgb(0, 0, 0),
          opacity: 1,
        });
      }
    }
  }

  return await pdfDoc.save();
}

/**
 * Convert Image files to a single PDF
 */
export async function imagesToPdf(
  imageFiles: { name: string; data: ArrayBuffer; type: string }[],
  options: {
    pageSize: 'A4' | 'Letter' | 'Fit';
    orientation: 'portrait' | 'landscape' | 'auto';
    margin: number; // in pt
  }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  const standardSizes = {
    A4: { width: 595.28, height: 841.89 },
    Letter: { width: 612, height: 792 },
  };

  for (const imgItem of imageFiles) {
    let embeddedImg;
    const isPng = imgItem.type.includes('png') || imgItem.name.toLowerCase().endsWith('.png');
    
    try {
      if (isPng) {
        embeddedImg = await pdfDoc.embedPng(imgItem.data);
      } else {
        embeddedImg = await pdfDoc.embedJpg(imgItem.data);
      }
    } catch (e) {
      // If jpeg/png decode fails, draw onto canvas and convert to png
      console.warn('Direct embedding failed, falling back to canvas decode:', e);
      const blob = new Blob([imgItem.data], { type: imgItem.type });
      const imgUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = imgUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const pngBlob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b || new Blob()), 'image/png'));
        const pngBuf = await pngBlob.arrayBuffer();
        embeddedImg = await pdfDoc.embedPng(pngBuf);
      }
      URL.revokeObjectURL(imgUrl);
    }

    if (!embeddedImg) continue;

    const imgWidth = embeddedImg.width;
    const imgHeight = embeddedImg.height;

    let pageWidth = imgWidth;
    let pageHeight = imgHeight;

    if (options.pageSize !== 'Fit') {
      const baseSize = standardSizes[options.pageSize];
      const isLandscape = options.orientation === 'landscape' || (options.orientation === 'auto' && imgWidth > imgHeight);
      pageWidth = isLandscape ? baseSize.height : baseSize.width;
      pageHeight = isLandscape ? baseSize.width : baseSize.height;
    }

    const margin = options.margin;
    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;

    const scale = Math.min(availableWidth / imgWidth, availableHeight / imgHeight, 1);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;
    const drawX = margin + (availableWidth - drawWidth) / 2;
    const drawY = margin + (availableHeight - drawHeight) / 2;

    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(embeddedImg, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
    });
  }

  return await pdfDoc.save();
}
