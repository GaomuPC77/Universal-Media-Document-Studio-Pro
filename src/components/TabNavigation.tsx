import React, { useRef, useState, useEffect } from 'react';
import {
  Layers,
  FileText,
  Image as ImageIcon,
  Briefcase,
  FileCode,
  PenTool,
  ScanText,
  GitCompare,
  Archive,
  History,
  ChevronLeft,
  ChevronRight,
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

  const tabs = [
    { id: 'converter', labelJa: '変換', labelEn: 'Convert', icon: Layers },
    { id: 'pdf-suite', labelJa: 'PDF編集・整理', labelEn: 'PDF Toolkit', icon: FileText },
    { id: 'pdf-image', labelJa: 'PDF ⇔ 画像', labelEn: 'PDF ⇔ Image', icon: ImageIcon },
    { id: 'office-suite', labelJa: 'Office ⇔ PDF', labelEn: 'Office Suite', icon: Briefcase },
    { id: 'html-studio', labelJa: 'HTML・Markdown', labelEn: 'HTML & Markdown', icon: FileCode },
    { id: 'sign-stamp', labelJa: '電子印鑑・署名', labelEn: 'Sign & Stamp', icon: PenTool },
    { id: 'ocr-qr', labelJa: 'OCR・QR', labelEn: 'OCR & QR', icon: ScanText },
    { id: 'diff-suite', labelJa: '差分比較', labelEn: 'Diff Studio', icon: GitCompare },
    { id: 'zip-suite', labelJa: 'ZIPアーカイブ', labelEn: 'ZIP & Rename', icon: Archive },
    { id: 'history', labelJa: '履歴', labelEn: 'History', icon: History },
  ];

  const checkScrollability = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 5);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 5);
    }
  };

  useEffect(() => {
    checkScrollability();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScrollability);
      window.addEventListener('resize', checkScrollability);
    }
    return () => {
      if (el) el.removeEventListener('scroll', checkScrollability);
      window.removeEventListener('resize', checkScrollability);
    };
  }, []);

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -220 : 220;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
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
      <div ref={scrollRef} className="tab-navigation">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-btn ${isActive ? 'active' : ''} inline-flex items-center gap-1.5`}
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
