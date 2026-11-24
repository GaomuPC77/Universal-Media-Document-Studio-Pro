/**
 * Safe client-side SVG parsing, sanitization, DOM inspection,
 * vector element editing, batch color replacement, and raster export utilities.
 */

import { canvasToBmpBlob, canvasToIcoBlob } from './formatConversionUtils';
import { canvasToPpmBlob } from './imageCodecUtils';

export interface SvgElementInfo {
  path: string;
  tagName: string;
  id: string;
  label: string;
  depth: number;
  fill: string;
  stroke: string;
  strokeWidth: string;
  opacity: string;
  rx?: string;
  textContent?: string;
  fontSize?: string;
  fontWeight?: string;
  hidden: boolean;
  transform: string;
}

export interface SvgColorToken {
  color: string;
  normalizedHex: string;
  count: number;
}

export interface SvgDocumentInfo {
  valid: boolean;
  error?: string;
  viewBox: { x: number; y: number; w: number; h: number };
  widthAttr: string;
  heightAttr: string;
  elements: SvgElementInfo[];
  palette: SvgColorToken[];
  byteSize: number;
}

export interface SvgTemplateItem {
  id: string;
  nameJa: string;
  nameEn: string;
  svg: string;
}

export const SVG_TEMPLATES: SvgTemplateItem[] = [
  {
    id: 'blank-512',
    nameJa: '新規アートボード (512×512)',
    nameEn: 'Blank Icon (512×512)',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect x="32" y="32" width="448" height="448" rx="48" fill="#f8fafc" stroke="#cbd5e1" stroke-width="4" />
</svg>`,
  },
  {
    id: 'blank-800',
    nameJa: 'ワイドキャンバス (800×600)',
    nameEn: 'Wide Canvas (800×600)',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <rect x="0" y="0" width="800" height="600" fill="#ffffff" />
</svg>`,
  },
  {
    id: 'badge-logo',
    nameJa: 'ロゴ・バッジサンプル',
    nameEn: 'Logo Badge Sample',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect x="24" y="24" width="352" height="352" rx="64" fill="#1e293b" />
  <circle cx="200" cy="176" r="76" fill="#2563eb" />
  <circle cx="200" cy="176" r="36" fill="#ffffff" />
  <rect x="96" y="284" width="208" height="18" rx="9" fill="#94a3b8" />
  <text x="200" y="340" text-anchor="middle" font-size="24" font-weight="bold" fill="#f8fafc">STUDIO</text>
</svg>`,
  },
  {
    id: 'diagram-card',
    nameJa: '図解カードサンプル',
    nameEn: 'Diagram Sample',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <rect x="16" y="16" width="608" height="328" rx="16" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" />
  <rect x="56" y="120" width="180" height="110" rx="12" fill="#eff6ff" stroke="#2563eb" stroke-width="3" />
  <text x="146" y="182" text-anchor="middle" font-size="20" font-weight="bold" fill="#1e3a8a">INPUT</text>
  <line x1="244" y1="175" x2="392" y2="175" stroke="#475569" stroke-width="4" />
  <path d="M 380 165 L 398 175 L 380 185 Z" fill="#475569" />
  <rect x="404" y="120" width="180" height="110" rx="12" fill="#ecfdf5" stroke="#16a34a" stroke-width="3" />
  <text x="494" y="182" text-anchor="middle" font-size="20" font-weight="bold" fill="#14532d">OUTPUT</text>
</svg>`,
  },
];

const EDITABLE_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'g',
  'use',
  'image',
]);

const UNSAFE_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'foreignobject']);

function parseStyleString(styleStr: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!styleStr) return map;
  for (const decl of styleStr.split(';')) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const key = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (key) map[key] = val;
  }
  return map;
}

function serializeStyleMap(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== '' && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

function sanitizeNodeTree(root: Element): void {
  const toRemove: Element[] = [];
  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (UNSAFE_TAGS.has(tag)) {
      toRemove.push(el);
      return;
    }
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (
        (name === 'href' || name === 'xlink:href' || name === 'src') &&
        /^javascript:/i.test(val)
      ) {
        el.removeAttribute(attr.name);
      }
    }
    Array.from(el.children).forEach(walk);
  };
  walk(root);
  toRemove.forEach((n) => n.parentNode?.removeChild(n));
}

export function normalizeColorToHex(color: string): string | null {
  const raw = (color || '').trim();
  if (!raw || raw === 'none' || raw === 'transparent' || raw.startsWith('url(')) {
    return null;
  }
  if (/^#[0-9a-f]{6}$/i.test(raw)) {
    return raw.toLowerCase();
  }
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgbMatch = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const hex = [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }
  // Named CSS colors via canvas 2D context
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000000';
      ctx.fillStyle = raw;
      const computed = ctx.fillStyle;
      if (/^#[0-9a-f]{6}$/i.test(computed)) {
        return computed.toLowerCase();
      }
    }
  }
  return null;
}

export function parseSvgSafe(rawSvg: string): { doc: Document; svgEl: SVGSVGElement } | { error: string } {
  const trimmed = (rawSvg || '').trim();
  if (!trimmed) {
    return { error: 'SVG markup is empty' };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'image/svg+xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    return { error: parserError.textContent?.trim() || 'Invalid SVG XML syntax' };
  }
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { error: 'Root element must be <svg>' };
  }
  if (!root.getAttribute('xmlns')) {
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  sanitizeNodeTree(root);
  return { doc, svgEl: root as unknown as SVGSVGElement };
}

export function serializeSvg(svgEl: Element): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgEl);
}

export function parseViewBox(svgEl: Element): { x: number; y: number; w: number; h: number } {
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }
  const wAttr = parseFloat(svgEl.getAttribute('width') || '');
  const hAttr = parseFloat(svgEl.getAttribute('height') || '');
  const w = Number.isFinite(wAttr) && wAttr > 0 ? wAttr : 800;
  const h = Number.isFinite(hAttr) && hAttr > 0 ? hAttr : 600;
  return { x: 0, y: 0, w, h };
}

function getElementByPath(svgEl: Element, path: string): Element | null {
  if (!path) return null;
  const indices = path.split('.').map(Number);
  let current: Element = svgEl;
  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= current.children.length) {
      return null;
    }
    current = current.children[idx];
  }
  return current;
}

function findElementPath(svgEl: Element, target: Element): string | null {
  const parts: number[] = [];
  let curr: Element | null = target;
  while (curr && curr !== svgEl) {
    const parent = curr.parentElement;
    if (!parent) return null;
    const idx = Array.from(parent.children).indexOf(curr);
    if (idx === -1) return null;
    parts.unshift(idx);
    curr = parent;
  }
  return curr === svgEl && parts.length > 0 ? parts.join('.') : null;
}

