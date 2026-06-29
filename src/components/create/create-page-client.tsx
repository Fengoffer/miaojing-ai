'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Brush, FileSearch, Film, ImagePlus, Loader2, Video } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImageToImagePanel } from '@/components/create/image-to-image';
import ReversePromptPanel from '@/components/create/reverse-prompt-panel';
import { TextToImagePanel } from '@/components/create/text-to-image';
import { ImageToVideoPanel } from '@/components/create/image-to-video';
import { TextToVideoPanel } from '@/components/create/text-to-video';

const TYPE_MAP: Record<string, string> = {
  text2img: 'text2img',
  img2img: 'img2img',
  text2video: 'text2video',
  img2video: 'img2video',
  reversePrompt: 'reversePrompt',
  'reverse-prompt': 'reversePrompt',
};
const DEFAULT_CREATE_TAB = 'text2img';
const CREATE_TAB_STORAGE_KEY = 'miaojing:create-active-tab';
const CREATE_TAB_VALUES = new Set(Object.values(TYPE_MAP));

function normalizeCreateTab(value: string | null): string | null {
  if (!value) return null;
  return TYPE_MAP[value] || null;
}

function getStoredCreateTab(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(CREATE_TAB_STORAGE_KEY);
    return stored && CREATE_TAB_VALUES.has(stored) ? stored : null;
  } catch {
    return null;
  }
}

function persistCreateTab(value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CREATE_TAB_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures so tab switching remains usable in private modes.
  }
}

function replaceCreateTabUrl(value: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('type') === value) return;
  url.searchParams.set('type', value);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function CreateContent() {
  const searchParams = useSearchParams();
  const typeParam = searchParams.get('type');

  const [activeTab, setActiveTab] = useState(DEFAULT_CREATE_TAB);

  useEffect(() => {
    const nextTab = normalizeCreateTab(typeParam) || getStoredCreateTab() || DEFAULT_CREATE_TAB;
    setActiveTab(nextTab);
    persistCreateTab(nextTab);
    if (!typeParam) {
      replaceCreateTabUrl(nextTab);
    }
  }, [typeParam]);

  const handleTabChange = (value: string) => {
    if (!CREATE_TAB_VALUES.has(value)) return;
    setActiveTab(value);
    persistCreateTab(value);
    replaceCreateTabUrl(value);
  };

  const renderModeTriggers = (mobile = false) => (
    <>
      <TabsTrigger value="text2img" className="gap-2">
        <Brush className="h-4 w-4" />
        <span className={mobile ? 'inline' : 'hidden sm:inline'}>文生图</span>
      </TabsTrigger>
      <TabsTrigger value="img2img" className="gap-2">
        <ImagePlus className="h-4 w-4" />
        <span className={mobile ? 'inline' : 'hidden sm:inline'}>图生图</span>
      </TabsTrigger>
      <TabsTrigger value="text2video" className="gap-2">
        <Video className="h-4 w-4" />
        <span className={mobile ? 'inline' : 'hidden sm:inline'}>文生视频</span>
      </TabsTrigger>
      <TabsTrigger value="img2video" className="gap-2">
        <Film className="h-4 w-4" />
        <span className={mobile ? 'inline' : 'hidden sm:inline'}>图生视频</span>
      </TabsTrigger>
      <TabsTrigger value="reversePrompt" className="gap-2">
        <FileSearch className="h-4 w-4" />
        <span className={mobile ? 'inline' : 'hidden sm:inline'}>图片反推</span>
      </TabsTrigger>
    </>
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="create-mobile-tabs-root space-y-6">
      <TabsList className="create-mode-tabs create-mode-tabs-desktop grid w-full grid-cols-5 max-w-4xl">
        {renderModeTriggers()}
      </TabsList>

      <TabsContent value="text2img" className="create-tab-content">
        <TextToImagePanel />
      </TabsContent>
      <TabsContent value="img2img" className="create-tab-content">
        <ImageToImagePanel />
      </TabsContent>
      <TabsContent value="text2video" className="create-tab-content">
        <TextToVideoPanel />
      </TabsContent>
      <TabsContent value="img2video" className="create-tab-content">
        <ImageToVideoPanel />
      </TabsContent>
      <TabsContent value="reversePrompt" className="create-tab-content">
        <ReversePromptPanel
          onUseForTextToImage={() => handleTabChange('text2img')}
          onUseForImageToImage={() => handleTabChange('img2img')}
        />
      </TabsContent>
    </Tabs>
  );
}

export function CreatePageClient() {
  return (
    <div className="create-mobile-page min-h-screen bg-background">
      <div className="create-mobile-shell mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="create-mobile-heading mb-8">
          <h1 className="font-serif text-3xl font-bold">创作中心</h1>
          <p className="mt-2 text-muted-foreground">
            选择创作模式，释放你的想象力
          </p>
        </div>
        <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
          <CreateContent />
        </Suspense>
      </div>
    </div>
  );
}
