/**
 * 创作中心 - 模型配置与参数规则
 *
 * 图片生成参数：
 * - 画面比例 (aspectRatio): 1:1 / 16:9 / 9:16 / 4:3 / 3:4
 * - 分辨率 (resolution): 1080P / 2K / 4K
 *
 * 视频生成参数：
 * - 画面比例 + 时长 + 帧率
 */

// ---- 图片生成模型 ----

export interface ImageModelConfig {
  id: string;
  label: string;
  provider: string;
  description: string;
}

export const IMAGE_MODELS: ImageModelConfig[] = [
  {
    id: 'doubao-seedream-5-0-260128',
    label: 'See Dream v5.0',
    provider: '字节跳动',
    description: '最新一代，画质与创意全面升级',
  },
  {
    id: 'doubao-seedream-4-5-251128',
    label: 'See Dream v4.5',
    provider: '字节跳动',
    description: '高质量通用图片生成',
  },
  {
    id: 'doubao-seedream-3-5-250528',
    label: 'See Dream v3.5',
    provider: '字节跳动',
    description: '均衡性价比之选',
  },
  {
    id: 'minimax-image-01',
    label: '香蕉图片',
    provider: 'MiniMax',
    description: '风格多样，创意表现力强',
  },
];

// ---- 画面比例选项 ----

export const ASPECT_RATIOS = [
  { value: 'auto', label: '自动', credits: 0 },
  { value: '1:1', label: '1:1 方形', credits: 8 },
  { value: '16:9', label: '16:9 横版', credits: 8 },
  { value: '9:16', label: '9:16 竖版', credits: 8 },
  { value: '4:3', label: '4:3 横版', credits: 8 },
  { value: '3:4', label: '3:4 竖版', credits: 8 },
] as const;

// 图生图额外画面比例选项
export const IMG2IMG_ASPECT_RATIOS = [
  { value: 'auto', label: '自动', desc: '从提示词自动识别', credits: 0 },
  { value: 'original', label: '原比例', desc: '使用参考图比例', credits: 8 },
  ...ASPECT_RATIOS.filter(item => item.value !== 'auto'),
] as const;

// ---- 分辨率选项 ----

export const RESOLUTION_OPTIONS = [
  { value: 'auto', label: '自动', credits: 0 },
  { value: '1080P', label: '1080P', credits: 5 },
  { value: '2K', label: '2K', credits: 10 },
  { value: '4K', label: '4K', credits: 20 },
] as const;

export const IMAGE_OUTPUT_FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
] as const;

export const IMAGE_QUALITY_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
] as const;

export type ImageOutputFormat = typeof IMAGE_OUTPUT_FORMAT_OPTIONS[number]['value'];
export type ImageQuality = typeof IMAGE_QUALITY_OPTIONS[number]['value'];

// 将画面比例+分辨率转换为具体像素尺寸
/**
 * Resolve pixel size for SDK (built-in) models.
 * These high-res sizes are supported by the official coze-coding-dev-sdk.
 */
export function resolveImageSize(aspectRatio: string, resolution: string): string {
  if (aspectRatio === 'auto' || resolution === 'auto') return 'auto';
  const sizeMap: Record<string, Record<string, string>> = {
    '1:1': { '1080P': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
    '16:9': { '1080P': '1920x1080', '2K': '2560x1440', '4K': '3840x2160' },
    '9:16': { '1080P': '1080x1920', '2K': '1440x2560', '4K': '2160x3840' },
    '4:3': { '1080P': '1440x1080', '2K': '2560x1920', '4K': '4096x3072' },
    '3:4': { '1080P': '1080x1440', '2K': '1920x2560', '4K': '3072x4096' },
  };
  return sizeMap[aspectRatio]?.[resolution] || '1024x1024';
}

/**
 * Resolve pixel size for custom/system API models.
 * Keep generic custom/system API requests aligned with the selected resolution.
 * NewAPI-specific adapters normalize this value again before calling NewAPI.
 */
export function resolveCustomApiImageSize(aspectRatio: string, resolution: string): string {
  if (/^\d{2,5}x\d{2,5}$/i.test(resolution.trim())) return resolution.trim().toLowerCase();
  return resolveImageSize(aspectRatio, resolution);
}

export function resolveImageSizeFromDimensions(width: number | undefined, height: number | undefined, resolution: string): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;

  const ratio = width / height;
  const candidates = ASPECT_RATIOS.filter(item => item.value !== 'auto').map(item => ({
    value: item.value,
    distance: Math.abs(Math.log(ratio / parseAspectRatioValue(item.value))),
  }));
  const closest = candidates.sort((a, b) => a.distance - b.distance)[0]?.value;
  return closest ? resolveImageSize(closest, resolution) : undefined;
}

