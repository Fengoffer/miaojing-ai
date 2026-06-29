import { CreatePageClient } from '@/components/create/create-page-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function CreatePage() {
  return <CreatePageClient />;
}
