import React, { useState, useEffect, useRef } from 'react';
import {
  Code,
  Eye,
  Columns,
  Download,
  Copy,
  Check,
  FileCode,
  Sparkles,
  Smartphone,
  Tablet,
  Monitor,
  RefreshCw,
  FileDown,
  FileText,
  Wand2,
  Trash2,
  BookOpen,
  FileEdit,
} from 'lucide-react';
import { saveProcessedFile } from '../../utils/historyDb';
import { parseMarkdownToHtml } from '../../utils/markdownUtils';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

interface HtmlStudioProps {
  lang: 'ja' | 'en';
  sharedFile: File | null;
  onSaveToDrive?: (name: string, blob: Blob) => void;
  onShowToast?: (msg: string) => void;
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
  onSaveToDrive,
  onShowToast,
}) => {
  const [docType, setDocType] = useState<'html' | 'markdown'>('html');
  const [codeContent, setCodeContent] = useState<string>(DEFAULT_SIMPLE_HTML);
  const [fileName, setFileName] = useState<string>('document.html');
  const [viewMode, setViewMode] = useState<'split' | 'code' | 'preview'>('split');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isCopied, setIsCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
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

  // Load shared file if passed
  useEffect(() => {
    if (sharedFile) {
      const ext = sharedFile.name.split('.').pop()?.toLowerCase();
      if (['html', 'htm', 'md', 'markdown', 'txt'].includes(ext || '')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          if (content) {
            if (ext === 'md' || ext === 'markdown') {
              setDocType('markdown');
            } else {
              setDocType('html');
            }
            setCodeContent(content);
            setFileName(sharedFile.name);
            if (onShowToast) {
              onShowToast(
                lang === 'ja'
                  ? `「${sharedFile.name}」を読み込みました`
                  : `Loaded "${sharedFile.name}"`
              );
            }
          }
        };
        reader.readAsText(sharedFile);
      }
    }
  }, [sharedFile, lang]);

  const handleFileUpload = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
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
    saveProcessedFile(
      `${docType}_${Date.now()}`,
      fileName,
      downloadName,
      new TextEncoder().encode(codeContent).buffer as ArrayBuffer,
      docType,
      { characters: codeContent.length, lines: codeContent.split('\n').length }
    );

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
    <div className="w-full flex flex-col gap-4">
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
              <span>{lang === 'ja' ? 'ファイルを開く' : 'Open'}</span>
            </button>

            <button
              onClick={handleFormatCode}
              className="btn-header"
              title={lang === 'ja' ? 'コードを整形' : 'Format Code'}
            >
              <Wand2 className="w-3.5 h-3.5 text-purple-600" />
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
              className="w-full h-[460px] p-4 font-mono text-xs leading-relaxed bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 resize-none focus:outline-hidden"
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

            <div className="w-full h-[460px] bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-2 overflow-auto">
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

      {/* Export & Conversion Card */}
      <div className="card">
        <div className="section-title">
          <span className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-600" />
            <span>{lang === 'ja' ? '保存・変換エクスポート' : 'Export & Save Options'}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-2">
          {/* 1. Download HTML / MD */}
          <button
            onClick={handleDownloadFile}
            className="btn btn-primary flex items-center justify-center gap-2 py-3"
          >
            <Download className="w-4 h-4" />
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
            className="btn flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {isExportingPdf ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            <span>{lang === 'ja' ? 'PDF形式でエクスポート (.pdf)' : 'Export as High-Res PDF'}</span>
          </button>

          {/* 3. Extract Text */}
          <button
            onClick={handleExtractText}
            className="btn flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-800 text-white"
          >
            <FileText className="w-4 h-4" />
            <span>{lang === 'ja' ? 'プレーンテキスト保存 (.txt)' : 'Save Plain Text (.txt)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
