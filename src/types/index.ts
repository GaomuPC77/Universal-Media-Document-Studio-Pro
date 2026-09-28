export type DocumentFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'xls'
  | 'csv'
  | 'tsv'
  | 'txt'
  | 'md'
  | 'html'
  | 'json'
  | 'xml'
  | 'rtf'
  | 'epub'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'webp'
  | 'svg'
  | 'bmp'
  | 'ico'
  | 'gif'
  | 'zip';

export interface FileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  format: DocumentFormat;
  targetFormat: DocumentFormat;
  status: 'idle' | 'processing' | 'done' | 'error';
  progress: number;
  resultBlob?: Blob;
  resultName?: string;
  resultUrl?: string;
  error?: string;
  pageCount?: number;
  previewUrl?: string;
  customOptions?: Record<string, any>;
}

export interface PdfPageInfo {
  pageNumber: number;
  thumbnailUrl: string;
  width: number;
  height: number;
  rotation: number;
  selected?: boolean;
}

export interface HankoConfig {
  type: 'round' | 'square' | 'date' | 'custom';
  text: string;
  subText?: string;
  dateText?: string;
  fontFamily: 'serif' | 'sans-serif' | 'maru-gothic' | 'kaisei';
  color: string;
  size: number;
  borderWidth: number;
  opacity: number;
  outerRing: boolean;
  innerRing: boolean;
}

export interface SignatureStampPlacement {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageUrl: string;
  rotation: number;
}

export interface RedactionBox {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}
