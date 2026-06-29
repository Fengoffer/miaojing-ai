export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageQuality = 'auto' | 'high' | 'medium' | 'low';

export type ImageApiConfigForTemplate = {
  provider?: string;
  apiUrl?: string;
  modelName?: string;
};

export type TextToImageTemplateInput = {
  apiUrl: string;
  modelName: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  size?: string;
  count: number;
  outputFormat: ImageOutputFormat;
  imageQuality: ImageQuality;
  guidanceScale?: number;
  style?: unknown;
  user?: unknown;
  stream?: boolean;
};

export type TextToImageTemplateResult = {
  endpoint: string;
  body: Record<string, unknown>;
  requestCount: number;
  requestSize: string | undefined;
  logFields: Record<string, unknown>;
};

export type ImageToImageTemplateInput = TextToImageTemplateInput & {
  imageUrl: string;
  imageUrls?: string[];
  base64Image: string;
  base64Images?: string[];
  strength?: number;
};

export type ImageToImageFormDataRequest = {
  endpoint: string;
  fields: Record<string, string>;
  logFields: Record<string, unknown>;
};

export type ImageToImageJsonRequest = {
  endpoint: string;
  body: Record<string, unknown>;
  isChatFormat: boolean;
  logFields: Record<string, unknown>;
};

export type ImageToImageTemplateResult = {
  editsFormData: ImageToImageFormDataRequest;
  chatJson: ImageToImageJsonRequest;
  generationJson: ImageToImageJsonRequest;
  requestCount: number;
  requestSize: string | undefined;
  logFields: Record<string, unknown>;
  strategy?: 'multi' | 'generation-json-only';
};

export type ImageApiTemplate = {
  id: string;
  label: string;
  matches: (config: ImageApiConfigForTemplate) => boolean;
  buildTextToImageRequest: (input: TextToImageTemplateInput) => TextToImageTemplateResult;
  buildImageToImageRequest: (input: ImageToImageTemplateInput) => ImageToImageTemplateResult;
};
