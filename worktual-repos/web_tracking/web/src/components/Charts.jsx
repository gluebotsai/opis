import { useEffect, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

/** Worktual CHART_PIE_SERIES + line/forecast tokens (see worktual-ui-system skill). */
export const CHART_PALETTE = [
  '#3b82f6',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#1877f2',
  '#fdba74',
  '#bfdbfe',
  '#059669',
  '#737373',
  '#171717',
];

const TRAFFIC_COLORS = {
  pageViews: { stroke: '#3b82f6', rgb: '59, 130, 246', bar: ['#93c5fd', '#2563eb'] },
  /** Distinct from pageViews blue — dashboard “Visitors” line (dashed). */
  visitors: { stroke: '#f59e0b', rgb: '245, 158, 11', bar: ['#fde68a', '#d97706'] },
  bounce: { stroke: '#3b82f6', rgb: '59, 130, 246', bar: ['#93c5fd', '#2563eb'] },
};

const baseAnimation = {
  duration: 1000,
  easing: 'easeOutQuart',
};

function chartColors(count) {
  return Array.from({ length: count }, (_, index) => CHART_PALETTE[index % CHART_PALETTE.length]);
}

function withAlpha(hex, alpha) {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatShare(value) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function centerCaptionFor(valueKey) {
  if (valueKey === 'sessions') return 'Sessions';
  if (valueKey === 'visitors') return 'Visitors';
  if (valueKey === 'views' || valueKey === 'pageviews') return 'Views';
  return 'Total';
}

function verticalAreaGradient(context, rgb) {
  const { chart } = context;
  const { ctx, chartArea } = chart;
  if (!chartArea) return `rgba(${rgb}, 0.15)`;
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, `rgba(${rgb}, 0.38)`);
  gradient.addColorStop(0.55, `rgba(${rgb}, 0.1)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0.01)`);
  return gradient;
}

function verticalBarGradient(context, stops) {
  const { chart } = context;
  const { ctx, chartArea } = chart;
  if (!chartArea) return stops[0];
  const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  gradient.addColorStop(0, stops[0]);
  gradient.addColorStop(1, stops[1]);
  return gradient;
}

const modernTooltip = {
  backgroundColor: '#171717',
  titleColor: '#ffffff',
  bodyColor: '#ffffff',
  borderColor: '#171717',
  borderWidth: 0,
  padding: 10,
  cornerRadius: 8,
  displayColors: true,
  boxPadding: 6,
  titleFont: { size: 12, weight: '600' },
  bodyFont: { size: 12, weight: '400' },
};

const modernLegend = {
  position: 'top',
  align: 'end',
    labels: {
    usePointStyle: true,
    pointStyle: 'circle',
    boxWidth: 8,
    boxHeight: 8,
    padding: 18,
    color: '#171717',
    font: { size: 12, weight: '600' },
  },
};

function modernCartesianScales({ yMax, percentY = false } = {}) {
  return {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: {
        color: '#212121',
        font: { size: 12, weight: '400' },
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 8,
      },
    },
    y: {
      beginAtZero: true,
      max: yMax,
      border: { display: false },
      grid: {
        color: '#858f96',
        borderDash: [4, 4],
        drawBorder: false,
      },
      ticks: {
        color: '#212121',
        font: { size: 12, weight: '400' },
        padding: 10,
        callback: percentY ? (value) => `${value}%` : undefined,
      },
    },
  };
}

function lineDataset(label, data, colors, { dashed = false, showPoints = true } = {}) {
  const pointCount = data?.length ?? 0;
  return {
    label,
    data,
    borderColor: colors.stroke,
    backgroundColor: (context) => verticalAreaGradient(context, colors.rgb),
    tension: 0.35,
    fill: true,
    borderWidth: 2.5,
    pointRadius: showPoints ? (pointCount > 24 ? 3 : 4) : 0,
    pointHoverRadius: 6,
    pointBackgroundColor: colors.stroke,
    pointBorderColor: '#ffffff',
    pointBorderWidth: 2,
    pointHitRadius: 12,
    borderDash: dashed ? [6, 4] : undefined,
  };
}

function barDataset(label, data, colors) {
  return {
    label,
    data,
    backgroundColor: (context) => verticalBarGradient(context, colors.bar),
    hoverBackgroundColor: (context) => verticalBarGradient(context, colors.bar),
    borderRadius: 10,
    borderSkipped: false,
    maxBarThickness: 52,
  };
}

