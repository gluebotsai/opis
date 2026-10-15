import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top', align: 'end', labels: { boxWidth: 12, usePointStyle: true } },
  },
  scales: {
    x: { grid: { display: false } },
    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.06)' } },
  },
};

function buildChartData(series) {
  if (!series) {
    return { labels: [], datasets: [] };
  }

  return {
    labels: series.labels ?? [],
    datasets: [
      {
        label: 'Actual',
        data: series.actual ?? [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        spanGaps: false,
      },
      {
        label: 'Forecast',
        data: series.forecast ?? [],
        borderColor: '#6366f1',
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        pointRadius: 3,
        spanGaps: false,
      },
    ],
  };
}

export default function PredictiveSection({ forecasts, predictive }) {
  if (!forecasts || !predictive) return null;

  const volumeData = buildChartData(forecasts.volume);
  const bounceData = buildChartData(forecasts.bounce);
  const volumeHorizon = forecasts.volume?.horizon_label ?? '';
  const bounceHorizon = forecasts.bounce?.horizon_label ?? '';
  const riskSignals = predictive.risk_signals ?? [];

  return (
    <section className="analytics-section">
      <div className="analytics-section-header">
        <span className="analytics-section-icon analytics-section-icon-predictive" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
            <path d="M3 17l6-6 4 4 8-10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h2>Predictive analytics</h2>
          <p>What is likely to happen next — forecasts and early risk signals.</p>
        </div>
      </div>

      <div className="analytics-charts-grid">
        <div className="card analytics-chart-card">
          <h3>Visitor volume forecast</h3>
          <p className="analytics-chart-sub">
            {predictive.volume_narrative || `Daily unique visitors — ${volumeHorizon.toLowerCase()}`}
          </p>
          <div className="analytics-chart-wrap">
            <Line data={volumeData} options={chartOptions} />
          </div>
        </div>
        <div className="card analytics-chart-card">
          <h3>Bounce rate forecast</h3>
          <p className="analytics-chart-sub">
            {predictive.bounce_narrative || `Projected bounce trend — ${bounceHorizon.toLowerCase()}`}
          </p>
          <div className="analytics-chart-wrap">
            <Line
              data={bounceData}
              options={{
                ...chartOptions,
                scales: {
                  ...chartOptions.scales,
                  y: { ...chartOptions.scales.y, max: 100 },
                },
              }}
            />
          </div>
        </div>
      </div>

      {riskSignals.length > 0 && (
        <div className="risk-signals">
          {riskSignals.map(({ level, title, detail }) => (
            <div key={title} className={`risk-signal risk-signal-${level}`}>
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