function getPropOrStyle(el: Element, prop: string): string {
  const styleMap = parseStyleString(el.getAttribute('style') || '');
  if (styleMap[prop] !== undefined) return styleMap[prop];
  return el.getAttribute(prop) || '';
}

function setPropClean(el: Element, prop: string, val: string | null): void {
  const styleMap = parseStyleString(el.getAttribute('style') || '');
  if (prop in styleMap) {
    delete styleMap[prop];
    const nextStyle = serializeStyleMap(styleMap);
    if (nextStyle) el.setAttribute('style', nextStyle);
    else el.removeAttribute('style');
  }
  if (val === null || val === '') {
    el.removeAttribute(prop);
  } else {
    el.setAttribute(prop, val);
  }
}

export function inspectSvgDocument(rawSvg: string): SvgDocumentInfo {
  const byteSize = new Blob([rawSvg || '']).size;
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) {
    return {
      valid: false,
      error: parsed.error,
      viewBox: { x: 0, y: 0, w: 800, h: 600 },
      widthAttr: '',
      heightAttr: '',
      elements: [],
      palette: [],
      byteSize,
    };
  }

  const { svgEl } = parsed;
  const viewBox = parseViewBox(svgEl);
  const widthAttr = svgEl.getAttribute('width') || '';
  const heightAttr = svgEl.getAttribute('height') || '';

  const elements: SvgElementInfo[] = [];
  const colorCounts = new Map<string, { color: string; count: number }>();

  const trackColor = (rawVal: string) => {
    const hex = normalizeColorToHex(rawVal);
    if (!hex) return;
    const existing = colorCounts.get(hex);
    if (existing) {
      existing.count += 1;
    } else {
      colorCounts.set(hex, { color: rawVal, count: 1 });
    }
  };

  const walk = (el: Element, prefix: string, depth: number) => {
    Array.from(el.children).forEach((child, idx) => {
      const path = prefix ? `${prefix}.${idx}` : `${idx}`;
      const tag = child.tagName.toLowerCase();

      // Track stop colors in defs/gradients too
      const stopColor = getPropOrStyle(child, 'stop-color');
      if (stopColor) trackColor(stopColor);

      if (EDITABLE_TAGS.has(tag)) {
        const fill = getPropOrStyle(child, 'fill');
        const stroke = getPropOrStyle(child, 'stroke');
        const strokeWidth = getPropOrStyle(child, 'stroke-width');
        const opacity = getPropOrStyle(child, 'opacity') || '1';
        const display = getPropOrStyle(child, 'display');
        const visibility = getPropOrStyle(child, 'visibility');
        const id = child.getAttribute('id') || '';
        const textContent = tag === 'text' || tag === 'tspan' ? child.textContent || '' : undefined;

        if (fill) trackColor(fill);
        if (stroke) trackColor(stroke);

        let label = `<${tag}>`;
        if (id) {
          label = `<${tag}> #${id}`;
        } else if (textContent && textContent.trim()) {
          label = `<text> "${textContent.trim().slice(0, 18)}"`;
        }

        elements.push({
          path,
          tagName: tag,
          id,
          label,
          depth,
          fill,
          stroke,
          strokeWidth,
          opacity,
          rx: child.getAttribute('rx') || undefined,
          textContent,
          fontSize: getPropOrStyle(child, 'font-size') || undefined,
          fontWeight: getPropOrStyle(child, 'font-weight') || undefined,
          hidden: display === 'none' || visibility === 'hidden',
          transform: child.getAttribute('transform') || '',
        });
      }

      if (tag !== 'defs' && child.children.length > 0) {
        walk(child, path, depth + 1);
      }
    });
  };

  walk(svgEl, '', 0);

  const palette: SvgColorToken[] = Array.from(colorCounts.entries()).map(([normalizedHex, info]) => ({
    color: info.color,
    normalizedHex,
    count: info.count,
  }));

  return {
    valid: true,
    viewBox,
    widthAttr,
    heightAttr,
    elements,
    palette,
    byteSize,
  };
}

export function buildRenderableSvgWithIds(rawSvg: string): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return '';
  const { svgEl } = parsed;
  const vb = parseViewBox(svgEl);
  if (!svgEl.getAttribute('viewBox')) {
    svgEl.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }
  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', '100%');

  const walk = (el: Element, prefix: string) => {
    Array.from(el.children).forEach((child, idx) => {
      const path = prefix ? `${prefix}.${idx}` : `${idx}`;
      const tag = child.tagName.toLowerCase();
      if (EDITABLE_TAGS.has(tag)) {
        child.setAttribute('data-edit-path', path);
      }
      if (tag !== 'defs' && child.children.length > 0) {
        walk(child, path);
      }
    });
  };
  walk(svgEl, '');
  return serializeSvg(svgEl);
}

export function updateSvgCanvasConfig(
  rawSvg: string,
  config: { x: number; y: number; w: number; h: number; widthAttr?: string; heightAttr?: string }
): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;
  const w = Math.max(1, Number(config.w) || 800);
  const h = Math.max(1, Number(config.h) || 600);
  const x = Number(config.x) || 0;
  const y = Number(config.y) || 0;
  svgEl.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  if (config.widthAttr !== undefined) {
    if (config.widthAttr.trim()) svgEl.setAttribute('width', config.widthAttr.trim());
    else svgEl.removeAttribute('width');
  }
  if (config.heightAttr !== undefined) {
    if (config.heightAttr.trim()) svgEl.setAttribute('height', config.heightAttr.trim());
    else svgEl.removeAttribute('height');
  }
  return formatSvgMarkup(serializeSvg(svgEl));
}

export function updateSvgElementProps(
  rawSvg: string,
  path: string,
  patch: {
    id?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    opacity?: string;
    rx?: string;
    textContent?: string;
    fontSize?: string;
    fontWeight?: string;
    hidden?: boolean;
  }
): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;
  const target = getElementByPath(svgEl, path);
  if (!target) return rawSvg;

  if (patch.id !== undefined) {
    if (patch.id.trim()) target.setAttribute('id', patch.id.trim());
    else target.removeAttribute('id');
  }
  if (patch.fill !== undefined) setPropClean(target, 'fill', patch.fill);
  if (patch.stroke !== undefined) setPropClean(target, 'stroke', patch.stroke);
  if (patch.strokeWidth !== undefined) setPropClean(target, 'stroke-width', patch.strokeWidth);
  if (patch.opacity !== undefined) {
    setPropClean(target, 'opacity', patch.opacity === '1' ? null : patch.opacity);
  }
  if (patch.rx !== undefined && target.tagName.toLowerCase() === 'rect') {
    if (patch.rx === '' || patch.rx === '0') target.removeAttribute('rx');
    else target.setAttribute('rx', patch.rx);
  }
  if (patch.textContent !== undefined && ['text', 'tspan'].includes(target.tagName.toLowerCase())) {
    target.textContent = patch.textContent;
  }
  if (patch.fontSize !== undefined) setPropClean(target, 'font-size', patch.fontSize);
  if (patch.fontWeight !== undefined) {
    setPropClean(target, 'font-weight', patch.fontWeight === 'normal' ? null : patch.fontWeight);
  }
  if (patch.hidden !== undefined) {
    if (patch.hidden) {
      setPropClean(target, 'display', 'none');
    } else {
      setPropClean(target, 'display', null);
      setPropClean(target, 'visibility', null);
    }
  }

  return formatSvgMarkup(serializeSvg(svgEl));
}

