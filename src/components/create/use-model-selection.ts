'use client';

import { useCallback, useEffect, useState } from 'react';

export type ModelSelectionOption = {
  id: string;
  group: string;
};

export function chooseFallbackModel(options: readonly ModelSelectionOption[]): string {
  const customOption = options.find(option => option.group === '自定义模型');
  return customOption?.id || options[0]?.id || '';
}

export function normalizeSelectedModel(selectedModel: string, options: readonly ModelSelectionOption[]): string {
  if (options.length === 0) return '';
  if (selectedModel && options.some(option => option.id === selectedModel)) return selectedModel;
  return chooseFallbackModel(options);
}

export function useModelSelection(
  options: readonly ModelSelectionOption[],
  selectedModelStorageKey: string,
  touchedStorageKey: string,
) {
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedModelRestored, setSelectedModelRestored] = useState(false);
  const [selectedModelTouched, setSelectedModelTouched] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(selectedModelStorageKey);
      setSelectedModelTouched(window.localStorage.getItem(touchedStorageKey) === '1');
      if (stored) setSelectedModel(stored);
    } catch {
      // Ignore unavailable storage.
    } finally {
      setSelectedModelRestored(true);
    }
  }, [selectedModelStorageKey, touchedStorageKey]);

  useEffect(() => {
    if (!selectedModelRestored) return;
    if (options.length === 0) return;
    const normalizedModel = normalizeSelectedModel(selectedModel, options);
    if (normalizedModel !== selectedModel) setSelectedModel(normalizedModel);
  }, [options, selectedModel, selectedModelRestored]);

  useEffect(() => {
    if (!selectedModelRestored) return;
    try {
      if (selectedModel) {
        window.localStorage.setItem(selectedModelStorageKey, selectedModel);
      } else {
        window.localStorage.removeItem(selectedModelStorageKey);
      }
      if (selectedModelTouched) window.localStorage.setItem(touchedStorageKey, '1');
    } catch {
      // Ignore unavailable storage.
    }
  }, [selectedModel, selectedModelRestored, selectedModelStorageKey, selectedModelTouched, touchedStorageKey]);

  const handleSelectedModelChange = useCallback((value: string) => {
    setSelectedModelTouched(true);
    setSelectedModel(value);
    try {
      window.localStorage.setItem(touchedStorageKey, '1');
      window.localStorage.setItem(selectedModelStorageKey, value);
    } catch {
      // Ignore unavailable storage.
    }
  }, [selectedModelStorageKey, touchedStorageKey]);

  return {
    selectedModel,
    setSelectedModel,
    selectedModelTouched,
    selectedModelRestored,
    handleSelectedModelChange,
  };
}
