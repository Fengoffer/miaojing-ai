'use client';

import { useState, type FocusEventHandler, type KeyboardEventHandler, type MouseEventHandler, type ReactEventHandler, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ExpandablePromptTextareaProps {
  title: string;
  placeholder?: string;
  rows?: number;
  value: string;
  className?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  onClick?: MouseEventHandler<HTMLTextAreaElement>;
  onFocus?: FocusEventHandler<HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onKeyUp?: KeyboardEventHandler<HTMLTextAreaElement>;
  onSelect?: ReactEventHandler<HTMLTextAreaElement>;
  onValueChange: (value: string) => void;
}

export function ExpandablePromptTextarea({
  title,
  placeholder,
  rows,
  value,
  className,
  textareaRef,
  onBlur,
  onClick,
  onFocus,
  onKeyDown,
  onKeyUp,
  onSelect,
  onValueChange,
}: ExpandablePromptTextareaProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Textarea
        ref={textareaRef}
        placeholder={placeholder}
        rows={rows}
        value={value}
        onChange={event => onValueChange(event.target.value)}
        onBlur={onBlur}
        onClick={onClick}
        onDoubleClick={() => setOpen(true)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onSelect={onSelect}
        title="双击放大编辑"
        className={className}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="!w-[96vw] !max-w-[1620px] max-h-[90vh] border-white/15 bg-background/88 backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            placeholder={placeholder}
            value={value}
            onChange={event => onValueChange(event.target.value)}
            className="h-[68vh] resize-none overflow-y-auto text-base leading-7"
          />
          <div className="flex justify-end">
            <Button onClick={() => setOpen(false)}>完成</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