export function moveSvgElement(rawSvg: string, path: string, dx: number, dy: number): string {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return rawSvg;
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;
  const target = getElementByPath(svgEl, path);
  if (!target) return rawSvg;

  const r = (n: number) => Math.round(n * 100) / 100;
  const tag = target.tagName.toLowerCase();
  const existingTransform = target.getAttribute('transform') || '';

  // For simple unrotated coordinate primitives without complex transforms, update direct attributes cleanly
  if (!existingTransform.trim()) {
    if (tag === 'rect' || tag === 'text' || tag === 'image') {
      const x = parseFloat(target.getAttribute('x') || '0') || 0;
      const y = parseFloat(target.getAttribute('y') || '0') || 0;
      target.setAttribute('x', String(r(x + dx)));
      target.setAttribute('y', String(r(y + dy)));
      return formatSvgMarkup(serializeSvg(svgEl));
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = parseFloat(target.getAttribute('cx') || '0') || 0;
      const cy = parseFloat(target.getAttribute('cy') || '0') || 0;
      target.setAttribute('cx', String(r(cx + dx)));
      target.setAttribute('cy', String(r(cy + dy)));
      return formatSvgMarkup(serializeSvg(svgEl));
    }
    if (tag === 'line') {
      const x1 = parseFloat(target.getAttribute('x1') || '0') || 0;
      const y1 = parseFloat(target.getAttribute('y1') || '0') || 0;
      const x2 = parseFloat(target.getAttribute('x2') || '0') || 0;
      const y2 = parseFloat(target.getAttribute('y2') || '0') || 0;
      target.setAttribute('x1', String(r(x1 + dx)));
      target.setAttribute('y1', String(r(y1 + dy)));
      target.setAttribute('x2', String(r(x2 + dx)));
      target.setAttribute('y2', String(r(y2 + dy)));
      return formatSvgMarkup(serializeSvg(svgEl));
    }
  }

  // Fallback for <path>, <polygon>, <g>, or transformed nodes: compose leading translate(tx, ty)
  const translateRegex = /^\s*translate\(\s*([^,\s)]+)(?:[\s,]+([^)]+))?\s*\)/i;
  const match = existingTransform.match(translateRegex);
  if (match) {
    const oldX = parseFloat(match[1]) || 0;
    const oldY = parseFloat(match[2] || '0') || 0;
    const nextTransform = existingTransform.replace(
      translateRegex,
      `translate(${r(oldX + dx)}, ${r(oldY + dy)})`
    );
    target.setAttribute('transform', nextTransform.trim());
  } else {
    const nextTransform = `translate(${r(dx)}, ${r(dy)}) ${existingTransform}`.trim();
    target.setAttribute('transform', nextTransform);
  }

  return formatSvgMarkup(serializeSvg(svgEl));
}

export type NewSvgShape =
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
      fill: string;
      stroke: string;
      strokeWidth: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill: string;
      stroke: string;
      strokeWidth: number;
    }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      strokeWidth: number;
    }
  | {
      kind: 'path';
      d: string;
      fill: string;
      stroke: string;
      strokeWidth: number;
    }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      fontSize: number;
      fill: string;
      fontWeight?: string;
    };

export function addSvgShape(rawSvg: string, shape: NewSvgShape): { svg: string; path: string | null } {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return { svg: rawSvg, path: null };
  const { doc, svgEl } = parsed;
  const ns = 'http://www.w3.org/2000/svg';
  const r = (n: number) => Math.round(n * 100) / 100;

  let node: Element;
  if (shape.kind === 'rect') {
    node = doc.createElementNS(ns, 'rect');
    node.setAttribute('x', String(r(shape.x)));
    node.setAttribute('y', String(r(shape.y)));
    node.setAttribute('width', String(Math.max(1, r(shape.width))));
    node.setAttribute('height', String(Math.max(1, r(shape.height))));
    if (shape.rx && shape.rx > 0) node.setAttribute('rx', String(r(shape.rx)));
    node.setAttribute('fill', shape.fill || 'none');
    node.setAttribute('stroke', shape.stroke || 'none');
    if (shape.stroke && shape.stroke !== 'none') {
      node.setAttribute('stroke-width', String(shape.strokeWidth || 2));
    }
  } else if (shape.kind === 'ellipse') {
    node = doc.createElementNS(ns, 'ellipse');
    node.setAttribute('cx', String(r(shape.cx)));
    node.setAttribute('cy', String(r(shape.cy)));
    node.setAttribute('rx', String(Math.max(1, r(shape.rx))));
    node.setAttribute('ry', String(Math.max(1, r(shape.ry))));
    node.setAttribute('fill', shape.fill || 'none');
    node.setAttribute('stroke', shape.stroke || 'none');
    if (shape.stroke && shape.stroke !== 'none') {
      node.setAttribute('stroke-width', String(shape.strokeWidth || 2));
    }
  } else if (shape.kind === 'line') {
    node = doc.createElementNS(ns, 'line');
    node.setAttribute('x1', String(r(shape.x1)));
    node.setAttribute('y1', String(r(shape.y1)));
    node.setAttribute('x2', String(r(shape.x2)));
    node.setAttribute('y2', String(r(shape.y2)));
    node.setAttribute('stroke', shape.stroke || '#2563eb');
    node.setAttribute('stroke-width', String(shape.strokeWidth || 3));
    node.setAttribute('stroke-linecap', 'round');
  } else if (shape.kind === 'path') {
    node = doc.createElementNS(ns, 'path');
    node.setAttribute('d', shape.d);
    node.setAttribute('fill', shape.fill || 'none');
    node.setAttribute('stroke', shape.stroke || '#2563eb');
    node.setAttribute('stroke-width', String(shape.strokeWidth || 3));
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
  } else {
    node = doc.createElementNS(ns, 'text');
    node.setAttribute('x', String(r(shape.x)));
    node.setAttribute('y', String(r(shape.y)));
    node.setAttribute('font-size', String(shape.fontSize || 28));
    node.setAttribute('fill', shape.fill || '#0f172a');
    if (shape.fontWeight && shape.fontWeight !== 'normal') {
      node.setAttribute('font-weight', shape.fontWeight);
    }
    node.textContent = shape.text;
  }

  svgEl.appendChild(node);
  const newPath = findElementPath(svgEl, node);
  return { svg: formatSvgMarkup(serializeSvg(svgEl)), path: newPath };
}

