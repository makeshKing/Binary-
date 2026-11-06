import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  AdminRole,
  getSupabaseConfig,
  isSupabaseConfigured,
  ProfileRow,
} from '@/lib/supabase/types';
import { ADMIN_AUTH_COOKIE_NAME } from '@/lib/supabase/admin-client';
import {
  clearAdminServerCookies,
  normalizeAdminRole,
  verifyAdminServerSession,
} from '@/lib/supabase/admin-server';
import {
  checkAdminLoginRateLimit,
  recordAdminAuditLog,
  recordAdminLoginAttempt,
} from '@/lib/admin/audit-and-rate-limit';

const GENERIC_AUTH_FAILURE_MESSAGE = 'Invalid credentials or no admin access';

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';

  try {
    const body = await req.json();
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    const totpCode = body.totpCode ? String(body.totpCode).trim() : '';
    const factorId = body.factorId ? String(body.factorId).trim() : '';
    const preAuthAccessToken = body.preAuthAccessToken
      ? String(body.preAuthAccessToken).trim()
      : '';
    const preAuthRefreshToken = body.preAuthRefreshToken
      ? String(body.preAuthRefreshToken).trim()
      : '';

    if (!email) {
      return NextResponse.json(
        { error: GENERIC_AUTH_FAILURE_MESSAGE },
        { status: 401 }
      );
    }

    // 1. RATE LIMIT CHECK: Max 5 failed attempts per 15 minutes per email and per IP
    const rateStatus = await checkAdminLoginRateLimit(email, ip);
    if (rateStatus.locked) {
      await recordAdminAuditLog({
        adminEmail: email,
        action: 'ADMIN_LOGIN_FAILED',
        targetType: 'auth',
        targetId: email,
        ipAddress: ip,
        userAgent,
        metadata: {
          reason: 'RATE_LIMIT_LOCKOUT',
          email_failed_attempts: rateStatus.emailFailedCount,
          ip_failed_attempts: rateStatus.ipFailedCount,
        },
      });

      return NextResponse.json(
        {
          error:
            'Too many failed login attempts (maximum 5 per 15 minutes). Your email/IP is temporarily locked for 15 minutes.',
          locked: true,
        },
        { status: 429 }
      );
    }

    // 2. DEMO / SANDBOX CREDENTIALS SUPPORT (When Supabase is not configured or for built-in testing accounts)
    if (!isSupabaseConfigured()) {
      const demoAccounts: Record<
        string,
        { pass: string; role: AdminRole | 'USER'; status: string }
      > = {
        'superadmin@pulseoption.demo': {
          pass: 'Admin123!',
          role: 'SUPERADMIN',
          status: 'ACTIVE',
        },
        'admin@pulseoption.demo': {
          pass: 'Admin123!',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
        'support@pulseoption.demo': {
          pass: 'Admin123!',
          role: 'SUPPORT',
          status: 'ACTIVE',
        },
        'trader@pulseoption.demo': {
          pass: 'Trader123!',
          role: 'USER',
          status: 'ACTIVE',
        },
      };

      const matched = demoAccounts[email];
      if (
        !matched ||
        matched.pass !== password ||
        matched.role === 'USER' ||
        matched.status !== 'ACTIVE'
      ) {
        await recordAdminLoginAttempt(email, ip, false);
        const postRate = await checkAdminLoginRateLimit(email, ip);
        await recordAdminAuditLog({
          adminEmail: email,
          action: 'ADMIN_LOGIN_FAILED',
          targetType: 'auth',
          targetId: email,
          ipAddress: ip,
          userAgent,
          metadata: {
            reason:
              matched?.role === 'USER'
                ? 'USER_ROLE_REJECTED'
                : 'INVALID_CREDENTIALS',
            failed_attempts: Math.max(
              postRate.emailFailedCount,
              postRate.ipFailedCount
            ),
          },
        });

        await clearAdminServerCookies();
        if (postRate.locked) {
          return NextResponse.json(
            {
              error:
                'Too many failed login attempts (maximum 5 per 15 minutes). Your email/IP is temporarily locked for 15 minutes.',
              locked: true,
            },
            { status: 429 }
          );
        }

        return NextResponse.json(
          { error: GENERIC_AUTH_FAILURE_MESSAGE },
          { status: 401 }
        );
      }

      await recordAdminLoginAttempt(email, ip, true);
      await recordAdminAuditLog({
        adminId: '00000000-0000-0000-0000-000000000001',
        adminEmail: email,
        action: 'ADMIN_LOGIN',
        targetType: 'session',
        targetId: ADMIN_AUTH_COOKIE_NAME,
        ipAddress: ip,
        userAgent,
        metadata: { role: matched.role, mode: 'demo' },
      });

      const cookiePayload = JSON.stringify({
        demoAdminSession: true,
        role: matched.role,
        email,
        issuedAt: Date.now(),
      });

      const isHttps =
        req.nextUrl.protocol === 'https:' ||
        (process.env.APP_URL || '').startsWith('https://');

      const res = NextResponse.json({
        ok: true,
        authenticated: true,
        role: matched.role,
        email,
        sessionPayload: cookiePayload,
      });

      res.cookies.set(ADMIN_AUTH_COOKIE_NAME, cookiePayload, {
        path: '/',
        maxAge: 60 * 60 * 8,
        sameSite: isHttps ? 'none' : 'lax',
        secure: isHttps,
      });

      return res;
    }

    // 3. REAL SUPABASE AUTHENTICATION + STRICT SERVER-SIDE ROLE & STATUS VERIFICATION
    const { url, anonKey } = getSupabaseConfig();
    const supabase = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    let activeSession = null;
    let activeUser = null;

    // Step 3A: If completing TOTP 2FA verification step
    if (totpCode && factorId && preAuthAccessToken && preAuthRefreshToken) {
      const { data: setSessionData, error: setSessionErr } =
        await supabase.auth.setSession({
          access_token: preAuthAccessToken,
          refresh_token: preAuthRefreshToken,
        });

      if (setSessionErr || !setSessionData.session) {
        await recordAdminLoginAttempt(email, ip, false);
        await recordAdminAuditLog({
          adminEmail: email,
          action: 'ADMIN_LOGIN_FAILED',
          targetType: 'mfa_totp',
          targetId: email,
          ipAddress: ip,
          userAgent,
          metadata: { reason: 'INVALID_PREAUTH_SESSION' },
        });
        return NextResponse.json(
          { error: GENERIC_AUTH_FAILURE_MESSAGE },
          { status: 401 }
        );
      }

      const { data: challengeData, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr || !challengeData) {
        await recordAdminLoginAttempt(email, ip, false);
        return NextResponse.json(
          { error: 'Invalid two-factor authentication challenge.' },
          { status: 401 }
        );
      }

      const { data: verifyData, error: verifyErr } =
        await supabase.auth.mfa.verify({
          factorId,
          challengeId: challengeData.id,
          code: totpCode,
        });

      if (verifyErr || !verifyData) {
        await recordAdminLoginAttempt(email, ip, false);
        await recordAdminAuditLog({
          adminId: setSessionData.user?.id,
          adminEmail: email,
          action: 'ADMIN_LOGIN_FAILED',
          targetType: 'mfa_totp',
          targetId: factorId,
          ipAddress: ip,
          userAgent,
          metadata: { reason: 'INVALID_TOTP_CODE' },
        });
        return NextResponse.json(
          { error: 'Invalid 6-digit authenticator code.' },
          { status: 401 }
        );
      }

      const {
        data: { session: upgradedSession },
      } = await supabase.auth.getSession();
      activeSession = upgradedSession ?? setSessionData.session;
      activeUser = activeSession?.user ?? setSessionData.user;
    } else {
      // Step 3B: Primary Email + Password Sign-In
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (signInError || !signInData.session || !signInData.user) {
        await recordAdminLoginAttempt(email, ip, false);
        const postRate = await checkAdminLoginRateLimit(email, ip);

        await recordAdminAuditLog({
          adminEmail: email,
          action: 'ADMIN_LOGIN_FAILED',
          targetType: 'auth',
          targetId: email,
          ipAddress: ip,
          userAgent,
          metadata: {
            reason: 'INVALID_PASSWORD_OR_EMAIL',
            failed_attempts: Math.max(
              postRate.emailFailedCount,
              postRate.ipFailedCount
            ),
          },
        });

        await clearAdminServerCookies();
        if (postRate.locked) {
          return NextResponse.json(
            {
              error:
                'Too many failed login attempts (maximum 5 per 15 minutes). Your email/IP is temporarily locked for 15 minutes.',
              locked: true,
            },
            { status: 429 }
          );
        }

        return NextResponse.json(
          { error: GENERIC_AUTH_FAILURE_MESSAGE },
          { status: 401 }
        );
      }

      activeSession = signInData.session;
      activeUser = signInData.user;
    }

    if (!activeSession || !activeUser) {
      await clearAdminServerCookies();
      return NextResponse.json(
        { error: GENERIC_AUTH_FAILURE_MESSAGE },
        { status: 401 }
      );
    }

    // 4. CHECK profiles.role AND profiles.status ON THE SERVER
    const authedDb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${activeSession.access_token}`,
        },
      },
    });

    const { data: profileData, error: profileError } = await authedDb
      .from('profiles')
      .select('*')
      .eq('id', activeUser.id)
      .single();

    const profile = profileData as ProfileRow | null;
    const adminRole = profile
      ? normalizeAdminRole(profile.role, profile.is_admin)
      : null;
    const status = String(profile?.status || 'ACTIVE').toUpperCase();

    // If role is NOT SUPPORT, ADMIN, or SUPERADMIN, or status !== ACTIVE:
    // Immediately sign out, clear cookie, log ADMIN_LOGIN_FAILED, and return generic message!
    if (profileError || !profile || !adminRole || status !== 'ACTIVE') {
      await supabase.auth.signOut().catch(() => {});
      await clearAdminServerCookies();
      await recordAdminLoginAttempt(email, ip, false);

      await recordAdminAuditLog({
        adminId: activeUser.id,
        adminEmail: email,
        action: 'ADMIN_LOGIN_FAILED',
        targetType: 'profile',
        targetId: activeUser.id,
        ipAddress: ip,
        userAgent,
        metadata: {
          reason: !adminRole
            ? 'NON_ADMIN_ROLE_REJECTED'
            : `ACCOUNT_STATUS_${status}`,
          attempted_role: profile?.role ?? 'UNKNOWN',
        },
        accessToken: activeSession.access_token,
      });

      const res = NextResponse.json(
        { error: GENERIC_AUTH_FAILURE_MESSAGE },
        { status: 401 }
      );
      res.cookies.delete(ADMIN_AUTH_COOKIE_NAME);
      return res;
    }

    // 5. CHECK IF ADMIN HAS ENROLLED SUPABASE TOTP 2FA FACTOR
    if (!totpCode) {
      try {
        const { data: factorsData } = await authedDb.auth.mfa.listFactors();
        const verifiedTotp = factorsData?.totp?.find(
          (f) => f.status === 'verified'
        );
        if (verifiedTotp) {
          return NextResponse.json({
            requiresTwoFactor: true,
            factorId: verifiedTotp.id,
            preAuthAccessToken: activeSession.access_token,
            preAuthRefreshToken: activeSession.refresh_token,
          });
        }
      } catch {
        // Proceed if MFA is not enabled on the Supabase project
      }
    }

    // 6. SUCCESSFUL ADMIN LOGIN: Record attempt, write ADMIN_LOGIN audit log, and set ONLY sb-admin-auth cookie
    await recordAdminLoginAttempt(email, ip, true);
    await recordAdminAuditLog({
      adminId: activeUser.id,
      adminEmail: email,
      action: 'ADMIN_LOGIN',
      targetType: 'session',
      targetId: activeUser.id,
      ipAddress: ip,
      userAgent,
      metadata: {
        role: adminRole,
        status,
        mfa_verified: Boolean(totpCode),
      },
      accessToken: activeSession.access_token,
    });

    const serializedSession = JSON.stringify({
      access_token: activeSession.access_token,
      refresh_token: activeSession.refresh_token,
      expires_at: activeSession.expires_at,
      expires_in: activeSession.expires_in,
      token_type: activeSession.token_type,
      user: activeUser,
    });

    const isHttps =
      req.nextUrl.protocol === 'https:' ||
      (process.env.APP_URL || '').startsWith('https://');

    const res = NextResponse.json({
      ok: true,
      authenticated: true,
      role: adminRole,
      email: activeUser.email || email,
      displayName: profile.display_name || profile.name || 'Admin',
      sessionPayload: serializedSession,
    });

    res.cookies.set(ADMIN_AUTH_COOKIE_NAME, serializedSession, {
      path: '/',
      maxAge: 60 * 60 * 8,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
    });

    return res;
  } catch {
    return NextResponse.json(
      { error: GENERIC_AUTH_FAILURE_MESSAGE },
      { status: 401 }
    );
  }
}

/**
 * Admin Logout: Clears ONLY the "sb-admin-auth" cookie and logs ADMIN_LOGOUT.
 * Never touches the user trading app's session cookies.
 */
export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';

  const adminSession = await verifyAdminServerSession('SUPPORT');
  if (adminSession) {
    await recordAdminAuditLog({
      adminId: adminSession.userId,
      adminEmail: adminSession.email,
      action: 'ADMIN_LOGOUT',
      targetType: 'session',
      targetId: adminSession.userId,
      ipAddress: ip,
      userAgent,
      metadata: { role: adminSession.role },
      accessToken: adminSession.accessToken,
    });
  }

  await clearAdminServerCookies();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_AUTH_COOKIE_NAME);
  return res;
}