export function ChartLoading({ label = 'Loading chart...' }) {
  return (
    <div className="chart-container chart-loading">
      <div className="chart-loading-ring" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

/** Minimal trend line for Reports KPI tiles (no axes, no tooltip). */
export function KpiSparkline({ values, color = '#3b82f6' }) {
  if (!values?.length || values.length < 2) {
    return <div className="kpi-sparkline-placeholder" aria-hidden="true" />;
  }

  const numeric = values.map((v) => Number(v) || 0);
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const padding = max === min ? Math.max(max * 0.1, 1) : (max - min) * 0.12;

  return (
    <div className="kpi-sparkline-wrap" aria-hidden="true">
      <Line
        data={{
          labels: numeric.map((_, index) => index),
          datasets: [{
            data: numeric,
            borderColor: color,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0.35,
            fill: false,
          }],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: {
              display: false,
              min: min - padding,
              max: max + padding,
            },
          },
        }}
      />
    </div>
  );
}

export function chartSeriesFromDaily(chartData, key) {
  if (!chartData?.length) return [];
  return chartData.map((row) => Number(row?.[key] ?? 0));
}

export function VisitorsChart({ chartData, period }) {
  if (!chartData?.length) {
    return <p className="chart-empty">No chart data available.</p>;
  }

  const labels = chartData.map((d) => d.label);
  const pageViews = chartData.map((d) => d.pageviews);
  const visitors = chartData.map((d) => d.visitors);

  const data = {
    labels,
    datasets: [
      lineDataset('Page Views', pageViews, TRAFFIC_COLORS.pageViews),
      lineDataset('Visitors', visitors, TRAFFIC_COLORS.visitors, { dashed: true }),
    ],
  };

  const ChartComponent = Line;

  return (
    <div className="chart-container chart-container-traffic">
      <ChartComponent
        key={`visitors-line-${period}-${labels.length}`}
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: baseAnimation,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: modernLegend,
            tooltip: {
              ...modernTooltip,
              callbacks: {
                label(context) {
                  const value = context.parsed.y ?? context.parsed ?? 0;
                  return `${context.dataset.label}: ${Number(value).toLocaleString()}`;
                },
              },
            },
          },
          scales: modernCartesianScales(),
        }}
      />
    </div>
  );
}

export function BounceRateChart({ bounceRate, chartData, period }) {
  const labels = chartData?.map((d) => d.label) || ['Bounce Rate'];
  const values = chartData?.map((d) => d.bounce_rate ?? 0) || [bounceRate];

  const data = {
        labels,
        datasets: [lineDataset('Bounce Rate', values, TRAFFIC_COLORS.bounce)],
      };

  const ChartComponent = Line;

  return (
    <div className="chart-container chart-container-bounce">
      <ChartComponent
        key={`bounce-line-${period}-${labels.length}`}
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: baseAnimation,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...modernTooltip,
              callbacks: {
                label(context) {
                  const value = context.parsed.y ?? context.parsed ?? 0;
                  return `Bounce rate: ${Number(value).toFixed(1)}%`;
                },
              },
            },
          },
          scales: modernCartesianScales({ yMax: 100, percentY: true }),
        }}
      />
    </div>
  );
}

