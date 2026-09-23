'use client';

import { createContext, useContext } from 'react';
import type { AuthState } from './types';

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
