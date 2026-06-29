import type { ManagedVideoUsageMode, ModelCapabilityConfig } from '@/lib/model-config-types';
import type { ImportedManifestBundle, ManifestEndpoint } from '@/lib/user-api-manifest';

export const AGNES_BASE_URL = 'https://apihub.agnes-ai.com';
export const AGNES_PROVIDER_ID = 'agnes-ai';
export const AGNES_PROVIDER_NAME = 'Agnes AI';
export const AGNES_IMAGE_MODEL_GROUP = 'agnes-image';
export const AGNES_VIDEO_MODEL_GROUP = 'agnes-video';
export const AGNES_TEXT_MODEL_GROUP = 'agnes-text';
export const AGNES_PROMPT_OPTIMIZER_MODEL = 'agnes-2.0-flash';

export type AgnesPromptOptimizationMediaType = 'image' | 'video';

export type AgnesPromptOptimizationTargetInput = {
  modelName?: string;
  displayName?: string;
  mediaType?: AgnesPromptOptimizationMediaType;
};

export type AgnesPromptOptimizationTarget = {
  modelName: string;
  displayName: string;
  mediaType: AgnesPromptOptimizationMediaType;
};

export type AgnesImageModelTemplate = {
  modelName: string;
  displayName: string;
  sourceDoc: string;
  capabilities: ModelCapabilityConfig;
};

export type AgnesVideoModelTemplate = {
  modelName: string;
  displayName: string;
  sourceDoc: string;
  usageModes: ManagedVideoUsageMode[];
  capabilities: ModelCapabilityConfig;
};

export type AgnesTextModelTemplate = {
  modelName: string;
  displayName: string;
  sourceDoc: string;
  note: string;
};

const option = (value: string, label = value) => ({ value, label });
const options = (values: string[]) => values.map(value => option(value));

function normalizeAgnesPromptModelToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

export const AGNES_VIDEO_FRAME_RATE = 24;
const AGNES_VIDEO_MAX_DURATION = 10;
const AGNES_STABLE_VIDEO_DURATIONS = ['3', '5', '10'];

export function normalizeAgnesVideoDuration(duration: number | string | undefined): number | null {
  const parsed = Number(duration);
  if (!Number.isFinite(parsed)) return 5;
  const seconds = Math.round(parsed);
  return AGNES_STABLE_VIDEO_DURATIONS.includes(String(seconds)) ? seconds : null;
}

export function getAgnesVideoNumFrames(duration: number | string | undefined): number {
  const normalizedDuration = normalizeAgnesVideoDuration(duration);
  const seconds = normalizedDuration === null ? AGNES_VIDEO_MAX_DURATION : normalizedDuration;
  const documentedFrameCounts: Record<number, number> = {
    3: 81,
    5: 121,
    10: 241,
  };
  return documentedFrameCounts[seconds] || (seconds * AGNES_VIDEO_FRAME_RATE + 1);
}

export function getAgnesModelCapabilities(modelName?: string): ModelCapabilityConfig | undefined {
  const normalizedModelName = String(modelName || '').toLowerCase();
  return [
    ...AGNES_IMAGE_MODEL_TEMPLATES,
    ...AGNES_VIDEO_MODEL_TEMPLATES,
  ].find(template => template.modelName.toLowerCase() === normalizedModelName)?.capabilities;
}

export function getAgnesPromptOptimizationTarget(
  input: AgnesPromptOptimizationTargetInput | undefined,
): AgnesPromptOptimizationTarget | undefined {
  if (!input) return undefined;
  const candidates = [
    normalizeAgnesPromptModelToken(input.modelName),
    normalizeAgnesPromptModelToken(input.displayName),
  ].filter(Boolean);
  const allowedMediaType = input.mediaType;
  const imageTarget = AGNES_IMAGE_MODEL_TEMPLATES.find(template => (
    (!allowedMediaType || allowedMediaType === 'image')
    && candidates.some(candidate => (
      candidate === normalizeAgnesPromptModelToken(template.modelName)
      || candidate === normalizeAgnesPromptModelToken(template.displayName)
    ))
  ));
  if (imageTarget) {
    return {
      modelName: imageTarget.modelName,
      displayName: imageTarget.displayName,
      mediaType: 'image',
    };
  }

  const videoTarget = AGNES_VIDEO_MODEL_TEMPLATES.find(template => (
    (!allowedMediaType || allowedMediaType === 'video')
    && candidates.some(candidate => (
      candidate === normalizeAgnesPromptModelToken(template.modelName)
      || candidate === normalizeAgnesPromptModelToken(template.displayName)
    ))
  ));
  if (videoTarget) {
    return {
      modelName: videoTarget.modelName,
      displayName: videoTarget.displayName,
      mediaType: 'video',
    };
  }

  return undefined;
}

