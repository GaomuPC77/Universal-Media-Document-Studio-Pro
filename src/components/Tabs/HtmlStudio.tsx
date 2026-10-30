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
  RotateCcw,
  History,
  Save,
  Clock,
  X,
  Search,
  ArrowDown,
  ArrowUp,
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
  const [lastSavedTime, setLastSavedTime] = useState<string>('');
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Find & Replace state
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historySnapshots, setHistorySnapshots] = useState<Array<{
    id: string;
    timestamp: number;
    docType: 'html' | 'markdown';
    fileName: string;
    content: string;
    snippet: string;
  }>>([]);

  // Load snapshots from localStorage
  const loadSnapshotsFromStorage = () => {
    try {
      const raw = localStorage.getItem('umc_html_studio_snapshots');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setHistorySnapshots(parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to parse html studio snapshots:', e);
    }
  };

  // Restore HTML/Markdown content from localStorage on mount or when backup restored
  useEffect(() => {
    try {
      const saved = localStorage.getItem('umc_html_studio_content');
      const savedType = localStorage.getItem('umc_html_studio_doctype') as 'html' | 'markdown' | null;
      const savedName = localStorage.getItem('umc_html_studio_filename');
      const savedTime = localStorage.getItem('umc_html_studio_updated_at');

      if (saved !== null && saved !== undefined) {
        setCodeContent(saved);
        if (savedType) setDocType(savedType);
        if (savedName) setFileName(savedName);
        if (savedTime) {
          const d = new Date(parseInt(savedTime, 10));
          setLastSavedTime(d.toLocaleTimeString());
        }
      }
      loadSnapshotsFromStorage();
    } catch (e) {
      console.warn('Could not restore HTML studio draft from localStorage:', e);
    }

    const handleDraftRestored = () => {
      try {
        const saved = localStorage.getItem('umc_html_studio_content');
        const savedType = localStorage.getItem('umc_html_studio_doctype') as 'html' | 'markdown' | null;
        const savedName = localStorage.getItem('umc_html_studio_filename');
        if (saved !== null && saved !== undefined) setCodeContent(saved);
        if (savedType) setDocType(savedType);
        if (savedName) setFileName(savedName);
        setLastSavedTime(new Date().toLocaleTimeString());
        loadSnapshotsFromStorage();
      } catch (e) {}
    };

    window.addEventListener('umc_html_draft_restored', handleDraftRestored);
    return () => window.removeEventListener('umc_html_draft_restored', handleDraftRestored);
  }, []);

  // Debounced auto-save to localStorage & periodic snapshot
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('umc_html_studio_content', codeContent);
        localStorage.setItem('umc_html_studio_doctype', docType);
        localStorage.setItem('umc_html_studio_filename', fileName);
        const now = Date.now();
        localStorage.setItem('umc_html_studio_updated_at', String(now));
        setLastSavedTime(new Date(now).toLocaleTimeString());

        // Save snapshot if meaningful content and changed
        if (codeContent && codeContent.trim().length > 10) {
          try {
            const raw = localStorage.getItem('umc_html_studio_snapshots');
            const list: Array<any> = raw ? JSON.parse(raw) : [];
            const lastOne = list[0];
            // Only add snapshot if content is different from last snapshot
            if (!lastOne || lastOne.content !== codeContent) {
              const snippet = codeContent.trim().substring(0, 100).replace(/\s+/g, ' ');
              const updated = [
                {
                  id: `snap_${now}`,
                  timestamp: now,
                  docType,
                  fileName,
                  content: codeContent,
                  snippet,
                },
                ...list.filter((s: any) => s.content !== codeContent),
              ].slice(0, 15); // keep last 15 versions
              localStorage.setItem('umc_html_studio_snapshots', JSON.stringify(updated));
              setHistorySnapshots(updated);
            }
          } catch (e) {}
        }
      } catch (e) {
        console.warn('Auto-save to localStorage failed:', e);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [codeContent, docType, fileName]);

  // Restore snapshot
  const handleRestoreSnapshot = (snap: { docType: 'html' | 'markdown'; fileName: string; content: string }) => {
    setCodeContent(snap.content);
    setDocType(snap.docType);
    setFileName(snap.fileName);
    setShowHistoryModal(false);
    if (onShowToast) {
      onShowToast(lang === 'ja' ? 'ローカル履歴から復元しました' : 'Restored from local version history');
    }
  };

  // Reset to default template
  const handleResetToTemplate = () => {
    if (docType === 'markdown') {
      setCodeContent(DEFAULT_SIMPLE_MD);
      setFileName('document.md');
    } else {
      setCodeContent(DEFAULT_SIMPLE_HTML);
      setFileName('document.html');
    }
    if (onShowToast) {
      onShowToast(lang === 'ja' ? '初期テンプレートに戻しました' : 'Reset to template');
    }
  };

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

  // Find & Replace match finding
  const getFindMatches = () => {
    if (!findQuery) return [];
    const source = isCaseSensitive ? codeContent : codeContent.toLowerCase();
    const target = isCaseSensitive ? findQuery : findQuery.toLowerCase();
    const indices: number[] = [];
    let pos = 0;
    while ((pos = source.indexOf(target, pos)) !== -1) {
      indices.push(pos);
      pos += target.length;
    }
    return indices;
  };

  const handleFindNext = () => {
    const matches = getFindMatches();
    if (matches.length === 0) return;
    const next = (currentMatchIdx + 1) % matches.length;
    setCurrentMatchIdx(next);
    const start = matches[next];
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start, start + findQuery.length);
    }
  };

  const handleFindPrev = () => {
    const matches = getFindMatches();
    if (matches.length === 0) return;
    const prev = (currentMatchIdx - 1 + matches.length) % matches.length;
    setCurrentMatchIdx(prev);
    const start = matches[prev];
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start, start + findQuery.length);
    }
  };

  const handleReplaceNext = () => {
    if (!findQuery) return;
    const matches = getFindMatches();
    if (matches.length === 0) {
      if (onShowToast) onShowToast(lang === 'ja' ? '一致する文字列がありません' : 'No matches found');
      return;
    }
    const idx = matches[currentMatchIdx % matches.length];
    const updated = codeContent.substring(0, idx) + replaceQuery + codeContent.substring(idx + findQuery.length);
    setCodeContent(updated);
    if (onShowToast) onShowToast(lang === 'ja' ? '1箇所を置換しました' : 'Replaced 1 match');
  };

  const handleReplaceAll = () => {
    if (!findQuery) return;
    const matches = getFindMatches();
    if (matches.length === 0) {
      if (onShowToast) onShowToast(lang === 'ja' ? '一致する文字列がありません' : 'No matches found');
      return;
    }
    let updated = '';
    if (isCaseSensitive) {
      updated = codeContent.split(findQuery).join(replaceQuery);
    } else {
      const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updated = codeContent.replace(new RegExp(escaped, 'gi'), replaceQuery);
    }
    setCodeContent(updated);
    if (onShowToast) onShowToast(lang === 'ja' ? `${matches.length} 箇所をすべて置換しました` : `Replaced all ${matches.length} matches`);
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

  const handleExportImage = async () => {
    setIsExportingPdf(true);
    if (onShowToast) {
      onShowToast(lang === 'ja' ? '高精細画像を生成中...' : 'Generating Image...');
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

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const imgName = `${fileName.replace(/\.[^/.]+$/, '')}.png`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = imgName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const arrayBuffer = await blob.arrayBuffer();
        await saveProcessedFile(`img_${Date.now()}`, fileName, imgName, arrayBuffer, 'png', { source: docType });

        if (onResultReady) {
          onResultReady({
            id: `res_htmlimg_${Date.now()}`,
            name: imgName,
            file: new File([blob], imgName, { type: 'image/png' }),
            size: blob.size,
            type: 'image/png',
            format: 'png',
            targetFormat: 'png',
            status: 'done',
            progress: 100,
            resultBlob: blob,
            resultName: imgName,
          });
        }

        if (onShowToast) {
          onShowToast(lang === 'ja' ? '画像(PNG)をエクスポートしました' : 'Exported image successfully');
        }
      }, 'image/png');
    } catch (e: any) {
      console.error('Image export error:', e);
      alert(lang === 'ja' ? '画像の生成に失敗しました' : 'Failed to export image');
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
              {lastSavedTime && (
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check className="w-3 h-3" />
                  <span>{lang === 'ja' ? `端末内ローカル保存中 (最終保存: ${lastSavedTime})` : `Autosaved locally (${lastSavedTime})`}</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center flex-wrap gap-2">
            <button
              onClick={() => {
                loadSnapshotsFromStorage();
                setShowHistoryModal(true);
              }}
              className="btn-header border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/30"
              title={lang === 'ja' ? 'ローカル保存履歴・いつでも復元' : 'Restore from Local Storage / History'}
            >
              <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
              <span>{lang === 'ja' ? 'ローカル復元' : 'Restore'}</span>
              {historySnapshots.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-bold ml-0.5">
                  {historySnapshots.length}
                </span>
              )}
            </button>

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
              onClick={() => setShowFindReplace((prev) => !prev)}
              className={`btn-header ${showFindReplace ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400' : ''}`}
              title={lang === 'ja' ? '文字列の検索・置換 (Ctrl+F)' : 'Find & Replace (Ctrl+F)'}
            >
              <Search className="w-3.5 h-3.5 text-blue-600" />
              <span>{lang === 'ja' ? '検索・置換' : 'Find / Replace'}</span>
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
        <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-0">
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <span>{lang === 'ja' ? '読み込み済みHTML/Webファイルを選択:' : 'Select Target HTML/Web File:'}</span>
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
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__upload_new__') {
                  fileInputRef.current?.click();
                  return;
                }
                handleSelectFromQueue(val);
              }}
              className="main-select text-xs mb-0"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたHTML/Webファイルを選択 --' : '-- Select Uploaded HTML/Web File --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいHTML/ファイルを端末からアップロード...' : '📁 + Upload New HTML/File...'}
              </option>
              {fileList
                .filter((f) =>
                  ['html', 'htm', 'md', 'markdown', 'txt'].includes(f.format?.toLowerCase() || '') ||
                  /\.(html|htm|md|markdown|txt)$/i.test(f.name)
                )
                .map((f) => (
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
                {fileList
                  .filter((f) =>
                    ['html', 'htm', 'md', 'markdown', 'txt'].includes(f.format?.toLowerCase() || '') ||
                    /\.(html|htm|md|markdown|txt)$/i.test(f.name)
                  )
                  .map((f) => {
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFindReplace((prev) => !prev)}
                  className={`px-2 py-1 text-xs rounded-md border flex items-center gap-1 font-semibold transition ${
                    showFindReplace
                      ? 'bg-blue-50 dark:bg-blue-950 border-blue-400 text-blue-600 dark:text-blue-400'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400'
                  }`}
                  title={lang === 'ja' ? '文字列の検索・置換 (Ctrl+F)' : 'Find & Replace (Ctrl+F)'}
                >
                  <Search className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{lang === 'ja' ? '検索・置換' : 'Find / Replace'}</span>
                </button>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="text-xs px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 max-w-[140px]"
                  title="File Name"
                />
              </div>
            </div>

            {/* Interactive Find & Replace Bar */}
            {showFindReplace && (
              <div className="p-3 bg-blue-50/70 dark:bg-slate-900 border-b border-blue-200 dark:border-slate-700 flex flex-col gap-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={findQuery}
                        onChange={(e) => {
                          setFindQuery(e.target.value);
                          setCurrentMatchIdx(0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (e.shiftKey) handleFindPrev();
                            else handleFindNext();
                          }
                        }}
                        placeholder={lang === 'ja' ? '検索する文字列...' : 'Find text...'}
                        className="w-full px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 pr-16"
                        autoFocus
                      />
                      <span className="absolute right-2 top-1.5 text-[10px] text-slate-500 font-mono">
                        {findQuery ? `${getFindMatches().length} ${lang === 'ja' ? '件' : 'matches'}` : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleFindPrev}
                        disabled={getFindMatches().length === 0}
                        className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        title={lang === 'ja' ? '前の一致 (Shift+Enter)' : 'Previous Match (Shift+Enter)'}
                      >
                        <ArrowUp className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                      </button>
                      <button
                        onClick={handleFindNext}
                        disabled={getFindMatches().length === 0}
                        className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        title={lang === 'ja' ? '次の一致 (Enter)' : 'Next Match (Enter)'}
                      >
                        <ArrowDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={isCaseSensitive}
                      onChange={(e) => setIsCaseSensitive(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 cursor-pointer"
                    />
                    <span>{lang === 'ja' ? '大文字/小文字を区別' : 'Match Case'}</span>
                  </label>

                  <button
                    onClick={() => setShowFindReplace(false)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                    placeholder={lang === 'ja' ? '置換後の文字列...' : 'Replace with...'}
                    className="flex-1 min-w-[200px] px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                  />
                  <button
                    onClick={handleReplaceNext}
                    disabled={!findQuery || getFindMatches().length === 0}
                    className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:border-blue-400 disabled:opacity-40 whitespace-nowrap"
                  >
                    {lang === 'ja' ? '置換' : 'Replace'}
                  </button>
                  <button
                    onClick={handleReplaceAll}
                    disabled={!findQuery || getFindMatches().length === 0}
                    className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs disabled:opacity-40 whitespace-nowrap"
                  >
                    {lang === 'ja' ? 'すべて置換' : 'Replace All'}
                  </button>
                </div>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={codeContent}
              onChange={(e) => setCodeContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                  e.preventDefault();
                  setShowFindReplace(true);
                }
              }}
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

        <div className="btn-group-equal grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-2 items-stretch">
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
            <span>{lang === 'ja' ? '高精細PDF出力 (.pdf)' : 'Export as High-Res PDF'}</span>
          </button>

          {/* 3. Export as Image (PNG) */}
          <button
            onClick={handleExportImage}
            disabled={isExportingPdf}
            className="btn h-full min-h-[52px] m-0 py-2.5 px-4 flex items-center justify-center gap-2 text-center bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white disabled:opacity-50"
          >
            {isExportingPdf ? <RefreshCw className="w-4 h-4 animate-spin shrink-0" /> : <FileDown className="w-4 h-4 shrink-0" />}
            <span>{lang === 'ja' ? '画像として出力 (.png)' : 'Export as Image (.png)'}</span>
          </button>

          {/* 4. Extract Text */}
          <button
            onClick={handleExtractText}
            className="btn h-full min-h-[52px] m-0 py-2.5 px-4 flex items-center justify-center gap-2 text-center bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white"
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>{lang === 'ja' ? 'テキスト抽出 (.txt)' : 'Save Plain Text (.txt)'}</span>
          </button>
        </div>
      </div>

      {/* Local Storage Version History & Restore Modal */}
      {showHistoryModal && (
        <div
          className="fixed inset-0 z-[9999] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowHistoryModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {lang === 'ja' ? 'ローカル保存履歴・いつでも復元' : 'Local Draft History & Restore'}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {lang === 'ja'
                      ? 'ブラウザ内のローカルストレージに自動保存された過去のスナップショットから復元できます。'
                      : 'Restore any previous autosaved version preserved in your browser local storage.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {historySnapshots.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                {lang === 'ja' ? '保存されている履歴スナップショットはありません。' : 'No saved snapshots yet.'}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {historySnapshots.map((snap) => {
                  const dateStr = new Date(snap.timestamp).toLocaleString();
                  return (
                    <div
                      key={snap.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:border-blue-300 dark:hover:border-blue-700 transition flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                            {snap.fileName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold uppercase">
                            {snap.docType}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {dateStr}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
                          {snap.snippet || '(空のコンテンツ)'}
                        </p>
                      </div>

                      <button
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="btn-sm btn-primary shrink-0 flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? 'この版を復元' : 'Restore'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('umc_html_studio_snapshots');
                    setHistorySnapshots([]);
                    if (onShowToast) onShowToast(lang === 'ja' ? '履歴をクリアしました' : 'Cleared history');
                  } catch (e) {}
                }}
                className="text-slate-400 hover:text-rose-600 transition"
              >
                {lang === 'ja' ? '履歴スナップショットを全消去' : 'Clear All Snapshots'}
              </button>

              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {lang === 'ja' ? '閉じる' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
