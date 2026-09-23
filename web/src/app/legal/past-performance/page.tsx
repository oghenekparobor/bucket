import type { Metadata } from 'next';
import { LegalPage } from '../LegalPage';

export const metadata: Metadata = { title: 'Past-performance notice (draft)' };

export default function Page() {
  return <LegalPage doc="past-performance" />;
}
