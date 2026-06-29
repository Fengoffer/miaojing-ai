import { NextRequest, NextResponse } from 'next/server';
import { buildCustomApiHeaders, fetchWithRetry, parseCustomApiError } from '@/lib/custom-api-fetch';
import { localStorage } from '@/lib/local-storage';
import {
  isUuid,
  resolveSystemTextApiByModelName,
  type ClientApiConfigRef,
} from '@/lib/server-api-config';
import { enforceGenerationRouteAccess } from '@/lib/generation-route-auth';
import { updateGenerationJobProgress } from '@/lib/generation-job-estimates';

const REVERSE_PROMPT_REQUEST_TIMEOUT = 90_000;
const REVERSE_PROMPT_TOTAL_TIMEOUT = 120_000;
const MAX_IMAGE_DATA_URL_LENGTH = 8_000_000;
const REVERSE_PROMPT_SYSTEM_MODEL = 'gpt-5.5';
const REVERSE_PROMPT_REASONING_EFFORT = 'XHigh';
const REVERSE_PROMPT_RESPONSES_REASONING_EFFORT = 'xhigh';

interface ReversePromptResult {
  generalPrompt: string;
  structuredPrompt: string;
  negativePrompt: string;
  structuredSections?: {
    subject?: string;
    environment?: string;
    visualStyle?: string;
    lighting?: string;
    composition?: string;
    character?: string;
  };
}

interface PersistedReferenceImage {
  publicUrl: string | null;
  storageKey: string | null;
  objectReadUrl: string | null;
}

function getDataUrlImage(image: string): { buffer: Buffer; contentType: string; extension: string } | null {
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  const extensionMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const extension = extensionMap[contentType] || 'jpg';
  return {
    buffer: Buffer.from(match[2], 'base64'),
    contentType,
    extension,
  };
}

function isUsableResolvedConfig(config: ClientApiConfigRef | undefined): config is ClientApiConfigRef {
  return Boolean(config?.apiKey && config.apiUrl && config.modelName);
}

