'use client';

import React, { useEffect } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { performFullLogout } from '@/lib/supabase/auth-utils';

export default function LogoutPage() {
  useEffect(() => {
    void performFullLogout('logged_out');
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#171a23] text-slate-100 p-6">
      <div className="w-full max-w-sm bg-[#1c202b] border border-[#2e3446] rounded-2xl p-6 text-center space-y-3 shadow-2xl">
        <div className="w-10 h-10 rounded-xl bg-[#252a3a] border border-[#343b4f] flex items-center justify-center mx-auto text-[#3898ff]">
          <LogOut className="w-5 h-5" />
        </div>
        <h1 className="text-base font-bold text-white">Signing Out...</h1>
        <p className="text-xs text-[#8c94ab] flex items-center justify-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3898ff]" />
          <span>Clearing session and redirecting to login...</span>
        </p>
      </div>
    </div>
  );
}