export function AnalyticsDonutChart({
  chartData,
  loading,
  labelKey = 'source',
  valueKey = 'visitors',
  percentKey,
  totalValue,
  centerLabel,
  extraFields = [],
  size = 'default',
  loadingLabel = 'Loading chart...',
  emptyLabel = 'No data for this period.',
}) {
  const [activeIndex, setActiveIndex] = useState(null);
  const activeRef = useRef(null);
  const clearTimer = useRef(null);
  const signature = chartData?.map((row) => `${row?.[labelKey]}:${row?.[valueKey]}`).join('|') ?? '';

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  useEffect(() => {
    activeRef.current = null;
    setActiveIndex(null);
  }, [signature]);

  const setActive = (index) => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    const next = index == null ? null : index;
    if (activeRef.current === next) return;
    activeRef.current = next;
    setActiveIndex(next);
  };

  const scheduleClear = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setActive(null), 40);
  };

  if (loading) {
    return <ChartLoading label={loadingLabel} />;
  }

  if (!chartData?.length) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  const labels = chartData.map((d) => d[labelKey]);
  const values = chartData.map((d) => Number(d[valueKey] ?? 0));
  const total = totalValue ?? values.reduce((sum, value) => sum + value, 0);
  const percentages = chartData.map((d, index) => {
    if (percentKey != null && d[percentKey] != null) {
      return Number(d[percentKey]);
    }
    const value = values[index];
    return total ? (value / total) * 100 : 0;
  });

  if (!total) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  const colors = chartColors(labels.length);
  const active = activeIndex != null && activeIndex >= 0 && activeIndex < labels.length
    ? activeIndex
    : null;
  const centerValue = active == null ? total : values[active];
  const activeExtras = active == null
    ? ''
    : extraFields
      .filter((field) => field.key !== valueKey)
      .map((field) => `${Number(chartData[active]?.[field.key] ?? 0).toLocaleString()} ${field.label}`)
      .join(' · ');
  const centerCaption = active == null
    ? (centerLabel || centerCaptionFor(valueKey))
    : [labels[active], activeExtras, formatShare(percentages[active])].filter(Boolean).join(' · ');

  const legendValue = (row, value, pct) => {
    if (!extraFields.length) {
      return `${Number(value).toLocaleString()} (${formatShare(pct)})`;
    }
    const bits = extraFields.map((field) => {
      const raw = field.key === valueKey ? value : row?.[field.key];
      return `${Number(raw ?? 0).toLocaleString()} ${field.label}`;
    });
    return `${bits.join(' · ')} (${formatShare(pct)})`;
  };

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors.map((color, index) => (
          active == null || index === active ? color : withAlpha(color, 0.28)
        )),
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverBorderColor: '#ffffff',
        hoverOffset: 0,
        offset: labels.map((_, index) => (index === active ? 8 : 0)),
      },
    ],
  };

  const cutout = size === 'compact' ? '71%' : size === 'thin' ? '78%' : '72%';
  const rootClass = [
    'donut-chart',
    size === 'compact' ? 'donut-chart--compact' : '',
    size === 'thin' ? 'donut-chart--thin' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass} onMouseLeave={() => setActive(null)}>
      <div className="donut-chart-plot">
        <Doughnut
          key={`donut-${signature}-${total}`}
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: true,
            cutout,
            layout: { padding: 8 },
            animation: { duration: 180 },
            interaction: { mode: 'nearest', intersect: true },
            onHover(_event, elements) {
              if (elements?.[0]) setActive(elements[0].index);
              else scheduleClear();
            },
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false },
            },
          }}
        />
        <div className="donut-chart-center" aria-live="polite">
          <span className="donut-chart-center-value">{Number(centerValue).toLocaleString()}</span>
          <span className="donut-chart-center-label">{centerCaption}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {labels.map((label, index) => {
          const itemClass = [
            'donut-legend-item',
            active === index ? 'is-active' : '',
            active != null && active !== index ? 'is-dimmed' : '',
          ].filter(Boolean).join(' ');
          return (
            <li key={`${label}-${index}`}>
              <button
                type="button"
                className={itemClass}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={scheduleClear}
              >
                <span className="donut-legend-swatch" style={{ background: colors[index] }} aria-hidden="true" />
                <span className="donut-legend-copy">
                  <span className="donut-legend-label">{label}</span>
                  <span className="donut-legend-value">
                    {legendValue(chartData[index], values[index], percentages[index])}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function VisitorActivityChart({ chartData }) {
  if (!chartData?.length) {
    return <p className="chart-empty">No activity timeline for this visitor yet.</p>;
  }

  const labels = chartData.map((d) => d.label);
  const pageviews = chartData.map((d) => Number(d.pageviews ?? 0));
  const interactions = chartData.map((d) => Number(d.interactions ?? 0));

  const data = {
    labels,
    datasets: [
      lineDataset('Page views', pageviews, TRAFFIC_COLORS.pageViews),
      lineDataset('Interactions', interactions, TRAFFIC_COLORS.visitors, { dashed: true }),
    ],
  };

  return (
    <div className="chart-container chart-container-visitor-activity">
      <Line
        key={`visitor-activity-${labels.join('-')}`}
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: baseAnimation,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: modernLegend,
            tooltip: {
              ...modernTooltip,
              callbacks: {
                label(context) {
                  const value = context.parsed.y ?? 0;
                  return `${context.dataset.label}: ${Number(value).toLocaleString()}`;
                },
              },
            },
          },
          scales: modernCartesianScales(),
        }}
      />
    </div>
  );
}

export function HorizontalBarChart({
  chartData,
  loading,
  labelKey = 'country',
  valueKey = 'visitors',
  loadingLabel = 'Loading chart...',
  emptyLabel = 'No data for this period.',
  datasetLabel = 'Visitors',
}) {
  if (loading) {
    return <ChartLoading label={loadingLabel} />;
  }

  if (!chartData?.length) {
    return <p className="chart-empty">{emptyLabel}</p>;
  }

  const labels = chartData.map((d) => d[labelKey]);
  const values = chartData.map((d) => d[valueKey]);

  const data = {
    labels,
    datasets: [
      {
        label: datasetLabel,
        data: values,
        backgroundColor: chartColors(labels.length),
        borderRadius: 6,
      },
    ],
  };

  return (
    <div className="chart-container geo-bar-chart">
      <Bar
        key={`hbar-${labels.join('-')}`}
        data={data}
        options={{
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: baseAnimation,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true } },
        }}
      />
    </div>
  );
}

// Backward-compatible export
export const TrafficSourceDonutChart = AnalyticsDonutChart;
