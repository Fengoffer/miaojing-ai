'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Megaphone } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ServerAnnouncement {
  id: string;
  title: string;
  content: string;
  start_date?: string | null;
  end_date?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  enabled?: boolean;
  is_active?: boolean;
}

function isActive(ann: ServerAnnouncement): boolean {
  if (ann.enabled === false || ann.is_active === false) return false;
  const now = Date.now();
  const startValue = ann.start_date || ann.starts_at;
  const endValue = ann.end_date || ann.expires_at;
  const start = startValue ? new Date(startValue).getTime() : 0;
  const endDate = endValue ? new Date(endValue) : null;
  if (endDate) endDate.setHours(23, 59, 59, 999);
  const end = endDate ? endDate.getTime() : Number.POSITIVE_INFINITY;

  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start && now <= end;
}

/**
 * Announcement popup — shown to ALL visitors (including unauthenticated).
 * Shows on every homepage visit (no sessionStorage dismiss tracking).
 */
export function AnnouncementPopup() {
  const [open, setOpen] = useState(false);
  const [currentAnn, setCurrentAnn] = useState<ServerAnnouncement | null>(null);

  useEffect(() => {
    // Fetch active announcements from server (public API, no auth required)
    fetch('/api/announcements')
      .then(res => res.ok ? res.json() : [])
      .then((data: ServerAnnouncement[]) => {
        const activeAnns = (data || []).filter(isActive);
        // Show the first active announcement
        if (activeAnns.length > 0) {
          setCurrentAnn(activeAnns[0]);
          // Delay so page renders first
          const timer = setTimeout(() => setOpen(true), 800);
          return () => clearTimeout(timer);
        }
      })
      .catch(() => { /* silently fail */ });
  }, []);

  if (!currentAnn) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] !max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            {currentAnn.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            平台公告：{currentAnn.title}
          </DialogDescription>
        </DialogHeader>
        <div className="announcement-markdown max-h-[60vh] overflow-y-auto py-2 pr-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {currentAnn.content}
          </ReactMarkdown>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            我知道了
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
