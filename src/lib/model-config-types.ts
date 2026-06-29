export type ManagedModelType = 'image' | 'video' | 'text';
export type ManagedMembershipTier = 'free' | 'pro' | 'max' | 'ultra';
export type ManagedSystemApiPollingMode = 'sequential' | 'random' | 'custom';
export type ManagedVideoUsageMode = 'text-to-video' | 'image-to-video';

export interface ModelCapabilityOption {
  value: string;
  label?: string;
}

export interface ModelCapabilityConfig {
  aspectRatios?: ModelCapabilityOption[];
  resolutions?: ModelCapabilityOption[];
  qualities?: ModelCapabilityOption[];
  outputFormats?: ModelCapabilityOption[];
  durations?: ModelCapabilityOption[];
  supportsAspectRatio?: boolean;
  supportsResolution?: boolean;
  supportsQuality?: boolean;
  supportsOutputFormat?: boolean;
  supportsDuration?: boolean;
}

export interface ManagedApiProvider {
  id: string;
  name: string;
  defaultApiUrl: string;
  defaultModel: string;
  type: ManagedModelType;
  website: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ManagedModelRecommendation {
  id: string;
  modelName: string;
  displayName: string;
  type: ManagedModelType;
  providerId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ManagedModelConfigResponse {
  providers: ManagedApiProvider[];
  recommendations: ManagedModelRecommendation[];
  systemApis?: ManagedSystemApi[];
}

export interface ManagedSystemApi {
  id: string;
  provider: string;
  name: string;
  apiUrl: string;
  modelName: string;
  modelGroup: string;
  note: string;
  apiKey: '';
  apiKeyPreview: string;
  type: ManagedModelType;
  creditsPerUse: number;
  billingMode: 'free' | 'fixed' | 'ratio' | 'token' | 'duration';
  fixedPrice: number;
  durationPricePerSecond?: number;
  inputPricePer1K: number;
  outputPricePer1K: number;
  modelRatio: number;
  completionRatio: number;
  groupRatio: number;
  priceNote: string;
  manifestPath?: string;
  capabilities?: ModelCapabilityConfig;
  isDefault: boolean;
  allowedMembershipTiers: ManagedMembershipTier[];
  pollingMode: ManagedSystemApiPollingMode;
  pollingOrder: number;
  videoUsageModes?: ManagedVideoUsageMode[];
  isActive: boolean;
  sortOrder: number;
}
