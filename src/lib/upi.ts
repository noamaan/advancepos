import QRCode from 'qrcode';

/** Build a standard UPI intent URI (works with GPay / PhonePe / Paytm / BHIM). */
export function upiUri(opts: { pa: string; pn: string; am: number; tn: string }): string {
  const q = new URLSearchParams({
    pa: opts.pa,
    pn: opts.pn,
    am: opts.am.toFixed(2),
    cu: 'INR',
    tn: opts.tn.slice(0, 40),
  });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

/** Render the QR to a PNG data-URL (small margin, sized for thermal print). */
export async function upiQrDataUrl(uri: string, px = 160): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: px, errorCorrectionLevel: 'M' });
}
