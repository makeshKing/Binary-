import { NextRequest, NextResponse } from 'next/server';
import {
  getPaymentProofRecord,
  savePaymentProofRecord,
  StoredPaymentProof,
} from '@/lib/payment-proof-store';
import {
  createServiceRoleClient,
  verifyAdminServerSession,
  createAuthenticatedAdminDbClient,
} from '@/lib/supabase/admin-server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

async function loadProofFromSupabase(
  cleanId: string
): Promise<StoredPaymentProof | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    let db = createServiceRoleClient();
    if (!db) {
      const adminSession = await verifyAdminServerSession('SUPPORT');
      if (adminSession?.accessToken) {
        db = createAuthenticatedAdminDbClient(adminSession.accessToken);
      }
    }
    if (!db) {
      db = await createServerSupabase();
    }

    const { data } = await db
      .from('admin_audit_log')
      .select('metadata, created_at')
      .eq('action', 'PAYMENT_PROOF_UPLOADED')
      .eq('target_id', cleanId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const meta = (data as { metadata?: Record<string, unknown> } | null)
      ?.metadata;
    if (
      meta &&
      typeof meta.base64Data === 'string' &&
      meta.base64Data.length > 0
    ) {
      const recovered: StoredPaymentProof = {
        id: cleanId,
        mimeType:
          typeof meta.mimeType === 'string' ? meta.mimeType : 'image/jpeg',
        fileName:
          typeof meta.fileName === 'string'
            ? meta.fileName
            : 'payment-proof.jpg',
        sizeBytes: Number(meta.sizeBytes) || 0,
        base64Data: meta.base64Data,
        createdAt:
          typeof meta.createdAt === 'string'
            ? meta.createdAt
            : new Date().toISOString(),
      };
      savePaymentProofRecord(recovered);
      return recovered;
    }
  } catch {
    // Ignore DB lookup failure
  }

  return null;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const cleanId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  let record = getPaymentProofRecord(cleanId);

  if (!record && cleanId) {
    record = await loadProofFromSupabase(cleanId);
  }

  if (!record) {
    return new NextResponse('Payment proof screenshot not found', {
      status: 404,
    });
  }

  const buffer = Buffer.from(record.base64Data, 'base64');
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': record.mimeType || 'image/png',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
