'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useRef, type ReactNode } from 'react';

type MobileCreationComposerProps = {
  prompt: string;
  placeholder: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  disabled?: boolean;
  generating?: boolean;
  params?: ReactNode;
  styles?: ReactNode;
  prefix?: ReactNode;
  input?: ReactNode;
};

export function MobileCreationComposer({
  prompt,
  placeholder,
  onPromptChange,
  onGenerate,
  disabled,
  generating,
  params,
  styles,
  prefix,
  input,
}: MobileCreationComposerProps) {
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const composer = composerRef.current;
    const layout = composer?.closest<HTMLElement>('.create-chat-layout');
    if (!composer || !layout) return undefined;

    const updateComposerHeight = () => {
      const height = Math.ceil(composer.getBoundingClientRect().height);
      layout.style.setProperty('--create-mobile-composer-height', `${height}px`);
    };

    updateComposerHeight();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateComposerHeight)
      : null;
    resizeObserver?.observe(composer);
    window.addEventListener('resize', updateComposerHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateComposerHeight);
      layout.style.removeProperty('--create-mobile-composer-height');
    };
  }, []);

  return (
    <div ref={composerRef} className="create-mobile-dialog-composer">
      {prefix}
      {params && <div className="create-mobile-param-strip">{params}</div>}
      {styles && <div className="create-mobile-style-strip">{styles}</div>}
      <div className="create-mobile-input-shell">
        {input ?? (
          <Textarea
            className="create-mobile-prompt-input"
            rows={1}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={placeholder}
          />
        )}
        <Button
          type="button"
          className="create-mobile-send-button"
          size="icon"
          onClick={onGenerate}
          disabled={disabled}
          aria-busy={generating || undefined}
          aria-label="发送创作"
        >
          {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );
}
