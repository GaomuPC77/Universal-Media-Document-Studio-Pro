import { HankoConfig } from '../types';

/**
 * Generate Digital Hanko / Seal as Transparent PNG Data URL
 */
export function generateHankoImage(config: HankoConfig): string {
  const canvas = document.createElement('canvas');
  const size = config.size || 240;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, size, size);

  const center = size / 2;
  const color = config.color || '#dc2626';
  const borderWidth = config.borderWidth || 6;
  const opacity = config.opacity !== undefined ? config.opacity : 0.95;

  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = borderWidth;

  // Set font
  let fontFamily = '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif';
  if (config.fontFamily === 'sans-serif') {
    fontFamily = '"Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif';
  } else if (config.fontFamily === 'maru-gothic') {
    fontFamily = '"HGMaruGothicMPRO", "Rounded Mplus 1c", sans-serif';
  } else if (config.fontFamily === 'kaisei') {
    fontFamily = '"Kaisei Decol", "Yu Mincho", serif';
  }

  if (config.type === 'round') {
    // Outer Circle
    const radius = center - borderWidth;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (config.innerRing) {
      ctx.beginPath();
      ctx.lineWidth = borderWidth * 0.4;
      ctx.arc(center, center, radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = config.text.trim();
    if (text.length <= 2) {
      // 1-2 chars vertical
      const fontSize = size * 0.38;
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      if (text.length === 1) {
        ctx.fillText(text, center, center);
      } else {
        ctx.fillText(text[0], center, center - fontSize * 0.5);
        ctx.fillText(text[1], center, center + fontSize * 0.5);
      }
    } else if (text.length <= 4) {
      // 3-4 chars 2x2 grid (standard Japanese seal layout)
      const fontSize = size * 0.28;
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      // In Japanese seals, read top-right to bottom-right, then top-left to bottom-left (or standard left-right)
      const c1 = text[0];
      const c2 = text[1] || '';
      const c3 = text[2] || '';
      const c4 = text[3] || (text.length === 3 ? '印' : '');

      ctx.fillText(c1, center + fontSize * 0.55, center - fontSize * 0.55);
      ctx.fillText(c2, center + fontSize * 0.55, center + fontSize * 0.55);
      ctx.fillText(c3, center - fontSize * 0.55, center - fontSize * 0.55);
      ctx.fillText(c4, center - fontSize * 0.55, center + fontSize * 0.55);
    } else {
      // Multiple chars, circle text or vertical
      const fontSize = size * 0.22;
      ctx.font = `bold ${fontSize}px ${fontFamily}`;
      ctx.fillText(text, center, center);
    }
  } else if (config.type === 'square') {
    // Square Seal (角印) - Evenly distributed vertical text (均等割付)
    const margin = borderWidth;
    const rectSize = size - margin * 2;
    const radius = 8;

    ctx.beginPath();
    ctx.roundRect(margin, margin, rectSize, rectSize, radius);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = config.text.trim();
    const chars = text.split('');
    if (chars.length === 0) return;

    // Determine number of columns (right-to-left)
    const cols = Math.max(1, Math.ceil(Math.sqrt(chars.length)));

    // Distribute characters into columns (rightmost columns receive remainder chars first)
    const baseCount = Math.floor(chars.length / cols);
    const remainder = chars.length % cols;
    const columns: string[][] = [];
    let curIdx = 0;

    for (let c = 0; c < cols; c++) {
      const countForCol = baseCount + (c < remainder ? 1 : 0);
      columns.push(chars.slice(curIdx, curIdx + countForCol));
      curIdx += countForCol;
    }

    const maxCharsInAnyCol = Math.max(...columns.map((c) => c.length), 1);
    const maxDim = Math.max(cols, maxCharsInAnyCol);
    const fontSize = Math.min((rectSize * 0.78) / maxDim, size * 0.28);
    ctx.font = `bold ${fontSize}px ${fontFamily}`;

    const usableW = rectSize * 0.76;
    const usableH = rectSize * 0.76;
    const leftX = margin + (rectSize - usableW) / 2;
    const topY = margin + (rectSize - usableH) / 2;

    // Render columns from right to left (c = 0 is rightmost column)
    for (let c = 0; c < cols; c++) {
      const colChars = columns[c];
      const colIdxFromLeft = cols - 1 - c;
      const x = cols === 1 ? center : leftX + (colIdxFromLeft + 0.5) * (usableW / cols);
      const k = colChars.length;
      if (k === 0) continue;

      if (k === 1) {
        ctx.fillText(colChars[0], x, center);
      } else {
        // Vertical justification (均等割付) for characters in this column
        for (let r = 0; r < k; r++) {
          const y = topY + (r + 0.5) * (usableH / k);
          ctx.fillText(colChars[r], x, y);
        }
      }
    }
  } else if (config.type === 'date') {
    // Date Seal (データネーム印)
    const radius = center - borderWidth;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Two horizontal divider lines
    const lineY1 = center - radius * 0.32;
    const lineY2 = center + radius * 0.32;
    const chord1 = Math.sqrt(radius * radius - (radius * 0.32) * (radius * 0.32));

    ctx.lineWidth = borderWidth * 0.6;
    ctx.beginPath();
    ctx.moveTo(center - chord1 + 2, lineY1);
    ctx.lineTo(center + chord1 - 2, lineY1);
    ctx.moveTo(center - chord1 + 2, lineY2);
    ctx.lineTo(center + chord1 - 2, lineY2);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Top section: Department or company
    const topText = config.subText || '承認';
    const topFontSize = size * 0.16;
    ctx.font = `bold ${topFontSize}px ${fontFamily}`;
    ctx.fillText(topText, center, center - radius * 0.58);

    // Middle section: Date (e.g. 2026.09.24)
    const today = new Date();
    const defaultDate = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
    const dateText = config.dateText || defaultDate;
    const dateFontSize = size * 0.15;
    ctx.font = `bold ${dateFontSize}px ${fontFamily}`;
    ctx.fillText(dateText, center, center);

    // Bottom section: Name
    const nameText = config.text || '山田';
    const nameFontSize = size * 0.18;
    ctx.font = `bold ${nameFontSize}px ${fontFamily}`;
    ctx.fillText(nameText, center, center + radius * 0.58);
  }

  return canvas.toDataURL('image/png');
}
