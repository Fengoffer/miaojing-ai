import type { ImageApiConfigForTemplate, ImageApiTemplate, ImageToImageTemplateInput, TextToImageTemplateInput } from './types';

export function isGptImageModel(modelName: string | undefined): boolean {
  return /^gpt-image-/i.test((modelName || '').trim());
}

export function isDallE3Model(modelName: string | undefined): boolean {
  return /^dall-e-3$/i.test((modelName || '').trim());
}

export function isDallE2Model(modelName: string | undefined): boolean {
  return /^dall-e-2$/i.test((modelName || '').trim());
}

function normalizeGptImageSize(size: string | undefined): string | undefined {
  if (!size) return undefined;
  const normalized = size.trim().toLowerCase();
  if (['auto', '1024x1024', '1536x1024', '1024x1536'].includes(normalized)) return normalized;
  const parsed = normalized.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!parsed) return undefined;
  const width = Number(parsed[1]);
  const height = Number(parsed[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const ratio = width / height;
  if (ratio > 1.12) return '1536x1024';
  if (ratio < 0.89) return '1024x1536';
  return '1024x1024';
}

export function isMozheImageRelay(apiUrl: string | undefined): boolean {
  try {
    const hostname = new URL(apiUrl || '').hostname.toLowerCase();
    return hostname === 'mozhevip.top' || hostname.endsWith('.mozhevip.top');
  } catch {
    return false;
  }
}

function isOfficialOpenAIEndpoint(apiUrl: string | undefined): boolean {
  try {
    return new URL(apiUrl || '').hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

function preserveRequestedImageSize(size: string | undefined): string | undefined {
  if (!size) return undefined;
  const normalized = size.trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  const parsed = normalized.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!parsed) return undefined;
  const width = Number(parsed[1]);
  const height = Number(parsed[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const align16 = (value: number) => Math.max(16, Math.round(value / 16) * 16);
  return `${align16(width)}x${align16(height)}`;
}

function normalizeMozheGptImageSize(size: string | undefined): string {
  const officialSize = normalizeGptImageSize(size);
  return officialSize && officialSize !== 'auto' ? officialSize : '1024x1024';
}

function isMozheGptImageApi(modelName: string | undefined, apiUrl: string | undefined): boolean {
  return isGptImageModel(modelName) && isMozheImageRelay(apiUrl);
}

function normalizeDallE3Size(size: string | undefined): string {
  const normalized = (size || '').trim().toLowerCase();
  if (['1024x1024', '1792x1024', '1024x1792'].includes(normalized)) return normalized;
  const parsed = normalized.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!parsed) return '1024x1024';
  const width = Number(parsed[1]);
  const height = Number(parsed[2]);
  const ratio = width / height;
  if (ratio > 1.2) return '1792x1024';
  if (ratio < 0.84) return '1024x1792';
  return '1024x1024';
}

function normalizeDallE2Size(size: string | undefined): string {
  const normalized = (size || '').trim().toLowerCase();
  if (['256x256', '512x512', '1024x1024'].includes(normalized)) return normalized;
  return '1024x1024';
}

export function normalizeOpenAICompatibleImageSize(
  modelName: string | undefined,
  size: string | undefined,
  options: { apiUrl?: string } = {},
): string {
  if (isDallE3Model(modelName)) return normalizeDallE3Size(size);
  if (isDallE2Model(modelName)) return normalizeDallE2Size(size);
  if (isMozheGptImageApi(modelName, options.apiUrl)) return normalizeMozheGptImageSize(size);
  if (isGptImageModel(modelName) && !isOfficialOpenAIEndpoint(options.apiUrl)) {
    return preserveRequestedImageSize(size) || 'auto';
  }
  return normalizeGptImageSize(size) || 'auto';
}

export function normalizeOpenAICompatibleImageCount(modelName: string | undefined, count: number): number {
  if (isDallE3Model(modelName)) return 1;
  return Math.min(10, Math.max(1, Math.floor(count)));
}

export function isOpenAICompatibleImageApi(config: ImageApiConfigForTemplate): boolean {
  const provider = (config.provider || '').trim().toLowerCase();
  const apiUrl = (config.apiUrl || '').trim().toLowerCase();
  return provider === 'newapi'
    || provider === 'new api'
    || provider === 'openai'
    || provider === 'openai-compatible'
    || isGptImageModel(config.modelName)
    || isDallE3Model(config.modelName)
    || isDallE2Model(config.modelName)
    || /\/v1\/images\/(generations|edits)\b/i.test(apiUrl);
}

function applyOpenAICompatibleExtras(body: Record<string, unknown>, input: TextToImageTemplateInput) {
  if (isGptImageModel(input.modelName)) {
    body.output_format = input.outputFormat;
    body.quality = input.imageQuality;
    body.stream = resolveOpenAICompatibleStream(input);
  } else if (isDallE3Model(input.modelName)) {
    body.quality = input.imageQuality === 'high' ? 'hd' : 'standard';
    if (input.style === 'natural' || input.style === 'vivid') body.style = input.style;
  }
  if (typeof input.user === 'string' && input.user.trim()) body.user = input.user.trim();
}

function resolveOpenAICompatibleStream(input: Pick<TextToImageTemplateInput, 'stream'>): boolean {
  return input.stream !== false;
}

function deriveChatCompletionsUrl(imagesUrl: string): string {
  if (imagesUrl.includes('/chat/completions')) return imagesUrl;
  return imagesUrl
    .replace(/\/images\/(generations|edits).*/i, '/chat/completions')
    .replace(/\/+$/, '');
}

function deriveImagesEditsUrl(imagesUrl: string): string {
  if (imagesUrl.includes('/images/edits')) return imagesUrl;
  return imagesUrl
    .replace(/\/images\/generations.*/i, '/images/edits')
    .replace(/\/+$/, '');
}

function buildOpenAICompatibleImageEditFields(input: ImageToImageTemplateInput, requestCount: number, requestSize: string | undefined) {
  const fields: Record<string, string> = {
    model: input.modelName,
    prompt: input.prompt,
    stream: resolveOpenAICompatibleStream(input) ? 'true' : 'false',
  };
  if (requestSize) fields.size = requestSize;
  if (requestCount > 1) fields.n = String(requestCount);
  if (input.strength !== undefined) fields.strength = String(input.strength);
  if (isGptImageModel(input.modelName)) {
    fields.output_format = input.outputFormat;
    fields.quality = input.imageQuality;
  }
  return fields;
}

export const openAICompatibleImageTemplate: ImageApiTemplate = {
  id: 'openai-compatible',
  label: 'OpenAI/NewAPI compatible image generation',
  matches: isOpenAICompatibleImageApi,
  buildTextToImageRequest(input) {
    const requestCount = normalizeOpenAICompatibleImageCount(input.modelName, input.count);
    const requestSize = normalizeOpenAICompatibleImageSize(input.modelName, input.size, { apiUrl: input.apiUrl });
    const prompt = input.negativePrompt
      ? `${input.prompt}\n\nNegative prompt: ${input.negativePrompt}`
      : input.prompt;
    const body: Record<string, unknown> = {
      model: input.modelName,
      prompt,
      n: requestCount,
      size: requestSize,
    };
    applyOpenAICompatibleExtras(body, input);
    return {
      endpoint: input.apiUrl,
      body,
      requestCount,
      requestSize,
      logFields: {
        adapter: 'openai-compatible',
        size: body.size,
        n: body.n,
        output_format: body.output_format,
        quality: body.quality,
        aspect_ratio: body.aspect_ratio,
        stream: body.stream,
        guidance_scale: body.guidance_scale,
      },
    };
  },
  buildImageToImageRequest(input) {
    const requestCount = normalizeOpenAICompatibleImageCount(input.modelName, input.count);
    const requestSize = normalizeOpenAICompatibleImageSize(input.modelName, input.size, { apiUrl: input.apiUrl });
    const denoisingStrength = input.strength ?? 0.5;
    const formFields = buildOpenAICompatibleImageEditFields(input, requestCount, requestSize);
    const imageUrls = input.imageUrls?.length ? input.imageUrls : [input.imageUrl];
    const base64Images = input.base64Images?.length ? input.base64Images : [input.base64Image];
    const chatBody: Record<string, unknown> = {
      model: input.modelName,
      stream: resolveOpenAICompatibleStream(input),
      messages: [
        {
          role: 'user',
          content: [
            ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
            { type: 'text', text: input.prompt },
          ],
        },
      ],
      size: requestSize,
      n: requestCount,
    };
    applyOpenAICompatibleExtras(chatBody, input);

    const generationBody: Record<string, unknown> = {
      model: input.modelName,
      prompt: input.prompt,
      n: requestCount,
      size: requestSize,
      stream: resolveOpenAICompatibleStream(input),
      init_image: input.base64Image,
      images: imageUrls,
      image_urls: imageUrls,
      reference_urls: imageUrls,
      base64Array: base64Images,
      denoising_strength: denoisingStrength,
    };
    applyOpenAICompatibleExtras(generationBody, input);

    const logFields = {
      adapter: 'openai-compatible',
      size: requestSize,
      n: requestCount,
      output_format: generationBody.output_format,
      quality: generationBody.quality,
      aspect_ratio: generationBody.aspect_ratio,
      stream: generationBody.stream,
      guidance_scale: generationBody.guidance_scale,
      strength: denoisingStrength,
    };

    return {
      editsFormData: {
        endpoint: deriveImagesEditsUrl(input.apiUrl),
        fields: formFields,
        logFields,
      },
      chatJson: {
        endpoint: deriveChatCompletionsUrl(input.apiUrl),
        body: chatBody,
        isChatFormat: true,
        logFields,
      },
      generationJson: {
        endpoint: input.apiUrl,
        body: generationBody,
        isChatFormat: false,
        logFields,
      },
      requestCount,
      requestSize,
      logFields,
    };
  },
};
