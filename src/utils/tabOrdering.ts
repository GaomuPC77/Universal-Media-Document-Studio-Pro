import { FileItem } from '../types';

export interface TabMeta {
  id: string;
  labelJa: string;
  labelEn: string;
  baseIndex: number;
  pinnedLast?: boolean;
}

export const TAB_DEFINITIONS: TabMeta[] = [
  { id: 'pdf-suite', labelJa: 'PDF編集・整理', labelEn: 'PDF Toolkit', baseIndex: 0 },
  { id: 'pdf-image', labelJa: 'PDF ⇔ 画像', labelEn: 'PDF ⇔ Image', baseIndex: 1 },
  { id: 'image-editor', labelJa: '画像編集・変換', labelEn: 'Image Studio & Convert', baseIndex: 2 },
  { id: 'svg-studio', labelJa: 'SVG編集・作成', labelEn: 'SVG Studio', baseIndex: 3 },
  { id: 'office-suite', labelJa: 'Office・データ表', labelEn: 'Office & Data Suite', baseIndex: 4 },
  { id: 'html-studio', labelJa: 'HTML・Markdown', labelEn: 'HTML & Markdown', baseIndex: 5 },
  { id: 'sign-stamp', labelJa: '電子印鑑・署名・PDF注釈', labelEn: 'Sign & PDF Markup', baseIndex: 6 },
  { id: 'ocr-qr', labelJa: 'OCR・QR', labelEn: 'OCR & QR', baseIndex: 7 },
  { id: 'diff-suite', labelJa: '差分比較', labelEn: 'Diff Studio', baseIndex: 8 },
  { id: 'metadata-studio', labelJa: 'メタデータ・C2PA', labelEn: 'Metadata & C2PA', baseIndex: 9 },
  { id: 'zip-suite', labelJa: 'ZIP・一括リネーム', labelEn: 'ZIP & Rename', baseIndex: 10 },
  { id: 'history', labelJa: '履歴', labelEn: 'History', baseIndex: 11, pinnedLast: true },
];

export type TabAdaptiveMode = 'reorder' | 'scroll' | 'off';

export interface TabUsageEntry {
  visits: number;
  actions: number;
  lastUsedAt: number;
}

export type TabUsageMap = Record<string, TabUsageEntry>;

const TAB_USAGE_STORAGE_KEY = 'umdsp_tab_usage_v1';
const TAB_ADAPTIVE_MODE_STORAGE_KEY = 'umdsp_tab_adaptive_mode_v1';

export function loadTabAdaptiveMode(): TabAdaptiveMode {
  try {
    const raw = localStorage.getItem(TAB_ADAPTIVE_MODE_STORAGE_KEY);
    if (raw === 'reorder' || raw === 'scroll' || raw === 'off') {
      return raw;
    }
    return 'scroll';
  } catch {
    return 'scroll';
  }
}

