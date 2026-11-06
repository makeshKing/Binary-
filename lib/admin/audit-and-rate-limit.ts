import { createClient } from '@supabase/supabase-js';
import {
  AdminAuditLogRow,
  getSupabaseConfig,
  isSupabaseConfigured,
} from '@/lib/supabase/types';
import { createServiceRoleClient } from '@/lib/supabase/admin-server';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

interface AttemptRecord {
  email: string;
  ip: string;
  succeeded: boolean;
  timestampMs: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ADMIN_LOGIN_ATTEMPTS__: AttemptRecord[] | undefined;
  // eslint-disable-next-line no-var
  var __ADMIN_AUDIT_FALLBACK_LOGS__: AdminAuditLogRow[] | undefined;
}

function getMemoryAttempts(): AttemptRecord[] {
  if (!globalThis.__ADMIN_LOGIN_ATTEMPTS__) {
    globalThis.__ADMIN_LOGIN_ATTEMPTS__ = [];
  }
  const cutoff = Date.now() - WINDOW_MS;
  globalThis.__ADMIN_LOGIN_ATTEMPTS__ =
    globalThis.__ADMIN_LOGIN_ATTEMPTS__.filter((a) => a.timestampMs >= cutoff);
  return globalThis.__ADMIN_LOGIN_ATTEMPTS__;
}

export function getMemoryAuditLogs(): AdminAuditLogRow[] {
  if (!globalThis.__ADMIN_AUDIT_FALLBACK_LOGS__) {
    globalThis.__ADMIN_AUDIT_FALLBACK_LOGS__ = [
      {
        id: 'audit-seed-1',
        admin_id: '00000000-0000-0000-0000-000000000001',
        admin_email: 'superadmin@pulseoption.demo',
        action: 'ADMIN_LOGIN',
        target_type: 'session',
        target_id: 'sb-admin-auth',
        ip_address: '127.0.0.1',
        user_agent: 'Mozilla/5.0 AdminConsole',
        metadata: { role: 'SUPERADMIN', note: 'Initial console session' },
        created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
      },
    ];
  }
  return globalThis.__ADMIN_AUDIT_FALLBACK_LOGS__;
}

/**
 * Checks whether the given email OR IP address has >= 5 failed login attempts
 * within the last 15 minutes.
 */
export async function checkAdminLoginRateLimit(
  rawEmail: string,
  rawIp: string
): Promise<{
  locked: boolean;
  emailFailedCount: number;
  ipFailedCount: number;
  retryAfterMinutes: number;
}> {
  const email = rawEmail.trim().toLowerCase();
  const ip = (rawIp || 'unknown').trim();
  const now = Date.now();
  const cutoffIso = new Date(now - WINDOW_MS).toISOString();

  const mem = getMemoryAttempts();
  let emailFailedCount = mem.filter(
    (a) => !a.succeeded && a.email === email
  ).length;
  let ipFailedCount = mem.filter((a) => !a.succeeded && a.ip === ip).length;

  if (isSupabaseConfigured()) {
    try {
      const { url, anonKey } = getSupabaseConfig();
      const serviceClient = createServiceRoleClient();
      const db =
        serviceClient ||
        createClient(url, anonKey, { auth: { persistSession: false } });

      const [emailRes, ipRes] = await Promise.all([
        db
          .from('admin_login_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('email', email)
          .eq('succeeded', false)
          .gte('created_at', cutoffIso),
        db
          .from('admin_login_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('ip_address', ip)
          .eq('succeeded', false)
          .gte('created_at', cutoffIso),
      ]);

      if (typeof emailRes.count === 'number') {
        emailFailedCount = Math.max(emailFailedCount, emailRes.count);
      }
      if (typeof ipRes.count === 'number') {
        ipFailedCount = Math.max(ipFailedCount, ipRes.count);
      }
    } catch {
      // Fallback to in-memory counter
    }
  }

  const locked =
    emailFailedCount >= MAX_FAILED_ATTEMPTS ||
    ipFailedCount >= MAX_FAILED_ATTEMPTS;

  return {
    locked,
    emailFailedCount,
    ipFailedCount,
    retryAfterMinutes: 15,
  };
}

/**
 * Records a login attempt (success or failure) in both memory and public.admin_login_attempts.
 */
export async function recordAdminLoginAttempt(
  rawEmail: string,
  rawIp: string,
  succeeded: boolean
): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const ip = (rawIp || 'unknown').trim();

  const mem = getMemoryAttempts();
  if (succeeded) {
    // Clear failed in-memory attempts for this email on success
    globalThis.__ADMIN_LOGIN_ATTEMPTS__ = mem.filter((a) => a.email !== email);
  } else {
    mem.push({
      email,
      ip,
      succeeded: false,
      timestampMs: Date.now(),
    });
  }

  if (isSupabaseConfigured()) {
    try {
      const { url, anonKey } = getSupabaseConfig();
      const serviceClient = createServiceRoleClient();
      const db =
        serviceClient ||
        createClient(url, anonKey, { auth: { persistSession: false } });

      await db.from('admin_login_attempts').insert({
        email,
        ip_address: ip,
        succeeded,
      });
    } catch {
      // Ignore if table not yet migrated
    }
  }
}

/**
 * Writes an immutable audit log entry to public.admin_audit_log AND the server memory log.
 */
export async function recordAdminAuditLog(params: {
  adminId?: string | null;
  adminUserId?: string | null;
  adminEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  accessToken?: string | null;
}): Promise<void> {
  const effectiveAdminId = params.adminId ?? params.adminUserId ?? null;
  const entry: AdminAuditLogRow = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    admin_id: effectiveAdminId,
    admin_email: params.adminEmail ?? null,
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
    metadata: params.metadata ?? {},
    created_at: new Date().toISOString(),
  };

  const memLogs = getMemoryAuditLogs();
  memLogs.unshift(entry);
  if (memLogs.length > 250) {
    memLogs.length = 250;
  }

  if (isSupabaseConfigured()) {
    try {
      const { url, anonKey } = getSupabaseConfig();
      const serviceClient = createServiceRoleClient();
      const db =
        serviceClient ||
        createClient(url, anonKey, {
          auth: { persistSession: false },
          global: params.accessToken
            ? { headers: { Authorization: `Bearer ${params.accessToken}` } }
            : undefined,
        });

      await db.from('admin_audit_log').insert({
        admin_id: effectiveAdminId,
        admin_email: params.adminEmail ?? null,
        action: params.action,
        target_type: params.targetType ?? null,
        target_id: params.targetId ?? null,
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
        metadata: params.metadata ?? {},
      });
    } catch {
      // Fallback already stored in memLogs
    }
  }
}
