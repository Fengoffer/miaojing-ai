import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  AGNES_IMAGE_MODEL_TEMPLATES,
  AGNES_TEXT_MODEL_TEMPLATES,
  AGNES_VIDEO_MODEL_TEMPLATES,
  buildAgnesCapabilitiesText,
} from '@/lib/agnes-model-templates';
import { installAgnesTemplates } from '@/lib/agnes-template-installer';

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json({
    success: true,
    capabilitiesText: buildAgnesCapabilitiesText(),
    imageTemplates: AGNES_IMAGE_MODEL_TEMPLATES,
    videoTemplates: AGNES_VIDEO_MODEL_TEMPLATES,
    textTemplates: AGNES_TEXT_MODEL_TEMPLATES,
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  try {
    const importedApis = await installAgnesTemplates({
      syncImageModels: body.syncImageModels === true,
      syncVideoModels: body.syncVideoModels === true,
      syncTextModels: body.syncTextModels === true,
      allowedMembershipTiers: body.allowedMembershipTiers,
      isDefault: body.isDefault,
    });

    return NextResponse.json({
      success: true,
      capabilitiesText: buildAgnesCapabilitiesText(),
      imageTemplates: AGNES_IMAGE_MODEL_TEMPLATES,
      videoTemplates: AGNES_VIDEO_MODEL_TEMPLATES,
      textTemplates: AGNES_TEXT_MODEL_TEMPLATES,
      importedApis,
      message: `已安装 ${importedApis.length} 个 Agnes AI 内置免费模型模板。请逐个编辑模型填写 API Key，然后启用给用户使用。`,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '安装 Agnes AI 内置模型失败',
    }, { status: 500 });
  }
}