export function reorderSvgElement(
  rawSvg: string,
  path: string,
  direction: 'front' | 'back' | 'forward' | 'backward'
): { svg: string; path: string | null } {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return { svg: rawSvg, path };
  const { svgEl } = parsed;
  const target = getElementByPath(svgEl, path);
  const parent = target?.parentElement;
  if (!target || !parent) return { svg: rawSvg, path };

  const siblings = Array.from(parent.children);
  const idx = siblings.indexOf(target);
  if (idx === -1) return { svg: rawSvg, path };

  if (direction === 'front') {
    parent.appendChild(target);
  } else if (direction === 'back') {
    const firstNonDefs = siblings.find((el) => el.tagName.toLowerCase() !== 'defs');
    if (firstNonDefs && firstNonDefs !== target) {
      parent.insertBefore(target, firstNonDefs);
    }
  } else if (direction === 'forward' && idx < siblings.length - 1) {
    const afterNext = siblings[idx + 2] || null;
    parent.insertBefore(target, afterNext);
  } else if (direction === 'backward' && idx > 0) {
    const prev = siblings[idx - 1];
    if (prev && prev.tagName.toLowerCase() !== 'defs') {
      parent.insertBefore(target, prev);
    }
  }

  const nextPath = findElementPath(svgEl, target);
  return { svg: formatSvgMarkup(serializeSvg(svgEl)), path: nextPath };
}

export function duplicateSvgElement(rawSvg: string, path: string): { svg: string; path: string | null } {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return { svg: rawSvg, path };
  const { svgEl } = parsed;
  const target = getElementByPath(svgEl, path);
  const parent = target?.parentElement;
  if (!target || !parent) return { svg: rawSvg, path };

  const clone = target.cloneNode(true) as Element;
  if (clone.getAttribute('id')) {
    clone.setAttribute('id', `${clone.getAttribute('id')}_copy`);
  }
  parent.insertBefore(clone, target.nextSibling);
  const clonedPath = findElementPath(svgEl, clone);
  let nextSvg = formatSvgMarkup(serializeSvg(svgEl));
  if (clonedPath) {
    nextSvg = moveSvgElement(nextSvg, clonedPath, 16, 16);
  }
  return { svg: nextSvg, path: clonedPath };
}

export function deleteSvgElement(rawSvg: string, path: string): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;
  const target = getElementByPath(svgEl, path);
  if (!target || !target.parentElement) return rawSvg;
  target.parentElement.removeChild(target);
  return formatSvgMarkup(serializeSvg(svgEl));
}

export function replaceSvgColor(rawSvg: string, fromHex: string, toHex: string): string {
  const targetFrom = normalizeColorToHex(fromHex);
  if (!targetFrom || !toHex) return rawSvg;
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;

  const props = ['fill', 'stroke', 'stop-color'];
  const walk = (el: Element) => {
    for (const p of props) {
      const attrVal = el.getAttribute(p);
      if (attrVal && normalizeColorToHex(attrVal) === targetFrom) {
        el.setAttribute(p, toHex);
      }
    }
    const styleStr = el.getAttribute('style');
    if (styleStr) {
      const styleMap = parseStyleString(styleStr);
      let changed = false;
      for (const p of props) {
        if (styleMap[p] && normalizeColorToHex(styleMap[p]) === targetFrom) {
          styleMap[p] = toHex;
          changed = true;
        }
      }
      if (changed) {
        el.setAttribute('style', serializeStyleMap(styleMap));
      }
    }
    Array.from(el.children).forEach(walk);
  };
  walk(svgEl);

  return formatSvgMarkup(serializeSvg(svgEl));
}

export function transformEntireSvg(rawSvg: string, mode: 'flipH' | 'flipV' | 'rotate90'): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { doc, svgEl } = parsed;
  const vb = parseViewBox(svgEl);
  const ns = 'http://www.w3.org/2000/svg';

  const wrapper = doc.createElementNS(ns, 'g');
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;

  if (mode === 'flipH') {
    wrapper.setAttribute('transform', `translate(${vb.x * 2 + vb.w}, 0) scale(-1, 1)`);
  } else if (mode === 'flipV') {
    wrapper.setAttribute('transform', `translate(0, ${vb.y * 2 + vb.h}) scale(1, -1)`);
  } else {
    // Rotate 90 deg clockwise cleanly around center and swap viewBox dimensions
    const nextW = vb.h;
    const nextH = vb.w;
    wrapper.setAttribute('transform', `translate(${nextW / 2}, ${nextH / 2}) rotate(90) translate(${-cx}, ${-cy})`);
    svgEl.setAttribute('viewBox', `0 0 ${nextW} ${nextH}`);
    if (svgEl.getAttribute('width') && svgEl.getAttribute('height')) {
      const oldW = svgEl.getAttribute('width')!;
      const oldH = svgEl.getAttribute('height')!;
      svgEl.setAttribute('width', oldH);
      svgEl.setAttribute('height', oldW);
    }
  }

  const children = Array.from(svgEl.children);
  children.forEach((child) => {
    if (child.tagName.toLowerCase() !== 'defs') {
      wrapper.appendChild(child);
    }
  });
  svgEl.appendChild(wrapper);

  return formatSvgMarkup(serializeSvg(svgEl));
}

export function formatSvgMarkup(rawSvg: string): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const serialized = serializeSvg(parsed.svgEl).replace(/>\s+</g, '><').trim();

  let formatted = '';
  let indent = 0;
  const tokens = serialized.split(/(?=<)|(?<=>)/g).filter((t) => t.trim() !== '');

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (token.startsWith('</')) {
      indent = Math.max(0, indent - 1);
      formatted += `${'  '.repeat(indent)}${token}\n`;
    } else if (token.startsWith('<') && token.endsWith('/>')) {
      formatted += `${'  '.repeat(indent)}${token}\n`;
    } else if (token.startsWith('<') && !token.startsWith('<?') && !token.startsWith('<!')) {
      // Check if inline text + closing tag immediately follows (e.g. <text>Hello</text>)
      if (
        i + 2 < tokens.length &&
        !tokens[i + 1].trim().startsWith('<') &&
        tokens[i + 2].trim().startsWith('</')
      ) {
        formatted += `${'  '.repeat(indent)}${token}${tokens[i + 1].trim()}${tokens[i + 2].trim()}\n`;
        i += 2;
      } else if (i + 1 < tokens.length && tokens[i + 1].trim().startsWith('</')) {
        formatted += `${'  '.repeat(indent)}${token}${tokens[i + 1].trim()}\n`;
        i += 1;
      } else {
        formatted += `${'  '.repeat(indent)}${token}\n`;
        indent += 1;
      }
    } else {
      formatted += `${'  '.repeat(indent)}${token}\n`;
    }
  }

  return formatted.trim();
}

