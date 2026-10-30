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
  Camera,
  CameraOff,
  ExternalLink,
  Image as ImageIcon,
  ScanLine,
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import jsQR from 'jsqr';
import { generateQrCode, QrOptions } from '../../utils/qrUtils';
import { createDocxFromText } from '../../utils/officeUtils';
import { extractPdfText, convertPdfToImages } from '../../utils/pdfUtils';
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
  const [activeTab, setActiveTab] = useState<'ocr' | 'qr-scan' | 'qr'>('ocr');

  // OCR state
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [ocrImage, setOcrImage] = useState<File | null>(null);
  const [pendingPromptFile, setPendingPromptFile] = useState<{ file: File; mode: 'ocr' | 'qr-scan' } | null>(null);
  const [ocrImagePreview, setOcrImagePreview] = useState<string>('');
  const [extractedText, setExtractedText] = useState<string>('');
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrLang, setOcrLang] = useState<'jpn+eng' | 'jpn' | 'eng'>('jpn+eng');
  const [copied, setCopied] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  // QR Scanner state
  const [qrScanMode, setQrScanMode] = useState<'image' | 'camera'>('image');
  const [selectedQrFileId, setSelectedQrFileId] = useState<string>('');
  const [qrScanPreview, setQrScanPreview] = useState<string>('');
  const [qrDecodedText, setQrDecodedText] = useState<string>('');
  const [qrScanError, setQrScanError] = useState<string>('');
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [qrCopied, setQrCopied] = useState<boolean>(false);
  const qrFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Stop camera helper
  const stopCamera = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Decode QR from File (Image or PDF)
  const handleScanQrFromFile = async (file: File) => {
    setQrScanError('');
    setQrDecodedText('');
    try {
      let imageSourceUrl = '';
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pages = await convertPdfToImages(file, { format: 'png', dpi: 150 });
        if (pages.length > 0) {
          imageSourceUrl = URL.createObjectURL(pages[0].blob);
        } else {
          setQrScanError(lang === 'ja' ? 'PDFからページを読み込めませんでした。' : 'Could not render PDF page.');
          return;
        }
      } else {
        imageSourceUrl = URL.createObjectURL(file);
      }

      setQrScanPreview(imageSourceUrl);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Try original scale first, then downscaled if very large
        const scales = [1, 0.5, 1.5];
        let foundCode: string | null = null;

        for (const s of scales) {
          canvas.width = Math.max(1, Math.floor(img.width * s));
          canvas.height = Math.max(1, Math.floor(img.height * s));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            foundCode = code.data;
            break;
          }
        }

        if (foundCode) {
          setQrDecodedText(foundCode);
          notifyCompletion(lang === 'ja' ? 'QRコードを読み取りました' : 'QR Code Decoded', foundCode.slice(0, 50));
          if (onShowToast) onShowToast(lang === 'ja' ? 'QRコードの読み取りに成功しました' : 'QR Code successfully decoded');
        } else {
          setQrScanError(
            lang === 'ja'
              ? '画像からQRコードが検出されませんでした。鮮明な画像を選択してください。'
              : 'No QR code detected in this image. Please try a clearer image.'
          );
        }
      };
      img.onerror = () => {
        setQrScanError(lang === 'ja' ? '画像の読み込みに失敗しました。' : 'Failed to load image.');
      };
      img.src = imageSourceUrl;
    } catch (err: any) {
      setQrScanError(err?.message || 'QR Scan failed');
    }
  };

  // Start Camera for real-time QR scanning
  const startCamera = async (mode: 'environment' | 'user' = facingMode) => {
    stopCamera();
    setQrScanError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        requestAnimationFrame(tickCameraScan);
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setQrScanError(
        lang === 'ja'
          ? 'カメラへのアクセスが許可されていないか、利用可能なカメラが見つかりません。ブラウザのカメラ権限設定をご確認ください。'
          : 'Camera access denied or no camera available. Please check browser permissions.'
      );
      setIsCameraActive(false);
    }
  };

  const tickCameraScan = () => {
    const video = videoRef.current;
    const canvas = scanCanvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code && code.data) {
          setQrDecodedText(code.data);
          setQrScanPreview(canvas.toDataURL('image/png'));
          stopCamera();
          notifyCompletion(lang === 'ja' ? 'カメラでQRコードを読み取りました' : 'QR Code Scanned via Camera', code.data.slice(0, 50));
          if (onShowToast) onShowToast(lang === 'ja' ? 'カメラからQRコードを読み取りました！' : 'QR Code scanned from camera!');
          return;
        }
      }
    }
    if (streamRef.current) {
      animFrameRef.current = requestAnimationFrame(tickCameraScan);
    }
  };

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
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(file.name))) {
      setOcrImagePreview(URL.createObjectURL(file));
    } else {
      setOcrImagePreview('');
    }
    setExtractedText('');
    setIsOcrProcessing(true);
    setOcrProgress(5);

    try {
      if (isPdf) {
        let text = '';
        try {
          text = await extractPdfText(file);
        } catch (pdfTextErr) {
          console.warn('Direct PDF text extraction failed, trying OCR fallback:', pdfTextErr);
        }

        if (!text || text.trim().length === 0) {
          // If PDF contains scanned images without digital text layer, convert first page to image and OCR
          try {
            setOcrProgress(20);
            const pageImages = await convertPdfToImages(file, { format: 'png', pages: [1], dpi: 150 });
            if (pageImages && pageImages.length > 0) {
              setOcrImagePreview(URL.createObjectURL(pageImages[0].blob));
              const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
                const img = new Image();
                const u = URL.createObjectURL(pageImages[0].blob);
                img.onload = () => {
                  URL.revokeObjectURL(u);
                  const c = document.createElement('canvas');
                  c.width = img.naturalWidth || img.width;
                  c.height = img.naturalHeight || img.height;
                  const ctx = c.getContext('2d');
                  if (ctx) ctx.drawImage(img, 0, 0);
                  resolve(c);
                };
                img.onerror = (err) => {
                  URL.revokeObjectURL(u);
                  reject(err);
                };
                img.src = u;
              });

              const result = await Tesseract.recognize(canvas, ocrLang, {
                logger: (m) => {
                  if (m.status === 'recognizing text' && typeof m.progress === 'number') {
                    setOcrProgress(Math.round(20 + m.progress * 80));
                  }
                },
              });
              text = result.data.text.trim();
            }
          } catch (ocrFallbackErr) {
            console.warn('PDF OCR fallback failed:', ocrFallbackErr);
          }
        }

        const finalText = text || (lang === 'ja' ? '(PDFからテキストが抽出されませんでした。画像スキャンPDFの場合は画像形式に変換してOCRをお試しください。)' : '(No text extracted from PDF)');
        setExtractedText(finalText);
        setIsOcrProcessing(false);
      } else {
        // Decode image through browser native image element and canvas to ensure full format compatibility
        const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
          const img = new Image();
          const u = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(u);
            const c = document.createElement('canvas');
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              resolve(c);
            } else {
              reject(new Error('Canvas context not available'));
            }
          };
          img.onerror = () => {
            URL.revokeObjectURL(u);
            reject(new Error(lang === 'ja' ? '画像の読み込みに失敗しました' : 'Error attempting to read image.'));
          };
          img.src = u;
        });

        // Run genuine Client-Side Tesseract.js OCR on standard canvas
        const result = await Tesseract.recognize(canvas, ocrLang, {
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
        file={pendingPromptFile?.file || null}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (!pendingPromptFile) return;
          if (onAddFiles) {
            onAddFiles([pendingPromptFile.file]);
          }
          if (pendingPromptFile.mode === 'ocr') {
            handleSelectOcrFile(pendingPromptFile.file);
          } else {
            handleScanQrFromFile(pendingPromptFile.file);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={() => {
          if (!pendingPromptFile) return;
          if (pendingPromptFile.mode === 'ocr') {
            handleSelectOcrFile(pendingPromptFile.file);
          } else {
            handleScanQrFromFile(pendingPromptFile.file);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'このタブのみに読み込みました' : 'Loaded into this tab only');
          }
          setPendingPromptFile(null);
        }}
      />

      {/* Sub Tabs */}
      <div className="grid grid-cols-3 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 max-w-lg mx-auto w-full">
        <button
          onClick={() => {
            stopCamera();
            setActiveTab('ocr');
          }}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition ${
            activeTab === 'ocr'
              ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <ScanText className="w-4 h-4 shrink-0" />
          <span>{lang === 'ja' ? 'OCR 文字認識' : 'OCR Text Scan'}</span>
        </button>
        <button
          onClick={() => {
            setActiveTab('qr-scan');
          }}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition ${
            activeTab === 'qr-scan'
              ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <ScanLine className="w-4 h-4 shrink-0" />
          <span>{lang === 'ja' ? 'QRコード読み取り' : 'Scan QR Code'}</span>
        </button>
        <button
          onClick={() => {
            stopCamera();
            setActiveTab('qr');
          }}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition ${
            activeTab === 'qr'
              ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <QrCode className="w-4 h-4 shrink-0" />
          <span>{lang === 'ja' ? 'QRコード生成' : 'Create QR Code'}</span>
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
              <input
                ref={ocrInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setPendingPromptFile({ file: e.target.files[0], mode: 'ocr' });
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>

          {/* Select Loaded File from Main Queue */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? 'OCR対象の画像 / PDFファイルを選択:' : 'Select Target Image or PDF File:'}
            </label>
            <select
              value={selectedFileId}
              onChange={(e) => {
                const id = e.target.value;
                if (id === '__upload_new__') {
                  ocrInputRef.current?.click();
                  return;
                }
                setSelectedFileId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  handleSelectOcrFile(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされた画像/PDFを選択 --' : '-- Select Loaded Image/PDF --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しい画像/PDFを端末からアップロード...' : '📁 + Upload New Image/PDF File...'}
              </option>
              {fileList
                .filter(
                  (f) =>
                    ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf'].includes(f.format?.toLowerCase() || '') ||
                    /\.(png|jpe?g|webp|bmp|pdf)$/i.test(f.name)
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
          </div>

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

      {/* 1.5. QR Code Scanner Tool (Camera & Image) */}
      {activeTab === 'qr-scan' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? 'カメラ・画像・PDFからQRコード読み取り' : 'Scan QR Code from Camera, Image, or PDF'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? '端末のカメラを使ったリアルタイムスキャン、または画像・スクリーンショット・PDF内のQRコードを高速解析します。'
                  : 'Scan QR codes in real-time using your device camera or decode directly from image files and PDFs.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  stopCamera();
                  setQrScanMode('image');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  qrScanMode === 'image'
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '画像・PDFから読取' : 'From Image / PDF'}</span>
              </button>

              <button
                onClick={() => {
                  setQrScanMode('camera');
                  startCamera(facingMode);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  qrScanMode === 'camera'
                    ? 'border-blue-600 bg-blue-600 text-white shadow-xs'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? 'カメラでスキャン' : 'Scan with Camera'}</span>
              </button>
            </div>
          </div>

          {/* Select Loaded File from Main Queue */}
          {qrScanMode === 'image' && (
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                {lang === 'ja' ? '読み込み済みファイルからQRを解析:' : 'Decode QR from Loaded Files:'}
              </label>
              <select
                value={selectedQrFileId}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id === '__upload_new__') {
                    qrFileInputRef.current?.click();
                    return;
                  }
                  setSelectedQrFileId(id);
                  const found = fileList.find((f) => f.id === id);
                  if (found && found.file) {
                    handleScanQrFromFile(found.file);
                  }
                }}
                className="main-select"
              >
                <option value="">{lang === 'ja' ? '-- アップロードされた画像/PDFを選択 --' : '-- Select Loaded Image/PDF --'}</option>
                <option value="__upload_new__">
                  {lang === 'ja' ? '📁 ＋ 新しい画像/PDFを端末からアップロード...' : '📁 + Upload New Image/PDF File...'}
                </option>
                {fileList
                  .filter(
                    (f) =>
                      ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf'].includes(f.format?.toLowerCase() || '') ||
                      /\.(png|jpe?g|webp|bmp|pdf)$/i.test(f.name)
                  )
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({(f.size / 1024).toFixed(1)} KB)
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Left: Camera Viewport or Image Dropzone */}
            <div className="flex flex-col gap-3">
              {qrScanMode === 'camera' ? (
                <div className="flex flex-col gap-3">
                  <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-video flex items-center justify-center">
                    <video
                      ref={videoRef}
                      className={`w-full h-full object-cover ${isCameraActive ? 'block' : 'hidden'}`}
                      muted
                      playsInline
                    />
                    <canvas ref={scanCanvasRef} className="hidden" />

                    {isCameraActive && (
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-48 h-48 border-2 border-emerald-400/90 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] relative">
                          <div className="absolute inset-x-2 top-1/2 h-0.5 bg-emerald-400 animate-pulse" />
                        </div>
                      </div>
                    )}

                    {!isCameraActive && (
                      <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 gap-3">
                        <Camera className="w-10 h-10 text-slate-500" />
                        <p className="text-xs">
                          {lang === 'ja'
                            ? 'カメラを起動してQRコードを枠内に合わせてください'
                            : 'Start the camera and align the QR code within the frame'}
                        </p>
                        <button
                          onClick={() => startCamera(facingMode)}
                          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition"
                        >
                          {lang === 'ja' ? 'カメラを起動する' : 'Start Camera'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => {
                        const nextMode = facingMode === 'environment' ? 'user' : 'environment';
                        setFacingMode(nextMode);
                        if (isCameraActive) startCamera(nextMode);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>
                        {lang === 'ja'
                          ? `カメラ切替 (${facingMode === 'environment' ? '背面' : '前面'})`
                          : `Switch Camera (${facingMode})`}
                      </span>
                    </button>

                    {isCameraActive && (
                      <button
                        onClick={stopCamera}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 transition"
                      >
                        <CameraOff className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? 'カメラ停止' : 'Stop Camera'}</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <input
                    ref={qrFileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setPendingPromptFile({ file: e.target.files[0], mode: 'qr-scan' });
                        e.target.value = '';
                      }
                    }}
                  />

                  <div
                    onClick={() => qrFileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 transition min-h-[200px]"
                  >
                    {qrScanPreview ? (
                      <div className="flex flex-col items-center gap-2">
                        <img src={qrScanPreview} alt="QR Scan Source" className="max-h-48 object-contain rounded-lg shadow-xs" />
                        <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold underline mt-1">
                          {lang === 'ja' ? '別の画像・PDFを選択する' : 'Choose another image or PDF'}
                        </span>
                      </div>
                    ) : (
                      <>
                        <QrCode className="w-10 h-10 text-slate-400 mb-2" />
                        <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                          {lang === 'ja' ? 'QRコードが含まれる画像またはPDFを選択' : 'Select an image or PDF containing a QR Code'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {lang === 'ja' ? 'PNG, JPG, WebP, BMP, PDF 対応' : 'Supports PNG, JPG, WebP, BMP, PDF'}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Decoded QR Result */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">
                  {lang === 'ja' ? 'QRコード読み取り結果' : 'Decoded QR Content'}
                </span>

                {qrDecodedText && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(qrDecodedText);
                        setQrCopied(true);
                        if (onShowToast) onShowToast(lang === 'ja' ? '読み取り結果をコピーしました' : 'Copied to clipboard');
                        setTimeout(() => setQrCopied(false), 2000);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                    >
                      {qrCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{qrCopied ? (lang === 'ja' ? 'コピー済' : 'Copied') : (lang === 'ja' ? 'コピー' : 'Copy')}</span>
                    </button>

                    {/^https?:\/\//i.test(qrDecodedText.trim()) && (
                      <a
                        href={qrDecodedText.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? 'URLを開く' : 'Open URL'}</span>
                      </a>
                    )}
                  </div>
                )}
              </div>

              {qrScanError && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                  {qrScanError}
                </div>
              )}

              <textarea
                value={qrDecodedText}
                onChange={(e) => setQrDecodedText(e.target.value)}
                placeholder={
                  lang === 'ja'
                    ? 'ここに読み取ったURLやテキストが表示されます...'
                    : 'Decoded URL or text will appear here...'
                }
                rows={7}
                className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500"
              />

              {qrDecodedText && (
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setQrText(qrDecodedText);
                      setQrType(/^https?:\/\//i.test(qrDecodedText) ? 'url' : 'text');
                      setActiveTab('qr');
                    }}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? 'この内容でQRコードを再生成・色変更する' : 'Customize & Re-generate QR with this content'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
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
