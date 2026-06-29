'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

interface GenerationLoadingPanelProps {
  startedAt: number;
  estimateSeconds: number;
  jobStatus?: {
    estimateSeconds?: number;
    elapsed_seconds?: number;
    status?: string;
    progress?: Record<string, unknown>;
    eta?: {
      estimateSeconds?: number;
      source?: string;
      sampleCount?: number;
      windowDays?: number | null;
    };
  } | null;
  finalCountdownSeconds?: number | null;
  title?: string;
  className?: string;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function GenerationLoadingPanel({
  startedAt,
  estimateSeconds,
  jobStatus = null,
  finalCountdownSeconds = null,
  title = '正在生成作品',
  className = '',
}: GenerationLoadingPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [effectiveEstimateSeconds, setEffectiveEstimateSeconds] = useState(estimateSeconds);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const progressData = jobStatus?.progress || {};
  const upstreamEstimate = Number(
    progressData.estimateSeconds
      || progressData.etaSeconds
      || jobStatus?.eta?.estimateSeconds
      || jobStatus?.estimateSeconds
      || 0,
  );
  const baseEstimateSeconds = Number.isFinite(upstreamEstimate) && upstreamEstimate > 0
    ? Math.ceil(upstreamEstimate)
    : estimateSeconds;

  useEffect(() => {
    setEffectiveEstimateSeconds(Math.max(1, baseEstimateSeconds));
  }, [baseEstimateSeconds, startedAt]);

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const progressRemaining = Number(progressData.remainingSeconds);
  const hasUpstreamRemaining = Number.isFinite(progressRemaining) && progressRemaining >= 0;
  const progressPercent = Number(progressData.percent);
  const hasUpstreamPercent = Number.isFinite(progressPercent) && progressPercent > 0;

  useEffect(() => {
    if (finalCountdownSeconds !== null || hasUpstreamRemaining) return;
    const remaining = effectiveEstimateSeconds - elapsedSeconds;
    if (remaining <= 10) {
      setEffectiveEstimateSeconds(elapsedSeconds + 20);
    }
  }, [effectiveEstimateSeconds, elapsedSeconds, finalCountdownSeconds, hasUpstreamRemaining]);

  const remainingSeconds = finalCountdownSeconds !== null
    ? Math.max(0, Math.ceil(finalCountdownSeconds))
    : hasUpstreamRemaining
      ? Math.ceil(progressRemaining)
      : Math.max(1, effectiveEstimateSeconds - elapsedSeconds);
  const progress = useMemo(() => {
    if (finalCountdownSeconds !== null) return 100;
    if (hasUpstreamPercent) return Math.min(99, Math.max(8, progressPercent));
    if (effectiveEstimateSeconds <= 0) return 100;
    return Math.min(96, Math.max(8, (elapsedSeconds / effectiveEstimateSeconds) * 100));
  }, [effectiveEstimateSeconds, elapsedSeconds, finalCountdownSeconds, hasUpstreamPercent, progressPercent]);

  const statusText = finalCountdownSeconds !== null
    ? '生成结果已返回，正在准备展示'
    : typeof progressData.message === 'string' && progressData.message.trim()
      ? progressData.message
      : '妙境正在处理请求，请保持页面打开';
  const remainingLabel = finalCountdownSeconds !== null ? '展示倒计时' : '预计剩余';

  const glowBlobs = useMemo(() => {
    let seed = Math.max(1, Math.floor(startedAt % 2147483647));
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };

    return Array.from({ length: 9 }, (_, index) => {
      const size = 120 + random() * 240;
      const floatX = (random() - 0.5) * 260;
      const floatY = (random() - 0.5) * 190;
      const duration = 5.4 + random() * 5.8;
      const delay = -random() * duration;

      return {
        id: index,
        style: {
          left: `${random() * 96}%`,
          top: `${random() * 92}%`,
          width: `${size}px`,
          height: `${size}px`,
          opacity: 0.12 + random() * 0.25,
          animationDuration: `${duration}s`,
          animationDelay: `${delay}s`,
          '--float-x': `${floatX}px`,
          '--float-y': `${floatY}px`,
        } as CSSProperties,
      };
    });
  }, [startedAt]);

  return (
    <div className={`relative flex min-h-[300px] w-full flex-col items-center justify-center overflow-hidden px-8 py-16 text-center ${className}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,213,124,0.10),rgba(245,166,35,0.05)_38%,rgba(0,0,0,0)_76%)] blur-2xl light:bg-[radial-gradient(circle_at_50%_50%,rgba(255,214,128,0.18),rgba(255,241,204,0.12)_42%,rgba(255,255,255,0)_78%)]" />
      {glowBlobs.map(blob => (
        <div
          key={blob.id}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,241,193,0.78),rgba(245,184,65,0.30)_38%,rgba(245,166,35,0)_72%)] blur-3xl animate-[golden-float-random_7s_ease-in-out_infinite] light:bg-[radial-gradient(circle,rgba(255,232,174,0.72),rgba(245,184,65,0.26)_38%,rgba(245,166,35,0)_72%)]"
          style={blob.style}
        />
      ))}

      <div className="relative z-10 w-full max-w-md">
        <p className="text-xl font-semibold text-amber-50 drop-shadow-[0_2px_16px_rgba(245,166,35,0.24)] light:text-foreground">{title}</p>
        <p className="mt-2 text-sm text-amber-100/62 light:text-muted-foreground">{statusText}</p>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-amber-200/14 bg-black/18 p-4 backdrop-blur-xl light:border-amber-900/12 light:bg-white/40">
            <p className="text-xs text-amber-100/58 light:text-muted-foreground">已用时间</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-amber-50 light:text-foreground">{formatDuration(elapsedSeconds)}</p>
          </div>
          <div className="rounded-2xl border border-amber-200/14 bg-black/18 p-4 backdrop-blur-xl light:border-amber-900/12 light:bg-white/40">
            <p className="text-xs text-amber-100/58 light:text-muted-foreground">{remainingLabel}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-amber-50 light:text-foreground">
              {remainingSeconds > 0 ? formatDuration(remainingSeconds) : '即将完成'}
            </p>
          </div>
        </div>

        <div className="mt-7 h-2 overflow-hidden rounded-full bg-amber-950/32 light:bg-amber-900/10">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(245,166,35,0.55),rgba(255,228,163,0.9),rgba(245,166,35,0.55))] shadow-[0_0_26px_rgba(245,166,35,0.42)] transition-[width] duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
