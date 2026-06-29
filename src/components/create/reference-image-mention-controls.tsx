'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExpandablePromptTextarea } from '@/components/create/expandable-prompt-textarea';

export interface ReferenceImageMentionItem {
  id: string;
  name: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface ReferenceImageAnnotationPayload {
  index: number;
  token: string;
  name?: string;
  width?: number;
  height?: number;
}

interface ReferenceImageMentionControlsProps {
  title: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  value: string;
  references: ReferenceImageMentionItem[];
  onValueChange: (value: string) => void;
}

export function buildReferenceImageAnnotations(
  references: ReferenceImageMentionItem[],
): ReferenceImageAnnotationPayload[] {
  return references.map((reference, index) => ({
    index: index + 1,
    token: `@参考图${index + 1}`,
    name: reference.name,
    width: reference.width,
    height: reference.height,
  }));
}

function getMentionQuery(value: string, cursor: number): string | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)(@[\u4e00-\u9fa5\w-]*)$/);
  return match ? match[2] : null;
}

export function ReferenceImageMentionControls({
  title,
  placeholder,
  rows,
  className,
  value,
  references,
  onValueChange,
}: ReferenceImageMentionControlsProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const referenceItems = useMemo(() => buildReferenceImageAnnotations(references), [references]);
  const visibleItems = useMemo(() => {
    if (!mentionQuery || mentionQuery === '@') return referenceItems;
    const query = mentionQuery.slice(1).trim().toLowerCase();
    return referenceItems.filter(item => (
      item.token.toLowerCase().includes(query)
      || item.name?.toLowerCase().includes(query)
    ));
  }, [mentionQuery, referenceItems]);

  const refreshMentionState = useCallback((nextValue = value) => {
    const textarea = textareaRef.current;
    if (!textarea || references.length === 0) {
      setMenuOpen(false);
      setMentionQuery(null);
      return;
    }
    const query = getMentionQuery(nextValue, textarea.selectionStart || 0);
    setMentionQuery(query);
    setMenuOpen(Boolean(query));
  }, [references.length, value]);

  const insertReferenceToken = useCallback((token: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onValueChange(`${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}${token} `);
      setMenuOpen(false);
      return;
    }

    const cursorStart = textarea.selectionStart || 0;
    const cursorEnd = textarea.selectionEnd || cursorStart;
    const query = getMentionQuery(value, cursorStart);
    const replaceStart = query ? cursorStart - query.length : cursorStart;
    const prefix = value.slice(0, replaceStart);
    const suffix = value.slice(cursorEnd);
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
    const insertion = `${needsLeadingSpace ? ' ' : ''}${token} `;
    const nextValue = `${prefix}${insertion}${suffix}`;
    const nextCursor = prefix.length + insertion.length;

    onValueChange(nextValue);
    setMenuOpen(false);
    setMentionQuery(null);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [onValueChange, value]);

  const handleValueChange = useCallback((nextValue: string) => {
    onValueChange(nextValue);
    window.requestAnimationFrame(() => refreshMentionState(nextValue));
  }, [onValueChange, refreshMentionState]);

  const hasReferences = references.length > 0;

  return (
    <div className="relative space-y-2">
      <ExpandablePromptTextarea
        title={title}
        placeholder={hasReferences ? `${placeholder || ''}${placeholder ? '，' : ''}输入 @ 可选择参考图` : placeholder}
        rows={rows}
        className={className}
        value={value}
        textareaRef={textareaRef}
        onBlur={() => window.setTimeout(() => setMenuOpen(false), 120)}
        onClick={() => refreshMentionState()}
        onFocus={() => refreshMentionState()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setMenuOpen(false);
          if (event.key === '@' && hasReferences) {
            setMenuOpen(true);
            setMentionQuery('@');
          }
        }}
        onKeyUp={() => refreshMentionState()}
        onSelect={() => refreshMentionState()}
        onValueChange={handleValueChange}
      />

      {hasReferences && (
        <div className="flex flex-wrap gap-1.5">
          {referenceItems.map(item => (
            <Button
              key={item.index}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
              onClick={() => insertReferenceToken(item.token)}
              title={`插入 ${item.token}`}
            >
              <ImageIcon className="h-3 w-3" />
              {item.token}
            </Button>
          ))}
        </div>
      )}

      {menuOpen && visibleItems.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border/80 bg-background/95 p-1 shadow-xl backdrop-blur">
          {visibleItems.map(item => (
            <button
              key={item.index}
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
              onMouseDown={(event) => {
                event.preventDefault();
                insertReferenceToken(item.token);
              }}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={references[item.index - 1]?.dataUrl} alt="" className="h-full w-full object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.token}</span>
                {item.name && <span className="block truncate text-xs text-muted-foreground">{item.name}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