export function minifySvgMarkup(rawSvg: string): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;

  // Strip comments and common editor namespaces (inkscape, sodipodi)
  const stripCommentsAndEditorMeta = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        const name = el.tagName.toLowerCase();
        if (name.startsWith('sodipodi:') || name.startsWith('inkscape:') || name === 'metadata') {
          node.removeChild(el);
          continue;
        }
        Array.from(el.attributes).forEach((attr) => {
          if (attr.name.startsWith('sodipodi:') || attr.name.startsWith('inkscape:')) {
            el.removeAttribute(attr.name);
          }
        });
        stripCommentsAndEditorMeta(el);
      }
    }
  };

  stripCommentsAndEditorMeta(svgEl);
  return serializeSvg(svgEl)
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function exportSvgToRasterBlob(
  rawSvg: string,
  format: 'png' | 'jpg' | 'webp' | 'bmp' | 'ico' | 'ppm',
  scale: number = 2,
  bgMode: 'transparent' | 'white' | 'dark' = 'transparent'
): Promise<{ blob: Blob; width: number; height: number }> {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) {
    throw new Error(parsed.error);
  }
  const { svgEl } = parsed;
  const vb = parseViewBox(svgEl);
  const outW = Math.max(1, Math.min(8192, Math.round(vb.w * scale)));
  const outH = Math.max(1, Math.min(8192, Math.round(vb.h * scale)));

  svgEl.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svgEl.setAttribute('width', String(outW));
  svgEl.setAttribute('height', String(outH));

  const svgString = serializeSvg(svgEl);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to rasterize SVG'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    const needsOpaqueBg = format === 'jpg' || format === 'bmp' || format === 'ppm';
    if (needsOpaqueBg || bgMode === 'white') {
      ctx.fillStyle = bgMode === 'dark' ? '#0f172a' : '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
    } else if (bgMode === 'dark') {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, outW, outH);
    }

    ctx.drawImage(img, 0, 0, outW, outH);

    if (format === 'bmp') {
      return { blob: canvasToBmpBlob(canvas), width: outW, height: outH };
    }
    if (format === 'ico') {
      const icoBlob = await canvasToIcoBlob(canvas, [16, 32, 48, 64, 128, 256]);
      return { blob: icoBlob, width: outW, height: outH };
    }
    if (format === 'ppm') {
      const bgHex = bgMode === 'dark' ? '#0f172a' : '#ffffff';
      return { blob: canvasToPpmBlob(canvas, 'P6', bgHex), width: outW, height: outH };
    }

    const mime =
      format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Raster export returned empty blob'))),
        mime,
        0.95
      );
    });
    return { blob, width: outW, height: outH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ============================================================================
 * Per-Element Vertex / Control Point Editing Utilities
 * Supports <path>, <polygon>, <polyline>, <line>, <rect>, <circle>, <ellipse>, <text>
 * ========================================================================== */

export interface SvgVertexHandle {
  index: number;
  kind: 'anchor' | 'control';
  label: string;
  x: number;
  y: number;
  anchorX?: number;
  anchorY?: number;
  removable?: boolean;
  insertableAfter?: boolean;
}

type PathCmdSeg =
  | { cmd: 'M' | 'L' | 'T'; x: number; y: number }
  | { cmd: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: 'S'; x2: number; y2: number; x: number; y: number }
  | { cmd: 'Q'; x1: number; y1: number; x: number; y: number }
  | { cmd: 'A'; rx: number; ry: number; rot: number; largeArc: number; sweep: number; x: number; y: number }
  | { cmd: 'Z' };

const CMD_PARAM_COUNTS: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

function parseSvgPathSegments(d: string): PathCmdSeg[] {
  const segs: PathCmdSeg[] = [];
  const rawTokens = d.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || [];
  let i = 0;
  let currentCmd = '';
  let curX = 0;
  let curY = 0;
  let subX = 0;
  let subY = 0;

  const nextNum = (): number | null => {
    if (i >= rawTokens.length) return null;
    if (/^[a-zA-Z]$/.test(rawTokens[i])) return null;
    const val = parseFloat(rawTokens[i]);
    i += 1;
    return Number.isFinite(val) ? val : 0;
  };

  // Handle arc flag tokenization edge case e.g. "01" or "10" in minified SVG arc params
  const expandArcTokenIfNeeded = () => {
    // Splits tokens like "0125" when reading arc flags if concatenated
    const tok = rawTokens[i];
    if (tok && /^[01]{2}/.test(tok) && !tok.includes('.')) {
      const first = tok[0];
      const rest = tok.slice(1);
      rawTokens.splice(i, 1, first, rest);
    }
  };

  while (i < rawTokens.length) {
    const token = rawTokens[i];
    if (/^[a-zA-Z]$/.test(token)) {
      currentCmd = token;
      i += 1;
      if (currentCmd === 'Z' || currentCmd === 'z') {
        segs.push({ cmd: 'Z' });
        curX = subX;
        curY = subY;
        currentCmd = '';
        continue;
      }
    } else if (!currentCmd) {
      i += 1;
      continue;
    }

    const upper = currentCmd.toUpperCase();
    const isRel = currentCmd !== upper;
    const arity = CMD_PARAM_COUNTS[upper];
    if (arity === undefined) {
      i += 1;
      continue;
    }

    if (upper === 'A') {
      const rx = nextNum();
      const ry = nextNum();
      const rot = nextNum();
      expandArcTokenIfNeeded();
      const largeArc = nextNum();
      expandArcTokenIfNeeded();
      const sweep = nextNum();
      const x = nextNum();
      const y = nextNum();
      if (rx === null || ry === null || rot === null || largeArc === null || sweep === null || x === null || y === null) break;
      const ax = isRel ? curX + x : x;
      const ay = isRel ? curY + y : y;
      segs.push({ cmd: 'A', rx, ry, rot, largeArc, sweep, x: ax, y: ay });
      curX = ax;
      curY = ay;
      continue;
    }

    const nums: number[] = [];
    for (let k = 0; k < arity; k++) {
      const n = nextNum();
      if (n === null) break;
      nums.push(n);
    }
    if (nums.length < arity) break;

    if (upper === 'M') {
      curX = isRel ? curX + nums[0] : nums[0];
      curY = isRel ? curY + nums[1] : nums[1];
      subX = curX;
      subY = curY;
      segs.push({ cmd: 'M', x: curX, y: curY });
      // Subsequent coordinate pairs after M are implicit L/l per SVG spec
      currentCmd = isRel ? 'l' : 'L';
    } else if (upper === 'L') {
      curX = isRel ? curX + nums[0] : nums[0];
      curY = isRel ? curY + nums[1] : nums[1];
      segs.push({ cmd: 'L', x: curX, y: curY });
    } else if (upper === 'H') {
      curX = isRel ? curX + nums[0] : nums[0];
      segs.push({ cmd: 'L', x: curX, y: curY });
    } else if (upper === 'V') {
      curY = isRel ? curY + nums[0] : nums[0];
      segs.push({ cmd: 'L', x: curX, y: curY });
    } else if (upper === 'C') {
      const x1 = isRel ? curX + nums[0] : nums[0];
      const y1 = isRel ? curY + nums[1] : nums[1];
      const x2 = isRel ? curX + nums[2] : nums[2];
      const y2 = isRel ? curY + nums[3] : nums[3];
      curX = isRel ? curX + nums[4] : nums[4];
      curY = isRel ? curY + nums[5] : nums[5];
      segs.push({ cmd: 'C', x1, y1, x2, y2, x: curX, y: curY });
    } else if (upper === 'S') {
      const x2 = isRel ? curX + nums[0] : nums[0];
      const y2 = isRel ? curY + nums[1] : nums[1];
      curX = isRel ? curX + nums[2] : nums[2];
      curY = isRel ? curY + nums[3] : nums[3];
      segs.push({ cmd: 'S', x2, y2, x: curX, y: curY });
    } else if (upper === 'Q') {
      const x1 = isRel ? curX + nums[0] : nums[0];
      const y1 = isRel ? curY + nums[1] : nums[1];
      curX = isRel ? curX + nums[2] : nums[2];
      curY = isRel ? curY + nums[3] : nums[3];
      segs.push({ cmd: 'Q', x1, y1, x: curX, y: curY });
    } else if (upper === 'T') {
      curX = isRel ? curX + nums[0] : nums[0];
      curY = isRel ? curY + nums[1] : nums[1];
      segs.push({ cmd: 'T', x: curX, y: curY });
    }
  }

  return segs;
}

function serializeSvgPathSegments(segs: PathCmdSeg[]): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return segs
    .map((s) => {
      if (s.cmd === 'Z') return 'Z';
      if (s.cmd === 'M' || s.cmd === 'L' || s.cmd === 'T') {
        return `${s.cmd} ${r(s.x)} ${r(s.y)}`;
      }
      if (s.cmd === 'C') {
        return `C ${r(s.x1)} ${r(s.y1)} ${r(s.x2)} ${r(s.y2)} ${r(s.x)} ${r(s.y)}`;
      }
      if (s.cmd === 'S') {
        return `S ${r(s.x2)} ${r(s.y2)} ${r(s.x)} ${r(s.y)}`;
      }
      if (s.cmd === 'Q') {
        return `Q ${r(s.x1)} ${r(s.y1)} ${r(s.x)} ${r(s.y)}`;
      }
      if (s.cmd === 'A') {
        return `A ${r(s.rx)} ${r(s.ry)} ${r(s.rot)} ${s.largeArc} ${s.sweep} ${r(s.x)} ${r(s.y)}`;
      }
      return '';
    })
    .join(' ');
}

