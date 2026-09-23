import type { Metadata } from 'next';
import { LegalPage } from '../LegalPage';

export const metadata: Metadata = { title: 'Risk disclosures (draft)' };

export default function Page() {
  return <LegalPage doc="risks" />;
}
