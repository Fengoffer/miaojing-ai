import type { ImageApiTemplate } from './types';

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

export const genericJsonImageTemplate: ImageApiTemplate = {
  id: 'generic-json',
  label: 'Generic JSON image generation',
  matches: () => true,
  buildTextToImageRequest(input) {
    const requestCount = Math.min(10, Math.max(1, Math.floor(input.count)));
    const requestSize = input.size || '1024x1024';
    const body: Record<string, unknown> = {
      model: input.modelName,
      prompt: input.prompt,
      n: requestCount,
      size: requestSize,
      response_format: 'b64_json',
      stream: input.stream !== false,
    };
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    if (input.guidanceScale && input.guidanceScale !== 7) body.guidance_scale = input.guidanceScale;
    if (input.aspectRatio && input.aspectRatio !== 'original') body.aspect_ratio = input.aspectRatio;

    return {
      endpoint: input.apiUrl,
      body,
      requestCount,
      requestSize,
      logFields: {
        adapter: 'generic-json',
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
    const requestCount = Math.min(10, Math.max(1, Math.floor(input.count)));
    const requestSize = input.size || '1024x1024';
    const denoisingStrength = input.strength ?? 0.5;
    const imageUrls = input.imageUrls?.length ? input.imageUrls : [input.imageUrl];
    const base64Images = input.base64Images?.length ? input.base64Images : [input.base64Image];
    const editsFields: Record<string, string> = {
      model: input.modelName,
      prompt: input.prompt,
      stream: input.stream === false ? 'false' : 'true',
      size: requestSize,
    };
    if (requestCount > 1) editsFields.n = String(requestCount);
    if (input.strength !== undefined) editsFields.strength = String(input.strength);

    const chatBody: Record<string, unknown> = {
      model: input.modelName,
      stream: input.stream !== false,
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

    const generationBody: Record<string, unknown> = {
      model: input.modelName,
      prompt: input.prompt,
      n: requestCount,
      size: requestSize,
      stream: input.stream !== false,
      init_image: input.base64Image,
      images: imageUrls,
      image_urls: imageUrls,
      reference_urls: imageUrls,
      base64Array: base64Images,
      denoising_strength: denoisingStrength,
      response_format: 'b64_json',
    };
    if (input.negativePrompt) generationBody.negative_prompt = input.negativePrompt;
    if (input.guidanceScale && input.guidanceScale !== 7) generationBody.guidance_scale = input.guidanceScale;
    if (input.aspectRatio && input.aspectRatio !== 'original') generationBody.aspect_ratio = input.aspectRatio;

    const logFields = {
      adapter: 'generic-json',
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
        fields: editsFields,
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
