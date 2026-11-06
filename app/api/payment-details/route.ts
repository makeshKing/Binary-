import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_MANUAL_PAYMENT_DETAILS,
  ManualPaymentDetailsState,
  ManualPaymentMethodConfig,
  PaymentMethodCode,
} from '@/lib/payment-details';
import {
  verifyAdminServerSession,
  createAuthenticatedAdminDbClient,
  createServiceRoleClient,
  hasRequiredRole,
} from '@/lib/supabase/admin-server';
import { recordAdminAuditLog } from '@/lib/admin/audit-and-rate-limit';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

// Server-side in-memory cache so updates persist immediately even if platform_settings
// does not have a custom JSONB column in the database.
let cachedPaymentDetails: ManualPaymentDetailsState = structuredClone(
  DEFAULT_MANUAL_PAYMENT_DETAILS
);

function sanitizeMethodConfig(
  code: PaymentMethodCode,
  raw: Partial<ManualPaymentMethodConfig> | undefined,
  fallback: ManualPaymentMethodConfig
): ManualPaymentMethodConfig {
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    code,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 80)
        : fallback.name,
    subtitle:
      typeof raw.subtitle === 'string' && raw.subtitle.trim()
        ? raw.subtitle.trim().slice(0, 120)
        : fallback.subtitle,
    enabled:
      typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    hideDetails:
      typeof raw.hideDetails === 'boolean'
        ? raw.hideDetails
        : Boolean(fallback.hideDetails),
    customMessage:
      typeof raw.customMessage === 'string'
        ? raw.customMessage.trim().slice(0, 400)
        : fallback.customMessage || '',
    accountName:
      typeof raw.accountName === 'string' && raw.accountName.trim()
        ? raw.accountName.trim().slice(0, 120)
        : fallback.accountName,
    accountIdentifier:
      typeof raw.accountIdentifier === 'string' && raw.accountIdentifier.trim()
        ? raw.accountIdentifier.trim().slice(0, 80)
        : fallback.accountIdentifier,
    bankName:
      typeof raw.bankName === 'string'
        ? raw.bankName.trim().slice(0, 100)
        : fallback.bankName || '',
    branchName:
      typeof raw.branchName === 'string'
        ? raw.branchName.trim().slice(0, 120)
        : fallback.branchName || '',
    qrCodeUrl:
      typeof raw.qrCodeUrl === 'string'
        ? raw.qrCodeUrl.trim().slice(0, 500)
        : fallback.qrCodeUrl || '',
    instructions:
      typeof raw.instructions === 'string' && raw.instructions.trim()
        ? raw.instructions.trim().slice(0, 400)
        : fallback.instructions,
    minAmountNpr:
      typeof raw.minAmountNpr === 'number' && Number.isFinite(raw.minAmountNpr)
        ? Math.max(100, raw.minAmountNpr)
        : fallback.minAmountNpr,
    maxAmountNpr:
      typeof raw.maxAmountNpr === 'number' && Number.isFinite(raw.maxAmountNpr)
        ? Math.max(1000, raw.maxAmountNpr)
        : fallback.maxAmountNpr,
    processingTime:
      typeof raw.processingTime === 'string' && raw.processingTime.trim()
        ? raw.processingTime.trim().slice(0, 60)
        : fallback.processingTime,
  };
}

