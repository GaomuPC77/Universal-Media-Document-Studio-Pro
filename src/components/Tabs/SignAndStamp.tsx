import React, { useState, useRef, useEffect } from 'react';
import {
  PenTool,
  Stamp,
  Shield,
  Download,
  Upload,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { HankoConfig, SignatureStampPlacement, RedactionBox } from '../../types';
import { generateHankoImage } from '../../utils/hankoUtils';
import { getPdfPages, enhancePdf } from '../../utils/pdfUtils';

interface SignAndStampProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
}

export const SignAndStamp: React.FC<SignAndStampProps> = ({ lang, sharedFile }) => {
  const [activeTab, setActiveTab] = useState<'hanko' | 'signature' | 'pdf-signer'>('hanko');

  // Hanko Config State
  const [hankoConfig, setHankoConfig] = useState<HankoConfig>({
    type: 'round',
    text: '山田',
    subText: '承認',
    dateText: '',
    fontFamily: 'serif',
    color: '#dc2626',
    size: 240,
    borderWidth: 6,
    opacity: 0.95,
    outerRing: true,
    innerRing: false,
  });
  const [hankoDataUrl, setHankoDataUrl] = useState<string>('');

  // Signature Pad State
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [sigColor, setSigColor] = useState('#0f172a');
  const [sigWidth, setSigWidth] = useState(3);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>('');

  // PDF Signer State
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState<{ pageNumber: number; thumbnailUrl: string; width: number; height: number }[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [stamps, setStamps] = useState<SignatureStampPlacement[]>([]);
  const [redactions, setRedactions] = useState<RedactionBox[]>([]);
  const [activeTool, setActiveTool] = useState<'stamp' | 'redact'>('stamp');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Auto load shared PDF when dropped
  useEffect(() => {
    if (sharedFile && (sharedFile.name.toLowerCase().endsWith('.pdf') || sharedFile.type === 'application/pdf')) {
      handleLoadPdf(sharedFile);
    }
  }, [sharedFile]);

  // Update Hanko on config change
  useEffect(() => {
    const url = generateHankoImage(hankoConfig);
    setHankoDataUrl(url);
  }, [hankoConfig]);

  // Handle PDF load for signing
  const handleLoadPdf = async (file: File) => {
    setPdfFile(file);
    setStamps([]);
    setRedactions([]);
    try {
      const pages = await getPdfPages(file);
      setPdfPages(pages);
      setCurrentPageIndex(0);
    } catch (e) {
      console.error('Failed to load PDF:', e);
    }
  };

  // Signature pad canvas handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.strokeStyle = sigColor;
    ctx.lineWidth = sigWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (sigCanvasRef.current) {
      setSignatureDataUrl(sigCanvasRef.current.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureDataUrl('');
  };

  // Click on PDF Page to place stamp or redaction
  const handlePdfPageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pdfPages[currentPageIndex]) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Scale to original page dimensions
    const scaleX = pdfPages[currentPageIndex].width / rect.width;
    const scaleY = pdfPages[currentPageIndex].height / rect.height;

    const pdfX = clickX * scaleX;
    const pdfY = clickY * scaleY;

    if (activeTool === 'stamp') {
      const stampImg = hankoDataUrl || signatureDataUrl;
      if (!stampImg) {
        alert(lang === 'ja' ? '電子印鑑または手書き署名を先に作成してください。' : 'Create a Hanko or Signature first.');
        return;
      }

      setStamps((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2, 9),
          pageIndex: currentPageIndex,
          x: pdfX - 40,
          y: pdfY - 40,
          width: 80,
          height: 80,
          imageUrl: stampImg,
          rotation: 0,
        },
      ]);
    } else if (activeTool === 'redact') {
      setRedactions((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2, 9),
          pageIndex: currentPageIndex,
          x: pdfX - 60,
          y: pdfY - 15,
          width: 120,
          height: 30,
          color: '#000000',
        },
      ]);
    }
  };

  // Export Signed and Redacted PDF
  const handleExportSignedPdf = async () => {
    if (!pdfFile) return;
    setIsExportingPdf(true);
    try {
      const fileBuffer = await pdfFile.arrayBuffer();
      const signedBytes = await enhancePdf(fileBuffer, {
        stamps,
        redactions,
      });

      const blob = new Blob([signedBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Signed_${pdfFile.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export signed PDF:', e);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Sub Tabs */}
      <div className="grid grid-cols-3 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 max-w-lg mx-auto w-full">
        {[
          { id: 'hanko', labelJa: '電子印鑑作成', labelEn: 'Digital Seal (Hanko)', icon: Stamp },
          { id: 'signature', labelJa: '手書き署名', labelEn: 'Signature Pad', icon: PenTool },
          { id: 'pdf-signer', labelJa: 'PDFへ捺印・黒塗り', labelEn: 'PDF Sign & Redact', icon: Shield },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center justify-center gap-2 py-2 px-2 rounded-lg text-xs font-bold transition ${
                isActive
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? tab.labelJa : tab.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Hanko Generator */}
      {activeTab === 'hanko' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          {/* Controls */}
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? '電子印鑑（認印・角印・日付印）ジェネレーター' : 'Digital Hanko & Stamp Generator'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? '本格的な印影を透過PNGとして瞬時に作成。PDFへ1クリックで捺印可能です。'
                  : 'Generate authentic transparent Japanese digital seals & stamps.'}
              </p>
            </div>

            {/* Seal Type */}
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                {lang === 'ja' ? '印鑑の形状' : 'Seal Type'}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'round', label: '丸印 (認印・代表印)' },
                  { id: 'square', label: '角印 (社判・領収用)' },
                  { id: 'date', label: 'データネーム (日付印)' },
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setHankoConfig((prev) => ({ ...prev, type: type.id as any }))}
                    className={`p-2 rounded-lg text-xs font-semibold border transition ${
                      hankoConfig.type === type.id
                        ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Text Input */}
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                {lang === 'ja' ? '印影の文字（氏名 / 会社名）' : 'Stamp Text'}
              </label>
              <input
                type="text"
                value={hankoConfig.text}
                onChange={(e) => setHankoConfig((prev) => ({ ...prev, text: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold"
                placeholder="山田 / 株式会社AI"
              />
            </div>

            {/* Date Seal Subtext & Date */}
            {hankoConfig.type === 'date' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">上部テキスト</label>
                  <input
                    type="text"
                    value={hankoConfig.subText || ''}
                    onChange={(e) => setHankoConfig((prev) => ({ ...prev, subText: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                    placeholder="承認"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">日付指定 (空白で本日)</label>
                  <input
                    type="text"
                    value={hankoConfig.dateText || ''}
                    onChange={(e) => setHankoConfig((prev) => ({ ...prev, dateText: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                    placeholder="2026.09.24"
                  />
                </div>
              </div>
            )}

            {/* Ink Color & Font */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {lang === 'ja' ? '印泥カラー' : 'Ink Color'}
                </label>
                <div className="flex gap-2">
                  {[
                    { color: '#dc2626', name: '朱赤' },
                    { color: '#b91c1c', name: '濃朱' },
                    { color: '#2563eb', name: '藍色' },
                    { color: '#0f172a', name: '黒' },
                  ].map((c) => (
                    <button
                      key={c.color}
                      onClick={() => setHankoConfig((prev) => ({ ...prev, color: c.color }))}
                      style={{ backgroundColor: c.color }}
                      className={`w-7 h-7 rounded-full transition ${
                        hankoConfig.color === c.color ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'opacity-80'
                      }`}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {lang === 'ja' ? '書体' : 'Font Style'}
                </label>
                <select
                  value={hankoConfig.fontFamily}
                  onChange={(e) => setHankoConfig((prev) => ({ ...prev, fontFamily: e.target.value as any }))}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
                >
                  <option value="serif">明朝体 (Mincho)</option>
                  <option value="sans-serif">ゴシック体 (Gothic)</option>
                  <option value="maru-gothic">丸ゴシック体 (Round)</option>
                  <option value="kaisei">古印体調 (Vintage)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Live Seal Preview & Download */}
          <div className="flex flex-col items-center justify-center p-8 bg-slate-100 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 gap-4">
            <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center">
              {hankoDataUrl && (
                <img src={hankoDataUrl} alt="Hanko Preview" className="w-40 h-40 object-contain animate-fade-in" />
              )}
            </div>

            <div className="flex gap-2">
              <a
                href={hankoDataUrl}
                download={`hanko_${hankoConfig.text}.png`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md shadow-red-500/20 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '透過PNGとして保存' : 'Download PNG'}</span>
              </a>

              <button
                onClick={() => setActiveTab('pdf-signer')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition"
              >
                <span>{lang === 'ja' ? 'PDFに捺印する →' : 'Use on PDF →'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Handwritten Signature Pad */}
      {activeTab === 'signature' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col items-center gap-5">
          <div className="text-center">
            <h3 className="font-bold text-base text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? '手書きサイン・電子署名パッド' : 'Handwritten Signature Pad'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'ja'
                ? 'マウスまたはタッチ画面で滑らかな署名を作成し、透過画像として保存またはPDFに直接配置できます。'
                : 'Draw smooth handwritten signatures on canvas.'}
            </p>
          </div>

          {/* Canvas */}
          <div className="border-2 border-slate-300 dark:border-slate-700 rounded-2xl overflow-hidden bg-white shadow-inner cursor-crosshair">
            <canvas
              ref={sigCanvasRef}
              width={500}
              height={220}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className="touch-none"
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 w-full max-w-lg">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {['#0f172a', '#2563eb', '#dc2626'].map((col) => (
                  <button
                    key={col}
                    onClick={() => setSigColor(col)}
                    style={{ backgroundColor: col }}
                    className={`w-6 h-6 rounded-full transition ${
                      sigColor === col ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'opacity-70'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 font-semibold">{lang === 'ja' ? '太さ:' : 'Size:'}</span>
                <select
                  value={sigWidth}
                  onChange={(e) => setSigWidth(parseInt(e.target.value, 10))}
                  className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-xs font-semibold"
                >
                  <option value={2}>細い (2px)</option>
                  <option value={3}>標準 (3px)</option>
                  <option value={5}>太い (5px)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={clearSignature}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100"
              >
                {lang === 'ja' ? 'クリア' : 'Clear'}
              </button>

              {signatureDataUrl && (
                <a
                  href={signatureDataUrl}
                  download="signature.png"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '署名を保存' : 'Save Sign'}</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. PDF Signer & Redaction Tool */}
      {activeTab === 'pdf-signer' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? 'PDFへの直接捺印・署名配置 & 機密情報黒塗り' : 'PDF Interactive Signer & Redaction Tool'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? 'クリックした位置に印鑑・署名を配置。また、隠したい機密部分を黒塗りマスキングできます。'
                  : 'Click anywhere on PDF pages to stamp signature or draw blackout redaction.'}
              </p>
            </div>

            <button
              onClick={() => pdfInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'PDFを開く' : 'Open PDF'}</span>
            </button>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) handleLoadPdf(e.target.files[0]);
              }}
            />
          </div>

          {!pdfFile ? (
            <div
              onClick={() => pdfInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <Shield className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? '捺印または黒塗りしたいPDFを選択' : 'Select PDF to sign or redact'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* PDF Placer Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {/* Tool toggle */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTool('stamp')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      activeTool === 'stamp' ? 'bg-red-600 text-white shadow-xs' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {lang === 'ja' ? '印鑑・署名スタンプ配置' : 'Stamp Placement'}
                  </button>
                  <button
                    onClick={() => setActiveTool('redact')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      activeTool === 'redact' ? 'bg-black text-white shadow-xs' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {lang === 'ja' ? '機密情報 黒塗りマスキング' : 'Blackout Redaction'}
                  </button>
                </div>

                {/* Page switcher */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {lang === 'ja' ? 'ページ:' : 'Page:'} {currentPageIndex + 1} / {pdfPages.length}
                  </span>
                  <div className="flex gap-1">
                    <button
                      disabled={currentPageIndex === 0}
                      onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                      className="px-2 py-1 rounded bg-white dark:bg-slate-900 disabled:opacity-40 font-bold border border-slate-200 dark:border-slate-700"
                    >
                      ‹
                    </button>
                    <button
                      disabled={currentPageIndex === pdfPages.length - 1}
                      onClick={() => setCurrentPageIndex((prev) => Math.min(pdfPages.length - 1, prev + 1))}
                      className="px-2 py-1 rounded bg-white dark:bg-slate-900 disabled:opacity-40 font-bold border border-slate-200 dark:border-slate-700"
                    >
                      ›
                    </button>
                  </div>
                </div>

                {/* Export Button */}
                <button
                  onClick={handleExportSignedPdf}
                  disabled={isExportingPdf}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs"
                >
                  {isExportingPdf ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>{lang === 'ja' ? '署名済みPDFを出力' : 'Export Signed PDF'}</span>
                </button>
              </div>

              {/* Interactive PDF Page Area */}
              <div className="flex justify-center p-4 bg-slate-200 dark:bg-slate-950 rounded-2xl overflow-auto min-h-[450px]">
                {pdfPages[currentPageIndex] && (
                  <div
                    onClick={handlePdfPageClick}
                    className="relative bg-white shadow-2xl rounded cursor-crosshair select-none max-w-full"
                    style={{
                      width: `${pdfPages[currentPageIndex].width * 0.75}px`,
                      height: `${pdfPages[currentPageIndex].height * 0.75}px`,
                    }}
                  >
                    <img
                      src={pdfPages[currentPageIndex].thumbnailUrl}
                      alt="PDF Page"
                      className="w-full h-full object-contain pointer-events-none"
                    />

                    {/* Render placed stamps for current page */}
                    {stamps
                      .filter((s) => s.pageIndex === currentPageIndex)
                      .map((s) => (
                        <div
                          key={s.id}
                          style={{
                            left: `${(s.x / pdfPages[currentPageIndex].width) * 100}%`,
                            top: `${(s.y / pdfPages[currentPageIndex].height) * 100}%`,
                            width: `${(s.width / pdfPages[currentPageIndex].width) * 100}%`,
                            height: `${(s.height / pdfPages[currentPageIndex].height) * 100}%`,
                          }}
                          className="absolute border border-blue-400/50 group"
                        >
                          <img src={s.imageUrl} alt="stamp" className="w-full h-full object-contain" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setStamps((prev) => prev.filter((item) => item.id !== s.id));
                            }}
                            className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow-xs"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}

                    {/* Render placed redaction boxes for current page */}
                    {redactions
                      .filter((r) => r.pageIndex === currentPageIndex)
                      .map((r) => (
                        <div
                          key={r.id}
                          style={{
                            left: `${(r.x / pdfPages[currentPageIndex].width) * 100}%`,
                            top: `${(r.y / pdfPages[currentPageIndex].height) * 100}%`,
                            width: `${(r.width / pdfPages[currentPageIndex].width) * 100}%`,
                            height: `${(r.height / pdfPages[currentPageIndex].height) * 100}%`,
                          }}
                          className="absolute bg-black group"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRedactions((prev) => prev.filter((item) => item.id !== r.id));
                            }}
                            className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow-xs"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
