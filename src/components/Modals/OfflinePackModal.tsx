import React, { useState, useEffect } from 'react';
import {
  Download,
  X,
  CheckCircle2,
  RefreshCw,
  Laptop,
  Apple,
  Terminal,
  Smartphone,
  Tablet,
  Globe,
  FileCode,
  ShieldCheck,
  FolderArchive,
  ChevronRight,
} from 'lucide-react';
import {
  TargetDeviceOS,
  DEVICE_OS_OPTIONS,
  detectCurrentOS,
  generateOfflinePackForOS,
  DeviceOSOption,
} from '../../utils/offlinePack';

interface OfflinePackModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onShowToast: (msg: string) => void;
}

export const OfflinePackModal: React.FC<OfflinePackModalProps> = ({
  isOpen,
  onClose,
  lang,
  onShowToast,
}) => {
  const [selectedOS, setSelectedOS] = useState<TargetDeviceOS>('windows');
  const [detectedOS, setDetectedOS] = useState<TargetDeviceOS>('universal');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<{ [filename: string]: boolean }>({});

  const currentOption = DEVICE_OS_OPTIONS.find((o) => o.id === selectedOS) || DEVICE_OS_OPTIONS[0];

  useEffect(() => {
    if (isOpen) {
      const cur = detectCurrentOS();
      setDetectedOS(cur);
      setSelectedOS(cur);
    }
  }, [isOpen]);

  // Reset selected files whenever selectedOS changes
  useEffect(() => {
    const initial: { [filename: string]: boolean } = {};
    currentOption.includedFiles.forEach((f) => {
      initial[f] = true;
    });
    setSelectedFiles(initial);
  }, [selectedOS]);

  if (!isOpen) return null;

  const toggleFile = (fileName: string) => {
    setSelectedFiles((prev) => ({
      ...prev,
      [fileName]: !prev[fileName],
    }));
  };

  const handleDownload = async () => {
    const filesToInclude = currentOption.includedFiles.filter((f) => selectedFiles[f] !== false);
    if (filesToInclude.length === 0) {
      onShowToast(lang === 'ja' ? 'ダウンロードするファイルを最低1つ選択してください' : 'Please select at least one file to download');
      return;
    }

    setIsGenerating(true);
    setProgressMsg(lang === 'ja' ? 'オフラインパックを作成中...' : 'Packaging standalone offline bundle...');
    try {
      const { blob, fileName } = await generateOfflinePackForOS(selectedOS, filesToInclude);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      onShowToast(
        lang === 'ja'
          ? `「${fileName}」をダウンロードしました。`
          : `Downloaded "${fileName}".`
      );
      onClose();
    } catch (err: any) {
      console.error(err);
      onShowToast(lang === 'ja' ? 'オフラインパックの生成に失敗しました' : 'Failed to generate offline pack');
    } finally {
      setIsGenerating(false);
      setProgressMsg('');
    }
  };

  const renderIcon = (type: DeviceOSOption['iconType']) => {
    switch (type) {
      case 'windows':
        return <Laptop className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
      case 'apple':
        return <Apple className="w-5 h-5 text-slate-800 dark:text-slate-100" />;
      case 'linux':
        return <Terminal className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
      case 'tablet':
        return <Tablet className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />;
      case 'smartphone':
        return <Smartphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
      default:
        return <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-5 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{lang === 'ja' ? 'スタンドアロン用パックの取得（OS・端末選択）' : 'Target OS & Device Offline Pack'}</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? 'お使いの端末やOSに合わせた最適な起動ランチャー・設定ガイド・全ライブラリ内蔵HTMLをパッケージ化します。'
                  : 'Generates a custom standalone offline package tailored to your target device, OS, and preferred launcher.'}
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

        {/* Current OS Detection Notice */}
        <div className="px-3.5 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              {lang === 'ja' ? '現在のアクセス環境: ' : 'Detected Current Device: '}
              <strong>
                {DEVICE_OS_OPTIONS.find((o) => o.id === detectedOS)?.[lang === 'ja' ? 'nameJa' : 'nameEn'] || detectedOS}
              </strong>
            </span>
          </div>
          <span className="text-[11px] opacity-80">
            {lang === 'ja' ? '別のOS用も自由に選択・ダウンロード可能' : 'Select any target OS below'}
          </span>
        </div>

        {/* OS / Device Selection Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {DEVICE_OS_OPTIONS.map((opt) => {
            const isSelected = selectedOS === opt.id;
            return (
              <div
                key={opt.id}
                onClick={() => setSelectedOS(opt.id)}
                className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex flex-col gap-1.5 ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:border-blue-400 bg-white dark:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {renderIcon(opt.iconType)}
                    <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                      {lang === 'ja' ? opt.nameJa : opt.nameEn}
                    </span>
                  </div>
                  {opt.id === detectedOS && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                      {lang === 'ja' ? 'この端末' : 'This Device'}
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 leading-snug">
                  {lang === 'ja' ? opt.descriptionJa : opt.descriptionEn}
                </p>

                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
                    {lang === 'ja' ? opt.badgeJa : opt.badgeEn}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Package Details with Checkboxes */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col gap-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <FolderArchive className="w-4 h-4 text-blue-600" />
              <span>{lang === 'ja' ? '同梱・生成されるファイル（チェックで選択）:' : 'Files to Include (Check to select):'}</span>
            </span>
            <span className="font-mono text-slate-500 text-[11px]">
              {selectedOS === 'universal' ? 'Direct HTML' : 'ZIP Archive'}
            </span>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            {currentOption.includedFiles.map((file) => {
              const isChecked = selectedFiles[file] !== false;
              return (
                <label
                  key={file}
                  className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer select-none transition ${
                    isChecked
                      ? 'bg-white dark:bg-slate-900 border-blue-400 dark:border-blue-700 shadow-2xs'
                      : 'bg-slate-100/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleFile(file)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <FileCode className="w-4 h-4 text-blue-600" />
                    <span className="font-mono font-bold text-xs text-slate-800 dark:text-slate-200">{file}</span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {file.endsWith('.html')
                      ? (lang === 'ja' ? '全機能内蔵HTML本体' : 'Core Standalone HTML')
                      : file.endsWith('.bat') || file.endsWith('.command') || file.endsWith('.sh')
                      ? (lang === 'ja' ? '自動起動スクリプト' : 'Launcher Script')
                      : (lang === 'ja' ? '利用手順・設定説明書' : 'Setup Guide')}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="text-[11px] text-slate-500 mt-1">
            {lang === 'ja'
              ? 'すべてのJavaScript、WebAssembly、CSS、フォント、アイコンがファイル内に埋め込まれているため、USBメモリや共有フォルダへコピーしてそのまま使用できます。'
              : 'All scripts, styles, and WebAssembly modules are embedded. Copy to a USB drive or local disk and run anywhere.'}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {lang === 'ja' ? 'キャンセル' : 'Cancel'}
          </button>

          <button
            onClick={handleDownload}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition cursor-pointer"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{progressMsg || (lang === 'ja' ? '生成中...' : 'Generating...')}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  {lang === 'ja'
                    ? `${currentOption.nameJa} 向けオフラインパックをダウンロード`
                    : `Download for ${currentOption.nameEn}`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
