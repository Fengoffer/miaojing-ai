'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ImageStylePreset } from '@/lib/model-config';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';

type StylePresetSelectorProps = {
  presets: ImageStylePreset[];
  selectedLabel?: string;
  onSelect: (label: string) => void;
};

export function StylePresetSelector({ presets, selectedLabel, onSelect }: StylePresetSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  const visiblePresets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return presets;
    return presets.filter(preset => preset.label.toLowerCase().includes(keyword));
  }, [presets, query]);

  return (
    <div className="style-preset-selector space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">预设风格</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-primary hover:text-primary"
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? '收起' : '展开'}
        </Button>
      </div>

      {expanded && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索预设风格"
            className="h-9 pl-8 text-sm"
          />
        </div>
      )}

      <div className={`style-preset-list flex flex-wrap gap-1.5 ${expanded ? 'is-expanded max-h-56 overflow-y-auto pr-1' : 'is-collapsed max-h-[64px] overflow-hidden'}`}>
        {visiblePresets.map(preset => {
          const selected = selectedLabel === preset.label;
          return (
            <Badge
              key={preset.label}
              variant={selected ? 'default' : 'outline'}
              className={`cursor-pointer text-xs transition-colors ${selected ? '' : 'hover:bg-primary/10'}`}
              onClick={() => onSelect(selected ? '' : preset.label)}
            >
              {preset.label}
            </Badge>
          );
        })}
        {visiblePresets.length === 0 && (
          <span className="text-xs text-muted-foreground">没有匹配的风格</span>
        )}
      </div>
    </div>
  );
}
