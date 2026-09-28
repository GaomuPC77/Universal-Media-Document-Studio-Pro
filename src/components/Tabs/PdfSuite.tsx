import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Upload,
  Plus,
  Trash2,
  RotateCw,
  Scissors,
  Layers,
  Stamp,
  Hash,
  Download,
  CheckCircle2,
  RefreshCw,
  Eye,
  ShieldCheck,
  FileCheck,
} from 'lucide-react';
import { PdfPageInfo } from '../../types';
import { getPdfPages, mergePdfs, manipulatePdfPages, enhancePdf, extractPdfText, convertPdfToImages } from '../../utils/pdfUtils';
import { createZipArchive } from '../../utils/zipUtils';
import { saveProcessedFile } from '../../utils/historyDb';

interface PdfSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
}

export const PdfSuite: React.FC<PdfSuiteProps> = ({ lang, sharedFile }) => {
  const [activeSubTab, setActiveSubTab] = useState<'organize' | 'merge' | 'split' | 'watermark' | 'numbering'>('organize');

  // State for Organize / Delete / Rotate
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PdfPageInfo[]>([]);
  const [pageRotations, setPageRotations] = useState<{ [index: number]: number }>({});
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // State for Merge
  const [mergeFiles, setMergeFiles] = useState<{ id: string; file: File; name: string; size: number }[]>([]);

  // State for Split
  const [splitRange, setSplitRange] = useState<string>('1-2, 3-4');
  const [splitEveryN, setSplitEveryN] = useState<number>(1);

  // State for Watermark
  const [watermarkText, setWatermarkText] = useState<string>('CONFIDENTIAL');
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(0.2);
  const [watermarkAngle, setWatermarkAngle] = useState<number>(45);
  const [watermarkFontSize, setWatermarkFontSize] = useState<number>(48);

  // State for Page Numbering
  const [numFormat, setNumFormat] = useState<'page_of_total' | 'page_only' | 'dash_page_dash'>('page_of_total');
  const [numPosition, setNumPosition] = useState<'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-center'>('bottom-center');
  const [numStart, setNumStart] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  // Load PDF for Page Organizer
  const handleLoadPdf = async (file: File) => {
    setCurrentFile(file);
    setIsLoadingPages(true);
    setSelectedPages(new Set());
    setPageRotations({});
    try {
      const loadedPages = await getPdfPages(file);
      setPages(loadedPages);
    } catch (err) {
      console.error('Failed to load PDF pages:', err);
    } finally {
      setIsLoadingPages(false);
    }
  };

  // Auto load sharedFile when dropped
  useEffect(() => {
    if (sharedFile) {
      if (sharedFile.name.toLowerCase().endsWith('.pdf') || sharedFile.type === 'application/pdf') {
        handleLoadPdf(sharedFile);
        setMergeFiles((prev) => {
          if (prev.some((m) => m.name === sharedFile.name && m.size === sharedFile.size)) return prev;
          return [...prev, { id: `m_${Date.now()}`, file: sharedFile, name: sharedFile.name, size: sharedFile.size }];
        });
      }
    }
  }, [sharedFile]);

  // Toggle page selection for deletion / export
  const togglePageSelection = (pageNumber: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNumber)) {
        next.delete(pageNumber);
      } else {
        next.add(pageNumber);
      }
      return next;
    });
  };

  // Rotate a specific page
  const rotatePage = (pageNumber: number) => {
    const zeroIndex = pageNumber - 1;
    setPageRotations((prev) => ({
      ...prev,
      [zeroIndex]: ((prev[zeroIndex] || 0) + 90) % 360,
    }));
  };

  // Rotate all pages
  const rotateAllPages = (angle: number) => {
    const newRotations: { [idx: number]: number } = {};
    pages.forEach((_, idx) => {
      newRotations[idx] = ((pageRotations[idx] || 0) + angle) % 360;
    });
    setPageRotations(newRotations);
  };

  // Export modified PDF (applying deletions and rotations)
  const handleExportOrganizedPdf = async () => {
    if (!currentFile) return;
    setIsProcessing(true);
    try {
      const fileBuffer = await currentFile.arrayBuffer();
      // Keep pages that are NOT selected for deletion
      const indicesToKeep = pages
        .map((p, idx) => ({ pageNum: p.pageNumber, idx }))
        .filter((item) => !selectedPages.has(item.pageNum))
        .map((item) => item.idx);

      if (indicesToKeep.length === 0) {
        alert(lang === 'ja' ? 'すべてのページが削除対象になっています。' : 'All pages are marked for deletion.');
        setIsProcessing(false);
        return;
      }

      const modifiedPdfBytes = await manipulatePdfPages(fileBuffer, {
        keepPageIndices: indicesToKeep,
        rotations: pageRotations,
      });

      const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
      await saveProcessedFile(`pdf_org_${Date.now()}`, currentFile.name, `Organized_${currentFile.name}`, blob, 'pdf');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Organized_${currentFile.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error modifying PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle PDF Merge
  const handleMergePdfs = async () => {
    if (mergeFiles.length < 2) return;
    setIsProcessing(true);
    try {
      const buffers = await Promise.all(mergeFiles.map((f) => f.file.arrayBuffer()));
      const mergedBytes = await mergePdfs(buffers);
      const blob = new Blob([mergedBytes], { type: 'application/pdf' });
      const outName = `Merged_Document_${new Date().toISOString().slice(0, 10)}.pdf`;
      await saveProcessedFile(`pdf_merge_${Date.now()}`, mergeFiles[0].name, outName, blob, 'pdf');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to merge PDFs:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Split PDF
  const handleSplitPdf = async (mode: 'single' | 'range' | 'everyN') => {
    if (!currentFile) return;
    setIsProcessing(true);
    try {
      const fileBuffer = await currentFile.arrayBuffer();
      const totalPages = pages.length;
      const baseName = currentFile.name.replace(/\.pdf$/i, '');
      const zipFiles: { name: string; content: Uint8Array }[] = [];

      if (mode === 'single') {
        for (let i = 0; i < totalPages; i++) {
          const singlePageBytes = await manipulatePdfPages(fileBuffer, { keepPageIndices: [i] });
          zipFiles.push({
            name: `${baseName}_page_${String(i + 1).padStart(3, '0')}.pdf`,
            content: singlePageBytes,
          });
        }
      } else if (mode === 'everyN') {
        let chunkIndex = 1;
        for (let i = 0; i < totalPages; i += splitEveryN) {
          const chunkIndices = [];
          for (let j = i; j < Math.min(i + splitEveryN, totalPages); j++) {
            chunkIndices.push(j);
          }
          const chunkBytes = await manipulatePdfPages(fileBuffer, { keepPageIndices: chunkIndices });
          zipFiles.push({
            name: `${baseName}_part_${chunkIndex}_pages_${i + 1}-${Math.min(i + splitEveryN, totalPages)}.pdf`,
            content: chunkBytes,
          });
          chunkIndex++;
        }
      } else if (mode === 'range') {
        // Parse range: e.g. "1-3, 4-5"
        const groups = splitRange.split(',').map((s) => s.trim()).filter(Boolean);
        let groupIdx = 1;
        for (const grp of groups) {
          let indices: number[] = [];
          if (grp.includes('-')) {
            const [startStr, endStr] = grp.split('-').map((s) => parseInt(s.trim(), 10));
            if (!isNaN(startStr) && !isNaN(endStr)) {
              for (let p = Math.max(1, startStr); p <= Math.min(totalPages, endStr); p++) {
                indices.push(p - 1);
              }
            }
          } else {
            const p = parseInt(grp, 10);
            if (!isNaN(p) && p >= 1 && p <= totalPages) {
              indices.push(p - 1);
            }
          }

          if (indices.length > 0) {
            const partBytes = await manipulatePdfPages(fileBuffer, { keepPageIndices: indices });
            zipFiles.push({
              name: `${baseName}_range_${grp.replace(/\s+/g, '')}.pdf`,
              content: partBytes,
            });
            groupIdx++;
          }
        }
      }

      if (zipFiles.length === 1) {
        const blob = new Blob([zipFiles[0].content], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipFiles[0].name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (zipFiles.length > 1) {
        const zipBlob = await createZipArchive(zipFiles.map((zf) => ({ name: zf.name, content: zf.content })));
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_split_pages.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to split PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Watermark & Numbering Export
  const handleApplyEnhancements = async () => {
    if (!currentFile) return;
    setIsProcessing(true);
    try {
      const fileBuffer = await currentFile.arrayBuffer();
      const enhancedBytes = await enhancePdf(fileBuffer, {
        watermarkText: activeSubTab === 'watermark' ? watermarkText : undefined,
        watermarkOpacity: watermarkOpacity,
        watermarkAngle: watermarkAngle,
        watermarkFontSize: watermarkFontSize,
        pageNumbering:
          activeSubTab === 'numbering'
            ? {
                enabled: true,
                format: numFormat,
                position: numPosition,
                startNumber: numStart,
                fontSize: 10,
              }
            : undefined,
      });

      const blob = new Blob([enhancedBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeSubTab === 'watermark' ? 'Watermarked_' : 'Numbered_'}${currentFile.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to apply enhancements:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Sub tabs navigation */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
        {[
          { id: 'organize', labelJa: 'ページ削除・回転・整列', labelEn: 'Organize & Delete Pages', icon: Layers },
          { id: 'merge', labelJa: '複数PDF結合', labelEn: 'Merge PDFs', icon: Plus },
          { id: 'split', labelJa: 'PDF分割・抽出', labelEn: 'Split PDF', icon: Scissors },
          { id: 'watermark', labelJa: '透かし・ウォーターマーク', labelEn: 'Watermark', icon: Stamp },
          { id: 'numbering', labelJa: 'ページ番号・ヘッダー', labelEn: 'Page Numbers', icon: Hash },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                isActive
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? tab.labelJa : tab.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Page Organizer / Delete / Rotate Tab */}
      {activeSubTab === 'organize' && (
        <div className="flex flex-col gap-5">
          {!currentFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer bg-white/60 dark:bg-slate-900/60 transition"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) handleLoadPdf(e.target.files[0]);
                }}
              />
              <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center mb-3">
                <FileText className="w-7 h-7" />
              </div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-base">
                {lang === 'ja' ? 'PDFファイルを選択してページ編集を開始' : 'Select PDF to edit pages'}
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                {lang === 'ja'
                  ? '全ページのサムネイルを視覚的に確認しながら、ページの削除、90度回転、並べ替えが可能です。'
                  : 'Visually view all page thumbnails to delete, rotate 90°, or reorder pages.'}
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col gap-4">
              {/* PDF Info & Top Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">{currentFile.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {pages.length} {lang === 'ja' ? 'ページ' : 'pages'} • {(currentFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedPages.size} {lang === 'ja' ? 'ページ削除選択中' : 'pages marked for deletion'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => rotateAllPages(90)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? '全ページ90°回転' : 'Rotate All 90°'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setCurrentFile(null);
                      setPages([]);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 transition"
                  >
                    {lang === 'ja' ? '別のPDFを開く' : 'Open Another PDF'}
                  </button>

                  <button
                    onClick={handleExportOrganizedPdf}
                    disabled={isProcessing}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-bold shadow-xs transition"
                  >
                    {isProcessing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    <span>{lang === 'ja' ? '編集後PDFを保存' : 'Save Modified PDF'}</span>
                  </button>
                </div>
              </div>

              {/* Instructions banner */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
                <span>
                  {lang === 'ja'
                    ? '💡 サムネイルをクリックすると「削除対象」としてマーク/解除できます。回転アイコンで個別回転も可能です。'
                    : '💡 Click any thumbnail to mark/unmark for deletion. Use the rotate icon on cards for individual rotation.'}
                </span>
                {selectedPages.size > 0 && (
                  <button
                    onClick={() => setSelectedPages(new Set())}
                    className="text-xs text-blue-600 dark:text-blue-400 font-semibold underline"
                  >
                    {lang === 'ja' ? '削除選択を全解除' : 'Deselect All'}
                  </button>
                )}
              </div>

              {/* Page Thumbnails Grid */}
              {isLoadingPages ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs font-medium">{lang === 'ja' ? '全ページのサムネイルを生成中...' : 'Generating page thumbnails...'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {pages.map((page, idx) => {
                    const isDeleted = selectedPages.has(page.pageNumber);
                    const rotation = pageRotations[idx] || 0;

                    return (
                      <div
                        key={page.pageNumber}
                        className={`group relative rounded-xl border-2 p-2 flex flex-col items-center bg-white dark:bg-slate-800/90 transition-all ${
                          isDeleted
                            ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20 opacity-60'
                            : 'border-slate-200 dark:border-slate-700 hover:border-blue-400 shadow-xs'
                        }`}
                      >
                        {/* Thumbnail image */}
                        <div
                          onClick={() => togglePageSelection(page.pageNumber)}
                          className="w-full aspect-[3/4] bg-slate-100 dark:bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer relative"
                        >
                          <img
                            src={page.thumbnailUrl}
                            alt={`Page ${page.pageNumber}`}
                            style={{ transform: `rotate(${rotation}deg)` }}
                            className="max-h-full max-w-full object-contain transition-transform"
                          />
                          {isDeleted && (
                            <div className="absolute inset-0 bg-red-600/30 flex items-center justify-center">
                              <span className="bg-red-600 text-white font-bold text-xs px-2 py-1 rounded-md shadow-xs">
                                {lang === 'ja' ? '削除' : 'DELETE'}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Card footer */}
                        <div className="w-full flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-700 text-xs">
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            {lang === 'ja' ? `P.${page.pageNumber}` : `Page ${page.pageNumber}`}
                          </span>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => rotatePage(page.pageNumber)}
                              className="p-1 rounded text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                              title="90°回転"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => togglePageSelection(page.pageNumber)}
                              className={`p-1 rounded transition ${
                                isDeleted
                                  ? 'text-red-500 bg-red-100 dark:bg-red-900/60'
                                  : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                              }`}
                              title={lang === 'ja' ? '削除フラグ' : 'Mark delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. Merge Multiple PDFs Tab */}
      {activeSubTab === 'merge' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? '複数のPDFファイルを1つに結合' : 'Merge Multiple PDF Files'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? '結合したい順序でPDFを追加してください。ドラッグで順序を自由に入れ替え可能です。'
                  : 'Add PDF files in your preferred merge order.'}
              </p>
            </div>

            <button
              onClick={() => mergeInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'PDFを追加' : 'Add PDF'}</span>
            </button>
            <input
              ref={mergeInputRef}
              type="file"
              multiple
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  const newItems = Array.from(e.target.files).map((f: File) => ({
                    id: Math.random().toString(36).substring(2, 9),
                    file: f,
                    name: f.name,
                    size: f.size,
                  }));
                  setMergeFiles((prev) => [...prev, ...newItems]);
                }
                e.target.value = '';
              }}
            />
          </div>

          {mergeFiles.length === 0 ? (
            <div
              onClick={() => mergeInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 transition"
            >
              <Layers className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? '結合する2つ以上のPDFファイルを選択' : 'Select 2 or more PDF files to merge'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {mergeFiles.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <div>
                      <h4 className="font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-200">{item.name}</h4>
                      <p className="text-[11px] text-slate-500">{(item.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setMergeFiles((prev) => prev.filter((f) => f.id !== item.id))}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="pt-3 flex justify-end">
                <button
                  onClick={handleMergePdfs}
                  disabled={mergeFiles.length < 2 || isProcessing}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition"
                >
                  {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
                  <span>{lang === 'ja' ? 'PDFを結合してダウンロード' : 'Merge & Download PDF'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Split PDF Tab */}
      {activeSubTab === 'split' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? 'PDFの分割・ページ抽出' : 'Split & Extract PDF Pages'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'ja' ? '全ページを個別のPDFにするか、指定したページ範囲ごとに分割できます。' : 'Split into single page PDFs or custom ranges.'}
            </p>
          </div>

          {!currentFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <Scissors className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? '分割したいPDFを選択' : 'Select PDF to split'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300 flex items-center justify-between">
                <span>
                  対象: <strong>{currentFile.name}</strong> ({pages.length} ページ)
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs underline font-semibold text-blue-600 dark:text-blue-400"
                >
                  {lang === 'ja' ? '別のファイルを選択' : 'Change File'}
                </button>
              </div>

              {/* Mode 1: Split every single page */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200">
                    {lang === 'ja' ? '1ページずつ全分割 (ZIPアーカイブ)' : 'Split Every Page into Individual PDFs'}
                  </h4>
                  <p className="text-xs text-slate-500">{pages.length} 個の独立したPDFファイルを作成します。</p>
                </div>
                <button
                  onClick={() => handleSplitPdf('single')}
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
                >
                  {lang === 'ja' ? '全分割実行' : 'Split All'}
                </button>
              </div>

              {/* Mode 2: Split by custom range */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <h4 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200">
                    {lang === 'ja' ? 'ページ範囲を指定して分割' : 'Split by Custom Page Ranges'}
                  </h4>
                  <p className="text-xs text-slate-500 mb-2">例: 1-2, 3-5 (カンマ区切りで複数パート指定)</p>
                  <input
                    type="text"
                    value={splitRange}
                    onChange={(e) => setSplitRange(e.target.value)}
                    className="w-full max-w-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-800 dark:text-slate-200"
                  />
                </div>
                <button
                  onClick={() => handleSplitPdf('range')}
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs self-end sm:self-center"
                >
                  {lang === 'ja' ? '範囲分割実行' : 'Split Ranges'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Watermark Tab */}
      {activeSubTab === 'watermark' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? 'PDFに透かし・ウォーターマークを追加' : 'Add Watermark to PDF'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'ja' ? '社外秘・サンプル・承認済みなどの透かし文字を全ページに半透明で合成します。' : 'Overlay semi-transparent text watermark across all pages.'}
            </p>
          </div>

          {!currentFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <Stamp className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? '透かしを追加するPDFを選択' : 'Select PDF to watermark'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {lang === 'ja' ? '透かしテキスト' : 'Watermark Text'}
                  </label>
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200"
                  />
                  <div className="flex gap-1.5 mt-2">
                    {['社外秘', 'CONFIDENTIAL', 'SAMPLE', '見本', 'COPY'].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setWatermarkText(preset)}
                        className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    <span>{lang === 'ja' ? '不透明度' : 'Opacity'}</span>
                    <span>{Math.round(watermarkOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.8"
                    step="0.05"
                    value={watermarkOpacity}
                    onChange={(e) => setWatermarkOpacity(parseFloat(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    <span>{lang === 'ja' ? '文字サイズ' : 'Font Size'}</span>
                    <span>{watermarkFontSize} pt</span>
                  </div>
                  <input
                    type="range"
                    min="24"
                    max="80"
                    step="2"
                    value={watermarkFontSize}
                    onChange={(e) => setWatermarkFontSize(parseInt(e.target.value, 10))}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {lang === 'ja' ? '回転角度' : 'Angle'}
                  </label>
                  <div className="flex gap-2">
                    {[0, 30, 45, 60, 90].map((angle) => (
                      <button
                        key={angle}
                        onClick={() => setWatermarkAngle(angle)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                          watermarkAngle === angle
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {angle}°
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleApplyEnhancements}
                  disabled={isProcessing}
                  className="mt-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition"
                >
                  {isProcessing ? (
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    lang === 'ja' ? '透かしを適用してダウンロード' : 'Apply Watermark & Download'
                  )}
                </button>
              </div>

              {/* Watermark Preview mockup */}
              <div className="flex flex-col items-center justify-center p-6 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 relative overflow-hidden h-64">
                <div className="w-40 h-52 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded shadow-md relative flex items-center justify-center overflow-hidden">
                  <div className="p-3 text-[8px] text-slate-300 space-y-1 select-none">
                    <div className="w-full h-1.5 bg-slate-200 rounded" />
                    <div className="w-3/4 h-1.5 bg-slate-200 rounded" />
                    <div className="w-5/6 h-1.5 bg-slate-200 rounded" />
                    <div className="w-2/3 h-1.5 bg-slate-200 rounded" />
                  </div>
                  <div
                    style={{
                      transform: `rotate(${watermarkAngle}deg)`,
                      opacity: watermarkOpacity,
                      fontSize: `${watermarkFontSize * 0.3}px`,
                    }}
                    className="absolute font-black text-slate-700 dark:text-slate-300 select-none whitespace-nowrap pointer-events-none"
                  >
                    {watermarkText}
                  </div>
                </div>
                <span className="text-[11px] text-slate-400 mt-2">透かしプレビュー</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Page Numbering Tab */}
      {activeSubTab === 'numbering' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? 'ページ番号・ヘッダー/フッター追加' : 'Add Page Numbers to PDF'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'ja' ? '「Page 1 of N」や「- 1 -」などのページ番号を全ページに自動挿入します。' : 'Insert automatic page numbering into all PDF pages.'}
            </p>
          </div>

          {!currentFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <Hash className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? 'ページ番号を追加するPDFを選択' : 'Select PDF to add page numbers'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 max-w-lg">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {lang === 'ja' ? '番号フォーマット' : 'Numbering Format'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'page_of_total', label: 'Page 1 of 10' },
                    { id: 'dash_page_dash', label: '- 1 -' },
                    { id: 'page_only', label: '1' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setNumFormat(f.id as any)}
                      className={`p-2.5 rounded-lg text-xs font-semibold border transition ${
                        numFormat === f.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {lang === 'ja' ? '配置位置' : 'Position'}
                </label>
                <select
                  value={numPosition}
                  onChange={(e) => setNumPosition(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  <option value="bottom-center">中央下部 (Bottom Center)</option>
                  <option value="bottom-right">右下 (Bottom Right)</option>
                  <option value="bottom-left">左下 (Bottom Left)</option>
                  <option value="top-right">右上 (Top Right)</option>
                  <option value="top-center">中央上部 (Top Center)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {lang === 'ja' ? '開始ページ番号' : 'Starting Number'}
                </label>
                <input
                  type="number"
                  min="1"
                  value={numStart}
                  onChange={(e) => setNumStart(parseInt(e.target.value, 10) || 1)}
                  className="w-24 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
                />
              </div>

              <button
                onClick={handleApplyEnhancements}
                disabled={isProcessing}
                className="mt-3 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition"
              >
                {isProcessing ? (
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  lang === 'ja' ? 'ページ番号を適用してダウンロード' : 'Apply Numbers & Download'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
