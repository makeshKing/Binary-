import { NextRequest, NextResponse } from 'next/server';
import {
  savePaymentProofRecord,
  StoredPaymentProof,
} from '@/lib/payment-proof-store';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin-server';
import { isSupabaseConfigured } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

async function persistProofInSupabase(record: StoredPaymentProof): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const db = createServiceRoleClient() || (await createServerSupabase());
    await db.from('admin_audit_log').insert({
      action: 'PAYMENT_PROOF_UPLOADED',
      target_type: 'payment_proof',
      target_id: record.id,
      metadata: {
        id: record.id,
        mimeType: record.mimeType,
        fileName: record.fileName,
        sizeBytes: record.sizeBytes,
        base64Data: record.base64Data,
        createdAt: record.createdAt,
      },
    });
  } catch {
    // Local file and memory stores remain active
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = (req.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      const body = await req.json();
      const rawBase64 =
        typeof body?.base64Data === 'string' ? body.base64Data.trim() : '';
      const mimeType =
        typeof body?.mimeType === 'string' && body.mimeType.startsWith('image/')
          ? body.mimeType
          : 'image/jpeg';
      const fileName =
        typeof body?.fileName === 'string' && body.fileName.trim()
          ? body.fileName.trim()
          : 'payment-proof.jpg';
      const declaredSize = Number(body?.sizeBytes) || 0;

      if (!rawBase64) {
        return NextResponse.json(
          { error: 'Please select a payment proof screenshot image to upload.' },
          { status: 400 }
        );
      }

      if (declaredSize > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: 'Payment proof screenshot size must be 2 MB or less.' },
          { status: 400 }
        );
      }

      const cleanedBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanedBase64, 'base64');

      if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: 'Payment proof screenshot size must be 2 MB or less.' },
          { status: 400 }
        );
      }

      const id =
        typeof body?.id === 'string' && /^p_[a-zA-Z0-9_-]{4,40}$/.test(body.id)
          ? body.id
          : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

      const record: StoredPaymentProof = {
        id,
        mimeType,
        fileName,
        sizeBytes: declaredSize || buffer.byteLength,
        base64Data: cleanedBase64,
        createdAt: new Date().toISOString(),
      };

      savePaymentProofRecord(record);
      await persistProofInSupabase(record);

      const proofUrl = `/api/payment-proof/${id}`;
      return NextResponse.json({
        id,
        proofUrl,
        sizeBytes: record.sizeBytes,
      });
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Please select a payment proof screenshot image to upload.' },
        { status: 400 }
      );
    }

    if (!file.type || !file.type.startsWith('image/')) {
      return NextResponse.json(
        {
          error:
            'Invalid file type. Please upload an image screenshot (PNG, JPG, WEBP, or GIF).',
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: 'Payment proof screenshot size must be 2 MB or less.',
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const id = `p_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const record: StoredPaymentProof = {
      id,
      mimeType: file.type || 'image/png',
      fileName: file.name || 'payment-proof.png',
      sizeBytes: file.size,
      base64Data: buffer.toString('base64'),
      createdAt: new Date().toISOString(),
    };

    savePaymentProofRecord(record);
    await persistProofInSupabase(record);

    const proofUrl = `/api/payment-proof/${id}`;
    return NextResponse.json({
      id,
      proofUrl,
      sizeBytes: file.size,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to upload payment proof screenshot.',
      },
      { status: 500 }
    );
  }
}
