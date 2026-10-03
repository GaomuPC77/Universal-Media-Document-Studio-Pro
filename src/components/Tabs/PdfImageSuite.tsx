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
  Sliders,
  CheckCircle2,
  Eye,
  Check,
} from 'lucide-react';
import { convertPdfToImages, imagesToPdf } from '../../utils/pdfUtils';
import { createZipArchive } from '../../utils/zipUtils';
import { saveProcessedFile } from '../../utils/historyDb';
import { FileItem } from '../../types';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';

interface PdfImageSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

export const PdfImageSuite: React.FC<PdfImageSuiteProps> = ({
  lang,
  sharedFile,
  fileList = [],
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [activeMode, setActiveMode] = useState<'pdf-to-img' | 'img-to-pdf'>('pdf-to-img');
  const [pendingPromptFile, setPendingPromptFile] = useState<{ file: File; mode: 'pdf' | 'img' } | null>(null);

  // PDF to Image state
  const [selectedPdfId, setSelectedPdfId] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [dpi, setDpi] = useState<number>(150);
  const [isConverting, setIsConverting] = useState(false);
  const [convertedImages, setConvertedImages] = useState<{ name: string; blob: Blob; pageNumber: number; url: string }[]>([]);
  const [convertProgress, setConvertProgress] = useState<{ current: number; total: number } | null>(null);

  // Image to PDF state
  const [imageFiles, setImageFiles] = useState<{ id: string; file: File; name: string; previewUrl: string; size: number }[]>([]);
  const [pageSize, setPageSize] = useState<'A4' | 'Letter' | 'Fit'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape' | 'auto'>('auto');
  const [margin, setMargin] = useState<number>(20);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Auto load shared file or from fileList
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
    } else if (fileList.length > 0) {
      if (!pdfFile) {
        const foundPdf = fileList.find((f) => f.format === 'pdf' && f.file);
        if (foundPdf && foundPdf.file) {
          setSelectedPdfId(foundPdf.id);
          setPdfFile(foundPdf.file);
        }
      }
      // Populate image files if in img-to-pdf mode and none loaded
      if (imageFiles.length === 0) {
        const loadedImgs = fileList.filter((f) => ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(f.format) && f.file);
        if (loadedImgs.length > 0) {
          setImageFiles(
            loadedImgs.map((img) => ({
              id: img.id,
              file: img.file!,
              name: img.name,
              previewUrl: URL.createObjectURL(img.file!),
              size: img.size,
            }))
          );
        }
      }
    }
  }, [sharedFile, fileList]);

  // Handle PDF file selection
  const handleSelectPdf = (file: File) => {
    setPdfFile(file);
    setConvertedImages([]);
    setConvertProgress(null);
  };

  // Convert PDF to Images
  const handleConvertPdfToImages = async () => {
    if (!pdfFile) {
      if (onShowToast) onShowToast(lang === 'ja' ? 'PDFファイルを選択してください' : 'Please select a PDF file');
      return;
    }
    setIsConverting(true);
    setConvertedImages([]);
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');

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

      // Save individual images and/or ZIP to history
      if (results.length === 1) {
        const single = results[0];
        const resName = `${baseName}.${imgFormat}`;
        await saveProcessedFile(`pdf_img_${Date.now()}`, pdfFile.name, resName, single.blob, imgFormat);
        if (onResultReady) {
          onResultReady({
            id: `res_img_${Date.now()}`,
            name: resName,
            file: new File([single.blob], resName, { type: `image/${imgFormat}` }),
            size: single.blob.size,
            type: `image/${imgFormat}`,
            format: imgFormat as any,
            targetFormat: imgFormat as any,
            status: 'done',
            progress: 100,
            resultBlob: single.blob,
            resultName: resName,
          });
        }
      } else if (results.length > 1) {
        const zipFiles = results.map((img) => ({
          name: `${baseName}_p${img.pageNumber}.${imgFormat}`,
          content: img.blob,
        }));
        const zipBlob = await createZipArchive(zipFiles);
        const zipName = `${baseName}_images_${dpi}dpi.zip`;
        await saveProcessedFile(`pdf_img_zip_${Date.now()}`, pdfFile.name, zipName, zipBlob, 'zip');
        if (onResultReady) {
          onResultReady({
            id: `res_zip_${Date.now()}`,
            name: zipName,
            file: new File([zipBlob], zipName, { type: 'application/zip' }),
            size: zipBlob.size,
            type: 'application/zip',
            format: 'zip',
            targetFormat: 'zip',
            status: 'done',
            progress: 100,
            resultBlob: zipBlob,
            resultName: zipName,
          });
        }
      }

      notifyCompletion(
        lang === 'ja' ? 'PDFから画像への変換が完了しました' : 'PDF to Images Converted',
        `${results.length} pages converted`
      );
      if (onShowToast) {
        onShowToast(lang === 'ja' ? `${results.length} ページの画像変換が完了しました` : `Converted ${results.length} pages`);
      }
    } catch (err: any) {
      console.error('Failed to convert PDF to images:', err);
      alert(lang === 'ja' ? '画像変換に失敗しました: ' + err.message : 'Failed to convert PDF to images');
    } finally {
      setIsConverting(false);
    }
  };

  // Download all generated images as ZIP
  const handleDownloadAllZip = async () => {
    if (convertedImages.length === 0 || !pdfFile) return;
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');
    const zipFiles = convertedImages.map((img) => ({
      name: `${baseName}_p${img.pageNumber}.${imgFormat}`,
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
    if (imageFiles.length === 0) {
      if (onShowToast) onShowToast(lang === 'ja' ? '画像ファイルを追加してください' : 'Please select image files');
      return;
    }
    setIsGeneratingPdf(true);
    const resultName = `Combined_Images_${new Date().toISOString().slice(0, 10)}.pdf`;

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
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`img_pdf_${Date.now()}`, 'images_batch', resultName, blob, 'pdf');

      if (onResultReady) {
        onResultReady({
          id: `res_imgpdf_${Date.now()}`,
          name: resultName,
          file: new File([blob], resultName, { type: 'application/pdf' }),
          size: blob.size,
          type: 'application/pdf',
          format: 'pdf',
          targetFormat: 'pdf',
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? '画像からPDFの作成が完了しました' : 'Images to PDF Created', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成・保存しました` : `Created "${resultName}"`);
    } catch (err: any) {
      console.error('Failed to generate PDF from images:', err);
      alert(lang === 'ja' ? 'PDF作成に失敗しました: ' + err.message : 'Images to PDF failed');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Add To Queue Confirmation Modal */}
      <AddToQueuePromptModal
        file={pendingPromptFile?.file || null}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (!pendingPromptFile) return;
          const { file, mode } = pendingPromptFile;
          if (onAddFiles) {
            onAddFiles([file]);
          }
          if (mode === 'pdf') {
            handleSelectPdf(file);
          } else {
            const url = URL.createObjectURL(file);
            setImageFiles((prev) => [
              ...prev,
              { id: `img_${Date.now()}`, file, name: file.name, previewUrl: url, size: file.size },
            ]);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={() => {
          if (!pendingPromptFile) return;
          const { file, mode } = pendingPromptFile;
          if (mode === 'pdf') {
            handleSelectPdf(file);
          } else {
            const url = URL.createObjectURL(file);
            setImageFiles((prev) => [
              ...prev,
              { id: `img_${Date.now()}`, file, name: file.name, previewUrl: url, size: file.size },
            ]);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'このタブのみに読み込みました' : 'Loaded into this tab only');
          }
          setPendingPromptFile(null);
        }}
      />

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
          <span>{lang === 'ja' ? 'PDF → 画像抽出・変換' : 'PDF to Images'}</span>
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
          <span>{lang === 'ja' ? '画像 → PDF結合作成' : 'Images to PDF'}</span>
        </button>
      </div>

      {/* 1. PDF to Image Mode */}
      {activeMode === 'pdf-to-img' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title">
            <span className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-blue-600" />
              <span>{lang === 'ja' ? 'PDFの全ページを高解像度画像に変換' : 'Convert PDF Pages to High-Res Images'}</span>
            </span>
          </div>

          {/* Select Loaded PDF */}
          <div>
            <label>{lang === 'ja' ? '変換対象のPDFファイルを選択:' : 'Select Target PDF File:'}</label>
            <select
              value={selectedPdfId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedPdfId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  handleSelectPdf(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたPDFを選択 --' : '-- Select Loaded PDF --'}</option>
              {fileList
                .filter((f) => f.format === 'pdf' || f.name.toLowerCase().endsWith('.pdf'))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label>{lang === 'ja' ? '画像形式:' : 'Output Image Format:'}</label>
              <div className="flex gap-2">
                {(['png', 'jpg', 'webp'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setImgFormat(fmt)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border uppercase transition ${
                      imgFormat === fmt
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    .{fmt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label>{lang === 'ja' ? `解像度: ${dpi} DPI` : `Resolution: ${dpi} DPI`}</label>
              <input
                type="range"
                min="72"
                max="300"
                step="25"
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
                className="input-range"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>72 DPI (軽量)</span>
                <span>150 DPI (標準)</span>
                <span>300 DPI (印刷品質)</span>
              </div>
            </div>
          </div>

          {/* Convert Action */}
          <button
            onClick={handleConvertPdfToImages}
            disabled={!pdfFile || isConverting}
            className="btn btn-primary flex items-center justify-center gap-2 py-3 mt-2"
          >
            {isConverting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>
                  {convertProgress
                    ? `${lang === 'ja' ? 'ページ変換中' : 'Converting'}: ${convertProgress.current} / ${convertProgress.total}`
                    : lang === 'ja'
                    ? '変換処理中...'
                    : 'Converting...'}
                </span>
              </>
            ) : (
              <>
                <ImageIcon className="w-4 h-4" />
                <span>{lang === 'ja' ? 'すべてのページを画像に変換' : 'Convert All Pages to Images'}</span>
              </>
            )}
          </button>

          {/* Converted Results Grid */}
          {convertedImages.length > 0 && (
            <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-700 dark:text-slate-200">
                  {lang === 'ja' ? `変換完了 (${convertedImages.length} ページ):` : `Converted (${convertedImages.length} pages):`}
                </span>
                <button
                  onClick={handleDownloadAllZip}
                  className="btn-header"
                >
                  <FolderArchive className="w-3.5 h-3.5 text-blue-600" />
                  <span>{lang === 'ja' ? '全画像をZIP一括ダウンロード' : 'Download All as ZIP'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-96 overflow-auto p-1">
                {convertedImages.map((img) => (
                  <div
                    key={img.pageNumber}
                    className="p-2 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-2 group"
                  >
                    <img
                      src={img.url}
                      alt={img.name}
                      className="w-full h-32 object-contain bg-white rounded-lg shadow-xs"
                    />
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {lang === 'ja' ? `ページ ${img.pageNumber}` : `Page ${img.pageNumber}`}
                      </span>
                      <a
                        href={img.url}
                        download={img.name}
                        className="p-1 rounded-md text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                        title={lang === 'ja' ? '保存' : 'Download'}
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

      {/* 2. Image to PDF Mode */}
      {activeMode === 'img-to-pdf' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title">
            <span className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              <span>{lang === 'ja' ? '複数画像を結合して1つのPDFを作成' : 'Combine Images into a Single PDF'}</span>
            </span>
          </div>

          {/* Image Files Selection from Loaded list */}
          <div className="flex flex-col gap-2">
            <label>{lang === 'ja' ? `選択された画像 (${imageFiles.length} 件):` : `Selected Images (${imageFiles.length}):`}</label>
            {imageFiles.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500">
                {lang === 'ja'
                  ? '画像が選択されていません。上部「1. 処理するファイルの読み込み・追加」から画像を追加してください。'
                  : 'No images loaded. Please add images in Section 1 above.'}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-60 overflow-auto p-1">
                {imageFiles.map((img, idx) => (
                  <div
                    key={img.id}
                    className="relative p-2 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-1"
                  >
                    <img src={img.previewUrl} alt={img.name} className="w-full h-24 object-cover rounded-lg bg-white" />
                    <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">{img.name}</div>
                    <button
                      onClick={() => setImageFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-rose-600 transition"
                      title={lang === 'ja' ? '削除' : 'Remove'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PDF Page Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label>{lang === 'ja' ? '用紙サイズ:' : 'Page Size:'}</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as any)}
                className="select-field"
              >
                <option value="A4">A4 (210 x 297 mm)</option>
                <option value="Letter">Letter (8.5 x 11 in)</option>
                <option value="Fit">{lang === 'ja' ? '画像サイズに合わせる (Fit)' : 'Fit to image'}</option>
              </select>
            </div>

            <div>
              <label>{lang === 'ja' ? 'ページの向き:' : 'Orientation:'}</label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as any)}
                className="select-field"
              >
                <option value="auto">{lang === 'ja' ? '自動判定 (Auto)' : 'Auto detect'}</option>
                <option value="portrait">{lang === 'ja' ? '縦向き (Portrait)' : 'Portrait'}</option>
                <option value="landscape">{lang === 'ja' ? '横向き (Landscape)' : 'Landscape'}</option>
              </select>
            </div>

            <div>
              <label>{lang === 'ja' ? `余白: ${margin} pt` : `Margin: ${margin} pt`}</label>
              <input
                type="range"
                min="0"
                max="50"
                step="5"
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
                className="input-range"
              />
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handleGeneratePdfFromImages}
            disabled={imageFiles.length === 0 || isGeneratingPdf}
            className="btn btn-primary flex items-center justify-center gap-2 py-3 mt-2"
          >
            {isGeneratingPdf ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'ja' ? 'PDFを生成中...' : 'Generating PDF...'}</span>
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                <span>{lang === 'ja' ? '画像を結合してPDFを保存' : 'Combine into PDF & Download'}</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