function normalizePaymentDetailsState(
  raw: unknown
): ManualPaymentDetailsState {
  if (!raw || typeof raw !== 'object') {
    return cachedPaymentDetails;
  }
  const obj = raw as Partial<ManualPaymentDetailsState>;
  const rawMethods = (obj.methods || {}) as Partial<
    Record<PaymentMethodCode, Partial<ManualPaymentMethodConfig>>
  >;

  return {
    updatedAt:
      typeof obj.updatedAt === 'string'
        ? obj.updatedAt
        : cachedPaymentDetails.updatedAt,
    updatedByEmail:
      typeof obj.updatedByEmail === 'string'
        ? obj.updatedByEmail
        : cachedPaymentDetails.updatedByEmail,
    hideDepositDetails:
      typeof obj.hideDepositDetails === 'boolean'
        ? obj.hideDepositDetails
        : Boolean(cachedPaymentDetails.hideDepositDetails),
    depositMessage:
      typeof obj.depositMessage === 'string'
        ? obj.depositMessage.trim().slice(0, 600)
        : cachedPaymentDetails.depositMessage,
    showDepositMessageBanner:
      typeof obj.showDepositMessageBanner === 'boolean'
        ? obj.showDepositMessageBanner
        : Boolean(cachedPaymentDetails.showDepositMessageBanner),
    globalNotice:
      typeof obj.globalNotice === 'string' && obj.globalNotice.trim()
        ? obj.globalNotice.trim().slice(0, 400)
        : cachedPaymentDetails.globalNotice,
    supportContact:
      typeof obj.supportContact === 'string' && obj.supportContact.trim()
        ? obj.supportContact.trim().slice(0, 140)
        : cachedPaymentDetails.supportContact,
    requireTransactionId:
      typeof obj.requireTransactionId === 'boolean'
        ? obj.requireTransactionId
        : cachedPaymentDetails.requireTransactionId,
    methods: {
      ESEWA: sanitizeMethodConfig(
        'ESEWA',
        rawMethods.ESEWA,
        cachedPaymentDetails.methods.ESEWA
      ),
      KHALTI: sanitizeMethodConfig(
        'KHALTI',
        rawMethods.KHALTI,
        cachedPaymentDetails.methods.KHALTI
      ),
      BANK_TRANSFER: sanitizeMethodConfig(
        'BANK_TRANSFER',
        rawMethods.BANK_TRANSFER,
        cachedPaymentDetails.methods.BANK_TRANSFER
      ),
    },
  };
}

export async function GET() {
  try {
    if (isSupabaseConfigured()) {
      const supabase = await createServerSupabase();
      const { data } = await supabase
        .from('platform_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      const rawConfig = (data as Record<string, unknown> | null)
        ?.manual_payment_methods;
      if (rawConfig && typeof rawConfig === 'object') {
        cachedPaymentDetails = normalizePaymentDetailsState(rawConfig);
      }
    }
  } catch {
    // Fallback cleanly to cachedPaymentDetails
  }

  return NextResponse.json(
    { paymentDetails: cachedPaymentDetails },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const session = await verifyAdminServerSession('ADMIN');
  if (!session || !hasRequiredRole(session.role, 'ADMIN')) {
    return NextResponse.json(
      {
        error:
          'Forbidden: ADMIN or SUPERADMIN role required to update manual payment details.',
      },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const nextState = normalizePaymentDetailsState({
      ...body,
      updatedAt: new Date().toISOString(),
      updatedByEmail: session.email,
    });

    cachedPaymentDetails = nextState;

    // Attempt to persist in platform_settings if column exists
    const db =
      createServiceRoleClient() ||
      createAuthenticatedAdminDbClient(session.accessToken);
    if (db) {
      try {
        await db
          .from('platform_settings')
          .update({
            manual_payment_methods: nextState,
            updated_at: nextState.updatedAt,
            updated_by: session.userId,
          } as Record<string, unknown>)
          .eq('id', 1);
      } catch {
        // Ignore if manual_payment_methods column is not yet added in SQL
      }
    }

    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await recordAdminAuditLog({
      adminUserId: session.userId,
      adminEmail: session.email,
      action: 'PAYMENT_DETAILS_UPDATED',
      targetType: 'platform_settings',
      targetId: 'manual_payment_methods',
      metadata: {
        hide_deposit_details: nextState.hideDepositDetails,
        deposit_message: nextState.depositMessage,
        show_deposit_message_banner: nextState.showDepositMessageBanner,
        esewa_id: nextState.methods.ESEWA.accountIdentifier,
        khalti_id: nextState.methods.KHALTI.accountIdentifier,
        bank_account: nextState.methods.BANK_TRANSFER.accountIdentifier,
        enabled_methods: Object.values(nextState.methods)
          .filter((m) => m.enabled)
          .map((m) => m.code),
      },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({
      ok: true,
      paymentDetails: cachedPaymentDetails,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to update manual payment details.',
      },
      { status: 400 }
    );
  }
}
