"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import type { LineSeriesOption } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ComposeOption } from "echarts/core";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

type ChartOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
>;

export type RankHistoryKeyword = {
  id: string;
  phrase: string;
  device: "desktop" | "mobile";
  rankCheckRuns: { checkedAt: Date; position: number | null }[];
};

// Literal hex — ECharts renders to canvas, it cannot read CSS custom
// properties. These mirror globals.css; keep both in sync if that
// palette changes. Not worth reading via getComputedStyle at runtime:
// this is a fixed dark theme with no toggle.
const THEME = {
  axisLine: "#3d4463", // mist-700
  splitLine: "#262c46", // mist-800
  axisLabel: "#7c86ab", // mist-500
  legendText: "#b6bedd", // mist-300
  tooltipBg: "#0e1424", // void-panel
  tooltipBorder: "#3d4463",
  tooltipText: "#e4e8f5", // mist-100
} as const;

// Fixed categorical order — the "aurora" set designed to be used
// together, plus horn-gold/crimson as overflow for sites tracking more
// than 4 keywords. Color reuse beyond this palette is fine since the
// legend still isolates any single line on click.
const SERIES_COLORS = [
  "#2fe0c4", // aurora-teal
  "#8b6ff5", // aurora-violet
  "#e256d9", // aurora-magenta
  "#f2c14e", // aurora-gold
  "#e0982f", // horn-gold
  "#ef4757", // crimson
];

function seriesName(kw: RankHistoryKeyword, all: RankHistoryKeyword[]) {
  const hasDupe = all.filter((k) => k.phrase === kw.phrase).length > 1;
  return hasDupe ? `${kw.phrase} (${kw.device})` : kw.phrase;
}

function buildOption(series: RankHistoryKeyword[]): ChartOption {
  return {
    color: SERIES_COLORS,
    backgroundColor: "transparent",
    grid: { left: 40, right: 16, top: series.length > 1 ? 48 : 24, bottom: 32 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: THEME.tooltipBg,
      borderColor: THEME.tooltipBorder,
      textStyle: { color: THEME.tooltipText },
      valueFormatter: (v) => (v == null ? "not ranking" : `#${v}`),
    },
    legend: {
      type: "scroll",
      show: series.length > 1,
      top: 0,
      textStyle: { color: THEME.legendText },
      pageIconColor: THEME.legendText,
      pageTextStyle: { color: THEME.legendText },
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: THEME.axisLine } },
      axisLabel: { color: THEME.axisLabel },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      inverse: true,
      min: 1,
      minInterval: 1,
      axisLabel: { color: THEME.axisLabel, formatter: "#{value}" },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: THEME.splitLine, type: "dashed" } },
    },
    dataZoom: [{ type: "inside" }],
    series: series.map((kw) => ({
      type: "line",
      name: seriesName(kw, series),
      data: kw.rankCheckRuns.map((r) => [r.checkedAt, r.position]),
      connectNulls: false,
      showSymbol: false,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" },
    })),
  };
}

export function RankHistoryChart({ keywords }: { keywords: RankHistoryKeyword[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const series = keywords.filter((k) => k.rankCheckRuns.length > 0);

  useEffect(() => {
    if (!ref.current || series.length === 0) return;
    const chart = echarts.init(ref.current);
    chart.setOption(buildOption(series));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(series)]);

  if (series.length === 0) return null;

  return <div ref={ref} className="h-80 w-full" />;
}