function parseAspectRatioValue(aspectRatio: string): number {
  const [width, height] = aspectRatio.split(':').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 1;
}

/**
 * Get aspect ratio description for prompt augmentation.
 * Many APIs ignore size/aspect_ratio parameters, so we embed the ratio
 * in the prompt as a fallback to guide the model's output orientation.
 */
export function getAspectRatioPromptHint(aspectRatio: string): string {
  const hints: Record<string, string> = {
    '1:1': 'square format, 1:1 aspect ratio',
    '16:9': 'landscape/widescreen format, 16:9 aspect ratio, horizontal orientation',
    '9:16': 'portrait/vertical format, 9:16 aspect ratio, vertical orientation',
    '4:3': 'standard landscape format, 4:3 aspect ratio',
    '3:4': 'standard portrait format, 3:4 aspect ratio',
  };
  return hints[aspectRatio] || '';
}

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function clampImageCount(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(10, Math.max(1, Math.floor(value)));
}

export function inferImageParamsFromPrompt(
  prompt: string,
  options: { allowOriginalAspectRatio?: boolean } = {},
): { aspectRatio?: string; resolution?: string; count?: number } {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const result: { aspectRatio?: string; resolution?: string; count?: number } = {};

  if (options.allowOriginalAspectRatio && /(原比例|原图比例|保持比例|参考图比例|original\s*(ratio|aspect))/i.test(text)) {
    result.aspectRatio = 'original';
  } else if (/(16\s*[:：/比]\s*9|16:9|widescreen|landscape|横版|宽屏|电影比例)/i.test(text)) {
    result.aspectRatio = '16:9';
  } else if (/(9\s*[:：/比]\s*16|9:16|portrait|vertical|竖版|竖屏|手机壁纸|小红书封面)/i.test(text)) {
    result.aspectRatio = '9:16';
  } else if (/(1\s*[:：/比]\s*1|1:1|square|方图|正方形)/i.test(text)) {
    result.aspectRatio = '1:1';
  } else if (/(4\s*[:：/比]\s*3|4:3)/i.test(text)) {
    result.aspectRatio = '4:3';
  } else if (/(3\s*[:：/比]\s*4|3:4)/i.test(text)) {
    result.aspectRatio = '3:4';
  }

  const explicitSize = lower.match(/\b(1024\s*x\s*1024|1536\s*x\s*1024|1024\s*x\s*1536)\b/);
  if (explicitSize) {
    result.resolution = explicitSize[1].replace(/\s+/g, '');
  } else if (/\b4k\b|4096|超高清|超清/i.test(text)) {
    result.resolution = '4K';
  } else if (/\b2k\b|2048|高清/i.test(text)) {
    result.resolution = '2K';
  } else if (/1080\s*p|\b1080p\b|1920\s*x\s*1080/i.test(text)) {
    result.resolution = '1080P';
  }

  const countPatterns = [
    /(?:生成|出|要|做|数量|count|n)\s*[:：=]?\s*(\d{1,2})\s*(?:张|幅|个|images?|imgs?|pics?)?/i,
    /(\d{1,2})\s*(?:张|幅|个|images?|imgs?|pics?)/i,
  ];
  for (const pattern of countPatterns) {
    const match = text.match(pattern);
    const parsed = match ? clampImageCount(Number(match[1])) : undefined;
    if (parsed) {
      result.count = parsed;
      break;
    }
  }
  if (!result.count) {
    const chineseCount = text.match(/([一二两三四五六七八九十])\s*(?:张|幅|个)/);
    if (chineseCount) result.count = CHINESE_NUMBERS[chineseCount[1]];
  }

  return result;
}

