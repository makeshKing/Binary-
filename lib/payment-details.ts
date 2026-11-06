export type PaymentMethodCode = 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER';

export interface ManualPaymentMethodConfig {
  code: PaymentMethodCode;
  name: string;
  subtitle: string;
  enabled: boolean;
  hideDetails?: boolean;
  customMessage?: string;
  accountName: string;
  accountIdentifier: string; // eSewa ID, Khalti ID, or Bank Account Number
  bankName?: string;
  branchName?: string;
  qrCodeUrl?: string;
  instructions: string;
  minAmountNpr: number;
  maxAmountNpr: number;
  processingTime: string;
}

export interface ManualPaymentDetailsState {
  updatedAt: string;
  updatedByEmail?: string;
  hideDepositDetails: boolean;
  depositMessage: string;
  showDepositMessageBanner: boolean;
  globalNotice: string;
  supportContact: string;
  requireTransactionId: boolean;
  methods: Record<PaymentMethodCode, ManualPaymentMethodConfig>;
}

export const DEFAULT_MANUAL_PAYMENT_DETAILS: ManualPaymentDetailsState = {
  updatedAt: new Date('2026-11-01T00:00:00Z').toISOString(),
  updatedByEmail: 'admin@quotex.local',
  hideDepositDetails: false,
  depositMessage:
    'Manual deposit account details are temporarily hidden by the administrator. Please contact support or check back shortly for updated payment instructions.',
  showDepositMessageBanner: false,
  globalNotice:
    'After sending funds to the official account, upload your payment proof screenshot (Max 2 MB) below for fast admin verification.',
  supportContact: 'Support Desk · Verified Manual Settlement (5–15 mins)',
  requireTransactionId: false,
  methods: {
    ESEWA: {
      code: 'ESEWA',
      name: 'eSewa Wallet',
      subtitle: 'Instant Nepal Mobile Wallet Transfer',
      enabled: true,
      hideDetails: false,
      customMessage: '',
      accountName: 'PulseOption Nepal Settlement',
      accountIdentifier: '9841778899',
      qrCodeUrl: '',
      instructions:
        'Open your eSewa app, select Send Money or scan the QR code, complete the transfer, and upload your payment proof screenshot (Max 2 MB).',
      minAmountNpr: 1350,
      maxAmountNpr: 500000,
      processingTime: '5–15 minutes',
    },
    KHALTI: {
      code: 'KHALTI',
      name: 'Khalti Digital Wallet',
      subtitle: 'Fast Khalti Wallet & QR Transfer',
      enabled: true,
      hideDetails: false,
      customMessage: '',
      accountName: 'PulseOption Nepal Settlement',
      accountIdentifier: '9801223344',
      qrCodeUrl: '',
      instructions:
        'Open your Khalti app, send to the Khalti ID above or scan the QR code, complete the transfer, and upload your payment proof screenshot (Max 2 MB).',
      minAmountNpr: 1350,
      maxAmountNpr: 500000,
      processingTime: '5–15 minutes',
    },
    BANK_TRANSFER: {
      code: 'BANK_TRANSFER',
      name: 'Nepal Bank / ConnectIPS',
      subtitle: 'Nabil Bank / Global IME / ConnectIPS',
      enabled: true,
      hideDetails: false,
      customMessage: '',
      accountName: 'PulseOption Trading Pvt. Ltd.',
      accountIdentifier: '01201017500982',
      bankName: 'Nabil Bank Limited',
      branchName: 'Teendhara Branch, Kathmandu',
      qrCodeUrl: '',
      instructions:
        'Transfer via Mobile Banking, Fonepay QR, or ConnectIPS to the bank account above and upload your payment proof screenshot (Max 2 MB).',
      minAmountNpr: 1350,
      maxAmountNpr: 1345000,
      processingTime: '10–30 minutes',
    },
  },
};

export interface ParsedPaymentProof {
  methodCode?: PaymentMethodCode;
  methodLabel?: string;
  transactionId?: string;
  screenshotUrl?: string;
  payoutAccountName?: string;
  payoutAccountId?: string;
  payoutBankName?: string;
  payoutBranchName?: string;
  userNote?: string;
  enteredCurrencySummary?: string;
  rawNote: string;
}

