'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCreationHistory, type CreationRecord, isPlaceholder } from '@/lib/creation-history-store';
import { CreationDetailDialog } from '@/components/creation-detail-dialog';
import { FileSearch, Film, Image as ImageIcon, ImageOff } from 'lucide-react';
export default function CreationHistoryTab() {
  const { records, remove, clear } = useCreationHistory();
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'reverse-prompt'>('all');
  const [selectedRecord, setSelectedRecord] = useState<CreationRecord | null>(null);

  const filtered = filter === 'all' ? records : records.filter(r => r.type === filter);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" />创作历史</CardTitle>
            <CardDescription>点击记录查看详情、提示词和参考图</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {records.length > 0 && (
              <Button variant="ghost" size="sm" className="text-destructive text-xs" onClick={clear}>
                清空历史
              </Button>
            )}
          </div>
        </div>
        {/* Filter */}
        <div className="flex gap-2 mt-2">
          {(['all', 'image', 'video', 'reverse-prompt'] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '全部' : f === 'image' ? '图片' : f === 'video' ? '视频' : '图片反推'}
              {f === 'all' ? ` (${records.length})` : ` (${records.filter(r => r.type === f).length})`}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>还没有创作记录，去创作中心开始创作吧</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {filtered.map((record) => {
              const isPlaceholderUrl = isPlaceholder(record.url);
              const isReversePrompt = record.type === 'reverse-prompt';
              return (
                <div
                  key={record.id}
                  className="group relative rounded-lg border border-border/80 overflow-hidden bg-muted/50 cursor-pointer"
                  onClick={() => setSelectedRecord(record)}
                >
                  {isReversePrompt ? (
                    record.referenceImage && !isPlaceholder(record.referenceImage) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={record.referenceImage}
                        alt={record.prompt}
                        className="w-full aspect-square object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-square flex flex-col items-center justify-center gap-1">
                        <FileSearch className="h-7 w-7 text-muted-foreground/35" />
                        <span className="text-[10px] text-muted-foreground/60">图片反推</span>
                      </div>
                    )
                  ) : isPlaceholderUrl ? (
                    <div className="w-full aspect-square flex flex-col items-center justify-center gap-1">
                      <ImageOff className="h-6 w-6 text-muted-foreground/30" />
                      <span className="text-[10px] text-muted-foreground/50">链接已过期</span>
                    </div>
                  ) : record.type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={record.thumbnailUrl || record.url}
                      alt={record.prompt}
                      className="w-full aspect-square object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-square flex items-center justify-center relative">
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center">
                          <Film className="h-5 w-5 text-black ml-0.5" />
                        </div>
                      </div>
                      <Film className="h-10 w-10 text-muted-foreground opacity-20" />
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex flex-col justify-end p-2 opacity-0 group-hover:opacity-100">
                    <p className="text-xs text-white line-clamp-2 mb-1">{record.prompt}</p>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] px-1 py-0 border-white/30 text-white/80">
                        {isReversePrompt ? '图片反推' : record.modelLabel}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Detail Dialog */}
      <CreationDetailDialog
        record={selectedRecord}
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onDelete={async (deletedRecord) => {
          await remove(deletedRecord.id);
          setSelectedRecord(null);
        }}
      />
    </Card>
  );
}