// ---- 视频生成模型 ----

export interface VideoModelConfig {
  id: string;
  label: string;
  provider: string;
  description: string;
}

export const VIDEO_MODELS: VideoModelConfig[] = [
  {
    id: 'doubao-seedance-1-5-pro-251215',
    label: 'SeeDance Pro',
    provider: '字节跳动',
    description: '专业视频生成，画质与流畅度兼优',
  },
  {
    id: 'doubao-seedance-1-0-lite-250428',
    label: 'SeeDance Lite',
    provider: '字节跳动',
    description: '轻量快速，适合短片段生成',
  },
];

// ---- 通用 ----

export type ImageStylePreset = {
  label: string;
  prompt: string;
};

export const IMAGE_STYLE_PRESET_LABELS = [
  '写实照片', '动漫插画', '水墨国风', '油画质感', '赛博朋克', '水彩淡雅', '像素复古', '极简线条', '梦幻童话', '暗黑哥特',
  '电影写实', '胶片摄影', '宝丽来', '复古港风', '日系清新', '韩系写真', '法式浪漫', '美式复古', '北欧极简', '东方禅意',
  '新中式', '国潮插画', '工笔重彩', '宋画雅致', '敦煌壁画', '浮世绘', '漫画分镜', '少女漫画', '少年热血', '欧美漫画',
  '儿童绘本', '黏土动画', '定格动画', '3D卡通', '皮克斯质感', '吉卜力氛围', '低多边形', '等距插画', '扁平矢量', '线稿素描',
  '铅笔速写', '炭笔素描', '马克笔', '彩铅手绘', '粉彩画', '丙烯画', '厚涂插画', '概念艺术', '游戏原画', '角色设定',
  '场景概念', '奇幻史诗', '魔法学院', '蒸汽朋克', '柴油朋克', '太空歌剧', '未来主义', '机甲科幻', '末日废土', '生物机械',
  '霓虹夜景', '城市街拍', '建筑摄影', '室内设计', '产品摄影', '商业广告', '时尚大片', '高级珠宝', '美食摄影', '旅行纪实',
  '自然风光', '森林秘境', '海边度假', '雪景电影', '雨夜氛围', '晨雾柔光', '夕阳逆光', '蓝调时刻', '高调影棚', '低调影棚',
  '伦勃朗光', '硬光戏剧', '柔光人像', '浅景深', '微距细节', '超现实主义', '梦核', '怪诞艺术', '波普艺术', '孟菲斯',
  '包豪斯', '野兽派', '印象派', '表现主义', '立体主义', '极繁主义', '赛璐璐', '玻璃拟态', '金属质感', '陶瓷质感',
  '纸艺拼贴', '剪纸风', '刺绣纹理', '织物纹理', '木刻版画', '黑白版画', '双色海报', '杂志大片', '社媒封面', '电商主图',
  '品牌KV', '海报设计', '专辑封面', '书籍封面', '塔罗牌', '复古科幻封面', '暗调悬疑', '暖调治愈', '清冷高级', '甜酷潮流',
  '运动视觉', '奢华金色', '透明水晶', '液态金属', '全息镭射', '红外摄影', '航拍视角', '鱼眼镜头', '长曝光', '双重曝光',
] as const;

export function buildImage2StylePrompt(label: string): string {
  return `Apply a ${label} visual style for an image2 generation model; preserve the user's main subject and composition, refine lighting, color grading, texture, and detail quality, keep clean edges and coherent anatomy, no text or watermark.`;
}

export const STYLE_PRESETS: ImageStylePreset[] = IMAGE_STYLE_PRESET_LABELS.map(label => ({
  label,
  prompt: buildImage2StylePrompt(label),
}));

export const IMG2IMG_STYLE_PRESETS = STYLE_PRESETS;

export function getImageStylePreset(label: string | undefined): ImageStylePreset | undefined {
  if (!label) return undefined;
  return STYLE_PRESETS.find(preset => preset.label === label);
}

export const CAMERA_MOVEMENTS = ['固定镜头', '平移', '推拉', '摇臂', '航拍'];
export const IMG2VIDEO_CAMERA_MOVEMENTS = ['固定镜头', '缓慢推进', '环绕', '航拍推移', '焦点切换'];