export function isAgnesPromptOptimizerModel(value: unknown): boolean {
  return normalizeAgnesPromptModelToken(value) === AGNES_PROMPT_OPTIMIZER_MODEL;
}

const agnesImageResolutions = [
  option('1024x768', '横版 1024x768'),
  option('1024x1024', '正方形 1024x1024'),
  option('768x1024', '竖版 768x1024'),
  option('1152x768', '宽横版 1152x768'),
  option('768x1152', '高竖版 768x1152'),
];

export const AGNES_IMAGE_MODEL_TEMPLATES: AgnesImageModelTemplate[] = [
  {
    modelName: 'agnes-image-2.1-flash',
    displayName: 'Agnes Image 2.1 Flash',
    sourceDoc: 'Agnes Image 2.1 Flash · https://agnes-ai.com/doc/agnes-image-21-flash',
    capabilities: {
      supportsAspectRatio: false,
      supportsResolution: true,
      supportsQuality: false,
      supportsOutputFormat: false,
      resolutions: agnesImageResolutions,
    },
  },
  {
    modelName: 'agnes-image-2.0-flash',
    displayName: 'Agnes Image 2.0 Flash',
    sourceDoc: 'Agnes Image 2.0 Flash · https://agnes-ai.com/doc/agnes-image-20-flash',
    capabilities: {
      supportsAspectRatio: false,
      supportsResolution: true,
      supportsQuality: false,
      supportsOutputFormat: false,
      resolutions: agnesImageResolutions,
    },
  },
];

export const AGNES_VIDEO_MODEL_TEMPLATES: AgnesVideoModelTemplate[] = [
  {
    modelName: 'agnes-video-v2.0',
    displayName: 'Agnes Video V2.0',
    sourceDoc: 'Agnes Video V2.0 · https://agnes-ai.com/doc/agnes-video-v20',
    usageModes: ['text-to-video', 'image-to-video'],
    capabilities: {
      supportsAspectRatio: false,
      supportsResolution: false,
      supportsDuration: true,
      supportsQuality: false,
      supportsOutputFormat: false,
      durations: options(AGNES_STABLE_VIDEO_DURATIONS),
    },
  },
];

export const AGNES_TEXT_MODEL_TEMPLATES: AgnesTextModelTemplate[] = [
  {
    modelName: 'agnes-2.0-flash',
    displayName: 'Agnes 2.0 Flash',
    sourceDoc: 'Agnes 2.0 Flash · https://agnes-ai.com/doc/agnes-20-flash',
    note: 'Agnes 免费文本/多模态模型，可用于提示词优化和反推提示词',
  },
  {
    modelName: 'agnes-1.5-flash',
    displayName: 'Agnes 1.5 Flash',
    sourceDoc: 'Agnes 1.5 Flash · https://agnes-ai.com/doc/agnes-15-flash',
    note: 'Agnes 免费轻量文本/多模态模型，可用于提示词优化和反推提示词',
  },
];

export function buildAgnesImageSubmit(): ManifestEndpoint {
  return {
    path: 'v1/images/generations',
    method: 'POST',
    contentType: 'json',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.size',
      extra_body: {
        response_format: 'url',
        image: '$inputImages.urls',
      },
    },
    result: {
      imageUrlPaths: ['data.*.url'],
      b64JsonPaths: ['data.*.b64_json'],
    },
  };
}

export function buildAgnesImageManifestBundle(template: AgnesImageModelTemplate): ImportedManifestBundle {
  return {
    customProviders: [{
      id: AGNES_PROVIDER_ID,
      name: AGNES_PROVIDER_NAME,
      submit: buildAgnesImageSubmit(),
    }],
    profiles: [{
      name: template.displayName,
      provider: AGNES_PROVIDER_ID,
      baseUrl: AGNES_BASE_URL,
      model: template.modelName,
      apiMode: 'images',
      capabilities: template.capabilities,
    }],
  };
}