async function createObjectReadUrl(storageKey: string | null): Promise<string | null> {
  if (!storageKey) return null;
  try {
    const objectUrl = localStorage.generateObjectReadUrl(storageKey, 3600);
    if (!objectUrl) return null;
    const objectExists = await localStorage.objectFileExistsAsync(storageKey);
    return objectExists ? objectUrl : null;
  } catch (error) {
    console.warn('[Reverse Prompt] object read url unavailable:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function persistReferenceImage(image: string): Promise<PersistedReferenceImage> {
  try {
    if (image.startsWith('data:image/')) {
      const parsed = getDataUrlImage(image);
      if (!parsed) return { publicUrl: null, storageKey: null, objectReadUrl: null };
      const key = `reverse-prompt/reference-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${parsed.extension}`;
      const savedKey = await localStorage.uploadFile({
        fileContent: parsed.buffer,
        fileName: key,
        contentType: parsed.contentType,
      });
      return {
        publicUrl: await localStorage.generatePresignedUrl({ key: savedKey, expireTime: 2592000 }),
        storageKey: savedKey,
        objectReadUrl: await createObjectReadUrl(savedKey),
      };
    }

    if (/^https?:\/\/\S+/i.test(image)) {
      const publicUrl = await localStorage.copyPublicUrlToFolder(image, 'reverse-prompt/reference-images');
      const storageKey = localStorage.getKeyFromPublicUrl(publicUrl);
      return {
        publicUrl,
        storageKey,
        objectReadUrl: await createObjectReadUrl(storageKey),
      };
    }
  } catch (error) {
    console.warn('[Reverse Prompt] persist reference image failed:', error);
  }
  return { publicUrl: null, storageKey: null, objectReadUrl: null };
}

function getPublicAppBaseUrl(request: NextRequest): string {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin)
    .trim()
    .replace(/\/+$/, '');
}

function toPublicImageUrl(imageUrl: string | null, request: NextRequest): string | null {
  const value = imageUrl?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${getPublicAppBaseUrl(request)}${value}`;
  return value;
}

function getSafeUrlHost(value: string | null): string {
  if (!value) return '';
  if (value.startsWith('data:image/')) return 'data-url';
  try {
    return new URL(value).host;
  } catch {
    return 'invalid-url';
  }
}

function sanitizeUpstreamError(value: string): string {
  return value
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[data-url]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\s+/g, ' ')
    .slice(0, 600);
}

function stripJsonCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function tryParseJsonObject(value: string, depth = 0): Record<string, unknown> | null {
  if (depth > 2) return null;
  const trimmed = stripJsonCodeFence(value);
  const candidates = [trimmed];
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch && objectMatch[0] !== trimmed) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      if (typeof parsed === 'string') {
        const nested = tryParseJsonObject(parsed, depth + 1);
        if (nested) return nested;
      }
    } catch {
      // Try the next candidate, then fall back to plain text handling.
    }
  }
  return null;
}

function getPromptField(parsed: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = parsed[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseStructuredSections(rawSections: unknown): ReversePromptResult['structuredSections'] {
  if (!rawSections || typeof rawSections !== 'object' || Array.isArray(rawSections)) return undefined;
  const sections = rawSections as Record<string, unknown>;
  return {
    subject: String(sections.subject || '').trim() || undefined,
    environment: String(sections.environment || '').trim() || undefined,
    visualStyle: String(sections.visualStyle || sections.style || '').trim() || undefined,
    lighting: String(sections.lighting || '').trim() || undefined,
    composition: String(sections.composition || '').trim() || undefined,
    character: String(sections.character || sections.person || '').trim() || undefined,
  };
}

function parseReversePromptObject(parsed: Record<string, unknown>, depth = 0): ReversePromptResult | null {
  const generalPrompt = getPromptField(parsed, ['generalPrompt', 'general', 'prompt']);
  const structuredPrompt = getPromptField(parsed, ['structuredPrompt', 'structured', 'fullPrompt', 'pixelPrompt']);
  const negativePrompt = getPromptField(parsed, ['negativePrompt', 'negative']);
  const nestedSource = generalPrompt || structuredPrompt;
  const nestedObject = depth < 2 && nestedSource ? tryParseJsonObject(nestedSource, depth + 1) : null;

  if (nestedObject) {
    const nestedResult = parseReversePromptObject(nestedObject, depth + 1);
    if (nestedResult) return nestedResult;
  }

  if (!generalPrompt && !structuredPrompt) return null;
  return {
    generalPrompt: generalPrompt || structuredPrompt,
    structuredPrompt: structuredPrompt || generalPrompt,
    negativePrompt,
    structuredSections: parseStructuredSections(parsed.structuredSections),
  };
}

function parseReversePrompt(content: string): ReversePromptResult {
  const trimmed = content.trim();
  const parsed = tryParseJsonObject(trimmed);
  if (parsed) {
    const result = parseReversePromptObject(parsed);
    if (result) return result;
  }

  return {
    generalPrompt: trimmed,
    structuredPrompt: trimmed,
    negativePrompt: 'low quality, blurry, distorted anatomy, extra limbs, deformed hands, bad face, inaccurate details, text, watermark, logo, cropped subject, oversaturated, underexposed, overexposed',
  };
}

function buildInstruction(outputMode: 'general' | 'structured' | 'pixel', language: 'zh' | 'en'): string {
  const languageRule = language === 'en'
    ? '所有提示词字段必须使用英文输出。'
    : '所有提示词字段必须使用中文输出。';

  if (outputMode === 'pixel') {
    return `你是专业的图片反推提示词专家，同时熟悉 image2 / 图生图模型的提示词偏好。请严格观察用户上传的参考图，把图片转换为更适合 image2 参考图生成的高保真复刻提示词。目标不是普通描述，而是让 image2 在使用同一张参考图时尽可能保留人物身份、面部微表情、身高体态、肢体粗细、脸型、手脚细节、长相、身形、身材比例和服装场景。必须描述所有可见细节，不要编造看不见的内容。

输出必须只返回 JSON，不要解释，不要 Markdown。JSON 格式只允许包含这两个字段：
{
  "structuredPrompt": "完整提示词。必须是一段可直接粘贴到 image2 正向提示词输入框的复刻型提示词，先写参考图硬约束和保真目标，再写人物身份锚点、面部微表情锚点、身高体态和身体比例锚点、手脚肢体锚点、服装材质锚点、构图光影色彩锚点，最后按画面区域逐块补全细节",
  "negativePrompt": "反向提示词。必须列出会破坏参考图一致性的错误，包括不同人物、不同脸型、错误表情、错误身材比例、手脚畸形、肢体粗细变化、胸腰臀比例变化、过度美化、重设计服装、改构图和低质量问题"
}

image2 复刻级要求：
1. 只输出完整提示词和反向提示词，不要输出通用描述、结构化分项、解释文字或 Markdown。
2. 完整提示词第一句必须明确：以参考图为硬视觉参考，保留同一个人物/主体，不重新设计，不随机换脸，不改变身材比例，不做额外美化。
3. 完整提示词必须按 image2 更容易执行的顺序组织：保真目标 -> 主体身份和年龄气质 -> 面部骨相和五官比例 -> 面部微表情和眼神 -> 头发和皮肤纹理 -> 身高体态和身体比例 -> 手部脚部及四肢 -> 服装配饰 -> 构图镜头 -> 光影色彩 -> 背景道具 -> 画面瑕疵纹理。
4. 人像必须写成“身份锁定”而不是普通外貌描述：脸型轮廓、额头、颧骨、下颌线、下巴、脸宽脸长比例、眉眼间距、眼型、眼睑开合、瞳孔/视线方向、鼻梁鼻尖鼻翼、嘴唇厚薄、嘴部开合、嘴角方向、法令纹/酒窝/痣/斑点/毛孔/皮肤质感、左右不对称特征、真实年龄感和气质都要尽量描述。
5. 面部微表情必须具体到可见肌肉和局部状态：眉毛高低、眼周紧张或放松、眼神情绪、脸颊受力、嘴角上扬/下压幅度、唇线、牙齿是否可见、下巴和颈部状态；不要只写“微笑”“严肃”等泛词。
6. 身高、身形、身材和肢体必须用相对比例锁定：人物在画面中占比、头身比、肩宽相对脸宽、颈长、胸廓/腰/髋的可见轮廓、成人非情色语境下的胸部体积和服装包裹形态、手臂粗细、手腕、手掌大小、手指长度和弯曲、腿长、膝盖、小腿脚踝粗细、脚部大小和朝向；不可把身材重塑成更瘦、更高、更丰满或更夸张。
7. 手部和脚部要单独描述：可见手指数量、手指姿态、关节弯曲、指尖方向、手掌遮挡关系、脚趾/鞋型/脚背/脚踝可见状态；要求保持自然解剖结构，避免多指、少指、粘连、变形和错误遮挡。
8. 服装、配饰和材质必须写清楚款式、剪裁、贴身/宽松程度、领口袖口下摆、布料厚薄、褶皱走向、拉伸变形、透明度、反光、花纹、缝线、饰品位置和遮挡关系；不要让 image2 自行换装或增强性感化。
9. 构图必须锁定画面比例、景别、视角、镜头高度、焦段感、主体在画面中的位置、裁切边界、头顶/脚底/四肢与画面边缘的距离、前景中景背景层次、透视和景深。
10. 颜色和光影必须描述主色、辅色、肤色倾向、衣物色块、背景色块、色温、光源方向、软硬、明暗边界、高光、阴影、反射、环境光、颗粒、压缩痕迹、噪点、模糊和瑕疵。
11. 按画面区域补充细节时，可以用九宫格、前景/中景/背景、或主体局部区域划分；每个区域都要写清楚位置、可见物体、大小比例、边缘形状、材质纹理、遮挡关系和小瑕疵。
12. 如果有文字、Logo、图标、符号、品牌标识或界面元素，必须描述可识别的内容、字体观感、颜色、大小、排列方式和具体位置；不可完全识别时只描述可见形态，不要臆造。
13. negativePrompt 必须优先排除破坏参考图相似度的内容：different person, changed identity, wrong face shape, different expression, changed gaze, altered body proportions, different height impression, thinner arms, thicker legs, changed bust/waist/hip proportion, deformed hands, wrong fingers, deformed feet, over-beautified face, plastic skin, redesigned outfit, different pose, different camera angle, different crop, extra objects, missing details。
14. 不要写“图片中”“这张图”等元描述，直接写可用于生成模型的提示词。
15. ${languageRule}`;
  }

  const preferred = outputMode === 'structured' ? '结构化提示词' : '通用描述提示词';

  return `你是专业的图片反推提示词专家。请严格观察用户上传的参考图，把图片转换为可直接用于 AI 文生图模型的提示词，目标是让用户把提示词交给文生图模型后尽可能还原原图。必须描述所有可见细节，不要编造看不见的内容。

输出必须只返回 JSON，不要解释，不要 Markdown。JSON 格式：
{
  "generalPrompt": "通用描述提示词，使用连贯自然语言完整描述主体、环境、画面、风格、光照、构图、色彩、材质、镜头感和所有关键细节",
  "structuredPrompt": "结构化提示词，分段包含：主题、环境、视觉风格、光照、构图；如果有人物，还必须包含人物身材比例、面部细节、面部微表情、嘴部和嘴角细节、眼神细节、发型、配饰、衣物、衣物质感、姿态、身体朝向、画面比例等",
  "structuredSections": {
    "subject": "主题/主体，描述主体身份、数量、动作、核心物体、关键视觉特征，以及主体与画面其他元素的关系",
    "environment": "环境，描述空间、背景、道具、天气、时代、场景关系、前景/中景/远景元素",
    "visualStyle": "视觉风格，描述画风、质感、色彩、镜头语言、渲染/摄影特征、清晰度、颗粒感、景深和后期效果",
    "lighting": "光照，描述光源方向、软硬、色温、明暗关系、反射、高光、阴影、轮廓光和环境光",
    "composition": "构图，描述景别、视角、主体位置、画面比例、裁切、留白、透视、镜头焦段感和画面重心",
    "character": "如果有人物，描述身材比例、体态、肩颈腰腿比例、脸型、肤色、眉眼鼻唇、面部微表情、嘴部形态、嘴角方向、眼神方向和情绪、发型、头饰、配饰、衣物款式、衣物材质、褶皱、透明度、姿态、手部细节和身体朝向；无人物则为空字符串"
  },
  "negativePrompt": "反向提示词，列出需要避免的低质量、错误结构、畸形、模糊、文字水印、不符合原图的元素"
}

细节要求：
1. ${preferred}要更适合当前选择的输出形式，但 generalPrompt 和 structuredPrompt 两个字段都必须生成。
2. 人物图片必须尽可能细致描述人物整体每一个可见细节：身材比例、体态、脸型、肤质、五官比例、眉毛、眼睛形状、瞳孔方向、眼神情绪、鼻梁、嘴唇厚薄、嘴部开合、嘴角上扬或下压、面部微表情、发型、发丝状态、配饰、服装款式、衣物材质、纹理、褶皱、透明度、姿态、手指、肢体动作和身体朝向。
3. 如果参考图包含文字、Logo、图标、符号、品牌标识或界面元素，必须仔细描述可识别的文字内容、字体观感、颜色、大小、排列方式，以及它们在图片中的具体位置；如果文字不可完全识别，要说明可见形态，不要臆造。
4. 产品、建筑、场景图片必须具体描述形状、材质、颜色、空间关系、背景、光照、反射、纹理、磨损、边缘轮廓和比例关系。
5. 需要描述画面中的小物件、局部装饰、材质反光、阴影、高光、背景细节和遮挡关系，避免只写大概风格。
6. 不要写“图片中”“这张图”等元描述，直接写可用于生成模型的提示词。
7. ${languageRule}`;
}

function resolveResponsesApiUrl(apiUrl: string): string {
  const value = apiUrl.trim();
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    const previous = segments.at(-2);
    if (last === 'responses') return parsed.toString();
    if (previous === 'chat' && last === 'completions') {
      segments.splice(segments.length - 2, 2, 'responses');
      parsed.pathname = `/${segments.join('/')}`;
      return parsed.toString();
    }
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/responses`;
    return parsed.toString();
  } catch {
    return value.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '/responses');
  }
}