function parsePolyPoints(pointsAttr: string): Array<{ x: number; y: number }> {
  const nums = (pointsAttr.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || []).map(Number);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
      pts.push({ x: nums[i], y: nums[i + 1] });
    }
  }
  return pts;
}

function serializePolyPoints(pts: Array<{ x: number; y: number }>): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return pts.map((p) => `${r(p.x)},${r(p.y)}`).join(' ');
}

export function getSvgElementVertices(rawSvg: string, path: string): SvgVertexHandle[] {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return [];
  const el = getElementByPath(parsed.svgEl, path);
  if (!el) return [];

  const tag = el.tagName.toLowerCase();

  if (tag === 'rect') {
    const x = parseFloat(el.getAttribute('x') || '0') || 0;
    const y = parseFloat(el.getAttribute('y') || '0') || 0;
    const w = parseFloat(el.getAttribute('width') || '0') || 0;
    const h = parseFloat(el.getAttribute('height') || '0') || 0;
    return [
      { index: 0, kind: 'anchor', label: 'TL', x, y },
      { index: 1, kind: 'anchor', label: 'TR', x: x + w, y },
      { index: 2, kind: 'anchor', label: 'BR', x: x + w, y: y + h },
      { index: 3, kind: 'anchor', label: 'BL', x, y: y + h },
    ];
  }

  if (tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx') || '0') || 0;
    const cy = parseFloat(el.getAttribute('cy') || '0') || 0;
    const r = parseFloat(el.getAttribute('r') || '0') || 0;
    return [
      { index: 0, kind: 'anchor', label: 'Center', x: cx, y: cy },
      { index: 1, kind: 'control', label: 'Top (r)', x: cx, y: cy - r, anchorX: cx, anchorY: cy },
      { index: 2, kind: 'control', label: 'Right (r)', x: cx + r, y: cy, anchorX: cx, anchorY: cy },
      { index: 3, kind: 'control', label: 'Bottom (r)', x: cx, y: cy + r, anchorX: cx, anchorY: cy },
      { index: 4, kind: 'control', label: 'Left (r)', x: cx - r, y: cy, anchorX: cx, anchorY: cy },
    ];
  }

  if (tag === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx') || '0') || 0;
    const cy = parseFloat(el.getAttribute('cy') || '0') || 0;
    const rx = parseFloat(el.getAttribute('rx') || '0') || 0;
    const ry = parseFloat(el.getAttribute('ry') || '0') || 0;
    return [
      { index: 0, kind: 'anchor', label: 'Center', x: cx, y: cy },
      { index: 1, kind: 'control', label: 'Top (ry)', x: cx, y: cy - ry, anchorX: cx, anchorY: cy },
      { index: 2, kind: 'control', label: 'Right (rx)', x: cx + rx, y: cy, anchorX: cx, anchorY: cy },
      { index: 3, kind: 'control', label: 'Bottom (ry)', x: cx, y: cy + ry, anchorX: cx, anchorY: cy },
      { index: 4, kind: 'control', label: 'Left (rx)', x: cx - rx, y: cy, anchorX: cx, anchorY: cy },
    ];
  }

  if (tag === 'line') {
    const x1 = parseFloat(el.getAttribute('x1') || '0') || 0;
    const y1 = parseFloat(el.getAttribute('y1') || '0') || 0;
    const x2 = parseFloat(el.getAttribute('x2') || '0') || 0;
    const y2 = parseFloat(el.getAttribute('y2') || '0') || 0;
    return [
      { index: 0, kind: 'anchor', label: 'Start', x: x1, y: y1 },
      { index: 1, kind: 'anchor', label: 'End', x: x2, y: y2 },
    ];
  }

  if (tag === 'text') {
    const x = parseFloat(el.getAttribute('x') || '0') || 0;
    const y = parseFloat(el.getAttribute('y') || '0') || 0;
    return [{ index: 0, kind: 'anchor', label: 'Origin', x, y }];
  }

  if (tag === 'polygon' || tag === 'polyline') {
    const pts = parsePolyPoints(el.getAttribute('points') || '');
    const minPts = tag === 'polygon' ? 3 : 2;
    return pts.map((p, idx) => ({
      index: idx,
      kind: 'anchor',
      label: `#${idx + 1}`,
      x: p.x,
      y: p.y,
      removable: pts.length > minPts,
      insertableAfter: true,
    }));
  }

  if (tag === 'path') {
    const segs = parseSvgPathSegments(el.getAttribute('d') || '');
    const anchorCount = segs.filter((s) => s.cmd !== 'Z').length;
    const handles: SvgVertexHandle[] = [];
    let prevX = 0;
    let prevY = 0;
    let subX = 0;
    let subY = 0;
    let handleIdx = 0;

    segs.forEach((seg, segIdx) => {
      if (seg.cmd === 'Z') {
        prevX = subX;
        prevY = subY;
        return;
      }
      if (seg.cmd === 'C') {
        handles.push({
          index: handleIdx++,
          kind: 'control',
          label: `C${segIdx} cp1`,
          x: seg.x1,
          y: seg.y1,
          anchorX: prevX,
          anchorY: prevY,
        });
        handles.push({
          index: handleIdx++,
          kind: 'control',
          label: `C${segIdx} cp2`,
          x: seg.x2,
          y: seg.y2,
          anchorX: seg.x,
          anchorY: seg.y,
        });
        handles.push({
          index: handleIdx++,
          kind: 'anchor',
          label: `C #${segIdx + 1}`,
          x: seg.x,
          y: seg.y,
          removable: anchorCount > 2,
          insertableAfter: true,
        });
      } else if (seg.cmd === 'S') {
        handles.push({
          index: handleIdx++,
          kind: 'control',
          label: `S${segIdx} cp2`,
          x: seg.x2,
          y: seg.y2,
          anchorX: seg.x,
          anchorY: seg.y,
        });
        handles.push({
          index: handleIdx++,
          kind: 'anchor',
          label: `S #${segIdx + 1}`,
          x: seg.x,
          y: seg.y,
          removable: anchorCount > 2,
          insertableAfter: true,
        });
      } else if (seg.cmd === 'Q') {
        handles.push({
          index: handleIdx++,
          kind: 'control',
          label: `Q${segIdx} cp1`,
          x: seg.x1,
          y: seg.y1,
          anchorX: seg.x,
          anchorY: seg.y,
        });
        handles.push({
          index: handleIdx++,
          kind: 'anchor',
          label: `Q #${segIdx + 1}`,
          x: seg.x,
          y: seg.y,
          removable: anchorCount > 2,
          insertableAfter: true,
        });
      } else {
        handles.push({
          index: handleIdx++,
          kind: 'anchor',
          label: `${seg.cmd} #${segIdx + 1}`,
          x: seg.x,
          y: seg.y,
          removable: seg.cmd !== 'M' && anchorCount > 2,
          insertableAfter: true,
        });
        if (seg.cmd === 'M') {
          subX = seg.x;
          subY = seg.y;
        }
      }
      prevX = seg.x;
      prevY = seg.y;
    });

    return handles;
  }

  return [];
}

