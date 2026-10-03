import React, { useState, useRef, useEffect } from 'react';
import {
  ScanText,
  QrCode,
  Upload,
  Download,
  Copy,
  Check,
  RefreshCw,
  FileText,
  Layers,
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import { generateQrCode, QrOptions } from '../../utils/qrUtils';
import { createDocxFromText } from '../../utils/officeUtils';
import { extractPdfText } from '../../utils/pdfUtils';
import { saveProcessedFile } from '../../utils/historyDb';
import { FileItem } from '../../types';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';

interface OcrSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

export const OcrSuite: React.FC<OcrSuiteProps> = ({
  lang,
  sharedFile,
  fileList = [],
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [activeTab, setActiveTab] = useState<'ocr' | 'qr'>('ocr');

  // OCR state
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [ocrImage, setOcrImage] = useState<File | null>(null);
  const [pendingPromptFile, setPendingPromptFile] = useState<File | null>(null);
  const [ocrImagePreview, setOcrImagePreview] = useState<string>('');
  const [extractedText, setExtractedText] = useState<string>('');
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrLang, setOcrLang] = useState<'jpn+eng' | 'jpn' | 'eng'>('jpn+eng');
  const [copied, setCopied] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  // Auto load shared file or from fileList
  useEffect(() => {
    if (sharedFile) {
      setActiveTab('ocr');
      handleSelectOcrFile(sharedFile);
    } else if (fileList.length > 0 && !ocrImage) {
      const found = fileList.find(
        (f) =>
          ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf'].includes(f.format) && f.file
      );
      if (found && found.file) {
        setSelectedFileId(found.id);
        handleSelectOcrFile(found.file);
      }
    }
  }, [sharedFile, fileList]);

  // QR Code generator state
  const [qrType, setQrType] = useState<'url' | 'text' | 'wifi' | 'email'>('url');
  const [qrText, setQrText] = useState<string>('https://google.com');
  const [wifiSsid, setWifiSsid] = useState<string>('');
  const [wifiPass, setWifiPass] = useState<string>('');
  const [qrDarkColor, setQrDarkColor] = useState<string>('#000000');
  const [qrLightColor, setQrLightColor] = useState<string>('#ffffff');
  const [generatedQrUrl, setGeneratedQrUrl] = useState<string>('');

  // Handle image upload for OCR
  const handleSelectOcrFile = async (file: File) => {
    setOcrImage(file);
    if (file.type.startsWith('image/')) {
      setOcrImagePreview(URL.createObjectURL(file));
    } else {
      setOcrImagePreview('');
    }
    setExtractedText('');
    setIsOcrProcessing(true);
    setOcrProgress(5);

    try {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const text = await extractPdfText(file);
        const finalText = text || (lang === 'ja' ? '(PDFからテキストが抽出されませんでした。画像スキャンPDFの場合は画像形式に変換してOCRをお試しください。)' : '(No text extracted from PDF)');
        setExtractedText(finalText);
        setIsOcrProcessing(false);
      } else {
        // Run genuine Client-Side Tesseract.js OCR
        const result = await Tesseract.recognize(file, ocrLang, {
          logger: (m) => {
            if (m.status === 'recognizing text' && typeof m.progress === 'number') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          },
        });

        const text = result.data.text.trim();
        setExtractedText(text || (lang === 'ja' ? '文字が検出されませんでした。' : 'No text recognized.'));
      }
    } catch (e: any) {
      console.error('OCR failed:', e);
      setExtractedText(lang === 'ja' ? `テキスト認識中にエラーが発生しました: ${e.message}` : `OCR failed: ${e.message}`);
    } finally {
      setIsOcrProcessing(false);
      setOcrProgress(100);
    }
  };

  // Generate QR Code on config update
  useEffect(() => {
    let payload = qrText;
    if (qrType === 'wifi') {
      payload = `WIFI:T:WPA;S:${wifiSsid};P:${wifiPass};;`;
    } else if (qrType === 'email') {
      payload = `mailto:${qrText}`;
    }

    if (!payload.trim()) return;

    generateQrCode({
      text: payload,
      colorDark: qrDarkColor,
      colorLight: qrLightColor,
      width: 320,
    }).then((url) => setGeneratedQrUrl(url));
  }, [qrType, qrText, wifiSsid, wifiPass, qrDarkColor, qrLightColor]);

  const handleCopyText = () => {
    navigator.clipboard.writeText(extractedText);
    setCopied(true);
    if (onShowToast) onShowToast(lang === 'ja' ? 'テキストをコピーしました' : 'Text copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportTextDocx = async () => {
    if (!extractedText || !ocrImage) return;
    const baseName = ocrImage.name.substring(0, ocrImage.name.lastIndexOf('.')) || ocrImage.name;
    const resultName = `OCR_${baseName}.docx`;
    const blob = await createDocxFromText(extractedText, { title: `OCR Result - ${baseName}` });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await saveProcessedFile(`ocr_${Date.now()}`, ocrImage.name, resultName, blob, 'docx');

    if (onResultReady) {
      onResultReady({
        id: `res_ocr_${Date.now()}`,
        name: resultName,
        file: new File([blob], resultName, { type: blob.type }),
        size: blob.size,
        type: blob.type,
        format: 'docx',
        targetFormat: 'docx',
        status: 'done',
        progress: 100,
        resultBlob: blob,
        resultName,
      });
    }

    notifyCompletion(lang === 'ja' ? 'OCR結果のWord保存が完了しました' : 'OCR Word Export Complete', resultName);
    if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Saved "${resultName}"`);
  };

  const handleExportTextTxt = async () => {
    if (!extractedText || !ocrImage) return;
    const baseName = ocrImage.name.substring(0, ocrImage.name.lastIndexOf('.')) || ocrImage.name;
    const resultName = `OCR_${baseName}.txt`;
    const blob = new Blob([extractedText], { type: 'text/plain;charset=utf-8' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await saveProcessedFile(`ocr_${Date.now()}`, ocrImage.name, resultName, blob, 'txt');

    if (onResultReady) {
      onResultReady({
        id: `res_ocrtxt_${Date.now()}`,
        name: resultName,
        file: new File([blob], resultName, { type: blob.type }),
        size: blob.size,
        type: blob.type,
        format: 'txt',
        targetFormat: 'txt',
        status: 'done',
        progress: 100,
        resultBlob: blob,
        resultName,
      });
    }

    notifyCompletion(lang === 'ja' ? 'OCRテキストを保存しました' : 'OCR Text Saved', resultName);
    if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Saved "${resultName}"`);
  };

  const handleDownloadQr = async () => {
    if (!generatedQrUrl) return;
    const res = await fetch(generatedQrUrl);
    const blob = await res.blob();
    const resultName = `QR_Code_${Date.now()}.png`;

    const a = document.createElement('a');
    a.href = generatedQrUrl;
    a.download = resultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    await saveProcessedFile(`qr_${Date.now()}`, 'qr_input', resultName, blob, 'png');

    if (onResultReady) {
      onResultReady({
        id: `res_qr_${Date.now()}`,
        name: resultName,
        file: new File([blob], resultName, { type: 'image/png' }),
        size: blob.size,
        type: 'image/png',
        format: 'png',
        targetFormat: 'png',
        status: 'done',
        progress: 100,
        resultBlob: blob,
        resultName,
      });
    }

    if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」をダウンロードしました` : `Saved "${resultName}"`);
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Add To Queue Confirmation Modal */}
      <AddToQueuePromptModal
        file={pendingPromptFile}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (!pendingPromptFile) return;
          if (onAddFiles) {
            onAddFiles([pendingPromptFile]);
          }
          handleSelectOcrFile(pendingPromptFile);
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={() => {
          if (!pendingPromptFile) return;
          handleSelectOcrFile(pendingPromptFile);
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'このタブのみに読み込みました' : 'Loaded into this tab only');
          }
          setPendingPromptFile(null);
        }}
      />

      {/* Sub Tabs */}
      <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 max-w-sm mx-auto w-full">
        <button
          onClick={() => setActiveTab('ocr')}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition ${
            activeTab === 'ocr'
              ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <ScanText className="w-4 h-4" />
          <span>{lang === 'ja' ? 'OCR 文字認識' : 'OCR Text Scan'}</span>
        </button>
        <button
          onClick={() => setActiveTab('qr')}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition ${
            activeTab === 'qr'
              ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>{lang === 'ja' ? 'QRコード生成' : 'QR Code Studio'}</span>
        </button>
      </div>

      {/* 1. OCR Tool */}
      {activeTab === 'ocr' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? '画像・PDFから文字を自動認識 (ローカルOCR)' : 'In-Browser Local OCR Text Extraction'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? '領収書、名刺、スキャン文書、スクリーンショットからテキストを抽出し、Wordやテキストファイルに出力します。'
                  : 'Extract text from documents, receipts, and screenshots into editable TXT or DOCX.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={ocrLang}
                onChange={(e) => setOcrLang(e.target.value as any)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
              >
                <option value="jpn+eng">日本語 + 英語 (Japanese + English)</option>
                <option value="jpn">日本語のみ (Japanese)</option>
                <option value="eng">英語のみ (English)</option>
              </select>

              <button
                onClick={() => ocrInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? 'ファイル選択' : 'Select File'}</span>
              </button>
              <input
                ref={ocrInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setPendingPromptFile(e.target.files[0]);
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>

          {/* Select Loaded File from Main Queue */}
          {fileList.length > 0 && (
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                {lang === 'ja' ? '読み込み済みファイルから選択:' : 'Select from Loaded Files:'}
              </label>
              <select
                value={selectedFileId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedFileId(id);
                  const found = fileList.find((f) => f.id === id);
                  if (found && found.file) {
                    handleSelectOcrFile(found.file);
                  }
                }}
                className="main-select"
              >
                <option value="">{lang === 'ja' ? '-- アップロードされたファイルを選択 --' : '-- Select Loaded File --'}</option>
                {fileList
                  .filter((f) => ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf'].includes(f.format) || f.file)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({(f.size / 1024).toFixed(1)} KB)
                    </option>
                  ))}
              </select>
            </div>
          )}

          {!ocrImage ? (
            <div
              onClick={() => ocrInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <ScanText className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? '文字を抽出したい画像またはPDFをドロップまたは選択' : 'Drop or select image/PDF to extract text'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Image preview */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase">{lang === 'ja' ? '入力元プレビュー' : 'Source Preview'}</span>
                  <button
                    onClick={() => handleSelectOcrFile(ocrImage)}
                    disabled={isOcrProcessing}
                    className="text-xs text-blue-600 dark:text-blue-400 font-semibold inline-flex items-center gap-1 hover:underline"
                  >
                    <RefreshCw className={`w-3 h-3 ${isOcrProcessing ? 'animate-spin' : ''}`} />
                    <span>{lang === 'ja' ? '再認識' : 'Re-run OCR'}</span>
                  </button>
                </div>

                <div className="p-3 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-center max-h-80 overflow-hidden min-h-[160px]">
                  {ocrImagePreview ? (
                    <img src={ocrImagePreview} alt="OCR source" className="max-h-72 object-contain rounded-lg shadow-xs" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <FileText className="w-12 h-12" />
                      <span className="text-xs font-bold">{ocrImage.name}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Extracted text */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase">
                    {lang === 'ja' ? '認識テキスト結果' : 'Extracted Text Result'}
                  </span>

                  {extractedText && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleCopyText}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'コピー済み' : 'コピー'}</span>
                      </button>

                      <button
                        onClick={handleExportTextTxt}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>TXT</span>
                      </button>

                      <button
                        onClick={handleExportTextDocx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Word保存</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="relative flex-1">
                  {isOcrProcessing ? (
                    <div className="h-72 flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
                      <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {lang === 'ja' ? `OCR文字解析を実行中... (${ocrProgress}%)` : `Extracting text... (${ocrProgress}%)`}
                      </p>
                      <div className="w-48 bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${ocrProgress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <textarea
                      value={extractedText}
                      onChange={(e) => setExtractedText(e.target.value)}
                      rows={12}
                      className="w-full h-72 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. QR Code Tool */}
      {activeTab === 'qr' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? '高解像度 QRコード生成スタジオ' : 'High-Resolution QR Code Studio'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja' ? 'WebサイトURL、テキスト、Wi-Fi接続用QRコードを高画質で瞬時に作成。' : 'Create QR codes for URLs, WiFi configs, and text.'}
              </p>
            </div>

            {/* Type selector */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'url', label: 'Web URL' },
                { id: 'text', label: 'テキスト' },
                { id: 'wifi', label: 'Wi-Fi 接続' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setQrType(t.id as any)}
                  className={`p-2 rounded-lg text-xs font-semibold border transition ${
                    qrType === t.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Value inputs */}
            {qrType !== 'wifi' ? (
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {qrType === 'url' ? 'URL' : 'テキスト内容'}
                </label>
                <input
                  type="text"
                  value={qrText}
                  onChange={(e) => setQrText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  placeholder={qrType === 'url' ? 'https://example.com' : '任意のテキスト'}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">SSID (Wi-Fi名)</label>
                  <input
                    type="text"
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                    placeholder="MyHome_WiFi"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">パスワード</label>
                  <input
                    type="password"
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  />
                </div>
              </div>
            )}

            {/* Colors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">QRコード色</label>
                <input
                  type="color"
                  value={qrDarkColor}
                  onChange={(e) => setQrDarkColor(e.target.value)}
                  className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">背景色</label>
                <input
                  type="color"
                  value={qrLightColor}
                  onChange={(e) => setQrLightColor(e.target.value)}
                  className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* QR Preview & Download */}
          <div className="flex flex-col items-center justify-center p-6 bg-slate-100 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 gap-4">
            <div className="p-4 bg-white rounded-2xl shadow-md flex items-center justify-center">
              {generatedQrUrl && <img src={generatedQrUrl} alt="QR Code" className="w-48 h-48 object-contain" />}
            </div>

            <button
              onClick={handleDownloadQr}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? '高解像度PNGで保存' : 'Download QR Code'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
