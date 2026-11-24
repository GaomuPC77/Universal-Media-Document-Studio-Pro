import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Header } from './components/Header';
import { CommonUploadCard } from './components/CommonUploadCard';
import { TabNavigation } from './components/TabNavigation';
import { PdfSuite } from './components/Tabs/PdfSuite';
import { PdfImageSuite } from './components/Tabs/PdfImageSuite';
import { OfficeSuite } from './components/Tabs/OfficeSuite';
import { SignAndStamp } from './components/Tabs/SignAndStamp';
import { OcrSuite } from './components/Tabs/OcrSuite';
import { DiffSuite } from './components/Tabs/DiffSuite';
import { ZipSuite } from './components/Tabs/ZipSuite';
import { HistoryTab } from './components/Tabs/HistoryTab';
import { HtmlStudio } from './components/Tabs/HtmlStudio';
import { ImageEditorSuite } from './components/Tabs/ImageEditorSuite';
import { SvgEditorSuite } from './components/Tabs/SvgEditorSuite';
import { MetadataSuite } from './components/Tabs/MetadataSuite';
import { StatusQueueCard } from './components/StatusQueueCard';
import { FilePreviewModal } from './components/Modals/FilePreviewModal';
import { DrivePickerModal } from './components/Modals/DrivePickerModal';
import { DriveDomainAuthModal } from './components/Modals/DriveDomainAuthModal';
import { HistoryModal } from './components/Modals/HistoryModal';
import { BackupModal } from './components/Modals/BackupModal';
import { OfflinePackModal } from './components/Modals/OfflinePackModal';
import { ShareModal } from './components/Modals/ShareModal';
import {
  TAB_DEFINITIONS,
  TabAdaptiveMode,
  loadTabAdaptiveMode,
  saveTabAdaptiveMode,
  loadTabUsage,
  recordTabVisit,
  recordTabAction,
  clearTabUsage,
  getOrderedTabs,
  getBestMatchingTabId,
  hasTabAffinity,
  TabUsageMap,
} from './utils/tabOrdering';
import {
  uploadFileToDrive,
  getStoredToken,
  requestGoogleAccessToken,
  isUnauthorizedDomainError,
} from './utils/googleDrive';
import { savePendingFile, getPendingFiles } from './utils/historyDb';
import { FileItem, DocumentFormat } from './types';
import {
  UploadCloud,
  ChevronRight,
  ChevronLeft,
  ArchiveRestore,
  Download,
  Upload,
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('pdf-suite');
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [lang, setLang] = useState<'ja' | 'en'>('ja');
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null);

  // Global File State
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [activeSharedFile, setActiveSharedFile] = useState<File | null>(null);
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const dragCounter = useRef<number>(0);

  // Adaptive Tab Behavior State ('scroll' | 'reorder' | 'off')
  const [tabAdaptiveMode, setTabAdaptiveMode] = useState<TabAdaptiveMode>(() => loadTabAdaptiveMode());
  const [tabUsage, setTabUsage] = useState<TabUsageMap>(() => loadTabUsage());
  const [scrollTargetRequest, setScrollTargetRequest] = useState<{ tabId: string; seq: number } | null>(null);

  const handleSelectTab = (nextTabId: string) => {
    setActiveTab(nextTabId);
    setTabUsage(recordTabVisit(nextTabId));
  };

  const handleChangeTabAdaptiveMode = (nextMode: TabAdaptiveMode) => {
    setTabAdaptiveMode(nextMode);
    saveTabAdaptiveMode(nextMode);
    if (nextMode === 'scroll') {
      const targetId = getBestMatchingTabId(fileList, tabUsage, activeSharedFile);
      if (targetId) {
        setScrollTargetRequest({ tabId: targetId, seq: Date.now() });
      }
      showToast(
        lang === 'ja'
          ? 'タブ表示を「最適タブへ自動スクロール（順番固定）」に変更しました'
          : 'Tab behavior set to Auto-Scroll (Fixed Order)'
      );
    } else if (nextMode === 'reorder') {
      showToast(
        lang === 'ja'
          ? 'タブ表示を「使用状況・拡張子で順番を並び替え」に変更しました'
          : 'Tab behavior set to Reorder by Usage & Extension'
      );
    } else {
      showToast(
        lang === 'ja'
          ? 'タブの自動連動をオフにしました（常に固定順）'
          : 'Tab automation turned off (Fixed order, manual only)'
      );
    }
  };

  const orderedTabs = useMemo(
    () => getOrderedTabs(fileList, tabUsage, activeSharedFile),
    [fileList, tabUsage, activeSharedFile]
  );

  const displayedTabs = useMemo(
    () => (tabAdaptiveMode === 'reorder' ? orderedTabs : TAB_DEFINITIONS),
    [tabAdaptiveMode, orderedTabs]
  );

  // Modals state
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [isDriveDomainModalOpen, setIsDriveDomainModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isOfflinePackModalOpen, setIsOfflinePackModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
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
      descJa: 'ファイル、フォルダ、またはGoogle Driveから処理したいファイルを追加します。画面全体へのドラッグ＆ドロップにも対応しています。',
      descEn: 'Add files, folders, or import from Google Drive here. Global window drag & drop is fully supported.',
    },
    {
      targetId: 'tabNavContainer',
      titleJa: '2. 処理ツールの選択 ＆ タブ連動モード設定',
      titleEn: '2. Select Tool & Tab Behavior',
      descJa: '「PDF編集・整理（マークアップ・テキストボックス含む）」「PDF ⇔ 画像」「画像編集・変換」「SVG編集・作成」「Office・データ表」「HTML・Markdown」「電子印鑑・署名・PDF注釈」「OCR・QR」「差分比較」「メタデータ・C2PA」「ZIP・一括リネーム」「履歴」から選択します。右上のメニューで「自動スクロール（順番固定）」「順番自動並び替え」「オフ」の3モードを切り替えられます。',
      descEn: 'Choose from PDF Toolkit (with Markup/Text Box), PDF ⇔ Image, Image Studio & Convert, SVG Studio, Office & Data, HTML & Markdown, Sign & PDF Markup, OCR & QR, Diff Studio, Metadata & C2PA, ZIP & Rename, and History. Use the selector above the tabs to toggle Auto-Scroll, Reorder, or Off.',
    },
    {
      targetId: 'mainTabContentArea',
      titleJa: '3. 編集・注釈・SVG編集・変換・メタデータ処理の実行',
      titleEn: '3. Edit, Annotate, Vector Edit & Convert',
      descJa: 'PDFへの日本語テキストボックス・手書き/図形マークアップ・印鑑捺印、SVGの図形追加/色一括置換/ViewBox調整/コード編集、EXIF/PNG/PDF/Office/C2PAなど全メタデータの編集とリスク確認、Office変換やOCRを実行します。他タブへ切り替えても作業内容は保持されます。',
      descEn: 'Add Japanese text boxes & PDF markup, edit SVG vector shapes/colors/code, inspect/edit all metadata with risk guides, convert Office/data tables, run OCR, and more. Work stays intact across tabs.',
    },
    {
      targetId: 'statusQueueSection',
      titleJa: '4. 変換・処理ステータス（プレビュー・保存・ZIP）',
      titleEn: '4. Status Queue & Downloads',
      descJa: '処理のリアルタイム進捗や完了ファイルの一覧がここに集約されます。プレビュー確認、個別保存、Google Drive保存、一括ZIPダウンロードが行えます。',
      descEn: 'Monitor real-time progress, preview results, save files individually, upload directly to Google Drive, or download everything as a ZIP.',
    },
    {
      targetId: 'mainAppContainer',
      titleJa: '5. オフラインパック ＆ 作業バックアップ引き継ぎ',
      titleEn: '5. Offline Pack & Workspace Backup',
      descJa: '「オフライン用パックを取得」でネット不要のスタンドアロン版を入手できるほか、作業バックアップ機能でファイル・履歴・編集中データを別端末へ引き継げます。言語やテーマ切替も上部から行えます。',
      descEn: 'Download a standalone Offline Pack, transfer your queue/drafts across devices via Backup, and switch language or theme anytime from the header.',
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

  const handleDownloadOfflinePack = () => {
    setIsOfflinePackModalOpen(true);
  };

  const handleRestoreBackup = (data: {
    restoredFiles: FileItem[];
    activeTab: string;
    lang: 'ja' | 'en';
    theme: 'auto' | 'light' | 'dark';
    historyCount: number;
  }) => {
    if (data.restoredFiles && data.restoredFiles.length > 0) {
      setFileList(data.restoredFiles);
      if (data.restoredFiles[0].file) {
        setActiveSharedFile(data.restoredFiles[0].file);
      }
    }
    if (data.activeTab) setActiveTab(data.activeTab);
    if (data.lang) {
      setLang(data.lang);
      localStorage.setItem('user_lang', data.lang);
    }
    if (data.theme) {
      setTheme(data.theme);
      localStorage.setItem('user_theme', data.theme);
    }
    showToast(
      lang === 'ja'
        ? `バックアップから復元しました（ファイル ${data.restoredFiles.length}件 / 履歴 ${data.historyCount}件）`
        : `Restored ${data.restoredFiles.length} files and ${data.historyCount} history items`
    );
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
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }
    // For unsupported devices/browsers (desktop, unsupported webviews, etc.), open custom ShareModal
    setIsShareModalOpen(true);
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

    if (tabAdaptiveMode === 'scroll') {
      const bestTabId = getBestMatchingTabId(newItems, tabUsage, fileArray[0]);
      if (bestTabId) {
        if (!hasTabAffinity(newItems, activeTab)) {
          setActiveTab(bestTabId);
        }
        setScrollTargetRequest({ tabId: bestTabId, seq: Date.now() });
      }
    }

    showToast(
      lang === 'ja'
        ? `${fileArray.length} 件のファイルを読み込みました。下の処理タブから選択して編集・変換できます。`
        : `Loaded ${fileArray.length} file(s). Select a tab below to process.`
    );
  };

  const handleResultReady = (item: FileItem) => {
    setTabUsage(recordTabAction(activeTab));
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
    const targetBlob = item.resultBlob || item.file;
    if (!targetBlob) return;
    let token = getStoredToken();
    if (!token) {
      try {
        showToast(lang === 'ja' ? 'Google認証を開いています...' : 'Opening Google Sign-in...');
        token = await requestGoogleAccessToken();
      } catch (e: any) {
        if (isUnauthorizedDomainError(e)) {
          setIsDriveDomainModalOpen(true);
          return;
        }
        if (e?.code !== 'auth/popup-closed-by-user') {
          showToast(lang === 'ja' ? 'Google Driveと連携してください' : 'Please connect Google Drive first');
        }
        setIsDriveModalOpen(true);
        return;
      }
    }

    const saveName = item.resultName || item.name;
    showToast(lang === 'ja' ? `Google Driveに保存中: ${saveName}...` : `Saving to Google Drive...`);
    try {
      const res = await uploadFileToDrive(
        saveName,
        targetBlob.type || 'application/octet-stream',
        targetBlob
      );
      showToast(
        lang === 'ja'
          ? `「${res.name}」をGoogle Driveに保存しました`
          : `Saved "${res.name}" to Google Drive`
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
            <UploadCloud className="w-12 h-12 text-blue-600" />
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
          onOpenBackup={() => setIsBackupModalOpen(true)}
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

        {/* Tab Navigation (Supports Auto-Scroll, Adaptive Reorder, or Fixed Off Mode) */}
        <TabNavigation
          activeTab={activeTab}
          setActiveTab={handleSelectTab}
          lang={lang}
          tabs={displayedTabs}
          adaptiveMode={tabAdaptiveMode}
          onChangeAdaptiveMode={handleChangeTabAdaptiveMode}
          scrollTargetRequest={scrollTargetRequest}
        />

        {/* Tab Contents - Kept mounted persistently so state and inputs are never lost */}
        <main className="w-full" id="mainTabContentArea">
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


          <div style={{ display: activeTab === 'image-editor' ? 'block' : 'none' }}>
            <ImageEditorSuite
              lang={lang}
              sharedFile={activeSharedFile}
              fileList={fileList}
              onResultReady={handleResultReady}
              onAddFiles={handleFilesAdded}
              onShowToast={showToast}
              onOpenInSvgStudio={(file) => {
                setActiveSharedFile(file);
                handleSelectTab('svg-studio');
              }}
            />
          </div>

          <div style={{ display: activeTab === 'svg-studio' ? 'block' : 'none' }}>
            <SvgEditorSuite
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

          <div style={{ display: activeTab === 'metadata-studio' ? 'block' : 'none' }}>
            <MetadataSuite
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
                const fmt = getFormatFromExt(file.name);
                const tempItem: FileItem = {
                  id: 'tmp',
                  file,
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  format: fmt,
                  targetFormat: fmt,
                  status: 'idle',
                  progress: 0,
                };
                const best = getOrderedTabs([tempItem], tabUsage, file)[0];
                if (best) handleSelectTab(best.id);
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
          onOpenBackup={() => setIsBackupModalOpen(true)}
          onShowToast={showToast}
          onClearCache={() => {
            setFileList([]);
            setActiveSharedFile(null);
            clearTabUsage();
            setTabUsage({});
          }}
        />

        {/* 3. Cross-Device Workspace Backup & Transfer Card (Placed directly under Conversion & Processing Status) */}
        <div className="card" id="workspaceBackupSection">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                <ArchiveRestore className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-100 flex flex-wrap items-baseline gap-x-2">
                  <span>{lang === 'ja' ? 'データ引き継ぎ・作業バックアップ' : 'Workspace Transfer & Backup'}</span>
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400" aria-hidden="true">·</span>
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                    {lang === 'ja' ? '端末間引き継ぎ対応' : 'Cross-Device Ready'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  {lang === 'ja'
                    ? '現在読み込み中のファイル、変換結果、履歴、HTML/Markdownの編集内容を1つのパッケージにまとめ、スマートフォンや別PCへ即座に引き継げます。'
                    : 'Package queued files, results, history, and HTML/MD drafts into a single file to continue seamlessly on another device.'}
                </p>
              </div>
            </div>

            {/* Unified 2 Buttons for Backup Operations */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setIsBackupModalOpen(true)}
                className="btn-sm btn-primary flex items-center gap-1.5 whitespace-nowrap py-2 px-3.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? 'バックアップを作成・保存' : 'Create & Save Backup'}</span>
              </button>

              <button
                onClick={() => setIsBackupModalOpen(true)}
                className="btn-sm btn-secondary flex items-center gap-1.5 whitespace-nowrap py-2 px-3.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-blue-600" />
                <span>{lang === 'ja' ? 'バックアップを復元・インポート' : 'Restore / Import Backup'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Features, Environment, How-To, and FAQ Section */}
        <div className="card" id="featuresSection">
          <div className="info-card-title">{lang === 'ja' ? '本ツールの特徴' : 'Tool Features'}</div>
          <div className="info-box-grid">
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? '完全ローカル処理 ＆ 完全無制限' : '100% Local Processing & Unlimited'}</h4>
              <p>
                {lang === 'ja'
                  ? 'すべての処理をブラウザ（端末内）だけで実行し、ファイルデータを外部サーバーへ送信しない安全設計です。回数・容量のサーバー側制限なく利用できます。'
                  : 'All processing runs strictly inside your browser with zero file uploads to external servers and no server-side size or count caps.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? 'PDF編集・整理 ＆ マークアップ・テキストボックス' : 'PDF Toolkit, Markup & Text Boxes'}</h4>
              <p>
                {lang === 'ja'
                  ? 'ページの結合・分割・並び替え・回転・透かし・番号付けに加え、日本語や複数行に対応したテキストボックス挿入、蛍光ペン、フリーハンドペン、図形・矢印、ナンバリング、機密箇所の黒塗りをページ上で直接編集できます。'
                  : 'Merge, split, reorder, rotate, watermark, and number PDFs, plus draw freehand ink, highlights, shapes, arrows, Japanese/multiline text boxes, numbered stamps, and redactions directly on pages.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? 'PDF ⇔ Office変換 ＆ データ表・画像・SVG編集スタジオ' : 'PDF ⇔ Office, Data Tables, Image & SVG Studio'}</h4>
              <p>
                {lang === 'ja'
                  ? 'PDFとWord・Excel・PowerPointの相互変換やデータ表（CSV/TSV/XLSX/JSON/HTML/MD）変換に対応。画像加工・形式変換（PNG/JPG/WebP/BMP/ICO/SVG）に加え、専用の「SVG編集・作成」タブでベクター図形・パス・テキスト追加、パーツごとの頂点・制御点移動や中間頂点の追加/削除、色一括置換、レイヤー操作、ViewBox自動調整、SVGコード整形/軽量化および高解像度ラスタ書き出しが行えます（各エディタでCtrl+Z/Ctrl+Y対応）。'
                  : 'Convert between PDF and Word/Excel/PowerPoint or transform data tables. Edit raster images (PNG/JPG/WebP/BMP/ICO/SVG), plus use SVG Studio to draw shapes/paths/text, move individual vertices and Bézier control handles per part, insert/delete nodes, batch-replace colors, manage layers, adjust viewBox, format/minify markup, and export scaled PNG/JPG/WebP (Ctrl+Z / Ctrl+Y supported across editors).'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? '電子印鑑・署名・PDF注釈 ＆ OCR・QRコード' : 'Electronic Stamps, Signatures & OCR / QR'}</h4>
              <p>
                {lang === 'ja'
                  ? '丸印・角印（均等割付）・日付印や手書きサインを作成してPDFへ自在に配置・テキスト注釈追加が可能。ブラウザ内OCR文字認識（日本語/英語対応）やQRコード生成・カメラ読取にも対応しています。'
                  : 'Create Japanese seals, handwritten signatures, text boxes, and markups on PDFs, extract text via client-side OCR (JA/EN), and generate or camera-scan QR codes.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? 'HTML・Markdown編集 ＆ 文書差分比較・ZIP処理' : 'HTML/Markdown Studio, Diff & ZIP Archive'}</h4>
              <p>
                {lang === 'ja'
                  ? '安全なサンドボックス内でのHTML/Markdownライブ編集・プレビュー・PDF/画像出力、PDF・Word・テキスト・CSV・JSONのSide-by-Side差分比較、ZIP圧縮・解凍・連番一括リネームを備えています。'
                  : 'Edit and preview HTML/Markdown with PDF/PNG export, compare PDF/DOCX/text/CSV/JSON side-by-side, and compress, extract, or batch-rename files in ZIP archives.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? '全メタデータ・C2PA確認・編集・リスク可視化' : 'Full Metadata & C2PA Editor + Risk Guide'}</h4>
              <p>
                {lang === 'ja'
                  ? 'EXIF/GPS/PNGチャンク/PDF辞書・XMP/Officeプロパティ/MP4・MOV・M4AメタデータやC2PA署名情報を単体・複数ファイルで検査し、ファイル名・名前上の拡張子・日時・位置情報を含む全検出項目を直接編集または削除できます。各項目の「設定内容」と「変更時のリスク」もあわせて表示します。'
                  : 'Inspect, inline-edit, or scrub filenames, extensions, timestamps, GPS, C2PA Content Credentials, and all detected EXIF/PNG/PDF/Office/XMP/MP4 tags on single or multiple files—with plain-language descriptions and modification risk warnings for every field.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? '処理タブの3モード切替 ＆ 自動復元機能' : '3-Mode Tab Behavior & Auto Recovery'}</h4>
              <p>
                {lang === 'ja'
                  ? 'タブが動いて迷わない「最適タブへ自動スクロール（順番固定）」、使用頻度と拡張子に基づく「順番自動並び替え」、完全に固定する「オフ」の3種類を選択可能。不意のリロード時もキュー内ファイルを自動復元します。'
                  : 'Switch between Auto-Scroll to Matching Tab (fixed order), Dynamic Reordering by usage & file type, or Off (manual only). Pending files auto-recover after reloads.'}
              </p>
            </div>
            <div className="info-sub-box">
              <h4 className="break-keep">{lang === 'ja' ? 'オフラインPWA・Google Drive連携・端末間引き継ぎ' : 'Offline Pack, Google Drive & Device Backup'}</h4>
              <p>
                {lang === 'ja'
                  ? 'スタンドアロン版HTMLのオフラインパック生成・PWAインストール、公式OAuth 2.0によるGoogle Drive直接読込/保存、別PCやスマートフォンへ作業内容を引き継げるバックアップ書き出し/復元に対応しています。'
                  : 'Download a standalone Offline Pack or install as a PWA, import/save directly with Google Drive OAuth 2.0, and package drafts/queues for seamless cross-device handoff.'}
              </p>
            </div>
          </div>

          <div className="info-card-title break-keep" style={{ marginTop: '18px' }}>
            {lang === 'ja' ? '対応フォーマットおよび動作環境' : 'Supported Formats & System Requirements'}
          </div>
          <div className="info-text-block">
            <span>
              <strong>{lang === 'ja' ? '入力形式: ' : 'Input: '}</strong>
              {lang === 'ja'
                ? 'PDF, Word (DOCX), Excel (XLSX, XLS), PowerPoint (PPTX), CSV, TSV, JSON, XML, HTML, Markdown (MD), テキスト (TXT), 画像 (PNG, JPG, WebP, BMP, SVG, ICO, GIF), ZIP ／ メタデータ解析・プレビュー対応: MP4, MOV, M4A, WebM, MP3, WAV'
                : 'PDF, Word (DOCX), Excel (XLSX, XLS), PowerPoint (PPTX), CSV, TSV, JSON, XML, HTML, Markdown (MD), Plain Text (TXT), Images (PNG, JPG, WebP, BMP, SVG, ICO, GIF), ZIP / Metadata & Preview: MP4, MOV, M4A, WebM, MP3, WAV'}
            </span>
            <br />
            <span>
              <strong>{lang === 'ja' ? '出力形式: ' : 'Output: '}</strong>
              {lang === 'ja'
                ? 'PDF, Word (DOCX), Excel (XLSX), PowerPoint (PPTX), CSV, TSV, JSON, HTML, Markdown (MD), テキスト (TXT), 画像 (PNG, JPG, WebP, BMP, ICO, SVG), ZIP, メタデータ編集／削除済みオリジナル形式ファイル'
                : 'PDF, Word (DOCX), Excel (XLSX), PowerPoint (PPTX), CSV, TSV, JSON, HTML, Markdown (MD), Plain Text (TXT), Images (PNG, JPG, WebP, BMP, ICO, SVG), ZIP, and metadata-edited or scrubbed original files'}
            </span>
            <br />
            <span>
              <strong>{lang === 'ja' ? '推奨動作環境・権限: ' : 'Recommended Browsers & Permissions: '}</strong>
              {lang === 'ja'
                ? 'Google Chrome, Microsoft Edge, Apple Safari, Mozilla Firefox（各最新版、WebAssembly / Canvas対応）。※QRコードのカメラ読取にはカメラ権限、Google Drive直接連携にはGoogleアカウント認証が必要です（いずれも任意利用）。'
                : 'Latest Google Chrome, Microsoft Edge, Apple Safari, or Mozilla Firefox with WebAssembly & Canvas support. Camera permission (optional, for QR scanning) and Google OAuth sign-in (optional, for Google Drive) run locally in the browser.'}
            </span>
          </div>

          <div className="info-card-title" style={{ marginTop: '18px' }}>
            {lang === 'ja' ? '使い方' : 'How to Use'}
          </div>
          <ol className="info-list">
            <li>
              <span>
                {lang === 'ja'
                  ? '最上部の「1. 処理するファイルの読み込み・追加」からファイル・フォルダを選択、または画面上へドラッグ＆ドロップ／Google Driveから読み込みます。'
                  : 'Load files or folders via Section 1, drag & drop anywhere onto the window, or import directly from Google Drive.'}
              </span>
            </li>
            <li>
              <span>
                {lang === 'ja'
                  ? 'タブバー右上の「タブ表示」メニューで「最適タブへ自動スクロール（順番固定）」「使用状況・拡張子で並び替え」「オフ」の好みのモードを選び、目的の処理タブを開きます。'
                  : 'Choose your preferred tab behavior above the tab bar (Auto-Scroll with fixed order, Reorder by usage & extension, or Off) and select the target suite.'}
              </span>
            </li>
            <li>
              <span>
                {lang === 'ja'
                  ? 'PDF編集・マークアップ（テキストボックス追加・黒塗り・電子印鑑）、画像編集・SVGベクター/コード編集、Office/データ表変換、HTML/Markdown編集、OCR・QR、差分比較、メタデータ・C2PA検査/全項目編集・リスク確認、ZIP処理を実行します。'
                  : 'Run your edits or conversions: PDF markup & text boxes, electronic stamps, image editing or SVG vector/code editing, Office/data table conversion, HTML/Markdown preview, OCR/QR, diff comparison, full metadata/C2PA inspection & editing, or ZIP packaging.'}
              </span>
            </li>
            <li>
              <span>
                {lang === 'ja'
                  ? '最下部の処理ステータス一覧で進捗を確認し、「プレビュー」「保存」「Google Drive保存」「一括ZIPダウンロード」または「端末間バックアップ」で成果物や作業状態を持ち出せます。'
                  : 'Track real-time progress in the Status Queue below to preview, download individually, save to Google Drive, export a batch ZIP, or create a cross-device workspace backup.'}
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
                ? 'はい、100%ユーザーのブラウザ内（クライアントサイド）だけで処理が行われます。インターネットを介して外部サーバーにファイルがアップロードされることは一切ありませんので、機密文書やプライベートな画像も安心して処理できます（Google Drive連携を選択した場合のみ、端末とGoogleサーバー間で直接OAuth通信を行います）。'
                : 'Yes. Processing runs 100% inside your browser via client-side WebAssembly and JavaScript. No files ever leave your device except when you explicitly choose to import from or save to Google Drive via direct browser OAuth.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q2: 処理できるファイルの容量や個数に制限はありますか？' : 'Q2: Are there limits on file sizes or counts?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'サーバー側の回数制限や容量制限はありませんが、お使いの端末のメモリ（RAM）容量に依存します。非常に大容量のファイルや多数の高解像度PDF/画像を一度に処理する場合は、分割して実行することをおすすめします。'
                : 'There are no server caps; performance depends on your device RAM. For very large files or many high-resolution pages, processing in smaller batches is recommended.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q3: オフライン環境や別端末への引き継ぎは可能ですか？' : 'Q3: Can I work offline or continue on another device?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい。上部の「オフライン用パックを取得」からスタンドアロンHTMLと起動バッチをダウンロードすればネット接続なしで動作します。また「作業バックアップ・別端末引き継ぎ」を使えば、現在のファイルキュー・履歴・HTML/Markdownドラフトを1ファイルにまとめて別PCやスマートフォンへ移行できます。'
                : 'Yes. Download a standalone Offline Pack from the header for internet-free use, or export a Workspace Backup package to transfer queued files, history, and drafts to another computer or phone.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q4: HTML・Markdownのプレビューや各種形式への出力はできますか？' : 'Q4: Can I preview HTML/Markdown and export them?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい。「HTML・Markdown」タブでは安全なサンドボックス内でのライブ表示プレビュー、ソースコード編集、シンタックスチェックに加え、PDF・高精細PNG画像・テキスト・DOCX等への出力に対応しています。'
                : 'Yes. The HTML & Markdown tab supports sandboxed live rendering, source editing, and export to PDF, high-DPI PNG images, plain text, and DOCX.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q5: PDFに日本語のテキストボックスやマークアップ、電子印鑑を追加できますか？' : 'Q5: Can I add Japanese text boxes, markups, and stamps to PDFs?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい。「PDF編集・整理」内の「マークアップ・テキスト追加」および「電子印鑑・署名・PDF注釈」タブの両方で対応しています。日本語や改行を含むテキストボックス、蛍光ハイライト、フリーハンドペン、矩形・楕円・矢印・直線、番号スタンプ、黒塗りをページ上にドラッグ配置して保存でき、Ctrl+Z / Ctrl+Y による元に戻す・やり直しにも対応しています。'
                : 'Yes. Both PDF Toolkit (Markup & Text tab) and Sign & PDF Markup let you place Japanese/multiline text boxes, highlights, freehand ink, shapes, arrows, numbered callouts, stamps, handwritten signatures, and blackouts directly onto PDF pages with Ctrl+Z / Ctrl+Y undo/redo support.'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q6: メタデータ・C2PA機能ではどのような項目の編集とリスク確認ができますか？' : 'Q6: What metadata and C2PA edits and risk checks are supported?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? '「メタデータ・C2PA」タブでは、単体・複数ファイルのファイル名・名前上の拡張子・作成/更新日時・GPS位置情報・C2PA(Content Credentials)に加え、検出されたすべてのEXIF/JPEGコメント/PNGチャンク(tEXt・iTXt・eXIf等)/PDF辞書・XMP/Officeプロパティ/MP4・MOV・M4A/HTML・SVGタグをその場で直接編集または一括削除できます。各項目には「何を設定しているデータか」と「変更・削除することで起きうるリスク（表示互換性低下、C2PA暗号署名無効化、時刻ズレ等）」の説明が表示されます。'
                : 'In Metadata & C2PA, you can inspect, inline-edit, or strip filenames, extensions, timestamps, GPS coordinates, C2PA manifests, and every detected EXIF, PNG, PDF, XMP, Office, MP4/MOV/M4A, and HTML/SVG tag across single or multiple files. Every field shows what it controls and potential modification risks (e.g., invalidating C2PA cryptographic signatures or breaking viewer compatibility).'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q7: ファイルを追加したときの処理タブの自動並び替えやスクロールを切り替えられますか？' : 'Q7: Can I change or disable automatic tab reordering or scrolling?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい。タブバー右上の「タブ表示」メニューからいつでも3種類を切り替えられます。(1)「最適タブへ自動スクロール（順番固定）」: タブの位置を変えずに対応するタブへスクロール表示、(2)「使用状況・拡張子で順番を並び替え」: よく使うタブや拡張子に合うタブを左へ移動、(3)「オフ」: 順番固定のまま自動移動も行いません。'
                : 'Yes. Use the "Tab Behavior" dropdown right above the tab strip to choose among three modes: Auto-Scroll to Match (keeps tab positions fixed), Reorder by Usage & Extension, or Off (completely manual).'}
            </div>
          </details>

          <details className="faq-details">
            <summary className="faq-summary">
              <span>{lang === 'ja' ? 'Q8: SVGファイルの図形や色・テキスト・ソースコードを直接編集できますか？' : 'Q8: Can I edit SVG vector shapes, colors, text, and markup directly?'}</span>
              <span>▼</span>
            </summary>
            <div className="faq-content">
              {lang === 'ja'
                ? 'はい。「SVG編集・作成」タブでSVGのベクター図形やテキストの選択・ドラッグ移動、「頂点編集」ツール（またはパーツのダブルクリック）によるパス/多角形/直線/四角形/円・楕円ごとの頂点・ベジェ制御点の移動・中間点追加・削除・座標数値編集、新規図形（四角形・円/楕円・直線・ペンパス・文字）追加、塗り/線色/線幅/不透明度/角丸調整、使用カラーの一括置換、レイヤー順変更、ViewBoxサイズ調整・自動フィット、SVGソースコードの整形・軽量化、およびSVG/PNG/JPG/WebP（1x〜4x倍率）書き出しまで端末内完結で行えます。Ctrl+Z（元に戻す）・Ctrl+Y（やり直し）のショートカットにも対応し、不要なスクリプト属性は自動サニタイズされます。'
                : 'Yes. The SVG Studio tab supports selecting and dragging vector elements, per-part vertex & Bézier control handle dragging (plus midpoint insertion, node deletion, and numeric coordinates via Edit Nodes or double-clicking a shape), adding shapes/paths/text, editing fill/stroke/opacity/radius, batch-replacing colors, managing layers, fitting/editing viewBox, formatting or minifying markup, Ctrl+Z / Ctrl+Y shortcuts, and exporting SVG or 1x–4x PNG/JPG/WebP locally with automatic script sanitization.'}
            </div>
          </details>
        </div>

        {/* Footer with accurate library links */}
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
            <a href="https://pdf-lib.js.org/" target="_blank" rel="noopener noreferrer">
              PDF-Lib
            </a>
            ,{' '}
            <a href="https://mozilla.github.io/pdf.js/" target="_blank" rel="noopener noreferrer">
              PDF.js
            </a>
            ,{' '}
            <a href="https://stuk.github.io/jszip/" target="_blank" rel="noopener noreferrer">
              JSZip
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
                    <p><strong>{lang === 'ja' ? '第1条（適用）' : 'Art 1: Scope'}</strong><br />{lang === 'ja' ? '本ツールが提供するPDF編集・注釈、Office変換、画像・SVG編集、メタデータ・C2PA編集、OCR等の利用条件を定めます。' : 'Applies to all PDF editing/markup, Office conversion, image/SVG editing, metadata/C2PA, and OCR features provided by this tool.'}</p>
                    <p style={{ marginTop: '6px' }}><strong>{lang === 'ja' ? '第2条（権利・法令遵守と不正改変の禁止）' : 'Art 2: Lawful Use & Provenance'}</strong><br />{lang === 'ja' ? '適法な権利を有するファイルのみを扱い、電子印鑑やC2PA・日時の不正な偽装・悪用は行わないものとします。' : 'Only process files you are authorized to edit, and never falsify stamps, C2PA credentials, or timestamps maliciously.'}</p>
                    <p style={{ marginTop: '6px' }}><strong>{lang === 'ja' ? '第3条（免責事項）' : 'Art 3: Disclaimer'}</strong><br />{lang === 'ja' ? '完全ローカル処理で動作し、データ破損やメタデータ改変による互換性・署名失効等の責任は負いません（事前バックアップ推奨）。' : 'Runs 100% locally; developers assume no liability for data loss, compatibility changes, or invalidated signatures.'}</p>
                  </div>
                </div>
                <div className="terms-split-box">
                  <h5>{lang === 'ja' ? 'プライバシーポリシー' : 'Privacy Policy'}</h5>
                  <div style={{ fontSize: '0.78rem', lineHeight: '1.5' }}>
                    <p><strong>{lang === 'ja' ? '1. 完全端末内処理（サーバー非送信）' : '1. 100% Local Browser Execution'}</strong><br />{lang === 'ja' ? 'PDF・Office・画像・SVG・メタデータ・OCR・カメラQR映像はブラウザ内のみで処理され、外部サーバーへ送信されません。' : 'All document, image, SVG, metadata, OCR, and camera QR processing stays strictly inside your browser.'}</p>
                    <p style={{ marginTop: '6px' }}><strong>{lang === 'ja' ? '2. 端末内保存・Google Drive直接通信' : '2. Local Storage & Google Drive Direct'}</strong><br />{lang === 'ja' ? '設定・タブ表示設定/利用統計・作業キューは端末内のみに保存し、Drive連携時は公式OAuth 2.0でGoogleへ直接通信します。' : 'Preferences, tab settings/usage, and drafts stay in device storage; Drive sync connects directly via official OAuth 2.0.'}</p>
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
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400 tabular-nums whitespace-nowrap">
                {lang === 'ja' ? `手順 ${currentTutorialStep + 1} / ${tutorialSteps.length}` : `Step ${currentTutorialStep + 1} / ${tutorialSteps.length}`}
              </span>
              <span className="text-slate-300 dark:text-slate-700 text-xs" aria-hidden="true">·</span>
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
                      ? '本規約は、Universal Media & Document Studio Pro（以下「本ツール」）が提供するPDF編集・マークアップ・注釈・墨消し、Office・データ表変換、画像・SVGベクター編集、HTML/Markdown編集、電子印鑑・署名、OCR・QR、差分比較、メタデータ・C2PA検査/編集/削除、ZIP処理、作業バックアップおよびオフラインパック等すべての機能の利用条件を定めるものです。利用者は本ツールの利用により本規約に同意したものとみなされます。'
                      : 'These Terms of Service govern all features of Universal Media & Document Studio Pro ("the Tool"), including PDF editing/markup/redaction, Office & data table conversion, image & SVG vector editing, HTML/Markdown studio, stamps & signatures, OCR/QR, diff comparison, metadata & C2PA inspection/editing/removal, ZIP archiving, workspace backup, and offline packs.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第2条（著作権・権利および法令遵守）' : 'Article 2 (Intellectual Property & Legal Compliance)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '利用者は、著作権法・不正アクセス禁止法その他の関係法令を遵守し、自らが適法な権利を有するファイル、または正当な許諾を得たファイルのみを本ツールの変換・編集・メタデータ変更対象とするものとします。'
                      : 'Users must comply with copyright and all applicable laws, processing and modifying only files for which they hold lawful ownership or valid permission.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第3条（禁止事項および電子署名の適正利用）' : 'Article 3 (Prohibited Conduct & Provenance Integrity)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '不正・違法なドキュメントや画像の生成、電子印鑑・署名・PDF注釈・作成日時・GPS・C2PA(Content Credentials)等メタデータの不正偽装や公的証跡の改ざん、第三者の権利侵害、公序良俗に反する利用、本ツールの不正解析・改変・営利目的の無断再配布を禁止します。'
                      : 'Creating unlawful files, maliciously falsifying electronic stamps, signatures, timestamps, GPS, or C2PA Content Credentials, infringing third-party rights, or reverse-engineering and redistributing the Tool without authorization are strictly prohibited.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第4条（メタデータ変更・黒塗り・署名に関する免責事項）' : 'Article 4 (Disclaimer of Liability)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールの利用により生じたデータ破損・消失、端末の不具合、メタデータやC2PA情報の編集・削除に伴うデジタル署名の無効化やファイル互換性低下、黒塗り設定ミスによる情報漏洩等の損害について、開発者および運営者は一切の法的責任を負いません。編集前に必ず元ファイルのバックアップを作成し、出力結果を直接ご確認ください。'
                      : 'Developers assume no liability for data loss, device issues, invalidated C2PA/digital signatures or viewer compatibility changes caused by metadata editing/removal, or incomplete redactions. Always back up originals and inspect exported files before sharing.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第5条（出力結果および動作保証について）' : 'Article 5 (Warranty & Output Accuracy)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールが提供する変換・OCR・注釈・編集機能および出力結果の完全性、正確性、法的効力、特定目的への適合性について、開発者は明示的にも黙示的にも保証するものではありません。'
                      : 'No express or implied warranty is given regarding completeness, OCR/conversion accuracy, legal validity of electronic stamps/signatures, or fitness for a particular purpose.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第6条（サービスの変更・終了）' : 'Article 6 (Modification & Discontinuation)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールは事前通知なく機能の変更、提供の中断または終了を行うことがあります。'
                      : 'Features of the Tool may be updated, suspended, or discontinued at any time without prior notice.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第7条（準拠法・管轄）' : 'Article 7 (Governing Law)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本規約の解釈にあたっては、日本法を準拠法とします。'
                      : 'These Terms of Service shall be governed by and construed in accordance with the laws of Japan.'}
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
                      ? '本ツールはWebAssemblyおよびクライアントサイドJavaScript技術を用い、PDF編集・マークアップ・テキスト追加・黒塗り、Office・データ表変換、画像編集・形式変換、SVGベクター/コード編集（危険なスクリプト要素の自動サニタイズを含む）、電子印鑑・手書き署名、OCR文字認識、HTML/Markdown編集・プレビュー、差分比較、メタデータ（EXIF/GPS/PNG/PDF/Office/XMP/MP4等）・C2PAの検査/編集/削除、ZIP処理をユーザーのブラウザ（端末内）だけで完結して実行します。処理対象のファイルデータが外部サーバーへアップロードまたは保存されることは一切ありません。'
                      : 'Using WebAssembly and client-side JavaScript, the Tool performs PDF editing/markup/redaction, Office & data table conversion, image editing, SVG vector/markup editing (with automatic script sanitization), digital stamps/signatures, OCR, HTML/Markdown editing & preview, diff comparison, metadata/C2PA inspection/editing/removal, and ZIP archiving entirely inside your browser. Target file data is never uploaded to or stored on external servers.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '2. ローカルストレージおよびIndexedDBの利用' : '2. Use of LocalStorage and IndexedDB'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールは利用者の利便性およびセッション復元のため、言語・テーマ設定、処理タブの連動モード設定およびタブ利用頻度スコア（自動並び替え用）、未処理ファイルの復旧キュー、処理履歴、HTML/Markdownドラフト・スナップショットを端末内のLocalStorageおよびIndexedDBにのみ保存します。これらは外部送信されず、ブラウザ設定またはツール内のキャッシュ消去機能・バックアップ機能からいつでも削除・管理できます。'
                      : 'For convenience and crash/reload recovery, language/theme preferences, tab adaptive mode and tab usage counts, pending file recovery queues, conversion history, and HTML/Markdown drafts are stored strictly on your device via LocalStorage and IndexedDB. Nothing is transmitted externally, and all stored data can be cleared anytime via browser settings or in-app controls.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '3. カメラ等端末権限の取り扱い（QRコード読取）' : '3. Camera & Device Permissions (QR Scanning)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? 'OCR・QRタブの「カメラでスキャン」機能を利用する場合にのみブラウザへカメラ権限を要求します。取得したカメラ映像フレームは端末メモリ上でリアルタイムにQRコード文字列をデコードするためだけに使用され、録画・保存・外部サーバーへの送信は一切行われません。'
                      : 'Camera access is requested solely when you explicitly start the QR scanner. Video frames are decoded strictly in local memory and are never recorded, persisted, or uploaded.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '4. Google Drive直接連携 ＆ 外部ライブラリ読み込み' : '4. Google Drive Direct OAuth 2.0 & External Libraries'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '利用者が明示的にGoogle Driveからの読み込みまたは保存を実行した場合に限り、公式Google Identity Services（OAuth 2.0）を通じてユーザーのブラウザとGoogleサーバー間で直接暗号化通信を行います（開発者の仲介サーバーは経由しません）。またオンライン版では必要なコアライブラリ・OCR言語モデルの取得が行われますが（スタンドアロン・オフラインパックでは外部通信ゼロで動作します）、行動履歴やファイルのトラッキング・収集は一切行いません。'
                      : 'Only when you explicitly connect Google Drive does the Tool establish a direct encrypted OAuth 2.0 connection from your browser to Google APIs (with no intermediary server). Online editions fetch required core libraries and OCR language data as needed, while the Standalone Offline Pack operates with zero external network requests. No analytics, profiling, or file tracking is performed.'}
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

      {/* Google Drive Domain Authorization & Token Connection Modal */}
      <DriveDomainAuthModal
        isOpen={isDriveDomainModalOpen}
        onClose={() => setIsDriveDomainModalOpen(false)}
        lang={lang}
        onRetryConnect={() => setIsDriveModalOpen(true)}
        onConnectedSuccess={() => {
          showToast(lang === 'ja' ? 'Google Driveに接続しました' : 'Connected to Google Drive');
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

      {/* Cross-Device Workspace Backup & Restore Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        lang={lang}
        fileList={fileList}
        activeTab={activeTab}
        theme={theme}
        onRestoreBackup={handleRestoreBackup}
        onShowToast={showToast}
      />

      {/* Device & OS Selected Offline Pack Modal */}
      <OfflinePackModal
        isOpen={isOfflinePackModalOpen}
        onClose={() => setIsOfflinePackModalOpen(false)}
        lang={lang}
        onShowToast={showToast}
      />

      {/* Custom Cross-Device Share Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        lang={lang}
        onOpenBackup={() => {
          setIsShareModalOpen(false);
          setIsBackupModalOpen(true);
        }}
        onShowToast={showToast}
      />
    </div>
  );
}
