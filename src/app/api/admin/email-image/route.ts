import { NextRequest, NextResponse } from 'next/server';
import { resolveAdminEmailImagePublicBaseUrl, saveAdminEmailImageUpload } from '@/lib/admin-email-image-upload';
import { getEmailSettings, getRequestBaseUrl } from '@/lib/email-service';
import { requireAdminUser } from '@/lib/session-auth';
import { getDbClient } from '@/storage/database/local-db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '请选择要上传的图片' }, { status: 400 });
    }

    const publicBaseUrl = await resolveMailImagePublicBaseUrl(request);
    const result = await saveAdminEmailImageUpload(file, { publicBaseUrl });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片上传失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function resolveMailImagePublicBaseUrl(request: NextRequest): Promise<string> {
  const requestBaseUrl = getRequestBaseUrl(request);
  const envBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || '';
  const client = await getDbClient();
  try {
    const settings = await getEmailSettings(client);
    return resolveAdminEmailImagePublicBaseUrl({
      requestBaseUrl,
      envBaseUrl,
      settingsBaseUrl: settings.appBaseUrl,
    });
  } catch {
    return resolveAdminEmailImagePublicBaseUrl({ requestBaseUrl, envBaseUrl });
  } finally {
    client.release();
  }
}
