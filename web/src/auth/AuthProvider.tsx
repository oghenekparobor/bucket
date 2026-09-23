'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { config } from '@/lib/config';
import { DevAuthProvider } from './DevAuthProvider';

// Only pulled in when a Privy app id is configured.
const PrivyAuthProvider = dynamic(() => import('./PrivyAuthProvider'));

export function AuthProvider({ children }: { children: ReactNode }) {
  if (config.authMode === 'privy') return <PrivyAuthProvider>{children}</PrivyAuthProvider>;
  return <DevAuthProvider>{children}</DevAuthProvider>;
}
