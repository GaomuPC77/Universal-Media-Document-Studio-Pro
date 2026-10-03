import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { CommonUploadCard } from './components/CommonUploadCard';
import { TabNavigation } from './components/TabNavigation';
import { UniversalConverter } from './components/Tabs/UniversalConverter';
import { PdfSuite } from './components/Tabs/PdfSuite';
import { PdfImageSuite } from './components/Tabs/PdfImageSuite';
import { OfficeSuite } from './components/Tabs/OfficeSuite';
import { SignAndStamp } from './components/Tabs/SignAndStamp';
import { OcrSuite } from './components/Tabs/OcrSuite';
import { DiffSuite } from './components/Tabs/DiffSuite';
import { ZipSuite } from './components/Tabs/ZipSuite';
import { HistoryTab } from './components/Tabs/HistoryTab';
import { HtmlStudio } from './components/Tabs/HtmlStudio';
import { StatusQueueCard } from './components/StatusQueueCard';
import { FilePreviewModal } from './components/Modals/FilePreviewModal';
import { DrivePickerModal } from './components/Modals/DrivePickerModal';
import { HistoryModal } from './components/Modals/HistoryModal';
import { downloadOfflinePack } from './utils/offlinePack';
import { uploadFileToDrive, getStoredToken } from './utils/googleDrive';
import { savePendingFile, getPendingFiles, deletePendingFile, clearEntireAppCache } from './utils/historyDb';
import { FileItem, DocumentFormat } from './types';
import { UploadCloud, CheckCircle2, ChevronRight, ChevronLeft, X, Sparkles } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('converter');
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [lang, setLang] = useState<'ja' | 'en'>('ja');
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null);

  // Global File State
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [activeSharedFile, setActiveSharedFile] = useState<File | null>(null);
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const dragCounter = useRef<number>(0);

  // Modals state
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isFirstLaunchOpen, setIsFirstLaunchOpen] = useState(false);
  const [isAgreedTerms, setIsAgreedTerms] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [currentTutorialStep, setCurrentTutorialStep] = useState(0);
  const [isOfflineGuideOpen, setIsOfflineGuideOpen] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync theme & language on load
  useEffect(() => {
    const savedLang = (localStorage.getItem('user_lang') as 'ja' | 'en') || 'ja';
    const savedTheme = (localStorage.getItem('user_theme') as 'auto' | 'light' | 'dark') || 'auto';
    setLang(savedLang);
    setTheme(savedTheme);

    const agreed = localStorage.getItem('app_agreed');
    if (agreed !== 'true') {
      setIsFirstLaunchOpen(true);
    }

    // Restore pending files & session across reloads
    getPendingFiles().then((stored) => {
      if (stored && stored.length > 0) {
        const reconstructed: FileItem[] = stored.map((item) => {
          const fileObj = new File([item.data], item.name, { type: item.type || 'application/octet-stream' });
          const format = (item.format || getFormatFromExt(item.name)) as DocumentFormat;
          return {
            id: item.id,
            name: item.name,
            size: item.size,
            type: item.type,
            format,
            targetFormat: (item.targetFormat || (format === 'pdf' ? 'docx' : 'pdf')) as DocumentFormat,
            status: 'idle',
            progress: 0,
            file: fileObj,
            previewUrl: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'gif', 'ico'].includes(format)
              ? URL.createObjectURL(fileObj)
              : undefined,
          };
        });
        setFileList(reconstructed);
        if (reconstructed.length > 0) {
          setActiveSharedFile(reconstructed[0].file);
        }
      }
    });
  }, []);

  // Sync theme to root element & data-theme attribute
  useEffect(() => {
    localStorage.setItem('user_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [theme]);

  const tutorialSteps = [
    {
      targetId: 'commonUploadCard',
      titleJa: '1. 処理するファイルの読み込み・追加',
      titleEn: '1. Load & Add Files',
      descJa: 'ファイル、フォルダ、またはGoogle Driveから処理したいファイルを追加します。ドラッグ＆ドロップにも対応しています。',
      descEn: 'Add files, folders, or import from Google Drive here. Drag & drop is fully supported.',
    },
    {
      targetId: 'tabNavContainer',
      titleJa: '2. 処理ツールの選択（機能タブ）',
      titleEn: '2. Select Processing Tool',
      descJa: '「変換」「PDF編集」「Office変換」「HTML・Markdown」「電子印鑑」「OCR」「差分比較」「ZIP」「履歴」など、目的の処理タブを選択して切り替えます。左右の矢印ボタンやマウスホイール・ドラッグで横スクロールできます。',
      descEn: 'Switch between suites like Universal Converter, PDF Toolkit, Office Suite, HTML/Markdown Studio, Sign & Stamp, OCR, Diff Studio, ZIP, and History.',
    },
    {
      targetId: 'mainTabContentArea',
      titleJa: '3. 変換・編集の各種設定と実行',
      titleEn: '3. Configure & Execute',
      descJa: '選択した処理タブで、変換先のフォーマットやオプション、編集内容を設定して処理を実行します。タブを切り替えても作業内容は保持されます。',
      descEn: 'Configure output formats, options, and editing parameters. Your progress is preserved even when switching between tabs.',
    },
    {
      targetId: 'statusQueueSection',
      titleJa: '4. 変換・処理ステータス（進捗・保存・ZIP）',
      titleEn: '4. Status Queue & Downloads',
      descJa: '処理のリアルタイム進捗や完了ファイルの一覧がここに集約されます。個別保存、Google Drive保存、一括ZIPダウンロードが行えます。',
      descEn: 'View real-time progress and completed files. Download individually, save to Google Drive, or batch download as a ZIP archive.',
    },
    {
      targetId: 'mainAppContainer',
      titleJa: '5. オフラインパック ＆ 各種機能',
      titleEn: '5. Offline Pack & Utilities',
      descJa: '「オフライン用パックを取得」をクリックすると、ネット接続が不要な完全スタンドアロン版HTMLと起動用バッチファイルをダウンロードできます。言語やテーマの切り替えもここから行えます。',
      descEn: 'Click "Offline Pack" to download a 100% standalone offline edition. Switch languages and themes anytime.',
    },
  ];

  // Auto-scroll and highlight target element on tutorial step change
  useEffect(() => {
    if (isTutorialOpen) {
      const step = tutorialSteps[currentTutorialStep];
      if (step) {
        const timer = setTimeout(() => {
          const el = document.getElementById(step.targetId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.querySelectorAll('.tutorial-highlight-ring').forEach((node) => node.classList.remove('tutorial-highlight-ring'));
            el.classList.add('tutorial-highlight-ring');
          }
        }, 120);
        return () => clearTimeout(timer);
      }
    } else {
      document.querySelectorAll('.tutorial-highlight-ring').forEach((node) => node.classList.remove('tutorial-highlight-ring'));
    }
  }, [isTutorialOpen, currentTutorialStep]);

  const handleNextTutorial = () => {
    if (currentTutorialStep < tutorialSteps.length - 1) {
      setCurrentTutorialStep((prev) => prev + 1);
    } else {
      handleCloseTutorial();
    }
  };

  const handlePrevTutorial = () => {
    if (currentTutorialStep > 0) {
      setCurrentTutorialStep((prev) => prev - 1);
    }
  };

  const handleCloseTutorial = () => {
    setIsTutorialOpen(false);
    setCurrentTutorialStep(0);
    document.querySelectorAll('.tutorial-highlight-ring').forEach((node) => node.classList.remove('tutorial-highlight-ring'));
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  };

  const handleSetLang = (newLang: 'ja' | 'en') => {
    setLang(newLang);
    localStorage.setItem('user_lang', newLang);
  };

  const handleDownloadOfflinePack = async () => {
    showToast(lang === 'ja' ? 'オフラインHTMLを作成中...' : 'Generating offline single file HTML...');
    try {
      await downloadOfflinePack();
      showToast(lang === 'ja' ? 'オフライン用パックを取得しました' : 'Offline Pack Downloaded!');
      setIsOfflineGuideOpen(true);
    } catch (e) {
      showToast(lang === 'ja' ? 'オフラインパックの取得に失敗しました' : 'Failed to generate offline pack');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Universal Media & Document Studio Pro',
          text:
            lang === 'ja'
              ? 'サーバーにファイルを送信せず、ブラウザだけで安全・無制限に一括変換できる高度なメディア＆ドキュメント変換ツールです。'
              : '100% Client-Side Universal Media & Document Studio Pro',
          url: window.location.href,
        });
      } catch (e) {}
    } else {
      await navigator.clipboard.writeText(window.location.href);
      showToast(lang === 'ja' ? 'URLをクリップボードにコピーしました' : 'URL copied to clipboard!');
    }
  };

  const handleAgreeFirstLaunch = () => {
    if (!isAgreedTerms) return;
    localStorage.setItem('app_agreed', 'true');
    setIsFirstLaunchOpen(false);
    setIsTutorialOpen(true);
  };

  // Helper to detect format from file extension
  const getFormatFromExt = (fileName: string): DocumentFormat => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'ico', 'gif', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) {
      return ext as DocumentFormat;
    }
    if (['pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'md', 'html', 'json', 'xml', 'rtf', 'zip'].includes(ext)) {
      return ext as DocumentFormat;
    }
    return 'txt';
  };

  const handleFilesAdded = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setActiveSharedFile(fileArray[0]);

    const newItems: FileItem[] = [];
    for (const file of fileArray) {
      const format = getFormatFromExt(file.name);
      const targetFormat = format === 'pdf' ? 'docx' : 'pdf';
      const id = `file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      newItems.push({
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        format,
        targetFormat,
        status: 'idle',
        progress: 0,
        file,
        previewUrl: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'gif', 'ico'].includes(format)
          ? URL.createObjectURL(file)
          : undefined,
      });

      // Persist pending file to IndexedDB for session recovery
      try {
        const buf = await file.arrayBuffer();
        await savePendingFile({
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          format,
          targetFormat,
          data: buf,
          date: Date.now(),
        });
      } catch (err) {
        console.warn('Failed to persist pending file:', err);
      }
    }

    setFileList((prev) => {
      const filtered = newItems.filter((item) => !prev.some((p) => p.name === item.name && p.size === item.size));
      return [...filtered, ...prev];
    });

    showToast(
      lang === 'ja'
        ? `📄 ${fileArray.length} 件のファイルを読み込みました。下の処理を選択して変換できます。`
        : `📄 Loaded ${fileArray.length} file(s). Select a tab below to process.`
    );
  };

  const handleResultReady = (item: FileItem) => {
    setFileList((prev) => {
      const existingIdx = prev.findIndex((p) => p.name === item.name || p.id === item.id);
      if (existingIdx !== -1) {
        const next = [...prev];
        next[existingIdx] = item;
        return next;
      }
      return [item, ...prev];
    });
  };

  // Rock-solid Global Window Drag & Drop Listeners (Prevents overlay stuck bug)
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        dragCounter.current += 1;
        setIsWindowDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsWindowDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsWindowDragging(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleFilesAdded(e.dataTransfer.files);
      }
    };

    const handleCancelDrag = () => {
      dragCounter.current = 0;
      setIsWindowDragging(false);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragend', handleCancelDrag);
    window.addEventListener('mouseleave', handleCancelDrag);
    window.addEventListener('blur', handleCancelDrag);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragend', handleCancelDrag);
      window.removeEventListener('mouseleave', handleCancelDrag);
      window.removeEventListener('blur', handleCancelDrag);
    };
  }, [lang]);

  // Direct Save to Google Drive
  const handleSaveItemToDrive = async (item: FileItem) => {
    if (!item.resultBlob) return;
    const token = getStoredToken();
    if (!token) {
      showToast(lang === 'ja' ? 'Google Driveと連携してください' : 'Please connect Google Drive first');
      setIsDriveModalOpen(true);
      return;
    }

    showToast(lang === 'ja' ? `Google Driveに保存中: ${item.resultName || item.name}...` : `Saving to Google Drive...`);
    try {
      const res = await uploadFileToDrive(
        item.resultName || item.name,
        item.resultBlob.type || 'application/octet-stream',
        item.resultBlob
      );
      showToast(
        lang === 'ja'
          ? `✓ 「${res.name}」をGoogle Driveに保存しました`
          : `✓ Saved "${res.name}" to Google Drive`
      );
    } catch (e: any) {
      console.error('Save to Drive error:', e);
      showToast(lang === 'ja' ? 'Google Driveへの保存に失敗しました' : 'Failed to save to Google Drive');
    }
  };

  return (
    <div className="w-full min-h-screen">
      {/* Toast Notification */}
      <div id="toastNotification" className={`toast-notification ${toastMessage ? 'show' : ''}`}>
        {toastMessage || '完了しました'}
      </div>

      {/* Global Drag Overlay (Click anywhere dismisses it immediately) */}
      {isWindowDragging && (
        <div
          onClick={() => {
            dragCounter.current = 0;
            setIsWindowDragging(false);
          }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex flex-col items-center justify-center animate-fade-in cursor-pointer p-4"
        >
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border-2 border-dashed border-blue-500 flex flex-col items-center gap-3 text-center max-w-sm pointer-events-none">
            <UploadCloud className="w-14 h-14 text-blue-600 animate-bounce" />
            <h3 className="font-bold text-base sm:text-lg text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? 'ここにファイルをドロップ' : 'Drop Files to Load'}
            </h3>
            <p className="text-xs text-slate-500">
              {lang === 'ja'
                ? 'ドロップしたファイルはすべての処理ツールに自動反映されます'
                : 'Dropped files are instantly ready for all processing suites'}
            </p>
          </div>
        </div>
      )}

      <div className="container" id="mainAppContainer">
        {/* Header Branding & Quick Actions */}
        <Header
          theme={theme}
          setTheme={setTheme}
          lang={lang}
          setLang={handleSetLang}
          onDownloadOfflinePack={handleDownloadOfflinePack}
          onOpenTutorial={() => setIsTutorialOpen(true)}
          onShareApp={handleShare}
        />

        {/* 1. Common File Upload Card (At the top of the workflow) */}
        <div id="commonUploadCard">
          <CommonUploadCard
            lang={lang}
            onFilesSelected={handleFilesAdded}
            onOpenDrivePicker={() => setIsDriveModalOpen(true)}
            onShowToast={showToast}
          />
        </div>

        {/* Tab Navigation (Directly underneath with Left & Right scroll buttons) */}
        <TabNavigation
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          lang={lang}
        />

        {/* Tab Contents - Kept mounted persistently so state and inputs are never lost */}
        <main className="w-full" id="mainTabContentArea">
          <div style={{ display: activeTab === 'converter' ? 'block' : 'none' }}>
            <UniversalConverter
              lang={lang}
              fileList={fileList}
              setFileList={setFileList}
              onAddFiles={handleFilesAdded}
              onPreview={(item) => setPreviewItem(item)}
              onSaveToDrive={handleSaveItemToDrive}
              onOpenDrivePicker={() => setIsDriveModalOpen(true)}
              onOpenHistory={() => setIsHistoryModalOpen(true)}
            />
          </div>

          <div style={{ display: activeTab === 'pdf-suite' ? 'block' : 'none' }}>
            <PdfSuite
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'pdf-image' ? 'block' : 'none' }}>
            <PdfImageSuite
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'office-suite' ? 'block' : 'none' }}>
            <OfficeSuite
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'html-studio' ? 'block' : 'none' }}>
            <HtmlStudio
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onSaveToDrive={(name, blob) =>
                handleSaveItemToDrive({
                  id: String(Date.now()),
                  name,
                  file: new File([blob], name, { type: blob.type || 'text/html' }),
                  size: blob.size,
                  type: blob.type,
                  format: 'html' as any,
                  targetFormat: 'html' as any,
                  status: 'done',
                  progress: 100,
                  resultBlob: blob,
                  resultName: name,
                })
              }
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'sign-stamp' ? 'block' : 'none' }}>
            <SignAndStamp
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'ocr-qr' ? 'block' : 'none' }}>
            <OcrSuite
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'diff-suite' ? 'block' : 'none' }}>
            <DiffSuite
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'zip-suite' ? 'block' : 'none' }}>
            <ZipSuite
              lang={lang}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
            />
          </div>

          <div style={{ display: activeTab === 'history' ? 'block' : 'none' }}>
            <HistoryTab
              lang={lang}
              onPreview={(name, blob, format) => {
                setPreviewItem({
                  id: `prev_${Date.now()}`,
                  name,
                  size: blob.size,
                  type: blob.type,
                  format: format as any,
                  targetFormat: format as any,
                  status: 'done',
                  progress: 100,
                  resultBlob: blob,
                  resultName: name,
                });
              }}
              onLoadToActiveStudio={(file) => {
                handleFilesAdded([file]);
                setActiveTab('converter');
              }}
              onShowToast={showToast}
            />
          </div>
        </main>

        {/* 2. Global Conversion & Processing Status Queue (Located directly below processing area and above Features) */}
        <StatusQueueCard
          lang={lang}
          fileList={fileList}
          setFileList={setFileList}
          onPreview={(item) => setPreviewItem(item)}
          onSaveToDrive={handleSaveItemToDrive}
          onOpenDrivePicker={() => setIsDriveModalOpen(true)}
          onShowToast={showToast}
          onClearCache={() => {
            setFileList([]);
            setActiveSharedFile(null);
          }}
        />

        {/* Bottom Features, Environment, How-To, and FAQ Section conforming to Reference HTML */}
        <div className="card" id="featuresSection">
          <div className="info-card-title">{lang === 'ja' ? '本ツールの特徴' : 'Tool Features'}</div>
          <div className="info-box-grid">
            <div className="info-sub-box">
              <h4>{lang === 'ja' ? '完全ローカル ＆ 完全無制限' : 'Fully Local & Truly Unlimited'}</h4>
              <p>
                {lang === 'ja'
                  ? 'サーバーへファイルをアップロードしない安全設計。容量制限や個数制限なく利用できます。'
                  : 'Secure architecture with zero server uploads. Convert freely without file size or count limitations.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4>{lang === 'ja' ? '異種形式の一括ミックス処理' : 'Mixed Format Batch Processing'}</h4>
              <p>
                {lang === 'ja'
                  ? 'PDF, DOCX, XLSX, MP4, MOV, PNG など異なる拡張子が混在したフォルダも指定形式へ一括で統一変換します。'
                  : 'Batch-convert folders containing mixed extensions into a single unified format.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4>{lang === 'ja' ? 'オフライン ＆ PWAアプリ対応' : 'Offline & PWA Ready'}</h4>
              <p>
                {lang === 'ja'
                  ? 'ブラウザ経由で端末へインストール可能。ネットワーク接続がない環境でも動作します。'
                  : 'Installable via browser as a standalone app. Functions completely offline without internet.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4>{lang === 'ja' ? '途中停止からの自動復元' : 'Automatic Recovery from Interruptions'}</h4>
              <p>
                {lang === 'ja'
                  ? 'ブラウザの終了やメモリクラッシュ時も、処理済みデータを保存し続きから自動スタートします。'
                  : 'Saves processed files so you can recover and resume seamlessly after crashes or reloads.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4>{lang === 'ja' ? 'WebMからMP4への超高速・高互換変換' : 'Ultra-Fast WebM to MP4 Conversion'}</h4>
              <p>
                {lang === 'ja'
                  ? 'H.264の -preset ultrafast、-tune zerolatency、-pix_fmt yuv420p を最適適用し、ブラウザ内WASMでのCPU負荷を最小化。フリーズやメモリ不足を根本解消し高速変換を実現します。'
                  : 'Engineered with libx264 ultrafast preset, zerolatency tuning, and yuv420p standard pixel format for instant high-compatibility MP4s.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4>{lang === 'ja' ? 'リアルタイム進捗率表示・HTMLプレビュー・メタタグ編集' : 'Real-time Progress, HTML Preview & Metadata'}</h4>
              <p>
                {lang === 'ja'
                  ? '進行度イベントを常時キャッチし0%〜100%の進捗バーを可視化。HTMLのサンドボックスプレビュー・ソース閲覧やメタタグ編集もすべて端末内で完結します。'
                  : 'Live progress tracking (0%-100%), interactive HTML sandboxed preview, and direct metadata editing.'}
              </p>
            </div>
          </div>

          <div className="info-card-title" style={{ marginTop: '18px' }}>
            {lang === 'ja' ? '対応フォーマットおよび動作環境' : 'Supported Formats & System Requirements'}
          </div>
          <div className="info-text-block">
            <span>
              <strong>{lang === 'ja' ? '入力形式: ' : 'Input: '}</strong>
              PDF, DOCX, XLSX, XLS, CSV, TSV, TXT, MD, HTML, JSON, XML, PNG, JPG, WEBP, SVG, MP4, WEBM, MOV, MP3, WAV, M4A, AAC, OGG ほか多数
            </span>
            <br />
            <span>
              <strong>{lang === 'ja' ? '出力形式: ' : 'Output: '}</strong>
              PDF, DOCX, XLSX, CSV, TSV, TXT, MD, HTML, JSON, PNG, JPG, WEBP, MP4, WEBM, MP3, WAV, ZIP
            </span>
            <br />
            <span>
              <strong>{lang === 'ja' ? '推奨環境: ' : 'Recommended Browsers: '}</strong>
              Google Chrome, Microsoft Edge, Apple Safari, Mozilla Firefox（最新版）
            </span>
          </div>

          <div className="info-card-title" style={{ marginTop: '18px' }}>
            {lang === 'ja' ? '使い方' : 'How to Use'}
          </div>
          <ol className="info-list">
            <li>
              <span>
                {lang === 'ja'
                  ? '最上部の「1. 処理するファイルの読み込み・追加」からファイルやフォルダ、またはGoogle Driveから追加します。'
                  : 'Add files/folders or import from Google Drive in Section 1 above.'}
              </span>
            </li>
            <li>
              <span>
                {lang === 'ja'
                  ? 'タブバーから行いたい処理（一括変換、PDF編集、Office変換、電子印鑑、OCRなど）を選択します。'
                  : 'Select your desired operation from the tab bar below Section 1.'}
              </span>
            </li>
            <li>
              <span>
                {lang === 'ja'
                  ? '処理完了後、個別に「保存」「Google Drive保存」または「一括ZIPダウンロード」を実行します。'
                  : 'After processing, download files individually, save directly to Google Drive, or batch download as a ZIP package.'}
              </span>
            </li>
          </ol>

          <div className="info-card-title" style={{ marginTop: '24px' }}>
            {lang === 'ja' ? 'Q&A（よくある質問）' : 'Q&A (Frequently Asked Questions)'}
          </div>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q1: 本当にファイルが外部に送信されませんか？' : 'Q1: Are files truly never sent to a server?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい、100%ユーザーのブラウザ内（クライアントサイド）だけで処理が行われます。インターネットを介して外部サーバーにファイルがアップロードされることは一切ありませんので、プライベートなファイルも安心して変換できます。'
                : 'Yes. Processing runs 100% inside your browser via client-side WebAssembly. No files ever leave your device.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q2: 変換できるファイルの容量や個数に制限はありますか？' : 'Q2: Are there limits on file sizes or counts?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'サーバー側の制限はありませんが、お使いの端末のメモリ（RAM）容量に依存します。非常に大容量のファイルや多数のファイルを一度に処理する場合、ブラウザのメモリ不足によりエラーが発生する可能性があります。'
                : 'There are no server limits; processing is limited only by your device\'s available RAM memory.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q3: オフライン環境でも使えますか？' : 'Q3: Can I use this app completely offline?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい。「オフライン用パックを取得」ボタンからダウンロードしていただくことで、インターネット接続がない環境でもローカルで快適にご利用いただけます。'
                : 'Yes. Click "Offline Pack" to download the local package for complete offline capability.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q4: HTMLファイルのプレビューや変換は可能ですか？' : 'Q4: Can I preview and convert HTML files?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい。読み込んだHTMLファイルは、安全なサンドボックス内でのWebページ表示プレビューおよびソースコード表示の両方に対応しています。PDFへの変換やテキスト抽出も可能です。'
                : 'Yes. HTML files can be previewed as live rendered pages in a sandboxed iframe or as raw source code, and converted to PDF or text.'}
            </div>
          </details>
        </div>

        {/* Footer with updated proper links */}
        <div className="footer">
          <div className="footer-links">
            <a onClick={() => setIsTermsOpen(true)} id="linkTermsTrigger">
              {lang === 'ja' ? '利用規約' : 'Terms of Service'}
            </a>
            <a onClick={() => setIsPrivacyOpen(true)} id="linkPrivacyTrigger">
              {lang === 'ja' ? 'プライバシーポリシー' : 'Privacy Policy'}
            </a>
          </div>
          <div className="footer-credits">
            ©Gaomu_PC77 2026 | Powered by{' '}
            <a href="https://webassembly.org/" target="_blank" rel="noopener noreferrer">
              WebAssembly
            </a>
            ,{' '}
            <a href="https://ffmpeg.org/" target="_blank" rel="noopener noreferrer">
              FFmpeg.wasm
            </a>
            ,{' '}
            <a href="https://stuk.github.io/jszip/" target="_blank" rel="noopener noreferrer">
              JSZip
            </a>
            ,{' '}
            <a href="https://pdf-lib.js.org/" target="_blank" rel="noopener noreferrer">
              PDF-Lib
            </a>{' '}
            &amp;{' '}
            <a href="https://tesseract.projectnaptha.com/" target="_blank" rel="noopener noreferrer">
              Tesseract.js
            </a>
          </div>
        </div>
      </div>

      {/* First Launch Agreement Modal */}
      {isFirstLaunchOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-box">
            <div className="modal-header">
              <div className="modal-title">
                {lang === 'ja' ? '利用規約とプライバシーポリシーの確認' : 'Terms & Privacy Policy'}
              </div>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '10px', fontSize: '0.85rem' }}>
                {lang === 'ja'
                  ? '本ツールをご利用いただく前に、以下の利用規約およびプライバシーポリシーをご確認ください。'
                  : 'Please review and accept our Terms of Service and Privacy Policy before using this tool.'}
              </p>
              <div className="terms-split-container">
                <div className="terms-split-box">
                  <h5>{lang === 'ja' ? '利用規約' : 'Terms of Service'}</h5>
                  <div style={{ fontSize: '0.78rem', lineHeight: '1.5' }}>
                    <p><strong>{lang === 'ja' ? '第1条（適用）' : 'Art 1: Scope'}</strong><br />{lang === 'ja' ? '本ツールが提供するすべてのファイル変換・編集機能の利用条件を定めます。' : 'Applies to all conversion and editing services provided by this tool.'}</p>
                    <p style={{ marginTop: '6px' }}><strong>{lang === 'ja' ? '第2条（著作権の遵守）' : 'Art 2: Copyright'}</strong><br />{lang === 'ja' ? '自らが適法な権利・許諾を有するファイルのみを処理対象としてください。' : 'Only process files you own or are legally authorized to convert.'}</p>
                    <p style={{ marginTop: '6px' }}><strong>{lang === 'ja' ? '第3条（免責事項）' : 'Art 3: Disclaimer'}</strong><br />{lang === 'ja' ? '完全ローカル処理で動作し、データ破損等の責任は負いません（事前バックアップ推奨）。' : 'Runs 100% client-side; developers assume no liability for data loss.'}</p>
                  </div>
                </div>
                <div className="terms-split-box">
                  <h5>{lang === 'ja' ? 'プライバシーポリシー' : 'Privacy Policy'}</h5>
                  <div style={{ fontSize: '0.78rem', lineHeight: '1.5' }}>
                    <p><strong>{lang === 'ja' ? '1. 完全端末内処理（サーバー非送信）' : '1. 100% Local Browser Execution'}</strong><br />{lang === 'ja' ? 'WASMによりブラウザ内でのみ処理され、ファイルが外部サーバーに送信されることは一切ありません。' : 'Files are processed strictly in your browser via WASM with zero server uploads.'}</p>
                    <p style={{ marginTop: '6px' }}><strong>{lang === 'ja' ? '2. Google Drive直接通信' : '2. Google Drive Direct HTTPS'}</strong><br />{lang === 'ja' ? '公式OAuth 2.0を用いてユーザーの端末とGoogle間で直接通信します。' : 'Direct encrypted communication between browser and Google Drive.'}</p>
                  </div>
                </div>
              </div>

              <div className="alert-box-warning" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#d97706' }}>
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                  <path d="M12 9v4"></path>
                  <path d="M12 17h.01"></path>
                </svg>
                <span>
                  {lang === 'ja'
                    ? '注意: 変換処理はすべてお使いの端末ブラウザ内（WASM）で実行されます。著作権法等の関連法令を遵守してご利用ください。'
                    : 'Note: All processing runs 100% inside your browser via WASM. Please comply with copyright laws.'}
                </span>
              </div>

              <label className="checkbox-row" htmlFor="chkAgreeTerms" style={{ justifyContent: 'center', marginTop: '12px' }}>
                <input
                  type="checkbox"
                  id="chkAgreeTerms"
                  checked={isAgreedTerms}
                  onChange={(e) => setIsAgreedTerms(e.target.checked)}
                  className="checkbox-field"
                />
                <span className="checkbox-label" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {lang === 'ja' ? '利用規約とプライバシーポリシーに同意します' : 'I agree to the Terms of Service and Privacy Policy'}
                </span>
              </label>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button
                id="btnAgreeStart"
                disabled={!isAgreedTerms}
                onClick={handleAgreeFirstLaunch}
                className="btn-sm btn-success"
                style={{ padding: '9px 28px', fontSize: '0.9rem', fontWeight: 600 }}
              >
                {lang === 'ja' ? '同意して利用開始' : 'Agree & Get Started'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Step-by-Step Tutorial Tour (Auto-scrolls & focuses on target elements, skippable at any time) */}
      {isTutorialOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[94vw] bg-white dark:bg-slate-900 border-2 border-blue-500 shadow-2xl rounded-2xl p-5 animate-fade-in flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                {lang === 'ja' ? `手順 ${currentTutorialStep + 1} / ${tutorialSteps.length}` : `Step ${currentTutorialStep + 1} / ${tutorialSteps.length}`}
              </span>
              <h4 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? tutorialSteps[currentTutorialStep].titleJa : tutorialSteps[currentTutorialStep].titleEn}
              </h4>
            </div>
            <button
              onClick={handleCloseTutorial}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-semibold px-2 py-1 rounded-md"
            >
              {lang === 'ja' ? 'スキップ ✕' : 'Skip ✕'}
            </button>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {lang === 'ja' ? tutorialSteps[currentTutorialStep].descJa : tutorialSteps[currentTutorialStep].descEn}
          </p>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            {/* Clickable Step Indicator Dots */}
            <div className="flex items-center gap-1.5">
              {tutorialSteps.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentTutorialStep(idx)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    currentTutorialStep === idx
                      ? 'bg-blue-600 w-5'
                      : 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400'
                  }`}
                  title={`${lang === 'ja' ? '手順' : 'Step'} ${idx + 1}`}
                  aria-label={`Jump to Step ${idx + 1}`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCloseTutorial}
                className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-semibold"
              >
                {lang === 'ja' ? 'スキップ' : 'Skip'}
              </button>
              {currentTutorialStep > 0 && (
                <button
                  onClick={handlePrevTutorial}
                  className="btn-sm flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '前へ' : 'Back'}</span>
                </button>
              )}
              <button
                onClick={handleNextTutorial}
                className="btn-sm btn-success flex items-center gap-1"
              >
                <span>{currentTutorialStep === tutorialSteps.length - 1 ? (lang === 'ja' ? '完了して利用開始' : 'Finish & Start') : (lang === 'ja' ? '次へ' : 'Next')}</span>
                {currentTutorialStep < tutorialSteps.length - 1 && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Ready Guidance Modal (Matching Reference HTML) */}
      {isOfflineGuideOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-box">
            <div className="modal-header">
              <div className="modal-title font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                <span>{lang === 'ja' ? 'オフライン用ファイルの準備完了' : 'Offline Files Ready'}</span>
              </div>
              <button className="modal-close" onClick={() => setIsOfflineGuideOpen(false)} aria-label="閉じる">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '10px', fontSize: '0.88rem', lineHeight: '1.6' }}>
                {lang === 'ja'
                  ? 'ダウンロードしたHTMLファイルと起動用バッチファイルを同じフォルダ（デスクトップなど）に置き、アプリを起動する.bat をダブルクリックして起動してください。'
                  : 'Place both downloaded files in the same folder and double-click "アプリを起動する.bat" to launch.'}
              </p>
              <div className="alert-box-warning" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong>{lang === 'ja' ? 'Windows Smart App Control 等の警告が出た場合:' : 'If Windows Warning Appears:'}</strong>
                <span>
                  {lang === 'ja'
                    ? 'バッチファイル実行時に警告が表示された場合は、「詳細情報」をクリックし「実行」を選択してご対応ください。'
                    : 'If a warning appears upon running the batch launcher, click "More info" and select "Run anyway".'}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-sm btn-success" onClick={() => setIsOfflineGuideOpen(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Terms of Service Modal */}
      {isTermsOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) setIsTermsOpen(false); }}>
          <div className="modal-box" style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div className="modal-title">{lang === 'ja' ? '利用規約' : 'Terms of Service'}</div>
              <button className="modal-close" onClick={() => setIsTermsOpen(false)} aria-label="閉じる">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ lineHeight: '1.6', fontSize: '0.82rem' }} className="flex flex-col gap-3">
                <div>
                  <p><strong>{lang === 'ja' ? '第1条（適用）' : 'Article 1 (Scope & Application)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本規約は、Universal Media & Document Studio Pro（以下「本ツール」）の利用に関する条件を定めるものです。利用者は本ツールの利用により本規約に同意したものとみなされます。'
                      : 'These Terms of Service set forth the terms and conditions for using Universal Media & Document Studio Pro (hereinafter referred to as "the Tool").'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第2条（著作権・権利の遵守）' : 'Article 2 (Compliance with Copyright & Intellectual Property)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '利用者は、著作権法およびその他の知的財産権関連法令を遵守し、自らが権利を有するファイル、または正当な許諾を得たファイルのみを本ツールの変換・編集対象とするものとします。'
                      : 'Users must strictly comply with copyright laws and other intellectual property regulations, and shall only process files for which they own the copyright or have obtained legitimate authorization.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第3条（禁止事項）' : 'Article 3 (Prohibited Actions)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '違法動画・音声・ドキュメントの作成、第三者の権利侵害、法令または公序良俗に反する行為、本ツールの不正解析・改変・再配布を禁止します。'
                      : 'Creating unlawful video, audio, or document files, infringing upon third-party rights, committing acts that violate laws or public order and morals, or unauthorized reverse-engineering and modification of the Tool are strictly prohibited.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第4条（免責事項）' : 'Article 4 (Disclaimer of Liability)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールの利用により生じたデータの破損、消失、端末の不具合、その他の損害について、開発者および運営者は一切の法的責任を負いません。重要なファイルは必ずバックアップを作成の上ご利用ください。'
                      : 'The developer and operators assume no legal liability for any data corruption, data loss, device malfunction, or any other damages resulting from the use of the Tool. Users are strongly advised to back up critical files before use.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第5条（AI生成コード・コンテンツに関する免責）' : 'Article 5 (Disclaimer Regarding AI-Assisted Code & Content)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールはAI技術の支援を受けて開発されたコードを含んでおり、提供する変換・編集機能や出力結果の完全性、正確性、特定目的への適合性を明示的にも黙示的にも保証するものではありません。'
                      : 'This Tool contains code developed with the assistance of AI technologies. Neither the developer nor operators make any express or implied warranty regarding the completeness, accuracy, or fitness for a particular purpose of the features or outputs.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第6条（サービスの変更・終了）' : 'Article 6 (Modification & Discontinuation of Service)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールは事前通知なく機能の変更、提供の中断または終了を行うことがあります。'
                      : 'Features of the Tool may be modified, suspended, or discontinued at any time without prior notice.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第7条（準拠法・管轄）' : 'Article 7 (Governing Law & Jurisdiction)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本規約の解釈にあたっては、日本法を準拠法とします。'
                      : 'The interpretation and application of these Terms of Service shall be governed by the laws of Japan.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-sm btn-success" onClick={() => setIsTermsOpen(false)}>
                {lang === 'ja' ? '閉じる' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Policy Modal */}
      {isPrivacyOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) setIsPrivacyOpen(false); }}>
          <div className="modal-box" style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div className="modal-title">{lang === 'ja' ? 'プライバシーポリシー' : 'Privacy Policy'}</div>
              <button className="modal-close" onClick={() => setIsPrivacyOpen(false)} aria-label="閉じる">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ lineHeight: '1.6', fontSize: '0.82rem' }} className="flex flex-col gap-3">
                <div>
                  <p><strong>{lang === 'ja' ? '1. 完全ローカル（端末内）処理の原則' : '1. Principle of 100% Local (On-Device) Processing'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールはWebAssembly技術を用い、すべての動画・音声変換、波形解析、メタタグ編集、PDF編集、Office文書変換、画像処理、OCR、HTML編集・プレビュー、差分比較、ZIP処理をユーザーのブラウザ（端末内）で完結して実行します。処理対象のファイルデータが外部サーバーへアップロードまたは送信されることは一切ありません。'
                      : 'This Tool leverages WebAssembly technology to execute all video/audio conversion, waveform analysis, metadata editing, PDF manipulation, Office documents, OCR, HTML editing, diff comparison, and ZIP archiving entirely within the user’s browser on the local device. Target file data is never uploaded or transmitted to any external server under any circumstances.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '2. ローカルストレージおよびIndexedDBの利用' : '2. Use of LocalStorage and IndexedDB'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールはお客様の利便性向上のため、言語・テーマ等の設定値および変換・処理結果のキャッシュを端末内のローカルストレージ（LocalStorage / IndexedDB）にのみ保存します。これらはブラウザの設定またはツール内の消去機能によりいつでも削除できます。'
                      : 'To enhance user convenience, user preferences (such as language and theme) and conversion output caches are saved strictly within local storage on your device (LocalStorage / IndexedDB). These can be deleted at any time via browser settings or the cache clearing button in the Tool.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '3. 外部ライブラリの読み込み & Google Drive直接通信' : '3. External Library Loading & Google Drive Direct Communication'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? 'アプリの実行に必要なコアライブラリ（FFmpeg WASM、PDF-Lib、JSZip等）およびCDNリソースのロード時、ならびに公式Google Identity Servicesを介したGoogle Driveダイレクト通信を除き、利用者の個人情報や行動履歴をトラッキングまたは外部送信することはありません。'
                      : 'Except for loading the necessary WASM core libraries and CDN resources required to run the application, as well as direct encrypted communication with Google Drive via official Google Identity Services, the Tool does not collect, track, or externally transmit any personal information or behavioral history of users.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-sm btn-success" onClick={() => setIsPrivacyOpen(false)}>
                {lang === 'ja' ? '閉じる' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal (supports HTML preview sandbox) */}
      <FilePreviewModal item={previewItem} onClose={() => setPreviewItem(null)} lang={lang} />

      {/* Dedicated Google Drive Picker Modal */}
      <DrivePickerModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        lang={lang}
        onFilesImported={(files) => {
          if (files.length > 0) {
            handleFilesAdded(files);
          }
        }}
      />

      {/* Dedicated Local History Modal */}
      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        lang={lang}
        onPreview={(name, blob, format) => {
          setPreviewItem({
            id: `prev_${Date.now()}`,
            name,
            size: blob.size,
            type: blob.type,
            format: format as any,
            targetFormat: format as any,
            status: 'done',
            progress: 100,
            resultBlob: blob,
            resultName: name,
          });
        }}
        onLoadToActiveStudio={(file) => {
          handleFilesAdded([file]);
        }}
      />
    </div>
  );
}
