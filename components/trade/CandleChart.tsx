'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/lib/compass/types';

/** Candle times may arrive in ms or s; lightweight-charts wants UNIX seconds. */
function toSeconds(t: number): number {
  return t >= 1e11 ? Math.floor(t / 1000) : Math.floor(t);
}

/**
 * Interactive candlestick chart (TradingView Lightweight Charts), themed to the
 * Neon Terminal: transparent canvas over the notched surface, cyan HUD grid,
 * neon green/red candles, cyan crosshair. Auto-fits the data (no clipping) and
 * supports crosshair / pan / zoom. Same props as before so callers don't change.
 */
export function CandleChart({ candles, height = 180, loading = false }: { candles: Candle[]; height?: number; loading?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(141,162,196,0.75)', // --text-dim
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(94,234,255,0.05)' }, // --cp-grid
        horzLines: { color: 'rgba(94,234,255,0.05)' },
      },
      rightPriceScale: { borderColor: 'rgba(120,190,255,0.12)', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: 'rgba(120,190,255,0.12)', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: 'rgba(0,234,255,0.45)', width: 1, labelBackgroundColor: '#10162a' },
        horzLine: { color: 'rgba(0,234,255,0.45)', width: 1, labelBackgroundColor: '#10162a' },
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff95',
      downColor: '#ff2e57',
      borderUpColor: '#00ff95',
      borderDownColor: '#ff2e57',
      wickUpColor: '#00ff95',
      wickDownColor: '#ff2e57',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Feed data: normalize to seconds, sort ascending, dedupe (lightweight-charts
  // requires strictly increasing, unique times), then fit so nothing clips.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const seen = new Set<number>();
    const data = candles
      .map((c) => ({ t: toSeconds(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
      .filter((c) => Number.isFinite(c.t) && c.t > 0)
      .sort((a, b) => a.t - b.t)
      .filter((c) => (seen.has(c.t) ? false : (seen.add(c.t), true)))
      .map((c) => ({ time: c.t as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    series.setData(data);
    if (data.length > 0) chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const showOverlay = loading || candles.length === 0;

  return (
    <div style={{ position: 'relative', height, background: 'var(--surface)', border: '1px solid var(--border)', clipPath: 'var(--clip-notch)', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 8 }} />
      {showOverlay && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--surface)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-mute)' }}>
          {loading ? 'Loading chart…' : 'No price data'}
        </div>
      )}
    </div>
  );
}
