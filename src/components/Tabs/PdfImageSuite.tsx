import React, { useState, useRef, useEffect } from 'react';
import {
  Image as ImageIcon,
  FileText,
  Upload,
  Download,
  FolderArchive,
  RefreshCw,
  Plus,
  Trash2,
  Sparkles,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { convertPdfToImages, imagesToPdf } from '../../utils/pdfUtils';
import { createZipArchive } from '../../utils/zipUtils';
import { saveProcessedFile } from '../../utils/historyDb';

interface PdfImageSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
}

export const PdfImageSuite: React.FC<PdfImageSuiteProps> = ({ lang, sharedFile }) => {
  const [activeMode, setActiveMode] = useState<'pdf-to-img' | 'img-to-pdf'>('pdf-to-img');

  // PDF to Image state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [dpi, setDpi] = useState<number>(150);
  const [isConverting, setIsConverting] = useState(false);
  const [convertedImages, setConvertedImages] = useState<{ name: string; blob: Blob; pageNumber: number; url: string }[]>([]);
  const [convertProgress, setConvertProgress] = useState<{ current: number; total: number } | null>(null);

  // Auto load shared file
  useEffect(() => {
    if (sharedFile) {
      if (sharedFile.name.toLowerCase().endsWith('.pdf') || sharedFile.type === 'application/pdf') {
        setActiveMode('pdf-to-img');
        handleSelectPdf(sharedFile);
      } else if (['image/png', 'image/jpeg', 'image/webp'].includes(sharedFile.type) || /\.(png|jpe?g|webp|bmp)$/i.test(sharedFile.name)) {
        setActiveMode('img-to-pdf');
        const url = URL.createObjectURL(sharedFile);
        setImageFiles((prev) => [
          ...prev,
          { id: `img_${Date.now()}`, file: sharedFile, name: sharedFile.name, previewUrl: url, size: sharedFile.size },
        ]);
      }
    }
  }, [sharedFile]);

  // Image to PDF state
  const [imageFiles, setImageFiles] = useState<{ id: string; file: File; name: string; previewUrl: string; size: number }[]>([]);
  const [pageSize, setPageSize] = useState<'A4' | 'Letter' | 'Fit'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape' | 'auto'>('auto');
  const [margin, setMargin] = useState<number>(20);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // Handle PDF file selection
  const handleSelectPdf = (file: File) => {
    setPdfFile(file);
    setConvertedImages([]);
    setConvertProgress(null);
  };

  // Convert PDF to Images
  const handleConvertPdfToImages = async () => {
    if (!pdfFile) return;
    setIsConverting(true);
    setConvertedImages([]);
    try {
      const results = await convertPdfToImages(pdfFile, {
        format: imgFormat,
        dpi,
        onProgress: (current, total) => setConvertProgress({ current, total }),
      });

      const itemsWithUrls = results.map((r) => ({
        ...r,
        url: URL.createObjectURL(r.blob),
      }));

      setConvertedImages(itemsWithUrls);
    } catch (err) {
      console.error('Failed to convert PDF to images:', err);
    } finally {
      setIsConverting(false);
    }
  };

  // Download all generated images as ZIP
  const handleDownloadAllZip = async () => {
    if (convertedImages.length === 0 || !pdfFile) return;
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');
    const zipFiles = convertedImages.map((img) => ({
      name: img.name,
      content: img.blob,
    }));
    const zipBlob = await createZipArchive(zipFiles);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_images_${dpi}dpi.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle Images to PDF creation
  const handleGeneratePdfFromImages = async () => {
    if (imageFiles.length === 0) return;
    setIsGeneratingPdf(true);
    try {
      const loadedBuffers = await Promise.all(
        imageFiles.map(async (f) => ({
          name: f.name,
          data: await f.file.arrayBuffer(),
          type: f.file.type,
        }))
      );

      const pdfBytes = await imagesToPdf(loadedBuffers, {
        pageSize,
        orientation,
        margin,
      });

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Combined_Images_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate PDF from images:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Mode Switcher */}
      <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 max-w-md mx-auto w-full">
        <button
          onClick={() => setActiveMode('pdf-to-img')}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition ${
            activeMode === 'pdf-to-img'
              ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          <span>{lang === 'ja' ? 'PDF → 画像に変換' : 'PDF to Images'}</span>
        </button>
        <button
          onClick={() => setActiveMode('img-to-pdf')}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition ${
            activeMode === 'img-to-pdf'
              ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>{lang === 'ja' ? '画像 → PDFに結合' : 'Images to PDF'}</span>
        </button>
      </div>

      {/* 1. PDF to Image Converter */}
      {activeMode === 'pdf-to-img' && (
        <div className="flex flex-col gap-5">
          {!pdfFile ? (
            <div
              onClick={() => pdfInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer bg-white/60 dark:bg-slate-900/60 transition"
            >
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) handleSelectPdf(e.target.files[0]);
                }}
              />
              <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center mb-3">
                <ImageIcon className="w-7 h-7" />
              </div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-base">
                {lang === 'ja' ? '画像に変換するPDFファイルを選択' : 'Select PDF to convert into images'}
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                {lang === 'ja'
                  ? '各ページを高解像度PNG / JPG / WebPに変換。300 DPIの高画質印刷用出力にも対応しています。'
                  : 'Convert every page into crystal clear PNG, JPG, or WebP. Supports 300 DPI print quality.'}
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
              {/* Settings and controls */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">{pdfFile.name}</h3>
                  <p className="text-xs text-slate-500">{(pdfFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Format select */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500 font-semibold">{lang === 'ja' ? '形式:' : 'Format:'}</span>
                    <select
                      value={imgFormat}
                      onChange={(e) => setImgFormat(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                    >
                      <option value="png">PNG (高画質・可逆圧縮)</option>
                      <option value="jpg">JPG (写真・容量小)</option>
                      <option value="webp">WebP (最新・高圧縮)</option>
                    </select>
                  </div>

                  {/* DPI select */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500 font-semibold">DPI:</span>
                    <select
                      value={dpi}
                      onChange={(e) => setDpi(parseInt(e.target.value, 10))}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                    >
                      <option value={72}>72 DPI (Web・標準)</option>
                      <option value={150}>150 DPI (高精細・推奨)</option>
                      <option value={300}>300 DPI (印刷・最高画質)</option>
                    </select>
                  </div>

                  <button
                    onClick={handleConvertPdfToImages}
                    disabled={isConverting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition"
                  >
                    {isConverting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>{isConverting ? (lang === 'ja' ? 'レンダリング中...' : 'Rendering...') : lang === 'ja' ? '画像変換を実行' : 'Convert to Images'}</span>
                  </button>
                </div>
              </div>

              {/* Progress bar if running */}
              {isConverting && convertProgress && (
                <div className="flex flex-col gap-2 p-4 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900">
                  <div className="flex justify-between text-xs font-bold text-blue-700 dark:text-blue-300">
                    <span>{lang === 'ja' ? 'ページレンダリング中' : 'Rendering pages'}</span>
                    <span>{convertProgress.current} / {convertProgress.total}</span>
                  </div>
                  <div className="w-full bg-blue-200 dark:bg-blue-900 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-200"
                      style={{ width: `${(convertProgress.current / convertProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Converted images display */}
              {convertedImages.length > 0 && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-700 dark:text-slate-300">
                      {lang === 'ja' ? '変換結果' : 'Converted Pages'} ({convertedImages.length} 枚)
                    </span>
                    <button
                      onClick={handleDownloadAllZip}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition"
                    >
                      <FolderArchive className="w-3.5 h-3.5" />
                      <span>{lang === 'ja' ? '全画像をZIPで一括保存' : 'Download All as ZIP'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {convertedImages.map((img) => (
                      <div
                        key={img.pageNumber}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-2.5 flex flex-col items-center gap-2 group"
                      >
                        <div className="w-full aspect-[3/4] bg-white dark:bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200 dark:border-slate-800 shadow-xs">
                          <img src={img.url} alt={img.name} className="max-h-full max-w-full object-contain" />
                        </div>
                        <div className="w-full flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">P.{img.pageNumber}</span>
                          <a
                            href={img.url}
                            download={img.name}
                            className="p-1 rounded-md bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-blue-600 hover:text-white transition"
                            title="この画像を保存"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. Images to PDF Converter */}
      {activeMode === 'img-to-pdf' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? '複数画像を1つのPDFに結合' : 'Combine Images into Single PDF'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? 'PNG, JPG, WebP, SVGなどの画像を追加し、用紙サイズ・余白を設定してPDFを生成します。'
                  : 'Combine PNG, JPG, WebP, SVG images into formatted multi-page PDF.'}
              </p>
            </div>

            <button
              onClick={() => imgInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? '画像を追加' : 'Add Images'}</span>
            </button>
            <input
              ref={imgInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  const newItems = Array.from(e.target.files).map((f: File) => ({
                    id: Math.random().toString(36).substring(2, 9),
                    file: f,
                    name: f.name,
                    previewUrl: URL.createObjectURL(f),
                    size: f.size,
                  }));
                  setImageFiles((prev) => [...prev, ...newItems]);
                }
                e.target.value = '';
              }}
            />
          </div>

          {imageFiles.length === 0 ? (
            <div
              onClick={() => imgInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <FileText className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? 'PDFにまとめたい画像をドラッグまたは選択' : 'Select images to compile into PDF'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Layout settings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {lang === 'ja' ? '用紙サイズ' : 'Page Size'}
                  </label>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value as any)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
                  >
                    <option value="A4">A4 (210 x 297 mm)</option>
                    <option value="Letter">Letter (216 x 279 mm)</option>
                    <option value="Fit">画像サイズに自動追従 (Fit to image)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {lang === 'ja' ? '用紙の向き' : 'Orientation'}
                  </label>
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as any)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
                  >
                    <option value="auto">自動判別 (Auto)</option>
                    <option value="portrait">縦向き (Portrait)</option>
                    <option value="landscape">横向き (Landscape)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {lang === 'ja' ? '余白設定' : 'Margins'}
                  </label>
                  <select
                    value={margin}
                    onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
                  >
                    <option value={0}>余白なし (0 mm)</option>
                    <option value={20}>狭い余白 (7 mm)</option>
                    <option value={40}>標準余白 (14 mm)</option>
                  </select>
                </div>
              </div>

              {/* Images preview queue */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {imageFiles.map((item, idx) => (
                  <div
                    key={item.id}
                    className="relative rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-2 flex flex-col items-center group"
                  >
                    <div className="w-full aspect-square bg-white dark:bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center">
                      <img src={item.previewUrl} alt={item.name} className="max-h-full max-w-full object-contain" />
                    </div>
                    <div className="w-full flex items-center justify-between mt-2 pt-1 border-t border-slate-200 dark:border-slate-700 text-[11px]">
                      <span className="font-bold text-slate-600 dark:text-slate-300">#{idx + 1}</span>
                      <button
                        onClick={() => setImageFiles((prev) => prev.filter((f) => f.id !== item.id))}
                        className="text-slate-400 hover:text-red-500 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleGeneratePdfFromImages}
                  disabled={isGeneratingPdf}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition"
                >
                  {isGeneratingPdf ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>{lang === 'ja' ? 'PDFを生成してダウンロード' : 'Compile & Download PDF'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