export function moveSvgElementVertex(
  rawSvg: string,
  path: string,
  vertexIndex: number,
  newX: number,
  newY: number
): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;
  const el = getElementByPath(svgEl, path);
  if (!el) return rawSvg;

  const r = (n: number) => Math.round(n * 100) / 100;
  const nx = r(newX);
  const ny = r(newY);
  const tag = el.tagName.toLowerCase();

  if (tag === 'rect') {
    const x = parseFloat(el.getAttribute('x') || '0') || 0;
    const y = parseFloat(el.getAttribute('y') || '0') || 0;
    const w = parseFloat(el.getAttribute('width') || '0') || 0;
    const h = parseFloat(el.getAttribute('height') || '0') || 0;
    const right = x + w;
    const bottom = y + h;

    if (vertexIndex === 0) {
      const clX = Math.min(nx, right - 1);
      const clY = Math.min(ny, bottom - 1);
      el.setAttribute('x', String(r(clX)));
      el.setAttribute('y', String(r(clY)));
      el.setAttribute('width', String(r(right - clX)));
      el.setAttribute('height', String(r(bottom - clY)));
    } else if (vertexIndex === 1) {
      const clR = Math.max(nx, x + 1);
      const clY = Math.min(ny, bottom - 1);
      el.setAttribute('y', String(r(clY)));
      el.setAttribute('width', String(r(clR - x)));
      el.setAttribute('height', String(r(bottom - clY)));
    } else if (vertexIndex === 2) {
      const clR = Math.max(nx, x + 1);
      const clB = Math.max(ny, y + 1);
      el.setAttribute('width', String(r(clR - x)));
      el.setAttribute('height', String(r(clB - y)));
    } else if (vertexIndex === 3) {
      const clX = Math.min(nx, right - 1);
      const clB = Math.max(ny, y + 1);
      el.setAttribute('x', String(r(clX)));
      el.setAttribute('width', String(r(right - clX)));
      el.setAttribute('height', String(r(clB - y)));
    }
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx') || '0') || 0;
    const cy = parseFloat(el.getAttribute('cy') || '0') || 0;
    if (vertexIndex === 0) {
      el.setAttribute('cx', String(nx));
      el.setAttribute('cy', String(ny));
    } else {
      const nextR = Math.max(1, r(Math.hypot(nx - cx, ny - cy)));
      el.setAttribute('r', String(nextR));
    }
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx') || '0') || 0;
    const cy = parseFloat(el.getAttribute('cy') || '0') || 0;
    if (vertexIndex === 0) {
      el.setAttribute('cx', String(nx));
      el.setAttribute('cy', String(ny));
    } else if (vertexIndex === 1 || vertexIndex === 3) {
      el.setAttribute('ry', String(Math.max(1, r(Math.abs(ny - cy)))));
    } else if (vertexIndex === 2 || vertexIndex === 4) {
      el.setAttribute('rx', String(Math.max(1, r(Math.abs(nx - cx)))));
    }
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'line') {
    if (vertexIndex === 0) {
      el.setAttribute('x1', String(nx));
      el.setAttribute('y1', String(ny));
    } else if (vertexIndex === 1) {
      el.setAttribute('x2', String(nx));
      el.setAttribute('y2', String(ny));
    }
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'text') {
    if (vertexIndex === 0) {
      el.setAttribute('x', String(nx));
      el.setAttribute('y', String(ny));
    }
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'polygon' || tag === 'polyline') {
    const pts = parsePolyPoints(el.getAttribute('points') || '');
    if (vertexIndex >= 0 && vertexIndex < pts.length) {
      pts[vertexIndex] = { x: nx, y: ny };
      el.setAttribute('points', serializePolyPoints(pts));
    }
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'path') {
    const segs = parseSvgPathSegments(el.getAttribute('d') || '');
    let handleIdx = 0;

    for (const seg of segs) {
      if (seg.cmd === 'Z') continue;
      if (seg.cmd === 'C') {
        if (handleIdx === vertexIndex) {
          seg.x1 = nx;
          seg.y1 = ny;
          break;
        }
        handleIdx++;
        if (handleIdx === vertexIndex) {
          seg.x2 = nx;
          seg.y2 = ny;
          break;
        }
        handleIdx++;
        if (handleIdx === vertexIndex) {
          seg.x = nx;
          seg.y = ny;
          break;
        }
        handleIdx++;
      } else if (seg.cmd === 'S') {
        if (handleIdx === vertexIndex) {
          seg.x2 = nx;
          seg.y2 = ny;
          break;
        }
        handleIdx++;
        if (handleIdx === vertexIndex) {
          seg.x = nx;
          seg.y = ny;
          break;
        }
        handleIdx++;
      } else if (seg.cmd === 'Q') {
        if (handleIdx === vertexIndex) {
          seg.x1 = nx;
          seg.y1 = ny;
          break;
        }
        handleIdx++;
        if (handleIdx === vertexIndex) {
          seg.x = nx;
          seg.y = ny;
          break;
        }
        handleIdx++;
      } else {
        if (handleIdx === vertexIndex) {
          seg.x = nx;
          seg.y = ny;
          break;
        }
        handleIdx++;
      }
    }

    el.setAttribute('d', serializeSvgPathSegments(segs));
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  return rawSvg;
}