export function getMethodLabel(code: PaymentMethodCode): string {
  switch (code) {
    case 'ESEWA':
      return 'eSewa';
    case 'KHALTI':
      return 'Khalti';
    case 'BANK_TRANSFER':
      return 'Bank Transfer';
  }
}

export const MAX_PAYMENT_PROOF_BYTES = 2 * 1024 * 1024; // 2 MB

export function validatePaymentProofFile(file: File | null | undefined): string | null {
  if (!file) {
    return 'Please upload a payment proof screenshot image (Max 2 MB).';
  }
  if (!file.type || !file.type.startsWith('image/')) {
    return 'Please select a valid image file (PNG, JPG, WEBP, or GIF).';
  }
  if (file.size > MAX_PAYMENT_PROOF_BYTES) {
    return 'Payment proof screenshot size must be 2 MB or less.';
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.length > 0) {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read payment proof image file.'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Could not read payment proof image file.'));
    };
    reader.readAsDataURL(file);
  });
}

async function optimizeDataUrlForUpload(
  dataUrl: string,
  originalMimeType: string
): Promise<{ base64Data: string; mimeType: string }> {
  const fallbackBase64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { base64Data: fallbackBase64, mimeType: originalMimeType || 'image/jpeg' };
  }

  // Only compress if the base64 payload is larger than ~220 KB or not a GIF
  if (fallbackBase64.length < 220_000 || originalMimeType === 'image/gif') {
    return { base64Data: fallbackBase64, mimeType: originalMimeType || 'image/png' };
  }

  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      try {
        const maxDim = 1280;
        let width = img.naturalWidth || img.width || 800;
        let height = img.naturalHeight || img.height || 600;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({
            base64Data: fallbackBase64,
            mimeType: originalMimeType || 'image/jpeg',
          });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedUrl = canvas.toDataURL('image/jpeg', 0.82);
        const compressedBase64 = compressedUrl.replace(/^data:[^;]+;base64,/, '');
        if (compressedBase64.length > 0 && compressedBase64.length < fallbackBase64.length) {
          resolve({ base64Data: compressedBase64, mimeType: 'image/jpeg' });
        } else {
          resolve({
            base64Data: fallbackBase64,
            mimeType: originalMimeType || 'image/jpeg',
          });
        }
      } catch {
        resolve({
          base64Data: fallbackBase64,
          mimeType: originalMimeType || 'image/jpeg',
        });
      }
    };
    img.onerror = () => {
      resolve({
        base64Data: fallbackBase64,
        mimeType: originalMimeType || 'image/jpeg',
      });
    };
    img.src = dataUrl;
  });
}