function buildReversePromptResponsesBody(
  resolvedConfig: ClientApiConfigRef,
  outputMode: 'general' | 'structured' | 'pixel',
  language: 'zh' | 'en',
  upstreamImage: string,
) {
  return {
    model: resolvedConfig.modelName,
    stream: true,
    reasoning: { effort: REVERSE_PROMPT_RESPONSES_REASONING_EFFORT },
    instructions: buildInstruction(outputMode, language),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '请根据这张参考图反推出文生图提示词，尽可能完整还原画面细节，并严格按 JSON 格式返回。',
          },
          {
            type: 'input_image',
            image_url: upstreamImage,
          },
        ],
      },
    ],
  };
}

function extractResponsesText(value: unknown, depth = 0): string {
  if (!value || depth > 4) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => extractResponsesText(item, depth + 1)).join('');
  if (typeof value !== 'object') return '';

  const data = value as Record<string, unknown>;
  const directParts = [
    data.output_text,
    data.text,
    data.delta,
  ].filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (directParts.length > 0) return directParts.join('');

  if (Array.isArray(data.choices)) {
    const chatText = data.choices.map(choice => {
      if (!choice || typeof choice !== 'object') return '';
      const item = choice as Record<string, unknown>;
      return extractResponsesText(item.delta, depth + 1)
        || extractResponsesText(item.message, depth + 1)
        || extractResponsesText(item.text, depth + 1);
    }).join('');
    if (chatText) return chatText;
  }

  for (const key of ['response', 'output', 'content', 'message', 'result', 'data']) {
    const nested = extractResponsesText(data[key], depth + 1);
    if (nested) return nested;
  }
  return '';
}

