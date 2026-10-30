import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Layers,
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
  ArrowRightLeft,
} from 'lucide-react';

interface TabNavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lang: 'ja' | 'en';
}

export const TabNavigation: React.FC<TabNavigationProps> = ({ activeTab, setActiveTab, lang }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Drag to scroll state
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const hasMovedRef = useRef(false);

  const tabs = [
    { id: 'pdf-suite', labelJa: 'PDF編集・整理', labelEn: 'PDF Toolkit', icon: FileText },
    { id: 'pdf-image', labelJa: 'PDF ⇔ 画像', labelEn: 'PDF ⇔ Image', icon: ImageIcon },
    { id: 'image-editor', labelJa: '画像編集・変換', labelEn: 'Image Studio & Convert', icon: Sliders },
    { id: 'office-suite', labelJa: 'Office・データ表', labelEn: 'Office & Data Suite', icon: Briefcase },
    { id: 'html-studio', labelJa: 'HTML・Markdown', labelEn: 'HTML & Markdown', icon: FileCode },
    { id: 'sign-stamp', labelJa: '電子印鑑・署名', labelEn: 'Sign & Stamp', icon: PenTool },
    { id: 'ocr-qr', labelJa: 'OCR・QR', labelEn: 'OCR & QR', icon: ScanText },
    { id: 'diff-suite', labelJa: '差分比較', labelEn: 'Diff Studio', icon: GitCompare },
    { id: 'zip-suite', labelJa: 'ZIP・一括リネーム', labelEn: 'ZIP & Rename', icon: Archive },
    { id: 'history', labelJa: '履歴', labelEn: 'History', icon: History },
  ];

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
  }, [checkScrollability]);

  // Center active tab when activeTab changes
  useEffect(() => {
    if (scrollRef.current) {
      const activeEl = scrollRef.current.querySelector<HTMLElement>(`.tab-btn[data-id="${activeTab}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeTab]);

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
    <div className="tab-navigation-container" id="tabNavContainer">
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
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              data-id={tab.id}
              onClick={(e) => {
                if (hasMovedRef.current) return;
                setActiveTab(tab.id);
                e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
              }}
              className={`tab-btn ${isActive ? 'active' : ''} inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap`}
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
  );
};
