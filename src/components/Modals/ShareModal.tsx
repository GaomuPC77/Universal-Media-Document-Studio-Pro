import React, { useState, useEffect } from 'react';
import {
  Share2,
  Copy,
  Check,
  X,
  QrCode,
  Smartphone,
  ExternalLink,
  ArchiveRestore,
} from 'lucide-react';
import QRCode from 'qrcode';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onOpenBackup: () => void;
  onShowToast: (msg: string) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  lang,
  onOpenBackup,
  onShowToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const appUrl = typeof window !== 'undefined' ? window.location.href : '';

  useEffect(() => {
    if (isOpen && appUrl) {
      QRCode.toDataURL(appUrl, {
        width: 200,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('Failed to generate QR:', err));
    }
  }, [isOpen, appUrl]);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onShowToast(lang === 'ja' ? 'URLをクリップボードにコピーしました' : 'App URL copied to clipboard');
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-5 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                {lang === 'ja' ? 'アプリを共有・他端末で開く' : 'Share App & Open on Other Devices'}
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'ja'
                  ? 'スマートフォンや別PCで即座にアクセスできます'
                  : 'Open seamlessly on mobile devices or other computers'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code Section */}
        <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-center gap-3">
          {qrDataUrl ? (
            <div className="p-2.5 bg-white rounded-xl shadow-xs border border-slate-200">
              <img src={qrDataUrl} alt="App QR Code" className="w-40 h-40 rounded" />
            </div>
          ) : (
            <div className="w-40 h-40 flex items-center justify-center bg-slate-200 dark:bg-slate-700 rounded-xl">
              <QrCode className="w-10 h-10 text-slate-400 animate-pulse" />
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
            <Smartphone className="w-4 h-4 text-blue-600" />
            <span>
              {lang === 'ja'
                ? 'スマートフォンのカメラで読み取ってアクセス'
                : 'Scan with smartphone camera to open'}
            </span>
          </div>
        </div>

        {/* Copy URL Box */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {lang === 'ja' ? 'アプリのURL:' : 'App Web Address:'}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={appUrl}
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono select-all"
            />
            <button
              onClick={handleCopyUrl}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? (lang === 'ja' ? 'コピー済' : 'Copied') : lang === 'ja' ? 'URLコピー' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Work State Transfer Link */}
        <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <ArchiveRestore className="w-5 h-5 text-blue-600 shrink-0" />
            <div>
              <p className="font-bold text-blue-900 dark:text-blue-200">
                {lang === 'ja' ? '作業中のファイルも一緒に引き継ぐ' : 'Transfer Current Work & Files'}
              </p>
              <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80">
                {lang === 'ja'
                  ? 'キューのファイルや履歴をバックアップとして別端末へ移行します'
                  : 'Export in-progress files and drafts to continue on another device'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              onClose();
              onOpenBackup();
            }}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-bold text-xs hover:bg-blue-50 whitespace-nowrap cursor-pointer shadow-xs"
          >
            {lang === 'ja' ? '引き継ぎ' : 'Transfer'}
          </button>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {lang === 'ja' ? '閉じる' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