function parseResponsesStreamEvent(payload: string): unknown | null {
  const trimmed = payload.trim();
  if (!trimmed || trimmed === '[DONE]') return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function getResponsesEventType(event: unknown): string {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return '';
  const data = event as Record<string, unknown>;
  return typeof data.type === 'string' ? data.type : '';
}

function getResponsesEventDelta(event: unknown): string {
  const eventType = getResponsesEventType(event);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return '';
  const data = event as Record<string, unknown>;
  if (eventType === 'response.output_text.delta' && typeof data.delta === 'string') return data.delta;
  return eventType ? '' : extractResponsesText(event);
}

function getResponsesEventFinalText(event: unknown): string {
  const eventType = getResponsesEventType(event);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return '';
  const data = event as Record<string, unknown>;
  if (eventType === 'response.output_text.done' && typeof data.text === 'string') return data.text;
  if (eventType === 'response.completed') return extractResponsesText(data.response || event);
  return '';
}

function isResponsesStreamDone(event: unknown): boolean {
  const eventType = getResponsesEventType(event);
  return eventType === 'response.output_text.done'
    || eventType === 'response.completed'
    || eventType === 'response.failed'
    || eventType === 'response.incomplete';
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('反推提示词上游流式响应超时')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isReversePromptTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /aborted|abort|timeout|timed out|超时/i.test(message);
}

async function readResponsesStreamText(
  response: Response,
  timeoutMs = REVERSE_PROMPT_REQUEST_TIMEOUT,
  totalTimeoutMs = REVERSE_PROMPT_TOTAL_TIMEOUT,
): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (!response.body || !/(text\/event-stream|stream|text\/plain|application\/x-ndjson)/i.test(contentType)) {
    const data = await response.json();
    return extractResponsesText(data).trim();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamedText = '';
  let finalText = '';

  let shouldStop = false;
  const startedAt = Date.now();

  const consumePayload = (payload: string) => {
    const trimmed = payload.trim();
    if (!trimmed) return;
    if (trimmed === '[DONE]') {
      shouldStop = true;
      return;
    }
    const event = parseResponsesStreamEvent(trimmed);
    if (!event) return;

    const delta = getResponsesEventDelta(event);
    if (delta) streamedText += delta;

    const extractedFinalText = getResponsesEventFinalText(event).trim();
    if (extractedFinalText) finalText = extractedFinalText;

    if (!delta && !extractedFinalText) {
      const extracted = extractResponsesText(event).trim();
      if (extracted) finalText = extracted;
    }

    if (isResponsesStreamDone(event)) shouldStop = true;
  };

  const consumeBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim());
    if (dataLines.length > 0) {
      consumePayload(dataLines.join('\n'));
      return;
    }
    block
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('event:'))
      .forEach(consumePayload);
  };

  while (!shouldStop) {
    const remainingTotalMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingTotalMs <= 0) {
      throw new Error('反推提示词上游响应超过 120 秒，已停止等待');
    }
    const { value, done } = await readStreamChunkWithTimeout(reader, Math.min(timeoutMs, remainingTotalMs));
    if (value) buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0 && !shouldStop) {
      const block = buffer.slice(0, boundary);
      const separatorLength = buffer.slice(boundary, boundary + 4) === '\r\n\r\n' ? 4 : 2;
      buffer = buffer.slice(boundary + separatorLength);
      consumeBlock(block);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
    if (done) break;
  }
  if (shouldStop) {
    await reader.cancel().catch(() => undefined);
  }
  if (buffer.trim() && !shouldStop) {
    if (buffer.trim().startsWith('data:')) {
      consumeBlock(buffer);
    } else {
      consumeBlock(buffer);
      if (!streamedText && !finalText) {
        const event = parseResponsesStreamEvent(buffer);
        const extracted = event ? extractResponsesText(event).trim() : buffer.trim();
        if (extracted) finalText = extracted;
      }
    }
  }

  return (streamedText || finalText).trim();
}

