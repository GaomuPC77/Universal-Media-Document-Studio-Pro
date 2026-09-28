import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { jsPDF } from 'jspdf';
import { extractPdfText } from './pdfUtils';

/**
 * Parse DOCX to HTML for preview
 */
export async function docxToHtml(file: File | ArrayBuffer): Promise<string> {
  const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}

/**
 * Parse DOCX to Plain Text
 */
export async function docxToText(file: File | ArrayBuffer): Promise<string> {
  const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/**
 * Create a DOCX from Plain Text or Markdown-like structure
 */
export async function createDocxFromText(
  text: string,
  options?: { title?: string; author?: string }
): Promise<Blob> {
  const lines = text.split('\n');
  const children: any[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      children.push(
        new Paragraph({
          text: trimmed.replace(/^#\s+/, ''),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (trimmed.startsWith('## ')) {
      children.push(
        new Paragraph({
          text: trimmed.replace(/^##\s+/, ''),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 180, after: 80 },
        })
      );
    } else if (trimmed.startsWith('### ')) {
      children.push(
        new Paragraph({
          text: trimmed.replace(/^###\s+/, ''),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 120, after: 60 },
        })
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      children.push(
        new Paragraph({
          text: trimmed.replace(/^[-*]\s+/, ''),
          bullet: { level: 0 },
          spacing: { after: 60 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun(line)],
          spacing: { after: 100 },
        })
      );
    }
  }

  const doc = new Document({
    title: options?.title || 'Document',
    creator: options?.author || 'Universal Document Studio',
    sections: [
      {
        properties: {},
        children: children.length > 0 ? children : [new Paragraph({ text: '' })],
      },
    ],
  });

  return await Packer.toBlob(doc);
}

/**
 * Parse Excel / CSV file into Sheet data matrix
 */
export async function parseSpreadsheet(
  file: File | ArrayBuffer
): Promise<{ sheetNames: string[]; sheets: { [name: string]: any[][] } }> {
  const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets: { [name: string]: any[][] } = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    sheets[sheetName] = jsonData;
  }

  return {
    sheetNames: workbook.SheetNames,
    sheets,
  };
}

/**
 * Export 2D data matrix or JSON to XLSX, CSV, JSON, HTML Table, or Markdown Table
 */
export function exportSpreadsheet(
  data: any[][],
  format: 'xlsx' | 'csv' | 'tsv' | 'json' | 'html' | 'md',
  sheetName: string = 'Sheet1'
): Blob {
  if (format === 'json') {
    if (data.length <= 1) {
      return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    }
    const headers = data[0];
    const rows = data.slice(1).map((row) => {
      const obj: any = {};
      headers.forEach((h: any, i: number) => {
        obj[h || `col_${i + 1}`] = row[i] !== undefined ? row[i] : null;
      });
      return obj;
    });
    return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  }

  if (format === 'md') {
    if (data.length === 0) return new Blob([''], { type: 'text/markdown' });
    const headers = data[0] || [];
    let md = '| ' + headers.map((h: any) => String(h || '')).join(' | ') + ' |\n';
    md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    for (let r = 1; r < data.length; r++) {
      const row = data[r] || [];
      md += '| ' + headers.map((_: any, colIdx: number) => String(row[colIdx] ?? '')).join(' | ') + ' |\n';
    }
    return new Blob([md], { type: 'text/markdown' });
  }

  if (format === 'html') {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const html = XLSX.utils.sheet_to_html(ws, { id: 'spreadsheet-table', editable: false });
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>table{border-collapse:collapse;width:100%;font-family:sans-serif;}th,td{border:1px solid #cbd5e1;padding:8px 12px;text-align:left;}th{background:#f1f5f9;font-weight:600;}tr:nth-child(even){background:#f8fafc;}</style></head><body>${html}</body></html>`;
    return new Blob([fullHtml], { type: 'text/html' });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  if (format === 'csv') {
    const csvStr = XLSX.utils.sheet_to_csv(ws);
    return new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
  }

  if (format === 'tsv') {
    const tsvStr = XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
    return new Blob([tsvStr], { type: 'text/tab-separated-values;charset=utf-8;' });
  }

  // xlsx binary
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Render text or markdown content to a formatted PDF
 */
export async function textToPdf(
  text: string,
  options?: {
    title?: string;
    fontSize?: number;
    lineSpacing?: number;
    margins?: number;
  }
): Promise<Uint8Array> {
  const doc = new jsPDF({
    orientation: 'p',
    unit: 'pt',
    format: 'a4',
  });

  const margin = options?.margins || 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxLineWidth = pageWidth - margin * 2;
  const fontSize = options?.fontSize || 11;
  const lineSpacing = options?.lineSpacing || 16;

  doc.setFontSize(fontSize);

  let currentY = margin + 20;

  if (options?.title) {
    doc.setFontSize(18);
    doc.text(options.title, margin, currentY);
    currentY += 28;
    doc.setFontSize(fontSize);
  }

  const paragraphs = text.split('\n');

  for (const para of paragraphs) {
    if (para.trim() === '') {
      currentY += lineSpacing * 0.7;
      continue;
    }

    const lines = doc.splitTextToSize(para, maxLineWidth);
    for (const line of lines) {
      if (currentY + lineSpacing > pageHeight - margin) {
        doc.addPage();
        currentY = margin + 20;
      }
      doc.text(line, margin, currentY);
      currentY += lineSpacing;
    }
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Render Spreadsheet matrix to PDF Table
 */
export async function spreadsheetToPdf(
  data: any[][],
  title: string = 'Spreadsheet Export'
): Promise<Uint8Array> {
  const doc = new jsPDF({
    orientation: data[0] && data[0].length > 5 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const margin = 30;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFontSize(16);
  doc.text(title, margin, margin + 15);

  let startY = margin + 35;
  const colCount = Math.max(...data.map((r) => r.length), 1);
  const colWidth = (pageWidth - margin * 2) / colCount;
  const rowHeight = 22;

  doc.setFontSize(9);

  for (let r = 0; r < data.length; r++) {
    if (startY + rowHeight > pageHeight - margin) {
      doc.addPage();
      startY = margin + 20;
    }

    const row = data[r] || [];
    const isHeader = r === 0;

    // Background fill
    if (isHeader) {
      doc.setFillColor(240, 243, 246);
      doc.rect(margin, startY - 14, pageWidth - margin * 2, rowHeight, 'F');
    } else if (r % 2 === 1) {
      doc.setFillColor(250, 250, 252);
      doc.rect(margin, startY - 14, pageWidth - margin * 2, rowHeight, 'F');
    }

    for (let c = 0; c < colCount; c++) {
      const val = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
      const cellX = margin + c * colWidth;
      
      // Cell borders
      doc.setDrawColor(220, 225, 230);
      doc.rect(cellX, startY - 14, colWidth, rowHeight);

      // Truncate cell text if too long
      const truncated = doc.splitTextToSize(val, colWidth - 8)[0] || '';
      doc.text(truncated, cellX + 4, startY);
    }

    startY += rowHeight;
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
