import React, { useState, useEffect, useRef } from 'react';
import {
  Code,
  Eye,
  Columns,
  Download,
  Copy,
  Check,
  FileCode,
  Smartphone,
  Tablet,
  Monitor,
  RefreshCw,
  FileDown,
  FileText,
  Trash2,
  BookOpen,
  FileEdit,
  Maximize2,
  Minimize2,
  ExternalLink,
  Layers,
  Plus,
} from 'lucide-react';
import { saveProcessedFile } from '../../utils/historyDb';
import { parseMarkdownToHtml } from '../../utils/markdownUtils';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { FileItem } from '../../types';

interface HtmlStudioProps {
  lang: 'ja' | 'en';
  sharedFile: File | null;
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onSaveToDrive?: (name: string, blob: Blob) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

const DEFAULT_SIMPLE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Document</title>
</head>
<body>
  <h1>タイトル</h1>
  <p>ここに内容を入力してください。</p>
</body>
</html>`;

const DEFAULT_SIMPLE_MD = `# タイトル

ここに内容を入力してください。
`;

export const HtmlStudio: React.FC<HtmlStudioProps> = ({
  lang,
  sharedFile,
  fileList = [],
  onResultReady,
  onSaveToDrive,
  onShowToast,
  onAddFiles,
}) => {
  const [docType, setDocType] = useState<'html' | 'markdown'>('html');
  const [codeContent, setCodeContent] = useState<string>(DEFAULT_SIMPLE_HTML);
  const [fileName, setFileName] = useState<string>('document.html');
  const [selectedQueueFileId, setSelectedQueueFileId] = useState<string>('');
  const [selectedQueueFileIds, setSelectedQueueFileIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'split' | 'code' | 'preview'>('split');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isCopied, setIsCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingPromptFile, setPendingPromptFile] = useState<File | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Switch docType
  const handleSwitchDocType = (type: 'html' | 'markdown') => {
    if (type === docType) return;
    setDocType(type);
    if (type === 'markdown') {
      setFileName(fileName.replace(/\.html?$/i, '') + '.md');
      setCodeContent(DEFAULT_SIMPLE_MD);
    } else {
      setFileName(fileName.replace(/\.md$/i, '') + '.html');
      setCodeContent(DEFAULT_SIMPLE_HTML);
    }
  };

  // Open preview in a new browser tab
  const handleOpenInNewTab = () => {
    try {
      const html = getRenderedHtml();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? '新しいブラウザタブで全画面プレビューを開きました' : 'Opened preview in new tab');
      }
    } catch (e) {
      console.error('Failed to open preview in new tab:', e);
    }
  };

  // Load a file into editor
  const loadFileContentIntoEditor = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content !== undefined) {
        if (ext === 'md' || ext === 'markdown') {
          setDocType('markdown');
        } else {
          setDocType('html');
        }
        setCodeContent(content);
        setFileName(file.name);
        if (onShowToast) {
          onShowToast(lang === 'ja' ? `「${file.name}」を読み込みました` : `Loaded "${file.name}"`);
        }
      }
    };
    reader.readAsText(file);
  };

  // Handle local upload - prompts user whether to add to global queue
  const handleFileUpload = (file: File) => {
    setPendingPromptFile(file);
  };

  const handleConfirmAddToQueue = () => {
    if (!pendingPromptFile) return;
    loadFileContentIntoEditor(pendingPromptFile);
    if (onAddFiles) {
      onAddFiles([pendingPromptFile]);
    } else if (onResultReady) {
      const ext = pendingPromptFile.name.split('.').pop()?.toLowerCase() || 'html';
      onResultReady({
        id: `file_${Date.now()}`,
        name: pendingPromptFile.name,
        size: pendingPromptFile.size,
        type: pendingPromptFile.type,
        format: ext as any,
        targetFormat: ext === 'md' ? 'html' : 'pdf',
        status: 'idle',
        progress: 0,
        file: pendingPromptFile,
      });
    }
    if (onShowToast) {
      onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
    }
    setPendingPromptFile(null);
  };

  const handleDismissAddToQueue = () => {
    if (!pendingPromptFile) return;
    loadFileContentIntoEditor(pendingPromptFile);
    setPendingPromptFile(null);
  };

  // Handle single select from global queue
  const handleSelectFromQueue = (fileId: string) => {
    setSelectedQueueFileId(fileId);
    if (!fileId) return;
    const found = fileList.find((f) => f.id === fileId);
    if (found && found.file) {
      loadFileContentIntoEditor(found.file);
    }
  };

  // Handle multiple select & combine from global queue
  const handleToggleMultiSelectQueue = (fileId: string) => {
    setSelectedQueueFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const handleCombineSelectedQueueFiles = async () => {
    if (selectedQueueFileIds.length === 0) return;
    const selectedItems = fileList.filter((f) => selectedQueueFileIds.includes(f.id) && f.file);
    if (selectedItems.length === 0) return;

    let combinedText = '';
    for (const item of selectedItems) {
      const txt = await item.file.text();
      if (docType === 'markdown') {
        combinedText += `\n\n---\n# ${item.name}\n\n${txt}`;
      } else {
        combinedText += `\n<!-- Section: ${item.name} -->\n<section style="margin-bottom:32px; border-bottom:1px dashed #ccc; padding-bottom:16px;">\n<h2>${item.name}</h2>\n${txt}\n</section>`;
      }
    }

    if (docType === 'html' && !combinedText.includes('<!DOCTYPE html>')) {
      combinedText = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Combined Documents</title></head><body>${combinedText}</body></html>`;
    }

    setCodeContent(combinedText.trim());
    setFileName(`combined_${selectedItems.length}_files.${docType === 'markdown' ? 'md' : 'html'}`);
    if (onShowToast) {
      onShowToast(lang === 'ja' ? `${selectedItems.length} 件のファイルを結合して読み込みました` : `Combined ${selectedItems.length} files`);
    }
  };

  // Load shared file if passed
  useEffect(() => {
    if (sharedFile) {
      const ext = sharedFile.name.split('.').pop()?.toLowerCase();
      if (['html', 'htm', 'md', 'markdown', 'txt'].includes(ext || '')) {
        loadFileContentIntoEditor(sharedFile);
      }
    }
  }, [sharedFile, lang]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? 'クリップボードにコピーしました' : 'Copied to clipboard');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClear = () => {
    setCodeContent('');
    if (onShowToast) {
      onShowToast(lang === 'ja' ? 'エディタをクリアしました' : 'Cleared editor');
    }
  };

  // Get rendered HTML string
  const getRenderedHtml = () => {
    if (docType === 'markdown') {
      return parseMarkdownToHtml(codeContent);
    }
    return codeContent;
  };

  const handleDownloadFile = () => {
    const isMd = docType === 'markdown';
    const mime = isMd ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8';
    const blob = new Blob([codeContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    let downloadName = fileName;
    if (isMd && !downloadName.endsWith('.md')) {
      downloadName = `${downloadName.replace(/\.[^/.]+$/, '')}.md`;
    } else if (!isMd && !downloadName.endsWith('.html') && !downloadName.endsWith('.htm')) {
      downloadName = `${downloadName.replace(/\.[^/.]+$/, '')}.html`;
    }
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Save to history
    const buffer = new TextEncoder().encode(codeContent).buffer as ArrayBuffer;
    saveProcessedFile(
      `${docType}_${Date.now()}`,
      fileName,
      downloadName,
      buffer,
      docType,
      { characters: codeContent.length, lines: codeContent.split('\n').length }
    );

    if (onResultReady) {
      onResultReady({
        id: `res_html_${Date.now()}`,
        name: downloadName,
        file: new File([blob], downloadName, { type: blob.type }),
        size: blob.size,
        type: blob.type,
        format: docType as any,
        targetFormat: docType as any,
        status: 'done',
        progress: 100,
        resultBlob: blob,
        resultName: downloadName,
      });
    }

    if (onShowToast) {
      onShowToast(
        lang === 'ja'
          ? `「${downloadName}」をダウンロードしました`
          : `Downloaded "${downloadName}"`
      );
    }
  };

  const handleFormatCode = () => {
    if (docType === 'markdown') {
      // Clean up multiple empty lines
      const formatted = codeContent.replace(/\n{3,}/g, '\n\n').trim() + '\n';
      setCodeContent(formatted);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? 'Markdownを整形しました' : 'Formatted Markdown');
      }
    } else {
      try {
        let formatted = '';
        let indent = '';
        const tab = '  ';
        codeContent.split(/>\s*</).forEach((element) => {
          if (element.match(/^\/\w/)) {
            indent = indent.substring(tab.length);
          }
          formatted += indent + '<' + element + '>\r\n';
          if (
            element.match(/^<?\w[^>]*[^\/]$/) &&
            !element.startsWith('input') &&
            !element.startsWith('img') &&
            !element.startsWith('br') &&
            !element.startsWith('hr') &&
            !element.startsWith('meta') &&
            !element.startsWith('link')
          ) {
            indent += tab;
          }
        });
        const clean = formatted.substring(1, formatted.length - 3);
        if (clean && clean.length > 10) {
          setCodeContent(clean);
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'コードを整形しました' : 'Formatted HTML');
          }
        }
      } catch (e) {
        console.warn('Format error:', e);
      }
    }
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    if (onShowToast) {
      onShowToast(lang === 'ja' ? '高精細PDFを生成中...' : 'Generating PDF...');
    }

    try {
      const renderHtml = getRenderedHtml();
      const renderContainer = document.createElement('div');
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      renderContainer.style.top = '0';
      renderContainer.style.width = '960px';
      renderContainer.style.background = '#ffffff';
      renderContainer.style.color = '#000000';
      renderContainer.innerHTML = renderHtml;
      document.body.appendChild(renderContainer);

      const canvas = await html2canvas(renderContainer, {
        scale: 2,
        useCORS: true,
        logging: false,
      });
      document.body.removeChild(renderContainer);

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2],
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2);
      const pdfBlob = pdf.output('blob');
      const pdfName = `${fileName.replace(/\.[^/.]+$/, '')}.pdf`;

      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Save to history
      const arrayBuffer = await pdfBlob.arrayBuffer();
      saveProcessedFile(
        `pdf_${Date.now()}`,
        fileName,
        pdfName,
        arrayBuffer,
        'pdf',
        { source: docType }
      );

      if (onResultReady) {
        onResultReady({
          id: `res_htmlpdf_${Date.now()}`,
          name: pdfName,
          file: new File([pdfBlob], pdfName, { type: 'application/pdf' }),
          size: pdfBlob.size,
          type: 'application/pdf',
          format: 'pdf',
          targetFormat: 'pdf',
          status: 'done',
          progress: 100,
          resultBlob: pdfBlob,
          resultName: pdfName,
        });
      }

      if (onShowToast) {
        onShowToast(lang === 'ja' ? 'PDFをエクスポートしました' : 'Exported to PDF successfully');
      }
    } catch (e: any) {
      console.error('PDF export error:', e);
      alert(lang === 'ja' ? 'PDFの生成に失敗しました' : 'Failed to export PDF');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExtractText = () => {
    let plainText = codeContent;
    if (docType === 'html') {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = codeContent;
      plainText = tempDiv.textContent || tempDiv.innerText || '';
    } else {
      // Strip markdown symbols
      plainText = codeContent
        .replace(/^#+\s+/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`{1,3}(.*?)`{1,3}/gs, '$1')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1');
    }
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.[^/.]+$/, '')}_text.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (onShowToast) {
      onShowToast(lang === 'ja' ? 'テキストを抽出・保存しました' : 'Extracted plain text');
    }
  };

  const handleInsertSnippet = (snippet: string) => {
    setCodeContent((prev) => (prev ? prev + '\n' + snippet : snippet));
    if (onShowToast) {
      onShowToast(lang === 'ja' ? '挿入しました' : 'Inserted');
    }
  };

  const renderedHtml = getRenderedHtml();

  return (
    <div className={`w-full flex flex-col gap-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-100 dark:bg-slate-950 p-4 overflow-y-auto max-h-screen' : ''}`}>
      {/* Local Upload -> Global Queue Prompt Dialog */}
      {pendingPromptFile && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                  {lang === 'ja' ? 'キューへの追加確認' : 'Add to Status Queue?'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 font-mono">
                  {pendingPromptFile.name} ({(pendingPromptFile.size / 1024).toFixed(1)} KB)
                </p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {lang === 'ja'
                ? 'アップロードしたファイルを「変換・処理ステータス（全体キュー）」にも追加しますか？追加すると、他のタブや一括ダウンロードでも利用できるようになります。'
                : 'Would you like to add this uploaded file to the global Conversion/Processing Status queue as well?'}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={handleDismissAddToQueue}
                className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                {lang === 'ja' ? 'このタブのみで使用' : 'Use in this tab only'}
              </button>
              <button
                onClick={handleConfirmAddToQueue}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '全体キューにも追加' : 'Add to Global Queue'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Toolbar Card */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-600 dark:text-orange-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                {lang === 'ja' ? 'HTML・マークダウン スタジオ' : 'HTML & Markdown Studio'}
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800/40">
                  {codeContent.length.toLocaleString()} {lang === 'ja' ? '文字' : 'chars'}
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'ja'
                  ? 'HTMLおよびMarkdownのリアルタイム編集、安全なサンドボックスプレビュー、PDF書き出しを端末内で完結。'
                  : 'Real-time HTML & Markdown editing, sandboxed live preview, and PDF export.'}
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center flex-wrap gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".html,.htm,.md,.markdown,.txt"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileUpload(e.target.files[0]);
                  e.target.value = '';
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-header"
              title={lang === 'ja' ? 'ファイルを開く' : 'Open File'}
            >
              <FileEdit className="w-3.5 h-3.5 text-blue-600" />
              <span>{lang === 'ja' ? '開く' : 'Open'}</span>
            </button>

            <button
              onClick={handleOpenInNewTab}
              className="btn-header"
              title={lang === 'ja' ? '別のブラウザタブで全画面プレビュー' : 'Preview in New Tab'}
            >
              <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
              <span>{lang === 'ja' ? '別タブ表示' : 'New Tab'}</span>
            </button>

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="btn-header"
              title={isFullscreen ? (lang === 'ja' ? '全画面解除' : 'Exit Fullscreen') : (lang === 'ja' ? '全画面表示' : 'Fullscreen')}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-indigo-600" /> : <Maximize2 className="w-3.5 h-3.5 text-indigo-600" />}
              <span>{isFullscreen ? (lang === 'ja' ? '縮小' : 'Exit') : (lang === 'ja' ? '全画面' : 'Expand')}</span>
            </button>

            <button
              onClick={handleFormatCode}
              className="btn-header"
              title={lang === 'ja' ? 'コードを整形' : 'Format Code'}
            >
              <FileCode className="w-3.5 h-3.5 text-blue-600" />
              <span>{lang === 'ja' ? '整形' : 'Format'}</span>
            </button>

            <button
              onClick={handleClear}
              className="btn-header text-slate-500 hover:text-rose-600"
              title={lang === 'ja' ? '内容をクリア' : 'Clear Text'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'クリア' : 'Clear'}</span>
            </button>

            <button
              onClick={handleCopyCode}
              className="btn-header"
              title={lang === 'ja' ? 'コードをコピー' : 'Copy Code'}
            >
              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{isCopied ? (lang === 'ja' ? 'コピー完了' : 'Copied') : lang === 'ja' ? 'コピー' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Global Queue File Selection & Multi-select Bar */}
        {fileList.length > 0 && (
          <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-0">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>{lang === 'ja' ? '読み込み済みファイルから選択して開く:' : 'Select from Loaded Queue:'}</span>
              </label>

              {selectedQueueFileIds.length > 1 && (
                <button
                  onClick={handleCombineSelectedQueueFiles}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? `${selectedQueueFileIds.length} 件を結合して読み込む` : `Combine ${selectedQueueFileIds.length} files`}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Single Select Dropdown */}
              <select
                value={selectedQueueFileId}
                onChange={(e) => handleSelectFromQueue(e.target.value)}
                className="main-select text-xs mb-0"
              >
                <option value="">{lang === 'ja' ? '-- 単一ファイルを選択して読み込み --' : '-- Select Single File --'}</option>
                {fileList.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} (.{f.format})
                  </option>
                ))}
              </select>

              {/* Multi-select Chips list */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 text-xs">
                <span className="text-[11px] text-slate-500 whitespace-nowrap font-medium mr-1">
                  {lang === 'ja' ? '複数選択:' : 'Multi:'}
                </span>
                {fileList.map((f) => {
                  const isSel = selectedQueueFileIds.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => handleToggleMultiSelectQueue(f.id)}
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap ${
                        isSel
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                      }`}
                    >
                      {f.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Mode Selector & View Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          {/* Format Switcher (HTML vs Markdown) */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700/60">
            <button
              onClick={() => handleSwitchDocType('html')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                docType === 'html'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>HTML</span>
            </button>
            <button
              onClick={() => handleSwitchDocType('markdown')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                docType === 'markdown'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Markdown</span>
            </button>
          </div>

          {/* View Modes (Split / Code / Preview) */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700/60">
            <button
              onClick={() => setViewMode('split')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                viewMode === 'split'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? '2分割' : 'Split'}</span>
            </button>

            <button
              onClick={() => setViewMode('code')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                viewMode === 'code'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'エディタ' : 'Editor'}</span>
            </button>

            <button
              onClick={() => setViewMode('preview')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                viewMode === 'preview'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'プレビュー' : 'Preview'}</span>
            </button>
          </div>

          {/* Device Responsive Controls (When Preview is shown) */}
          {viewMode !== 'code' && (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700/60">
              <button
                onClick={() => setPreviewDevice('desktop')}
                className={`p-1.5 rounded-md transition-colors ${
                  previewDevice === 'desktop'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Desktop View (100%)"
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPreviewDevice('tablet')}
                className={`p-1.5 rounded-md transition-colors ${
                  previewDevice === 'tablet'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Tablet View (768px)"
              >
                <Tablet className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPreviewDevice('mobile')}
                className={`p-1.5 rounded-md transition-colors ${
                  previewDevice === 'mobile'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Mobile View (375px)"
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Studio Area (Editor & Live Preview) */}
      <div
        className={`grid gap-4 w-full ${
          viewMode === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {/* Left: Code Editor */}
        {(viewMode === 'split' || viewMode === 'code') && (
          <div className="card flex flex-col gap-2 p-0 overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  {docType === 'markdown' ? 'Markdown Source' : 'HTML Source'}
                </span>
              </div>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="text-xs px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 max-w-[160px]"
                title="File Name"
              />
            </div>
            <textarea
              value={codeContent}
              onChange={(e) => setCodeContent(e.target.value)}
              placeholder={docType === 'markdown' ? '# タイトル\n\nここに記述...' : '<html>...</html>'}
              spellCheck={false}
              className={`w-full ${isFullscreen ? 'h-[620px]' : 'h-[460px]'} p-4 font-mono text-xs leading-relaxed bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 resize-none focus:outline-hidden`}
              style={{ tabSize: 2 }}
            />
            {/* Quick Snippets Bar */}
            <div className="flex items-center flex-wrap gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-xs">
              <span className="text-slate-400 text-[11px] font-medium mr-1">{lang === 'ja' ? '挿入:' : 'Insert:'}</span>
              {docType === 'markdown' ? (
                <>
                  <button
                    onClick={() => handleInsertSnippet('## 見出し2')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + H2
                  </button>
                  <button
                    onClick={() => handleInsertSnippet('- リスト項目')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + List
                  </button>
                  <button
                    onClick={() => handleInsertSnippet('> 引用文')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + Quote
                  </button>
                  <button
                    onClick={() => handleInsertSnippet('```js\nconsole.log("Hello");\n```')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + Code Block
                  </button>
                  <button
                    onClick={() => handleInsertSnippet('| 項目 | 値 |\n|---|---|\n| データ1 | データ2 |')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + Table
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleInsertSnippet('<button>Click Me</button>')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + Button
                  </button>
                  <button
                    onClick={() => handleInsertSnippet('<div><h3>Title</h3><p>Description</p></div>')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + Card
                  </button>
                  <button
                    onClick={() => handleInsertSnippet('<table><tr><th>Col 1</th></tr><tr><td>Val 1</td></tr></table>')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 text-[11px]"
                  >
                    + Table
                  </button>
                  <button
                    onClick={() => handleInsertSnippet('<script src="https://cdn.tailwindcss.com"></script>')}
                    className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:border-blue-400 text-[11px]"
                  >
                    + Tailwind CDN
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Right: Live Sandboxed Preview */}
        {(viewMode === 'split' || viewMode === 'preview') && (
          <div className="card flex flex-col gap-2 p-0 overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  {docType === 'markdown'
                    ? lang === 'ja'
                      ? 'Markdown レンダリング'
                      : 'Markdown Live Render'
                    : lang === 'ja'
                    ? 'HTML ライブプレビュー'
                    : 'HTML Live Preview'}
                </span>
              </div>
              <button
                onClick={() => {
                  if (iframeRef.current) {
                    iframeRef.current.srcdoc = renderedHtml;
                  }
                }}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                title="Reload Preview"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className={`w-full ${isFullscreen ? 'h-[620px]' : 'h-[460px]'} bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-2 overflow-auto`}>
              <div
                style={{
                  width:
                    previewDevice === 'mobile'
                      ? '375px'
                      : previewDevice === 'tablet'
                      ? '768px'
                      : '100%',
                  height: '100%',
                  transition: 'width 0.25s ease-in-out',
                }}
                className="bg-white rounded-lg shadow-sm border border-slate-300 dark:border-slate-800 overflow-hidden flex flex-col"
              >
                <iframe
                  ref={iframeRef}
                  title="Live Preview"
                  srcDoc={renderedHtml}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  className="w-full h-full border-none bg-white"
                />
              </div>
            </div>

            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <span>{lang === 'ja' ? '🔒 端末内サンドボックス表示' : '🔒 Secure Sandboxed Render'}</span>
              <span>{previewDevice.toUpperCase()} ({previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%'})</span>
            </div>
          </div>
        )}
      </div>

      {/* Export & Conversion Card - Uniform button heights without vertical offsets */}
      <div className="card">
        <div className="section-title">
          <span className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-600" />
            <span>{lang === 'ja' ? '保存・変換エクスポート' : 'Export & Save Options'}</span>
          </span>
        </div>

        <div className="btn-group-equal grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-2 items-stretch">
          {/* 1. Download HTML / MD */}
          <button
            onClick={handleDownloadFile}
            className="btn btn-primary h-full min-h-[52px] m-0 py-2.5 px-4 flex items-center justify-center gap-2 text-center"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>
              {docType === 'markdown'
                ? lang === 'ja'
                  ? 'Markdownを保存 (.md)'
                  : 'Save Markdown (.md)'
                : lang === 'ja'
                ? 'HTMLファイルを保存 (.html)'
                : 'Download HTML (.html)'}
            </span>
          </button>

          {/* 2. Export as PDF */}
          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="btn h-full min-h-[52px] m-0 py-2.5 px-4 flex items-center justify-center gap-2 text-center bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white disabled:opacity-50"
          >
            {isExportingPdf ? <RefreshCw className="w-4 h-4 animate-spin shrink-0" /> : <FileDown className="w-4 h-4 shrink-0" />}
            <span>{lang === 'ja' ? 'PDF形式でエクスポート (.pdf)' : 'Export as High-Res PDF'}</span>
          </button>

          {/* 3. Extract Text */}
          <button
            onClick={handleExtractText}
            className="btn h-full min-h-[52px] m-0 py-2.5 px-4 flex items-center justify-center gap-2 text-center bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white"
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>{lang === 'ja' ? 'プレーンテキスト保存 (.txt)' : 'Save Plain Text (.txt)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