export async function uploadPaymentProofScreenshot(
  file: File,
  preloadedDataUrl?: string | null
): Promise<string> {
  const validationError = validatePaymentProofFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  let sourceDataUrl =
    typeof preloadedDataUrl === 'string' && preloadedDataUrl.startsWith('data:image/')
      ? preloadedDataUrl
      : '';

  if (!sourceDataUrl) {
    sourceDataUrl = await readFileAsDataUrl(file);
  }

  const { base64Data, mimeType } = await optimizeDataUrlForUpload(
    sourceDataUrl,
    file.type || 'image/jpeg'
  );

  const clientProofId = `p_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;

  const payload = JSON.stringify({
    id: clientProofId,
    fileName: file.name || 'payment-proof.jpg',
    mimeType,
    sizeBytes: file.size,
    base64Data,
  });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/payment-proof', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.proofUrl) {
        return data.proofUrl as string;
      }
      if (res.status >= 400 && res.status < 500 && data?.error) {
        throw new Error(data.error);
      }
      lastError = new Error(
        data?.error || 'Failed to upload payment proof screenshot (Max 2 MB).'
      );
    } catch (err) {
      if (
        err instanceof Error &&
        !err.message.toLowerCase().includes('fetch') &&
        !err.message.toLowerCase().includes('network')
      ) {
        throw err;
      }
      lastError =
        err instanceof Error
          ? err
          : new Error('Network error while uploading payment proof.');
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  }

  // Resilient fallback if the preview proxy temporarily dropped the upload connection
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `pulseoption_proof_${clientProofId}`,
        `data:${mimeType};base64,${base64Data}`
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  if (lastError && !lastError.message.toLowerCase().includes('fetch')) {
    throw lastError;
  }

  return `/api/payment-proof/${clientProofId}`;
}

export function buildPaymentProofNote(params: {
  userNumber: number | string | null;
  methodCode?: PaymentMethodCode;
  transactionId?: string;
  screenshotUrl?: string;
  userNote?: string;
  currencySuffix?: string;
}): string {
  const parts: string[] = [];
  if (params.userNumber) {
    parts.push(`[User ID: ${params.userNumber}]`);
  }
  if (params.methodCode) {
    parts.push(`[Method: ${getMethodLabel(params.methodCode)}]`);
  }
  if (params.transactionId && params.transactionId.trim()) {
    parts.push(`[UTR: ${params.transactionId.trim()}]`);
  }
  if (params.screenshotUrl && params.screenshotUrl.trim()) {
    parts.push(`[Proof: ${params.screenshotUrl.trim()}]`);
  }
  if (params.userNote && params.userNote.trim()) {
    parts.push(params.userNote.trim());
  }
  if (params.currencySuffix && params.currencySuffix.trim()) {
    parts.push(params.currencySuffix.trim());
  }
  return parts.join(' ').slice(0, 275);
}

export function buildWithdrawalPayoutNote(params: {
  userNumber: number | string | null;
  methodCode: PaymentMethodCode;
  accountName: string;
  accountIdentifier: string;
  bankName?: string;
  branchName?: string;
  userNote?: string;
  currencySuffix?: string;
}): string {
  const parts: string[] = [];
  if (params.userNumber) {
    parts.push(`[User ID: ${params.userNumber}]`);
  }
  parts.push(`[Method: ${getMethodLabel(params.methodCode)}]`);
  if (params.methodCode === 'BANK_TRANSFER' && params.bankName?.trim()) {
    parts.push(`[Bank: ${params.bankName.trim()}]`);
  }
  if (params.methodCode === 'BANK_TRANSFER' && params.branchName?.trim()) {
    parts.push(`[Branch: ${params.branchName.trim()}]`);
  }
  if (params.accountName.trim()) {
    parts.push(`[Payout Name: ${params.accountName.trim()}]`);
  }
  if (params.accountIdentifier.trim()) {
    parts.push(
      params.methodCode === 'BANK_TRANSFER'
        ? `[Account No: ${params.accountIdentifier.trim()}]`
        : `[Payout ID: ${params.accountIdentifier.trim()}]`
    );
  }
  if (params.userNote && params.userNote.trim()) {
    parts.push(params.userNote.trim());
  }
  if (params.currencySuffix && params.currencySuffix.trim()) {
    parts.push(params.currencySuffix.trim());
  }
  return parts.join(' ').slice(0, 480);
}

export function parsePaymentProofFromNote(
  note: string | null | undefined
): ParsedPaymentProof {
  const rawNote = (note || '').trim();
  if (!rawNote) {
    return { rawNote: '' };
  }

  const methodMatch = rawNote.match(/\[Method:\s*([^\]]+)\]/i);
  const utrMatch = rawNote.match(/\[UTR:\s*([^\]]+)\]/i);
  const proofMatch = rawNote.match(/\[Proof:\s*([^\]]+)\]/i);
  const payoutNameMatch = rawNote.match(/\[Payout Name:\s*([^\]]+)\]/i);
  const payoutIdMatch =
    rawNote.match(/\[Payout ID:\s*([^\]]+)\]/i) ||
    rawNote.match(/\[Account No:\s*([^\]]+)\]/i);
  const bankMatch = rawNote.match(/\[Bank:\s*([^\]]+)\]/i);
  const branchMatch = rawNote.match(/\[Branch:\s*([^\]]+)\]/i);
  const enteredMatch = rawNote.match(/\[Entered as\s*([^\]]+)\]/i);

  let methodCode: PaymentMethodCode | undefined;
  const methodLabel = methodMatch ? methodMatch[1].trim() : undefined;
  if (methodLabel) {
    const upper = methodLabel.toUpperCase();
    if (upper.includes('ESEWA')) methodCode = 'ESEWA';
    else if (upper.includes('KHALTI')) methodCode = 'KHALTI';
    else if (upper.includes('BANK')) methodCode = 'BANK_TRANSFER';
  }

  const cleanedNote = rawNote
    .replace(/\[User ID:\s*[^\]]+\]/gi, '')
    .replace(/\[Method:\s*[^\]]+\]/gi, '')
    .replace(/\[UTR:\s*[^\]]+\]/gi, '')
    .replace(/\[Proof:\s*[^\]]+\]/gi, '')
    .replace(/\[Payout Name:\s*[^\]]+\]/gi, '')
    .replace(/\[Payout ID:\s*[^\]]+\]/gi, '')
    .replace(/\[Account No:\s*[^\]]+\]/gi, '')
    .replace(/\[Bank:\s*[^\]]+\]/gi, '')
    .replace(/\[Branch:\s*[^\]]+\]/gi, '')
    .replace(/\[Entered as\s*[^\]]+\]/gi, '')
    .replace(/^User ID:\s*\d+\s*/i, '')
    .trim();

  return {
    methodCode,
    methodLabel,
    transactionId: utrMatch ? utrMatch[1].trim() : undefined,
    screenshotUrl: proofMatch ? proofMatch[1].trim() : undefined,
    payoutAccountName: payoutNameMatch ? payoutNameMatch[1].trim() : undefined,
    payoutAccountId: payoutIdMatch ? payoutIdMatch[1].trim() : undefined,
    payoutBankName: bankMatch ? bankMatch[1].trim() : undefined,
    payoutBranchName: branchMatch ? branchMatch[1].trim() : undefined,
    enteredCurrencySummary: enteredMatch ? enteredMatch[1].trim() : undefined,
    userNote: cleanedNote || undefined,
    rawNote,
  };
}

export function formatShareablePaymentText(
  state: ManualPaymentDetailsState,
  pageUrl: string,
  filterMethod?: PaymentMethodCode,
  exchangeRate?: number
): string {
  const lines: string[] = [];
  lines.push('=== MANUAL DEPOSIT PAYMENT DETAILS ===');
  if (exchangeRate && Number.isFinite(exchangeRate)) {
    lines.push(`Active Exchange Rate: 1 USDT = Rs ${exchangeRate.toFixed(2)} NPR`);
  }
  lines.push('');

  if (state.hideDepositDetails) {
    lines.push(
      state.depositMessage?.trim() ||
        'Manual deposit account details are currently hidden by the administrator. Please check the deposit page or contact support.'
    );
    lines.push('');
    lines.push(`Deposit Page: ${pageUrl}`);
    return lines.join('\n');
  }

  if (state.showDepositMessageBanner && state.depositMessage?.trim()) {
    lines.push(`DEPOSIT NOTICE: ${state.depositMessage.trim()}`);
    lines.push('');
  }

  const codes: PaymentMethodCode[] = filterMethod
    ? [filterMethod]
    : (['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as const);

  for (const code of codes) {
    const m = state.methods[code];
    if (!m || (!m.enabled && !filterMethod)) continue;
    lines.push(`• ${m.name} (${getMethodLabel(code)})`);
    if (m.hideDetails) {
      lines.push(
        `  Notice: ${
          m.customMessage?.trim() ||
          state.depositMessage?.trim() ||
          'Account details for this method are currently hidden.'
        }`
      );
      lines.push('');
      continue;
    }
    lines.push(`  Account Name: ${m.accountName}`);
    if (code === 'BANK_TRANSFER') {
      if (m.bankName) lines.push(`  Bank Name: ${m.bankName}`);
      lines.push(`  Account Number: ${m.accountIdentifier}`);
      if (m.branchName) lines.push(`  Branch: ${m.branchName}`);
    } else {
      lines.push(`  ${getMethodLabel(code)} ID: ${m.accountIdentifier}`);
    }
    lines.push(`  Instructions: ${m.instructions}`);
    lines.push('');
  }

  lines.push(`IMPORTANT: ${state.globalNotice}`);
  lines.push(`Submit Payment Proof & View QR Codes: ${pageUrl}`);
  return lines.join('\n');
}
