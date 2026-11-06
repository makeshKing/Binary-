import fs from 'fs';
import path from 'path';

export interface StoredPaymentProof {
  id: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  base64Data: string;
  createdAt: string;
}

const TMP_PROOF_DIR = '/tmp/pulseoption-payment-proofs';
const WORKSPACE_PROOF_DIR = path.join(process.cwd(), '.payment-proofs');

declare global {
  var __PAYMENT_PROOF_MEM_STORE__: Map<string, StoredPaymentProof> | undefined;
}

function getMemStore(): Map<string, StoredPaymentProof> {
  if (!globalThis.__PAYMENT_PROOF_MEM_STORE__) {
    globalThis.__PAYMENT_PROOF_MEM_STORE__ = new Map<string, StoredPaymentProof>();
  }
  return globalThis.__PAYMENT_PROOF_MEM_STORE__;
}

function ensureDirs() {
  for (const dir of [TMP_PROOF_DIR, WORKSPACE_PROOF_DIR]) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      // Ignore filesystem errors if read-only
    }
  }
}

export function savePaymentProofRecord(record: StoredPaymentProof): void {
  const store = getMemStore();
  store.set(record.id, record);

  ensureDirs();
  const serialized = JSON.stringify(record);

  for (const dir of [TMP_PROOF_DIR, WORKSPACE_PROOF_DIR]) {
    try {
      const filePath = path.join(dir, `${record.id}.json`);
      fs.writeFileSync(filePath, serialized, 'utf8');
    } catch {
      // In-memory store and alternate dir remain active fallback
    }
  }
}

export function getPaymentProofRecord(id: string): StoredPaymentProof | null {
  const cleanId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanId) return null;

  const store = getMemStore();
  const cached = store.get(cleanId);
  if (cached) return cached;

  for (const dir of [WORKSPACE_PROOF_DIR, TMP_PROOF_DIR]) {
    try {
      const filePath = path.join(dir, `${cleanId}.json`);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as StoredPaymentProof;
        store.set(cleanId, parsed);
        return parsed;
      }
    } catch {
      // Try next directory
    }
  }

  return null;
}