export function buildAgnesVideoSubmit(): ManifestEndpoint {
  return {
    path: 'v1/videos',
    method: 'POST',
    contentType: 'json',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      image: '$inputImages.urls.0',
      num_frames: '$params.num_frames',
      frame_rate: '$params.fps',
      width: '$params.width',
      height: '$params.height',
      negative_prompt: '$params.negative_prompt',
    },
    taskIdPath: 'video_id|task_id|id',
    result: {
      videoUrlPaths: ['remixed_from_video_id', 'video_url', 'url'],
    },
  };
}

export function buildAgnesVideoManifestBundle(template: AgnesVideoModelTemplate): ImportedManifestBundle {
  return {
    customProviders: [{
      id: AGNES_PROVIDER_ID,
      name: AGNES_PROVIDER_NAME,
      submit: buildAgnesVideoSubmit(),
      poll: {
        path: 'agnesapi',
        method: 'GET',
        query: {
          video_id: '{task_id}',
          model_name: '$profile.model',
        },
        intervalSeconds: 5,
        statusPath: 'status',
        successValues: ['completed'],
        failureValues: ['failed'],
        errorPath: 'error',
        result: {
          videoUrlPaths: ['remixed_from_video_id', 'video_url', 'url'],
        },
      },
    }],
    profiles: [{
      name: template.displayName,
      provider: AGNES_PROVIDER_ID,
      baseUrl: AGNES_BASE_URL,
      model: template.modelName,
      apiMode: 'videos',
      capabilities: template.capabilities,
    }],
  };
}

export function buildAgnesCapabilitiesText(): string {
  return [
    '# Agnes AI 内置免费模型',
    '',
    `API Base：${AGNES_BASE_URL}`,
    '图片生成：POST /v1/images/generations，同步返回 data[].url 或 data[].b64_json。',
    '视频生成：POST /v1/videos 创建任务，GET /agnesapi?video_id={video_id}&model_name=agnes-video-v2.0 查询结果。',
    '文本/多模态：POST /v1/chat/completions，使用 OpenAI-compatible chat 请求体。',
    '',
    '后台安装后每个图片/视频模型都会写入独立 system-api-manifests/<systemApiId>.json；文本模型不需要 Manifest，直接使用系统 API 的 chat/completions 地址。',
    '',
    ...AGNES_IMAGE_MODEL_TEMPLATES.map((template, index) => [
      `## 图片 ${index + 1}. ${template.displayName}`,
      `- model：${template.modelName}`,
      `- 文档：${template.sourceDoc}`,
      `- 接口：POST ${AGNES_BASE_URL}/v1/images/generations`,
      `- 尺寸：${template.capabilities.resolutions?.map(item => item.value).join(' / ') || '文档未注明'}`,
      '- 图生图：extra_body.image = string[]；输出：extra_body.response_format = url，读取 data.*.url；兼容 data.*.b64_json。',
    ].join('\n')),
    '',
    ...AGNES_VIDEO_MODEL_TEMPLATES.map((template, index) => [
      `## 视频 ${index + 1}. ${template.displayName}`,
      `- model：${template.modelName}`,
      `- 文档：${template.sourceDoc}`,
      `- 创建：POST ${AGNES_BASE_URL}/v1/videos`,
      `- 查询：GET ${AGNES_BASE_URL}/agnesapi?video_id={video_id}&model_name=${template.modelName}`,
      `- 用途：${template.usageModes.includes('text-to-video') ? '文生视频' : ''}${template.usageModes.length > 1 ? ' / ' : ''}${template.usageModes.includes('image-to-video') ? '图生视频' : ''}`,
      `- 时长：${template.capabilities.durations?.map(item => item.value).join(' / ') || '文档未注明'}`,
    ].join('\n')),
    '',
    ...AGNES_TEXT_MODEL_TEMPLATES.map((template, index) => [
      `## 文本 ${index + 1}. ${template.displayName}`,
      `- model：${template.modelName}`,
      `- 文档：${template.sourceDoc}`,
      `- 接口：POST ${AGNES_BASE_URL}/v1/chat/completions`,
      `- 用途：${template.note}`,
    ].join('\n')),
  ].join('\n');
}