export function insertSvgElementVertex(
  rawSvg: string,
  path: string,
  afterVertexIndex: number
): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;
  const el = getElementByPath(svgEl, path);
  if (!el) return rawSvg;
  const tag = el.tagName.toLowerCase();

  if (tag === 'polygon' || tag === 'polyline') {
    const pts = parsePolyPoints(el.getAttribute('points') || '');
    if (afterVertexIndex < 0 || afterVertexIndex >= pts.length) return rawSvg;
    const p1 = pts[afterVertexIndex];
    const p2 = pts[(afterVertexIndex + 1) % pts.length] || p1;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    pts.splice(afterVertexIndex + 1, 0, mid);
    el.setAttribute('points', serializePolyPoints(pts));
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'path') {
    const segs = parseSvgPathSegments(el.getAttribute('d') || '');
    let handleIdx = 0;
    let targetSegIdx = -1;

    for (let sIdx = 0; sIdx < segs.length; sIdx++) {
      const seg = segs[sIdx];
      if (seg.cmd === 'Z') continue;
      const stepCount = seg.cmd === 'C' ? 3 : seg.cmd === 'S' || seg.cmd === 'Q' ? 2 : 1;
      const anchorHandleIdx = handleIdx + stepCount - 1;
      if (anchorHandleIdx === afterVertexIndex) {
        targetSegIdx = sIdx;
        break;
      }
      handleIdx += stepCount;
    }

    if (targetSegIdx !== -1) {
      const curSeg = segs[targetSegIdx];
      if (curSeg.cmd !== 'Z') {
        // Find next non-Z anchor or wrap back to subpath M
        let nextAnchor: { x: number; y: number } | null = null;
        for (let j = targetSegIdx + 1; j < segs.length; j++) {
          const cand = segs[j];
          if (cand.cmd === 'Z') {
            // Find matching M backwards
            for (let k = targetSegIdx; k >= 0; k--) {
              if (segs[k].cmd === 'M') {
                const mSeg = segs[k] as { cmd: 'M'; x: number; y: number };
                nextAnchor = { x: mSeg.x, y: mSeg.y };
                break;
              }
            }
            break;
          } else {
            nextAnchor = { x: cand.x, y: cand.y };
            break;
          }
        }
        const midX = nextAnchor ? (curSeg.x + nextAnchor.x) / 2 : curSeg.x + 20;
        const midY = nextAnchor ? (curSeg.y + nextAnchor.y) / 2 : curSeg.y + 20;
        segs.splice(targetSegIdx + 1, 0, { cmd: 'L', x: midX, y: midY });
        el.setAttribute('d', serializeSvgPathSegments(segs));
        return formatSvgMarkup(serializeSvg(svgEl));
      }
    }
  }

  return rawSvg;
}

export function deleteSvgElementVertex(
  rawSvg: string,
  path: string,
  vertexIndex: number
): string {
  const parsed = parseSvgSafe(rawSvg);
  if ('error' in parsed) return rawSvg;
  const { svgEl } = parsed;
  const el = getElementByPath(svgEl, path);
  if (!el) return rawSvg;
  const tag = el.tagName.toLowerCase();

  if (tag === 'polygon' || tag === 'polyline') {
    const pts = parsePolyPoints(el.getAttribute('points') || '');
    const minPts = tag === 'polygon' ? 3 : 2;
    if (pts.length <= minPts || vertexIndex < 0 || vertexIndex >= pts.length) return rawSvg;
    pts.splice(vertexIndex, 1);
    el.setAttribute('points', serializePolyPoints(pts));
    return formatSvgMarkup(serializeSvg(svgEl));
  }

  if (tag === 'path') {
    const segs = parseSvgPathSegments(el.getAttribute('d') || '');
    const anchorCount = segs.filter((s) => s.cmd !== 'Z').length;
    if (anchorCount <= 2) return rawSvg;

    let handleIdx = 0;
    for (let sIdx = 0; sIdx < segs.length; sIdx++) {
      const seg = segs[sIdx];
      if (seg.cmd === 'Z') continue;
      const stepCount = seg.cmd === 'C' ? 3 : seg.cmd === 'S' || seg.cmd === 'Q' ? 2 : 1;
      const anchorHandleIdx = handleIdx + stepCount - 1;
      if (anchorHandleIdx === vertexIndex && seg.cmd !== 'M') {
        segs.splice(sIdx, 1);
        el.setAttribute('d', serializeSvgPathSegments(segs));
        return formatSvgMarkup(serializeSvg(svgEl));
      }
      handleIdx += stepCount;
    }
  }

  return rawSvg;
}

