import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Sliders,
  Briefcase,
  FileCode,
  PenTool,
  ScanText,
  GitCompare,
  Archive,
  History,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  LucideIcon,
} from 'lucide-react';
import { TAB_DEFINITIONS, TabAdaptiveMode, TabMeta } from '../utils/tabOrdering';

interface TabNavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lang: 'ja' | 'en';
  tabs?: TabMeta[];
  adaptiveMode?: TabAdaptiveMode;
  onChangeAdaptiveMode?: (mode: TabAdaptiveMode) => void;
  scrollTargetRequest?: { tabId: string; seq: number } | null;
}

const TAB_ICON_MAP: Record<string, LucideIcon> = {
  'pdf-suite': FileText,
  'pdf-image': ImageIcon,
  'image-editor': Sliders,
  'office-suite': Briefcase,
  'html-studio': FileCode,
  'sign-stamp': PenTool,
  'ocr-qr': ScanText,
  'diff-suite': GitCompare,
  'metadata-studio': FileSearch,
  'zip-suite': Archive,
  history: History,
};

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  setActiveTab,
  lang,
  tabs = TAB_DEFINITIONS,
  adaptiveMode = 'scroll',
  onChangeAdaptiveMode,
  scrollTargetRequest,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [highlightedTabId, setHighlightedTabId] = useState<string | null>(null);

  // Drag to scroll state
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const hasMovedRef = useRef(false);

  const checkScrollability = useCallback(() => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 4);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
    }
  }, []);

  useEffect(() => {
    checkScrollability();
    const timer = setTimeout(checkScrollability, 150);
    const timer2 = setTimeout(checkScrollability, 500);

    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScrollability, { passive: true });
      window.addEventListener('resize', checkScrollability);
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      if (el) el.removeEventListener('scroll', checkScrollability);
      window.removeEventListener('resize', checkScrollability);
    };
  }, [checkScrollability, tabs]);

  // Center active tab when activeTab changes
  useEffect(() => {
    if (scrollRef.current) {
      const activeEl = scrollRef.current.querySelector<HTMLElement>(`.tab-btn[data-id="${activeTab}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeTab]);

  // Scroll to suggested tab in 'scroll' adaptive mode
  useEffect(() => {
    if (!scrollTargetRequest?.tabId || !scrollRef.current) return;
    const targetEl = scrollRef.current.querySelector<HTMLElement>(
      `.tab-btn[data-id="${scrollTargetRequest.tabId}"]`
    );
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      setHighlightedTabId(scrollTargetRequest.tabId);
      const timer = setTimeout(() => {
        setHighlightedTabId((prev) => (prev === scrollTargetRequest.tabId ? null : prev));
      }, 2800);
      return () => clearTimeout(timer);
    }
  }, [scrollTargetRequest]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -280 : 280;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
      setTimeout(checkScrollability, 300);
    }
  };

  // Convert vertical mouse wheel to horizontal scroll over the tab bar
  const handleWheel = (e: React.WheelEvent) => {
    if (scrollRef.current) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        scrollRef.current.scrollLeft += e.deltaY;
      } else {
        scrollRef.current.scrollLeft += e.deltaX;
      }
      checkScrollability();
    }
  };

  // Mouse grab and drag to scroll
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    startXRef.current = e.pageX - scrollRef.current.offsetLeft;
    startScrollLeftRef.current = scrollRef.current.scrollLeft;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    if (Math.abs(walk) > 4) {
      hasMovedRef.current = true;
    }
    scrollRef.current.scrollLeft = startScrollLeftRef.current - walk;
    checkScrollability();
  };

  const handleMouseUpOrLeave = () => {
    isDraggingRef.current = false;
  };

  return (
    <div id="tabNavContainer" className="w-full">
      {onChangeAdaptiveMode && (
        <div className="flex flex-wrap items-center justify-end gap-2 mb-1.5">
          <label
            htmlFor="tabAdaptiveModeSelect"
            className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap"
          >
            {lang === 'ja' ? 'タブ表示:' : 'Tab Behavior:'}
          </label>
          <select
            id="tabAdaptiveModeSelect"
            value={adaptiveMode}
            onChange={(e) => onChangeAdaptiveMode(e.target.value as TabAdaptiveMode)}
            className="select-sm text-[11px] py-1 px-2"
            aria-label={lang === 'ja' ? '処理タブの自動動作モード' : 'Tab adaptive behavior mode'}
          >
            <option value="scroll">
              {lang === 'ja' ? '最適タブへ自動スクロール（順番固定）' : 'Auto-Scroll to Match (Fixed Order)'}
            </option>
            <option value="reorder">
              {lang === 'ja' ? '使用状況・拡張子で順番を並び替え' : 'Reorder by Usage & Extension'}
            </option>
            <option value="off">
              {lang === 'ja' ? 'オフ（順番固定・手動選択）' : 'Off (Fixed Order, Manual)'}
            </option>
          </select>
        </div>
      )}

      <div className="tab-navigation-container">
        {/* Left Scroll Button */}
        <button
          onClick={() => handleScroll('left')}
          disabled={!canScrollLeft}
          className="tab-scroll-btn"
          title={lang === 'ja' ? '左にスクロール' : 'Scroll Left'}
          aria-label="Scroll Tabs Left"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Tab List */}
        <div
          ref={scrollRef}
          className="tab-navigation cursor-grab active:cursor-grabbing select-none"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
        >
          {tabs.map((tab) => {
            const Icon = TAB_ICON_MAP[tab.id] || FileText;
            const isActive = activeTab === tab.id;
            const isSuggested = !isActive && highlightedTabId === tab.id;
            return (
              <button
                key={tab.id}
                data-id={tab.id}
                onClick={(e) => {
                  if (hasMovedRef.current) return;
                  setHighlightedTabId(null);
                  setActiveTab(tab.id);
                  e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                }}
                className={`tab-btn ${isActive ? 'active' : ''} ${
                  isSuggested ? '!text-blue-600 dark:!text-blue-400 !border-b-blue-400' : ''
                } inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap`}
              >
                <Icon className="w-4 h-4" />
                <span>{lang === 'ja' ? tab.labelJa : tab.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* Right Scroll Button */}
        <button
          onClick={() => handleScroll('right')}
          disabled={!canScrollRight}
          className="tab-scroll-btn"
          title={lang === 'ja' ? '右にスクロール' : 'Scroll Right'}
          aria-label="Scroll Tabs Right"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
