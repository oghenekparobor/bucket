import type { Metadata } from 'next';
import { LegalPage } from '../LegalPage';

export const metadata: Metadata = { title: 'Terms of Service (draft)' };

export default function Page() {
  return <LegalPage doc="terms" />;
}