export const VIDEO_STYLES = ['真实电影', '动画', '纪录片', '科幻', '奇幻', '新闻'];

export const VIDEO_ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3 横版' },
] as const;

export const VIDEO_DURATIONS = [
  { value: '4', label: '4秒', credits: 20 },
  { value: '6', label: '6秒', credits: 30 },
  { value: '8', label: '8秒', credits: 40 },
  { value: '10', label: '10秒', credits: 50 },
] as const;

export const VIDEO_DURATIONS_SHORT = [
  { value: '4', label: '4秒', credits: 20 },
  { value: '6', label: '6秒', credits: 30 },
  { value: '8', label: '8秒', credits: 40 },
] as const;

// 辅助：根据模型 ID 获取模型配置
export function getImageModelConfig(modelId: string): ImageModelConfig | undefined {
  return IMAGE_MODELS.find(m => m.id === modelId);
}

// 辅助：计算积分消耗（自定义模型不消耗积分，系统模型按管理员配置消耗）
export function calcImageCredits(modelId: string, resolution?: string, aspectRatio?: string, count: number = 1, systemCreditsPerUse?: number): number {
  if (isCustomModel(modelId)) return 0;
  if (isSystemModel(modelId) && systemCreditsPerUse !== undefined) return systemCreditsPerUse * count;
  // Resolution credits
  const r = RESOLUTION_OPTIONS.find(o => o.value === resolution);
  return (r?.credits ?? 10) * count;
}

export function calcVideoCredits(
  duration: string,
  modelId?: string,
  systemPricing?: number | {
    creditsPerUse?: number;
    billingMode?: 'free' | 'fixed' | 'ratio' | 'token' | 'duration';
    fixedPrice?: number;
    durationPricePerSecond?: number;
  },
): number {
  if (modelId && isCustomModel(modelId)) return 0;
  if (modelId && isSystemModel(modelId) && systemPricing !== undefined) {
    if (typeof systemPricing === 'number') return systemPricing;
    if (systemPricing.billingMode === 'free') return 0;
    if (systemPricing.billingMode === 'duration') {
      const seconds = Math.max(0, Number(duration) || 0);
      return Math.ceil(seconds * Number(systemPricing.durationPricePerSecond || 0));
    }
    if (systemPricing.billingMode === 'fixed') {
      return Math.ceil(Number(systemPricing.fixedPrice || systemPricing.creditsPerUse || 0));
    }
    return Math.ceil(Number(systemPricing.creditsPerUse || systemPricing.fixedPrice || 0));
  }
  const d = VIDEO_DURATIONS.find(o => o.value === duration);
  return d?.credits ?? 20;
}

// ---- 自定义模型 (用户添加的 API 密钥对应的模型) ----

// 自定义模型 ID 前缀，用于区分内置模型和自定义模型
export const CUSTOM_MODEL_PREFIX = 'custom:';

// 判断是否为自定义模型
export function isCustomModel(modelId: string): boolean {
  return modelId.startsWith(CUSTOM_MODEL_PREFIX);
}

// 从自定义模型 ID 中提取 apiKey ID
export function getCustomKeyId(modelId: string): string {
  return modelId.slice(CUSTOM_MODEL_PREFIX.length);
}

// 构建自定义模型 ID
export function buildCustomModelId(keyId: string): string {
  return `${CUSTOM_MODEL_PREFIX}${keyId}`;
}

// ---- 系统模型 (管理员配置的默认API) ----

// 系统模型 ID 前缀，用于区分内置模型、自定义模型和系统模型
export const SYSTEM_MODEL_PREFIX = 'system:';

// 判断是否为系统模型
export function isSystemModel(modelId: string): boolean {
  return modelId.startsWith(SYSTEM_MODEL_PREFIX);
}

// 从系统模型 ID 中提取系统 API ID
export function getSystemApiId(modelId: string): string {
  return modelId.slice(SYSTEM_MODEL_PREFIX.length);
}

// 构建系统模型 ID
export function buildSystemModelId(apiId: string): string {
  return `${SYSTEM_MODEL_PREFIX}${apiId}`;
}
