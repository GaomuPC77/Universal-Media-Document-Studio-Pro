import QRCode from 'qrcode';

export interface QrOptions {
  text: string;
  width?: number;
  margin?: number;
  colorDark?: string;
  colorLight?: string;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Generate QR code as Data URL
 */
export async function generateQrCode(options: QrOptions): Promise<string> {
  return await QRCode.toDataURL(options.text, {
    width: options.width || 300,
    margin: options.margin || 2,
    color: {
      dark: options.colorDark || '#000000',
      light: options.colorLight || '#ffffff',
    },
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
  });
}
