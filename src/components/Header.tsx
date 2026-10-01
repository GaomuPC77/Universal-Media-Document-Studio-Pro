import React, { useState, useEffect } from 'react';
import {
  FileText,
  Layers,
  Image as ImageIcon,
  Briefcase,
  PenTool,
  ScanText,
  GitCompare,
  Archive,
  Download,
  Share2,
  HelpCircle,
  HardDrive,
  History,
} from 'lucide-react';

interface HeaderProps {
  theme: 'auto' | 'light' | 'dark';
  setTheme: (theme: 'auto' | 'light' | 'dark') => void;
  lang: 'ja' | 'en';
  setLang: (lang: 'ja' | 'en') => void;
  onOpenDrivePicker?: () => void;
  onOpenHistory?: () => void;
  onDownloadOfflinePack: () => void;
  onOpenTutorial: () => void;
  onShareApp: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  theme,
  setTheme,
  lang,
  setLang,
  onDownloadOfflinePack,
  onOpenTutorial,
  onShareApp,
}) => {
  const [currentDateTime, setCurrentDateTime] = useState<string>('--/--/---- --:--:--');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      };
      setCurrentDateTime(now.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', options));
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [lang]);

  return (
    <header className="w-full flex flex-col gap-2">
      {/* 3-Column Header Bar Grid */}
      <div className="header-bar-grid">
        {/* Left Column 1: Tutorial */}
        <div className="header-col-left-1">
          <button className="btn-header" onClick={onOpenTutorial} id="btnTutorial">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <span>{lang === 'ja' ? '使い方' : 'Tutorial'}</span>
          </button>
        </div>

        {/* Left Column 2: Share */}
        <div className="header-col-left-2">
          <button className="btn-header" onClick={onShareApp} id="btnShareApp">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
            <span>{lang === 'ja' ? '共有' : 'Share'}</span>
          </button>
        </div>

        {/* Center: Live Date & Time */}
        <div className="header-col-center">
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-color)' }} id="headerDatetime">
            {currentDateTime}
          </div>
        </div>

        {/* Right Column 1: Offline Pack */}
        <div className="header-col-right-1">
          <button className="btn-header btn-install-app" onClick={onDownloadOfflinePack} id="btnDownloadAppPack">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>{lang === 'ja' ? 'オフライン用パックを取得' : 'Offline Pack'}</span>
          </button>
        </div>

        {/* Right Column 2: Lang & Theme */}
        <div className="header-col-right-2">
          <select
            id="langSelect"
            value={lang}
            onChange={(e) => setLang(e.target.value as 'ja' | 'en')}
            className="select-sm"
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>

          <select
            id="themeSelect"
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'auto' | 'light' | 'dark')}
            className="select-sm"
          >
            <option value="auto">Auto (OS)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      {/* Main Branding Header conforming to Reference HTML */}
      <div className="header">
        <h1>Universal Media &amp; Document Studio Pro</h1>
        <p>
          {lang === 'ja'
            ? 'サーバーにファイルを送信せず、ブラウザだけで安全・無制限に一括変換できる高度なメディア＆ドキュメント変換ツールです。'
            : 'Fast, secure client-side media & document converter with 100% private in-browser engine.'}
        </p>
        <div className="badge-group">
          <span className="badge offline-indicator">OFFLINE EDITION</span>
          <span className="badge">{lang === 'ja' ? '100% 端末内処理' : '100% Client-Side'}</span>
          <span className="badge">{lang === 'ja' ? 'Google Drive 純正連携' : 'Google Drive Ready'}</span>
          <span className="badge">{lang === 'ja' ? 'リアルタイム進捗' : 'Real-time Progress'}</span>
          <span className="badge">{lang === 'ja' ? '異種形式一括処理' : 'Batch Processor'}</span>
        </div>
      </div>
    </header>
  );
};
