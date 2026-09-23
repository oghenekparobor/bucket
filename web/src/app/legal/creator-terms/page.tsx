import type { Metadata } from 'next';
import { LegalPage } from '../LegalPage';

export const metadata: Metadata = { title: 'Creator terms (draft)' };

export default function Page() {
  return <LegalPage doc="creator-terms" />;
}
