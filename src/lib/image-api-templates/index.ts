import { agnesImageTemplate } from './agnes';
import { genericJsonImageTemplate } from './generic-json';
import { openAICompatibleImageTemplate } from './openai-compatible';
import type { ImageApiConfigForTemplate, ImageApiTemplate } from './types';

const imageApiTemplates: ImageApiTemplate[] = [
  agnesImageTemplate,
  openAICompatibleImageTemplate,
  genericJsonImageTemplate,
];

export function resolveImageApiTemplate(config: ImageApiConfigForTemplate): ImageApiTemplate {
  return imageApiTemplates.find(template => template.matches(config)) || genericJsonImageTemplate;
}

export {
  agnesImageTemplate,
  genericJsonImageTemplate,
  openAICompatibleImageTemplate,
};
export {
  isAgnesImageApi,
  normalizeAgnesImageSize,
} from './agnes';
export {
  isDallE2Model,
  isDallE3Model,
  isGptImageModel,
  isOpenAICompatibleImageApi,
  normalizeOpenAICompatibleImageCount,
  normalizeOpenAICompatibleImageSize,
} from './openai-compatible';
export type {
  ImageApiConfigForTemplate,
  ImageApiTemplate,
  ImageOutputFormat,
  ImageQuality,
  TextToImageTemplateInput,
  TextToImageTemplateResult,
} from './types';
