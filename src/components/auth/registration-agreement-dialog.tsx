'use client';

import { UIEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSiteConfig } from '@/lib/site-config';

type RegistrationAgreementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAgree: () => void;
};

function hasScrolledToBottom(element: HTMLElement) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
}

export function RegistrationAgreementDialog({ open, onOpenChange, onAgree }: RegistrationAgreementDialogProps) {
  const { config } = useSiteConfig();
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  useEffect(() => {
    if (open) setScrolledToBottom(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (content && (content.scrollHeight <= content.clientHeight + 4 || hasScrolledToBottom(content))) {
        setScrolledToBottom(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, config.termsOfService, config.privacyPolicy]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (hasScrolledToBottom(event.currentTarget)) {
      setScrolledToBottom(true);
    }
  };

  const handleAgree = () => {
    if (!scrolledToBottom) return;
    onAgree();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="auth-mobile-dialog max-h-[90vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>服务条款与隐私政策</DialogTitle>
          <DialogDescription>
            请完整阅读以下内容，滚动到底部后点击同意即可继续注册。
          </DialogDescription>
        </DialogHeader>

        <div
          ref={contentRef}
          className="max-h-[54vh] overflow-y-auto rounded-lg border border-border bg-muted/20 p-4 text-sm leading-7 text-foreground"
          onScroll={handleScroll}
        >
          <section className="space-y-3">
            <h3 className="text-base font-semibold">服务条款</h3>
            <div className="whitespace-pre-wrap break-words text-muted-foreground">
              {config.termsOfService}
            </div>
          </section>

          <section className="mt-6 space-y-3">
            <h3 className="text-base font-semibold">隐私政策</h3>
            <div className="whitespace-pre-wrap break-words text-muted-foreground">
              {config.privacyPolicy}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {scrolledToBottom ? '已阅读到底部，可以继续注册。' : '请先滚动阅读至底部。'}
          </p>
          <div className="flex gap-2 sm:justify-end">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleAgree} disabled={!scrolledToBottom}>
              同意并继续注册
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
