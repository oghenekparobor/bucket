'use client';

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { AuthProvider } from '@/auth/AuthProvider';
import { SessionProvider } from '@/auth/SessionProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ revalidateOnFocus: false, dedupingInterval: 2000, shouldRetryOnError: false }}>
      <AuthProvider>
        <SessionProvider>{children}</SessionProvider>
      </AuthProvider>
    </SWRConfig>
  );
}