export function saveTabAdaptiveMode(mode: TabAdaptiveMode): void {
  try {
    localStorage.setItem(TAB_ADAPTIVE_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota errors
  }
}

export function loadTabUsage(): TabUsageMap {
  try {
    const raw = localStorage.getItem(TAB_USAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as TabUsageMap;
  } catch {
    return {};
  }
}

function saveTabUsage(map: TabUsageMap): void {
  try {
    localStorage.setItem(TAB_USAGE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function recordTabVisit(tabId: string): TabUsageMap {
  const current = loadTabUsage();
  const prev = current[tabId] || { visits: 0, actions: 0, lastUsedAt: 0 };
  const next: TabUsageMap = {
    ...current,
    [tabId]: {
      visits: prev.visits + 1,
      actions: prev.actions,
      lastUsedAt: Date.now(),
    },
  };
  saveTabUsage(next);
  return next;
}

export function recordTabAction(tabId: string): TabUsageMap {
  const current = loadTabUsage();
  const prev = current[tabId] || { visits: 0, actions: 0, lastUsedAt: 0 };
  const next: TabUsageMap = {
    ...current,
    [tabId]: {
      visits: prev.visits,
      actions: prev.actions + 1,
      lastUsedAt: Date.now(),
    },
  };
  saveTabUsage(next);
  return next;
}

export function clearTabUsage(): void {
  try {
    localStorage.removeItem(TAB_USAGE_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

function getExtensionFromName(name: string, fallbackFormat?: string): string {
  const idx = name.lastIndexOf('.');
  if (idx > 0 && idx < name.length - 1) {
    return name.slice(idx + 1).toLowerCase();
  }
  return (fallbackFormat || '').toLowerCase();
}

function getExtensionAffinity(ext: string): Record<string, number> {
  switch (ext) {
    case 'pdf':
      return {
        'pdf-suite': 36,
        'pdf-image': 30,
        'sign-stamp': 28,
        'office-suite': 16,
        'ocr-qr': 16,
        'metadata-studio': 14,
        'diff-suite': 12,
      };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'bmp':
    case 'gif':
    case 'ico':
    case 'ppm':
    case 'pnm':
      return {
        'image-editor': 36,
        'pdf-image': 28,
        'ocr-qr': 24,
        'metadata-studio': 18,
        'sign-stamp': 12,
      };
    case 'svg':
      return {
        'svg-studio': 42,
        'image-editor': 26,
        'html-studio': 22,
        'pdf-image': 18,
        'metadata-studio': 16,
      };
    case 'docx':
    case 'doc':
    case 'rtf':
    case 'epub':
      return {
        'office-suite': 36,
        'diff-suite': 18,
        'metadata-studio': 16,
      };
    case 'xlsx':
    case 'xls':
    case 'csv':
    case 'tsv':
      return {
        'office-suite': 36,
        'diff-suite': 20,
        'metadata-studio': 14,
      };
    case 'pptx':
    case 'ppt':
      return {
        'office-suite': 36,
        'metadata-studio': 16,
      };
    case 'html':
    case 'htm':
      return {
        'html-studio': 36,
        'diff-suite': 18,
        'metadata-studio': 16,
        'office-suite': 12,
      };
    case 'md':
    case 'markdown':
      return {
        'html-studio': 34,
        'office-suite': 26,
        'diff-suite': 18,
      };
    case 'txt':
      return {
        'office-suite': 30,
        'html-studio': 28,
        'diff-suite': 24,
      };
    case 'json':
    case 'xml':
      return {
        'office-suite': 32,
        'diff-suite': 24,
        'metadata-studio': 16,
        'html-studio': 12,
      };
    case 'zip':
      return {
        'zip-suite': 38,
        'metadata-studio': 12,
      };
    case 'mp4':
    case 'mov':
    case 'm4a':
    case 'mp3':
    case 'wav':
    case 'webm':
    case 'aac':
    case 'ogg':
      return {
        'metadata-studio': 34,
        'zip-suite': 14,
      };
    default:
      return {
        'metadata-studio': 20,
        'zip-suite': 16,
      };
  }
}

export function getOrderedTabs(
  fileList: FileItem[],
  usageMap: TabUsageMap,
  activeSharedFile?: File | null,
  now: number = Date.now()
): TabMeta[] {
  const fileAffinityScores: Record<string, number> = {};

  if (fileList.length > 0) {
    // Score uploaded files; newest / activeSharedFile gets slightly higher weight
    const totalWeightByTab: Record<string, number> = {};
    let weightSum = 0;

    fileList.forEach((item, idx) => {
      const isShared = activeSharedFile && (item.file === activeSharedFile || item.name === activeSharedFile.name);
      const recencyWeight = idx === 0 || isShared ? 1.5 : Math.max(0.6, 1.1 - idx * 0.1);
      weightSum += recencyWeight;

      const ext = getExtensionFromName(item.name, item.format);
      const affinities = getExtensionAffinity(ext);
      for (const [tabId, pts] of Object.entries(affinities)) {
        totalWeightByTab[tabId] = (totalWeightByTab[tabId] || 0) + pts * recencyWeight;
      }
    });

    if (weightSum > 0) {
      for (const [tabId, weightedPts] of Object.entries(totalWeightByTab)) {
        fileAffinityScores[tabId] = weightedPts / weightSum;
      }
    }

    // Multi-file workflow boosts
    if (fileList.length >= 2) {
      fileAffinityScores['zip-suite'] = (fileAffinityScores['zip-suite'] || 0) + 10;
      fileAffinityScores['metadata-studio'] = (fileAffinityScores['metadata-studio'] || 0) + 8;

      const comparableCount = fileList.filter((item) => {
        const ext = getExtensionFromName(item.name, item.format);
        return ['txt', 'md', 'markdown', 'html', 'htm', 'json', 'xml', 'csv', 'tsv', 'docx', 'xlsx', 'pdf'].includes(ext);
      }).length;
      if (comparableCount >= 2) {
        fileAffinityScores['diff-suite'] = (fileAffinityScores['diff-suite'] || 0) + 12;
      }
    }
  } else if (activeSharedFile) {
    const ext = getExtensionFromName(activeSharedFile.name);
    const affinities = getExtensionAffinity(ext);
    for (const [tabId, pts] of Object.entries(affinities)) {
      fileAffinityScores[tabId] = pts;
    }
  }

  const computeTotalScore = (tab: TabMeta): number => {
    const extScore = fileAffinityScores[tab.id] || 0;
    const usage = usageMap[tab.id];
    let usageScore = 0;

    if (usage) {
      const rawInteractions = (usage.actions || 0) * 2.5 + (usage.visits || 0);
      usageScore += Math.min(26, Math.log1p(rawInteractions) * 6.5);

      if (usage.lastUsedAt > 0) {
        const ageMs = Math.max(0, now - usage.lastUsedAt);
        if (ageMs < 30 * 60 * 1000) usageScore += 8;
        else if (ageMs < 24 * 60 * 60 * 1000) usageScore += 5;
        else if (ageMs < 7 * 24 * 60 * 60 * 1000) usageScore += 2;
      }
    }

    return extScore + usageScore;
  };

  return [...TAB_DEFINITIONS].sort((a, b) => {
    if (a.pinnedLast && !b.pinnedLast) return 1;
    if (!a.pinnedLast && b.pinnedLast) return -1;

    const scoreA = computeTotalScore(a);
    const scoreB = computeTotalScore(b);
    if (Math.abs(scoreB - scoreA) > 0.001) {
      return scoreB - scoreA;
    }
    return a.baseIndex - b.baseIndex;
  });
}

export function hasTabAffinity(files: FileItem[], tabId: string): boolean {
  if (!files || files.length === 0) return false;
  return files.some((item) => {
    const ext = getExtensionFromName(item.name, item.format);
    const affinities = getExtensionAffinity(ext);
    return (affinities[tabId] || 0) > 0;
  });
}

export function getBestMatchingTabId(
  files: FileItem[],
  usageMap: TabUsageMap,
  activeSharedFile?: File | null
): string | null {
  if ((!files || files.length === 0) && !activeSharedFile) return null;
  const ranked = getOrderedTabs(files, usageMap, activeSharedFile);
  const candidate = ranked.find((t) => !t.pinnedLast);
  return candidate ? candidate.id : null;
}
