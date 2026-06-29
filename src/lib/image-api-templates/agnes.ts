import {
  AGNES_BASE_URL,
  AGNES_IMAGE_MODEL_TEMPLATES,
  AGNES_PROVIDER_NAME,
} from '../agnes-model-templates';
import type { ImageApiConfigForTemplate, ImageApiTemplate, TextToImageTemplateInput } from './types';

const AGNES_IMAGE_SIZES = ['1024x768', '1024x1024', '768x1024', '1152x768', '768x1152'] as const;

function normalizeToken(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function isAgnesImageModel(value: unknown): boolean {
  const modelName = String(value || '').trim().toLowerCase();
  return AGNES_IMAGE_MODEL_TEMPLATES.some(template => template.modelName === modelName)
    || modelName.startsWith('agnes-image-');
}

function isAgnesApiUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value || '').trim());
    return url.hostname.toLowerCase().includes('agnes-ai.com')
      || url.hostname.toLowerCase().includes('agnes.ai');
  } catch {
    return false;
  }
}

export function isAgnesImageApi(config: ImageApiConfigForTemplate): boolean {
  const provider = normalizeToken(config.provider);
  return provider === normalizeToken(AGNES_PROVIDER_NAME)
    || provider.includes('agnes')
    || isAgnesImageModel(config.modelName)
    || (isAgnesApiUrl(config.apiUrl) && /\/v1\/images\/generations\b/i.test(String(config.apiUrl || '')));
}

function parseSize(value: string | undefined): { width: number; height: number } | null {
  const match = String(value || '').trim().toLowerCase().match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function parseAspectRatio(value: string | undefined): number | null {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : null;
}

function closestAgnesSize(ratio: number): string {
  return AGNES_IMAGE_SIZES
    .map(size => {
      const parsed = parseSize(size);
      const candidateRatio = parsed ? parsed.width / parsed.height : 1;
      return { size, distance: Math.abs(Math.log(ratio / candidateRatio)) };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.size || '1024x1024';
}

export function normalizeAgnesImageSize(size: string | undefined, aspectRatio?: string): string {
  const normalized = String(size || '').trim().toLowerCase();
  if ((AGNES_IMAGE_SIZES as readonly string[]).includes(normalized)) return normalized;

  const parsedSize = parseSize(normalized);
  if (parsedSize) return closestAgnesSize(parsedSize.width / parsedSize.height);

  const parsedRatio = parseAspectRatio(aspectRatio);
  return parsedRatio ? closestAgnesSize(parsedRatio) : '1024x1024';
}

function buildAgnesPrompt(input: Pick<TextToImageTemplateInput, 'prompt' | 'negativePrompt'>): string {
  return input.negativePrompt
    ? `${input.prompt}\n\nNegative prompt: ${input.negativePrompt}`
    : input.prompt;
}

function buildAgnesImageBody(input: TextToImageTemplateInput, imageUrls: string[] = []) {
  const extraBody: Record<string, unknown> = {
    response_format: 'url',
  };
  if (imageUrls.length > 0) extraBody.image = imageUrls;

  return {
    model: input.modelName,
    prompt: buildAgnesPrompt(input),
    size: normalizeAgnesImageSize(input.size, input.aspectRatio),
    extra_body: extraBody,
  };
}

export const agnesImageTemplate: ImageApiTemplate = {
  id: 'agnes-image',
  label: 'Agnes AI image generation',
  matches: isAgnesImageApi,
  buildTextToImageRequest(input) {
    const body = buildAgnesImageBody(input);
    return {
      endpoint: input.apiUrl || `${AGNES_BASE_URL}/v1/images/generations`,
      body,
      requestCount: 1,
      requestSize: String(body.size),
      logFields: {
        adapter: 'agnes-image',
        size: body.size,
        n: undefined,
        output_format: undefined,
        quality: undefined,
        aspect_ratio: undefined,
        stream: undefined,
        guidance_scale: undefined,
        response_format: (body.extra_body as Record<string, unknown>).response_format,
      },
    };
  },
  buildImageToImageRequest(input) {
    const imageUrls = input.imageUrls?.length ? input.imageUrls : [input.imageUrl].filter(Boolean);
    const body = buildAgnesImageBody(input, imageUrls);
    const logFields = {
      adapter: 'agnes-image',
      size: body.size,
      n: undefined,
      output_format: undefined,
      quality: undefined,
      aspect_ratio: undefined,
      stream: undefined,
      guidance_scale: undefined,
      strength: input.strength,
      image_count: imageUrls.length,
      response_format: (body.extra_body as Record<string, unknown>).response_format,
    };

    return {
      editsFormData: {
        endpoint: input.apiUrl,
        fields: {},
        logFields,
      },
      chatJson: {
        endpoint: input.apiUrl,
        body,
        isChatFormat: false,
        logFields,
      },
      generationJson: {
        endpoint: input.apiUrl,
        body,
        isChatFormat: false,
        logFields,
      },
      requestCount: 1,
      requestSize: String(body.size),
      logFields,
      strategy: 'generation-json-only',
    };
  },
};
