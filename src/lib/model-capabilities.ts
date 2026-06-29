import type { ModelCapabilityConfig, ModelCapabilityOption } from '@/lib/model-config-types';

type BaseOption = {
  value: string;
  label: string;
};

function mergeOptions<T extends BaseOption>(
  defaults: readonly T[],
  capabilities: ModelCapabilityOption[] | undefined,
  alwaysKeepValues: string[] = [],
): BaseOption[] {
  if (!capabilities || capabilities.length === 0) return [...defaults];
  const allowed = new Map(capabilities.map(option => [option.value, option.label || option.value]));
  const keep = new Set(alwaysKeepValues);
  const merged: BaseOption[] = [];

  for (const option of defaults) {
    if (keep.has(option.value) || allowed.has(option.value)) {
      merged.push({
        value: option.value,
        label: allowed.get(option.value) || option.label,
      });
    }
  }

  for (const option of capabilities) {
    if (!merged.some(item => item.value === option.value)) {
      merged.push({ value: option.value, label: option.label || option.value });
    }
  }

  return merged.length > 0 ? merged : [...defaults];
}

export function getImageCapabilityOptions<TAspect extends BaseOption, TResolution extends BaseOption, TQuality extends BaseOption>(
  capabilities: ModelCapabilityConfig | undefined,
  defaults: {
    aspectRatios: readonly TAspect[];
    resolutions: readonly TResolution[];
    qualities: readonly TQuality[];
    outputFormats?: readonly BaseOption[];
  },
  options: { keepOriginalAspectRatio?: boolean } = {},
) {
  const supportsAspectRatio = capabilities?.supportsAspectRatio !== false;
  const supportsResolution = capabilities?.supportsResolution !== false;
  const supportsQuality = capabilities?.supportsQuality !== false;
  const supportsOutputFormat = capabilities?.supportsOutputFormat !== false;
  return {
    supportsAspectRatio,
    supportsResolution,
    supportsQuality,
    supportsOutputFormat,
    aspectRatios: supportsAspectRatio ? mergeOptions(
      defaults.aspectRatios,
      capabilities?.aspectRatios,
      options.keepOriginalAspectRatio ? ['auto', 'original'] : ['auto'],
    ) : [],
    resolutions: supportsResolution ? mergeOptions(defaults.resolutions, capabilities?.resolutions, ['auto']) : [],
    qualities: supportsQuality ? mergeOptions(defaults.qualities, capabilities?.qualities, ['auto']) : [],
    outputFormats: supportsOutputFormat && defaults.outputFormats
      ? mergeOptions(defaults.outputFormats, capabilities?.outputFormats)
      : undefined,
  };
}

export function getVideoCapabilityOptions<TAspect extends BaseOption, TDuration extends BaseOption, TResolution extends BaseOption>(
  capabilities: ModelCapabilityConfig | undefined,
  defaults: {
    aspectRatios: readonly TAspect[];
    durations: readonly TDuration[];
    resolutions: readonly TResolution[];
  },
) {
  const supportsAspectRatio = capabilities?.supportsAspectRatio !== false;
  const supportsDuration = capabilities?.supportsDuration !== false;
  const supportsResolution = capabilities?.supportsResolution !== false;
  return {
    supportsAspectRatio,
    supportsDuration,
    supportsResolution,
    aspectRatios: supportsAspectRatio ? mergeOptions(defaults.aspectRatios, capabilities?.aspectRatios) : [],
    durations: supportsDuration ? mergeOptions(defaults.durations, capabilities?.durations) : [],
    resolutions: supportsResolution ? mergeOptions(defaults.resolutions, capabilities?.resolutions) : [],
  };
}

export function ensureSelectedOption(
  selected: string,
  options: readonly BaseOption[],
  fallback = 'auto',
): string {
  if (options.some(option => option.value === selected)) return selected;
  return options.find(option => option.value === fallback)?.value || options[0]?.value || selected;
}

export function keepSelectedOptionVisible<T extends BaseOption>(
  options: readonly T[],
  selected: string,
): BaseOption[] {
  if (!selected || options.some(option => option.value === selected)) return [...options];
  return [{ value: selected, label: `${selected}（当前选择）` }, ...options];
}
