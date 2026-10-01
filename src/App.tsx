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
import { FilePreviewModal } from './components/Modals/FilePreviewModal';
import { DrivePickerModal } from './components/Modals/DrivePickerModal';
import { HistoryModal } from './components/Modals/HistoryModal';
import { downloadOfflinePack } from './utils/offlinePack';
import { uploadFileToDrive, getStoredToken } from './utils/googleDrive';
import { FileItem, DocumentFormat } from './types';
import { UploadCloud } from 'lucide-react';

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
    await downloadOfflinePack();
    showToast(lang === 'ja' ? 'オフラインHTMLをダウンロードしました' : 'Offline Pack Downloaded!');
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

  const handleFilesAdded = (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setActiveSharedFile(fileArray[0]);

    const newItems: FileItem[] = fileArray.map((file) => {
      const format = getFormatFromExt(file.name);
      return {
        id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        format,
        targetFormat: format === 'pdf' ? 'docx' : 'pdf',
        status: 'idle',
        progress: 0,
        file,
        previewUrl: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'gif', 'ico'].includes(format)
          ? URL.createObjectURL(file)
          : undefined,
      };
    });

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
        <CommonUploadCard
          lang={lang}
          onFilesSelected={handleFilesAdded}
          onOpenDrivePicker={() => setIsDriveModalOpen(true)}
          onShowToast={showToast}
        />

        {/* Tab Navigation (Directly underneath Card 1 with Left & Right scroll buttons) */}
        <TabNavigation
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          lang={lang}
        />

        {/* Active Tab Contents */}
        <main className="w-full">
          {activeTab === 'converter' && (
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
          )}

          {activeTab === 'pdf-suite' && <PdfSuite lang={lang} sharedFile={activeSharedFile} />}

          {activeTab === 'pdf-image' && <PdfImageSuite lang={lang} sharedFile={activeSharedFile} />}

          {activeTab === 'office-suite' && <OfficeSuite lang={lang} sharedFile={activeSharedFile} />}

          {activeTab === 'sign-stamp' && <SignAndStamp lang={lang} sharedFile={activeSharedFile} />}

          {activeTab === 'ocr-qr' && <OcrSuite lang={lang} sharedFile={activeSharedFile} />}

          {activeTab === 'diff-suite' && <DiffSuite lang={lang} sharedFile={activeSharedFile} />}

          {activeTab === 'zip-suite' && <ZipSuite lang={lang} />}

          {activeTab === 'history' && (
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
          )}
        </main>

        {/* Bottom Features, Environment, How-To, and FAQ Section conforming to Reference HTML */}
        <div className="card">
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

      {/* Tutorial Modal */}
      {isTutorialOpen && (
        <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) setIsTutorialOpen(false); }}>
          <div className="modal-box">
            <div className="modal-header">
              <div className="modal-title">{lang === 'ja' ? '使い方ガイド（チュートリアル）' : 'Getting Started Guide'}</div>
              <button className="modal-close" onClick={() => setIsTutorialOpen(false)} aria-label="閉じる">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <ol style={{ paddingLeft: '18px', lineHeight: 1.7 }}>
                <li><strong>{lang === 'ja' ? '1. ファイルの読み込み:' : '1. Add Files:'}</strong> {lang === 'ja' ? '最上部の「1. 処理するファイルの読み込み・追加」から「ファイルを選択」「フォルダを選択」または「Google Driveから読込」でメディアやドキュメントを追加します。' : 'Add files via Section 1 above (File select, folder select, or Google Drive import).'}</li>
                <li><strong>{lang === 'ja' ? '2. 処理タブの選択:' : '2. Select Tool:'}</strong> {lang === 'ja' ? '左右スクロールボタン付きのタブバーから「変換」「PDF編集」「Office変換」「電子印鑑」「OCR」「差分比較」「ZIP」「履歴」など目的のツールを選択します。' : 'Choose your desired tool from the scrollable tab bar (Convert, PDF Toolkit, Office Suite, OCR, Diff Studio, ZIP, History, etc.).'}</li>
                <li><strong>{lang === 'ja' ? '3. 変換とリアルタイム進捗:' : '3. Convert:'}</strong> {lang === 'ja' ? '出力形式を設定して開始ボタンを押すと、リアルタイムに進捗パーセントが表示されます。' : 'Select target format and start conversion to view live progress.'}</li>
                <li><strong>{lang === 'ja' ? '4. 保存とGoogle Drive同期:' : '4. Save & Drive:'}</strong> {lang === 'ja' ? '完了後、個別保存、Google Driveへ直接同期、または「一括ZIPダウンロード」が可能です。' : 'Download individually, save to Google Drive, or batch download as a ZIP package.'}</li>
                <li><strong>{lang === 'ja' ? '5. 処理履歴の確認:' : '5. History:'}</strong> {lang === 'ja' ? '過去に変換・作成したファイルは、タブバー右端の「履歴」タブからいつでも再閲覧・再ダウンロード・再編集できます。' : 'Access previous processed files anytime via the rightmost "History" tab in the navigation bar.'}</li>
              </ol>
            </div>
            <div className="modal-footer">
              <button className="btn-sm btn-success" onClick={() => setIsTutorialOpen(false)}>OK</button>
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
                  <p><strong>{lang === 'ja' ? '第1条（適用）' : 'Article 1 (Scope of Application)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本利用規約（以下「本規約」）は、Universal Media & Document Studio Pro（以下「本ツール」）が提供するすべてのファイル変換、ドキュメント編集、メディア処理、および関連機能の利用条件を定めるものです。利用者は、本ツールを利用することにより本規約に同意したものとみなされます。'
                      : 'These Terms of Service govern the use of Universal Media & Document Studio Pro (the "Tool") and all associated conversion, editing, and media processing features. By accessing or using the Tool, you agree to be bound by these Terms.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第2条（完全ローカル処理と著作権等の遵守）' : 'Article 2 (Local Processing & Intellectual Property)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールはWebAssembly技術を活用し、利用者の端末ブラウザ内（クライアントサイド）でのみ処理を実行します。利用者は、著作権法および知的財産権関連法令を遵守し、自らが正当な権利を有するファイル、または権利者から適法な許諾を得たファイルのみを処理対象とするものとします。'
                      : 'The Tool operates 100% client-side within your browser using WebAssembly. Users must comply with applicable copyright and intellectual property laws and only process files they own or are legally authorized to convert.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第3条（禁止事項）' : 'Article 3 (Prohibited Conduct)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '利用者は、法令または公序良俗に反する行為、第三者の著作権・プライバシー権・肖像権を侵害する行為、不正なマルウェア等の生成や加工、および本ツールの正常な運営を妨げる行為を行ってはならないものとします。'
                      : 'Users shall not engage in unlawful acts, violate public order, infringe third-party intellectual property or privacy rights, generate malware, or interfere with the normal operation of the Tool.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第4条（免責事項）' : 'Article 4 (Disclaimer of Warranties & Liability)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールは現状有姿（AS-IS）で提供されます。開発者および運営者は、本ツールの利用または利用不能により生じたデータの破損、消失、端末の不具合、業務の中断等について、一切の損害賠償責任を負いません。重要なファイルは事前にバックアップを取った上でご利用ください。'
                      : 'The Tool is provided "AS-IS" without warranties of any kind. The developers and operators shall not be liable for any data loss, file corruption, device issues, or incidental damages arising from the use of the Tool.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '第5条（規約の改定）' : 'Article 5 (Modifications to Terms)'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本規約は、機能追加や法令の改正に伴い事前の告知なく改定されることがあります。改定後の規約は本ツール上に掲載された時点で効力を生じるものとします。'
                      : 'These Terms may be revised at any time without prior notice. Continued use of the Tool constitutes acceptance of the updated terms.'}
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
                  <p><strong>{lang === 'ja' ? '1. 完全ローカル処理の原則（ファイルデータの非送信）' : '1. 100% Client-Side Local Processing'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールは、動画・音声変換、PDF編集、Office文書変換、画像処理、OCR、差分比較、ZIP処理を含むすべてのデータ処理をお使いの端末ブラウザ内（WebAssembly / JavaScript）で完結して実行します。お客様が読み込んだファイルや変換結果が外部サーバーにアップロードまたは蓄積されることは一切ありません。'
                      : 'All operations—including video/audio conversion, PDF manipulation, Office documents, OCR, and ZIP archiving—run entirely inside your local web browser via WebAssembly. Your files are never uploaded or stored on any external server.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '2. Google Drive連携および直接通信' : '2. Google Drive Integration & Direct HTTPS'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? 'Google Drive連携をご利用の場合、Google公式のOAuth 2.0認証（Google Identity Services）を通じてユーザーのマイドライブとブラウザ間で直接通信（Direct HTTPS）を行います。認証トークンやファイルデータが第三者のサーバーに中継・保存されることはありません。'
                      : 'Google Drive integration utilizes official Google Identity Services (OAuth 2.0) for direct, encrypted client-to-Google communication. Access tokens and file contents are never transmitted to or processed by third-party servers.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '3. 個人情報およびトラッキングCookieの不保持' : '3. Zero Tracking Cookies & Personal Data Storage'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールは個人情報の収集や広告トラッキングを行いません。言語設定、テーマ、処理履歴等の設定情報はすべてお使いの端末（LocalStorage / IndexedDB）にのみ保存され、ユーザー自身の操作でいつでも消去できます。'
                      : 'The Tool does not collect personal data, telemetry, or tracking cookies. UI preferences, theme selection, and conversion history reside strictly in your browser (LocalStorage / IndexedDB) and can be cleared at any time.'}
                  </p>
                </div>
                <div>
                  <p><strong>{lang === 'ja' ? '4. セキュアなCDNリソース読み込み' : '4. Secure CDN Asset Delivery'}</strong></p>
                  <p className="text-slate-600 dark:text-slate-300">
                    {lang === 'ja'
                      ? '本ツールは動作に必要なWASMコアライブラリ等を安全なCDN経由でブラウザにキャッシュして読み込みますが、利用者のファイルデータがCDNに送信されることはありません。また「オフライン用パックを取得」により完全オフライン環境でも利用可能です。'
                      : 'WASM modules and libraries are delivered via secure CDNs and cached locally. No user data is sent to CDNs. Offline packs are also available for air-gapped environments.'}
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