async function fetchReversePromptContent(input: {
  config: ClientApiConfigRef;
  outputMode: 'general' | 'structured' | 'pixel';
  language: 'zh' | 'en';
  upstreamImage: string;
  upstreamImageHost: string;
  usesObjectReadUrl: boolean;
}) {
  const { config, outputMode, language, upstreamImage, upstreamImageHost, usesObjectReadUrl } = input;
  if (!config.apiKey || !config.apiUrl || !config.modelName) {
    throw new Error('未配置可用的多模态模型，请先在 API 设置中添加支持图片理解的多模态模型');
  }

  const responsesApiUrl = resolveResponsesApiUrl(config.apiUrl);
  console.log(
    '[Reverse Prompt] Using multimodal model:',
    config.modelName,
    '| provider:',
    config.provider || 'unknown',
    '| customApiKeyId:',
    config.customApiKeyId || '',
    '| systemApiId:',
    config.systemApiId || '',
    '| upstreamHost:',
    upstreamImageHost || getSafeUrlHost(upstreamImage),
    '| usesObjectReadUrl:',
    usesObjectReadUrl,
    '| apiUrl:',
    responsesApiUrl,
    '| endpoint:',
    '/responses',
    '| reasoning:',
    REVERSE_PROMPT_REASONING_EFFORT,
  );

  let response: Response;
  try {
    response = await fetchWithRetry(
      responsesApiUrl,
      {
        method: 'POST',
        headers: buildCustomApiHeaders(config.apiKey),
        body: JSON.stringify(buildReversePromptResponsesBody(config, outputMode, language, upstreamImage)),
      },
      REVERSE_PROMPT_REQUEST_TIMEOUT,
      0,
    );
  } catch (error) {
    console.warn(
      '[Reverse Prompt] upstream request exception:',
      JSON.stringify({
        model: config.modelName,
        provider: config.provider || 'unknown',
        upstreamHost: upstreamImageHost || getSafeUrlHost(upstreamImage),
        usesObjectReadUrl,
        error: sanitizeUpstreamError(error instanceof Error ? error.message : String(error || '')),
      }),
    );
    if (isReversePromptTimeoutError(error)) {
      return {
        ok: false as const,
        status: 504,
        error: '反推提示词上游响应超时，已停止等待，请稍后重试',
      };
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(
      '[Reverse Prompt] upstream returned error:',
      JSON.stringify({
        model: config.modelName,
        provider: config.provider || 'unknown',
        status: response.status,
        upstreamHost: upstreamImageHost || getSafeUrlHost(upstreamImage),
        usesObjectReadUrl,
        error: sanitizeUpstreamError(errorText),
      }),
    );
    return {
      ok: false as const,
      status: response.status,
      error: parseCustomApiError(response.status, errorText, 'multimodal'),
    };
  }

  let content = '';
  try {
    content = await readResponsesStreamText(response, REVERSE_PROMPT_REQUEST_TIMEOUT, REVERSE_PROMPT_TOTAL_TIMEOUT);
  } catch (error) {
    if (isReversePromptTimeoutError(error)) {
      return {
        ok: false as const,
        status: 504,
        error: '反推提示词上游响应超时，已停止等待，请稍后重试',
      };
    }
    throw error;
  }
  if (!content.trim()) {
    return {
      ok: false as const,
      status: 502,
      error: '模型未返回有效的反推提示词',
    };
  }

  return { ok: true as const, content };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const image = typeof body.image === 'string' ? body.image : '';
    const outputMode = body.outputMode === 'general'
      ? 'general'
      : body.outputMode === 'pixel'
        ? 'pixel'
        : 'structured';
    const language = body.language === 'en' ? 'en' : 'zh';

    const isDataImage = image.startsWith('data:image/');
    const isHttpImage = /^https?:\/\/\S+/i.test(image);
    if (!image || (!isDataImage && !isHttpImage)) {
      return NextResponse.json({ error: '请上传需要反推提示词的图片' }, { status: 400 });
    }
    if (isDataImage && image.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return NextResponse.json({ error: '图片过大，请压缩后再上传' }, { status: 400 });
    }
    const routeAccess = await enforceGenerationRouteAccess(request, undefined);
    if (routeAccess.response) return routeAccess.response;
    const trustedUserId = routeAccess.trustedUserId || routeAccess.authenticatedUserId;
    const generationJobId = routeAccess.generationJobId;
    const handleUpstreamProgress = (progress: Record<string, unknown>) => updateGenerationJobProgress(
      isUuid(generationJobId) ? generationJobId : null,
      progress,
    );
    await handleUpstreamProgress({
      percent: 10,
      message: '正在解析参考图片并准备反推提示词',
    });

    const systemReversePromptConfig = await resolveSystemTextApiByModelName(
      request,
      REVERSE_PROMPT_SYSTEM_MODEL,
      isUuid(trustedUserId) ? trustedUserId : null,
    );
    if (!isUsableResolvedConfig(systemReversePromptConfig)) {
      return NextResponse.json({ error: '系统反推提示词模型 gpt-5.5 未配置或未启用' }, { status: 400 });
    }
    const persistedReferenceImage = await persistReferenceImage(image);
    const publicReferenceImage = toPublicImageUrl(persistedReferenceImage.publicUrl, request);
    const upstreamImage = publicReferenceImage || persistedReferenceImage.objectReadUrl || image;
    const upstreamImageHost = getSafeUrlHost(upstreamImage);
    const usesObjectReadUrl = Boolean(persistedReferenceImage.objectReadUrl);
    console.log(
      '[Reverse Prompt] Prepared reference image:',
      JSON.stringify({
        persisted: Boolean(persistedReferenceImage.publicUrl),
        hasStorageKey: Boolean(persistedReferenceImage.storageKey),
        upstreamHost: upstreamImageHost,
        usesObjectReadUrl,
        rawDataUrlUsed: upstreamImage.startsWith('data:image/'),
      }),
    );
    await handleUpstreamProgress({
      percent: 30,
      message: '已准备图片，正在请求多模态模型',
    });

    const reversePromptResponse = await fetchReversePromptContent({
      config: systemReversePromptConfig,
      outputMode,
      language,
      upstreamImage,
      upstreamImageHost,
      usesObjectReadUrl,
    });

    if (!reversePromptResponse.ok) {
      return NextResponse.json(
        { error: reversePromptResponse.error },
        { status: reversePromptResponse.status >= 500 ? 502 : reversePromptResponse.status },
      );
    }

    await handleUpstreamProgress({
      percent: 85,
      message: '模型已返回，正在整理提示词',
    });

    return NextResponse.json({
      ...parseReversePrompt(reversePromptResponse.content),
      referenceImage: persistedReferenceImage.publicUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '图片反推提示词失败';
    console.error('[Reverse Prompt Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
