'use client';

import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const IMAGE_COUNT_OPTIONS = [
  { value: '1', label: '1 张' },
  { value: '2', label: '2 张' },
  { value: '3', label: '3 张' },
  { value: '4', label: '4 张' },
] as const;

function normalizeCountValue(value: string): string {
  const numeric = value.replace(/[^\d]/g, '');
  if (!numeric) return '1';
  return String(Math.min(10, Math.max(1, Math.floor(Number(numeric)))));
}

interface ImageCountComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ImageCountCombobox({ value, onChange, className }: ImageCountComboboxProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div
      className={cn('relative w-28', className)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <Input
        ref={inputRef}
        aria-label="生成数量"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="h-10 pr-9 text-center"
        inputMode="numeric"
        maxLength={2}
        placeholder="1"
        role="combobox"
        value={value === 'auto' ? '1' : value}
        onBlur={event => onChange(normalizeCountValue(event.currentTarget.value))}
        onChange={event => {
          setOpen(true);
          onChange(normalizeCountValue(event.currentTarget.value));
        }}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
      />
      <button
        type="button"
        aria-label="选择生成数量"
        className="text-muted-foreground hover:text-foreground focus-visible:border-primary/70 focus-visible:ring-primary/30 absolute top-0 right-0 flex h-10 w-9 items-center justify-center rounded-r-md outline-none focus-visible:ring-2"
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          setOpen(current => !current);
          inputRef.current?.focus();
        }}
      >
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="listbox"
          className="glass-popover absolute top-full left-0 z-[100] mt-1 w-28 rounded-md p-1"
        >
          {IMAGE_COUNT_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={cn(
                'focus:bg-accent focus:text-accent-foreground flex min-h-8 w-full items-center justify-center rounded-sm px-2 text-center text-sm outline-none',
                value === option.value && 'bg-accent text-accent-foreground',
              )}
              onMouseDown={event => event.preventDefault()}
              onClick={() => selectValue(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
