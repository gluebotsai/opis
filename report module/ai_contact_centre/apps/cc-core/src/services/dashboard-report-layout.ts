import { slaRateCaption, type ChannelBreakdownRow } from "./reporting.js";

export type DashboardReportLayoutInput = {
  periodLabel: string;
  orgKpis: {
    handled: number;
    handledChangePercent: number | null;
    resolutionRate: number;
    avgFirstResponseSeconds: number | null;
    avgHandleSeconds: number | null;
    slaRate: number;
    transferred: number;
    resolved: number;
    firstResponseCount?: number;
    withinSlaCount?: number;
  };
  daily: Array<{ label: string; handled: number; avgHandleSeconds: number }>;
  channels: ChannelBreakdownRow[];
  dispositions: Array<{ label: string; value: number }>;
};

const CHART_LINE_COLOR = "#2563eb";
const CHART_BAR_COLORS = ["#2563eb", "#0d9488", "#4f46e5", "#7c3aed", "#0284c7"];

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function drawCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  doc.save();
  doc.roundedRect(x, y, width, height, 8).fillAndStroke("#ffffff", "#e5e7eb");
  doc.restore();
}

type KpiCardStyle = {
  iconFill: string;
  iconStroke: string;
  trend?: { label: string; positive: boolean };
};

function drawKpiCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  caption: string,
  style: KpiCardStyle,
) {
  drawCard(doc, x, y, width, height);

  doc.save();
  doc.roundedRect(x + 10, y + 10, 18, 18, 6).fill(style.iconFill);
  doc.circle(x + 19, y + 19, 3.5).fill(style.iconStroke);
  doc.restore();

  if (style.trend) {
    const pillWidth = Math.min(78, width - 24);
    const pillX = x + width - pillWidth - 10;
    doc.save();
    doc.roundedRect(pillX, y + 10, pillWidth, 14, 7).fill(style.trend.positive ? "#ecfdf5" : "#fef2f2");
    doc
      .fontSize(6.5)
      .fillColor(style.trend.positive ? "#047857" : "#dc2626")
      .text(style.trend.label, pillX + 4, y + 14, { width: pillWidth - 8, align: "center" });
    doc.restore();
  }

  doc
    .fontSize(7)
    .fillColor("#a3a3a3")
    .text(label.toUpperCase(), x + 10, y + 34, { width: width - 20, characterSpacing: 0.6 });
  doc.fontSize(15).fillColor("#171717").text(value, x + 10, y + 44, { width: width - 20 });
  doc.fontSize(8).fillColor("#525252").text(caption, x + 10, y + height - 16, { width: width - 20 });
}

function drawSparkline(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  subtitle: string,
  points: number[],
  summary?: string,
) {
  drawCard(doc, x, y, width, height);
  doc.fontSize(10).fillColor("#171717").text(title, x + 14, y + 12, { width: width * 0.62 });
  doc.fontSize(8).fillColor("#525252").text(subtitle, x + 14, y + 26, { width: width * 0.62 });
  if (summary) {
    doc.fontSize(13).fillColor(CHART_LINE_COLOR).text(summary, x + width - 96, y + 12, {
      width: 82,
      align: "right",
    });
  }

  const chartX = x + 14;
  const chartY = y + 44;
  const chartW = width - 28;
  const chartH = height - 58;
  if (points.length === 0) {
    doc.fontSize(8).fillColor("#d1d5db").text("No data yet", chartX, chartY + chartH / 2 - 4);
    return;
  }

  const max = Math.max(...points, 1);
  const step = points.length > 1 ? chartW / (points.length - 1) : 0;
  const baselineY = chartY + chartH;
  const coords = points.map((value, index) => ({
    x: chartX + step * index,
    y: chartY + chartH - (value / max) * chartH,
  }));

  doc.save();
  doc.moveTo(coords[0]?.x ?? chartX, baselineY);
  coords.forEach((point) => doc.lineTo(point.x, point.y));
  doc.lineTo(coords[coords.length - 1]?.x ?? chartX, baselineY);
  doc.closePath();
  doc.fillOpacity(0.18).fill(CHART_LINE_COLOR);
  doc.fillOpacity(1);
  doc.restore();

  doc.save();
  doc.strokeColor("#e5e7eb").lineWidth(1);
  doc.moveTo(chartX, baselineY).lineTo(chartX + chartW, baselineY).stroke();
  doc.strokeColor(CHART_LINE_COLOR).lineWidth(1.5);
  coords.forEach((point, index) => {
    if (index === 0) doc.moveTo(point.x, point.y);
    else doc.lineTo(point.x, point.y);
  });
  doc.stroke();
  coords.forEach((point) => {
    doc.circle(point.x, point.y, 2.2).fill(CHART_LINE_COLOR);
  });
  doc.restore();
}

function drawPieSlice(
  doc: PDFKit.PDFDocument,
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  color: string,
): void {
  const x1 = centerX + radius * Math.cos(startAngle);
  const y1 = centerY + radius * Math.sin(startAngle);
  const x2 = centerX + radius * Math.cos(endAngle);
  const y2 = centerY + radius * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  doc.save();
  doc
    .path(`M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`)
    .fill(color);
  doc.restore();
}

function drawDonutChannelMix(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  subtitle: string,
  rows: Array<{ label: string; value: number; color: string }>,
) {
  drawCard(doc, x, y, width, height);
  doc.fontSize(10).fillColor("#171717").text(title, x + 14, y + 12, { width: width - 28 });
  doc.fontSize(8).fillColor("#525252").text(subtitle, x + 14, y + 26, { width: width - 28 });

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const activeRows = rows.filter((row) => row.value > 0);
  const centerX = x + 46;
  const centerY = y + height / 2 + 8;
  const outerR = 24;
  const innerR = 16;

  if (activeRows.length === 0) {
    doc.fontSize(8).fillColor("#d1d5db").text("No data yet", x + 14, centerY - 4);
    return;
  }

  let startAngle = -Math.PI / 2;
  for (const row of activeRows) {
    const slice = (row.value / total) * Math.PI * 2;
    drawPieSlice(doc, centerX, centerY, outerR, startAngle, startAngle + slice, row.color);
    startAngle += slice;
  }

  doc.circle(centerX, centerY, innerR).fill("#ffffff");
  doc.fontSize(12).fillColor("#171717").text(String(total), centerX - 14, centerY - 8, {
    width: 28,
    align: "center",
  });
  doc.fontSize(6).fillColor("#a3a3a3").text("TOTAL", centerX - 14, centerY + 4, {
    width: 28,
    align: "center",
  });

  let rowY = y + 52;
  const legendX = x + 92;
  for (const row of rows.slice(0, 5)) {
    const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
    doc.circle(legendX + 4, rowY + 4, 2).fill(row.color);
    doc.fontSize(8).fillColor("#525252").text(row.label, legendX + 10, rowY, { width: width - legendX - 58 });
    doc.fillColor("#171717").text(`${row.value} (${pct}%)`, x + width - 52, rowY, {
      width: 44,
      align: "right",
    });
    rowY += 13;
  }
}

function drawDispositionBars(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  subtitle: string,
  rows: Array<{ label: string; value: number }>,
) {
  drawCard(doc, x, y, width, height);
  doc.fontSize(10).fillColor("#171717").text(title, x + 14, y + 12, { width: width - 28 });
  doc.fontSize(8).fillColor("#525252").text(subtitle, x + 14, y + 26, { width: width - 28 });
  const max = Math.max(...rows.map((row) => row.value), 1);
  let rowY = y + 48;
  for (const [index, row] of rows.slice(0, 6).entries()) {
    const barColor = CHART_BAR_COLORS[index % CHART_BAR_COLORS.length]!;
    doc.fontSize(8).fillColor("#525252").text(row.label, x + 14, rowY, { width: 120 });
    doc.fillColor(barColor).text(String(row.value), x + width - 34, rowY, { width: 20, align: "right" });
    const barW = ((width - 170) * row.value) / max;
    doc
      .roundedRect(x + 140, rowY + 4, Math.max(barW, row.value > 0 ? 6 : 0), 6, 3)
      .fill(barColor);
    rowY += 18;
  }
}

const CHANNEL_COLORS: Record<string, string> = {
  webchat: "#06b6d4",
  chat: "#06b6d4",
  email: "#f59e0b",
  whatsapp: "#8b5cf6",
  instagram: "#ec4899",
  facebook: "#1877f2",
  voice: "#3b82f6",
  call: "#3b82f6",
};

function channelColor(name: string, index: number): string {
  const key = name.trim().toLowerCase();
  return CHANNEL_COLORS[key] ?? CHART_BAR_COLORS[index % CHART_BAR_COLORS.length]!;
}

export function renderDashboardReportPage(
  doc: PDFKit.PDFDocument,
  input: DashboardReportLayoutInput,
): void {
  const margin = 36;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - margin * 2;

  doc.fontSize(14).fillColor("#171717").text("Reports", margin, margin);
  doc.fontSize(8).fillColor("#525252").text(input.periodLabel, margin, margin + 18);

  const cardGap = 8;
  const cardW = (contentWidth - cardGap * 2) / 3;
  const cardH = 56;
  let y = margin + 32;

  const handledTrend =
    input.orgKpis.handledChangePercent === null
      ? { label: "New", positive: true }
      : {
          label: `${Math.abs(input.orgKpis.handledChangePercent)}% vs prior`,
          positive: input.orgKpis.handledChangePercent >= 0,
        };

  const topCards: Array<[string, string, string, KpiCardStyle]> = [
    [
      "Handled",
      String(input.orgKpis.handled),
      "Completed conversations",
      { iconFill: "#eff6ff", iconStroke: "#2563eb", trend: handledTrend },
    ],
    [
      "Resolution rate",
      `${input.orgKpis.resolutionRate}%`,
      "Resolved from handled",
      { iconFill: "#ecfdf5", iconStroke: "#059669" },
    ],
    [
      "First response",
      formatDuration(input.orgKpis.avgFirstResponseSeconds),
      input.orgKpis.avgFirstResponseSeconds == null
        ? "No first replies in period"
        : "Average after assignment",
      { iconFill: "#ecfeff", iconStroke: "#0891b2" },
    ],
    [
      "Handle time",
      formatDuration(input.orgKpis.avgHandleSeconds),
      input.orgKpis.avgHandleSeconds == null
        ? "No completed handles in period"
        : "Average assigned to end",
      { iconFill: "#f5f3ff", iconStroke: "#7c3aed" },
    ],
    [
      "First-Reply SLA",
      input.orgKpis.firstResponseCount === 0 ? "—" : `${input.orgKpis.slaRate}%`,
      input.orgKpis.firstResponseCount == null
        ? "First reply within 60s"
        : slaRateCaption(input.orgKpis.firstResponseCount, input.orgKpis.withinSlaCount ?? 0),
      { iconFill: "#fffbeb", iconStroke: "#d97706" },
    ],
    [
      "Transferred",
      String(input.orgKpis.transferred),
      "Conversations handed off",
      { iconFill: "#fff1f2", iconStroke: "#e11d48" },
    ],
  ];

  topCards.forEach(([label, value, caption, style], index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawKpiCard(
      doc,
      margin + col * (cardW + cardGap),
      y + row * (cardH + cardGap),
      cardW,
      cardH,
      label,
      value,
      caption,
      style,
    );
  });

  y += 2 * (cardH + cardGap) + 4;
  const secondaryW = (contentWidth - cardGap) / 2;
  const daysWithVolume = input.daily.filter((point) => point.handled > 0).length || 1;
  const avgDailyHandled = Math.round(input.orgKpis.handled / daysWithVolume);
  const activeChannels = input.channels.filter((row) => Number(row.value) > 0).length;

  drawKpiCard(
    doc,
    margin,
    y,
    secondaryW,
    cardH,
    "Resolved",
    String(input.orgKpis.resolved),
    "Closed with resolution",
    { iconFill: "#f0fdfa", iconStroke: "#0d9488" },
  );
  drawKpiCard(
    doc,
    margin + secondaryW + cardGap,
    y,
    secondaryW,
    cardH,
    "Avg daily handled",
    String(avgDailyHandled),
    `Across ${activeChannels} active channel${activeChannels === 1 ? "" : "s"}`,
    { iconFill: "#eef2ff", iconStroke: "#4f46e5" },
  );

  y += cardH + cardGap;
  const chartH = 102;
  const chartW = (contentWidth - cardGap) / 2;
  drawSparkline(
    doc,
    margin,
    y,
    chartW,
    chartH,
    "Handled conversations",
    "Daily completed workload",
    input.daily.map((point) => point.handled),
    String(input.orgKpis.handled),
  );
  drawSparkline(
    doc,
    margin + chartW + cardGap,
    y,
    chartW,
    chartH,
    "Average handle time",
    "Daily average assigned to close",
    input.daily.map((point) => point.avgHandleSeconds),
    formatDuration(input.orgKpis.avgHandleSeconds),
  );

  y += chartH + cardGap;
  const mixW = (contentWidth - cardGap * 2) / 3;
  const mixH = 108;
  const aiRows = input.channels
    .filter((row) => row.handler === "AI")
    .map((row, index) => ({
      label: row.channel,
      value: Number(row.value),
      color: channelColor(row.channel, index),
    }));
  const agentRows = input.channels
    .filter((row) => row.handler === "Agent")
    .map((row, index) => ({
      label: row.channel,
      value: Number(row.value),
      color: channelColor(row.channel, index),
    }));

  drawDonutChannelMix(
    doc,
    margin,
    y,
    mixW,
    mixH,
    "AI channel mix",
    "Volume by channel — AI handled",
    aiRows,
  );
  drawDonutChannelMix(
    doc,
    margin + mixW + cardGap,
    y,
    mixW,
    mixH,
    "Support Agent channel mix",
    "Volume by channel — support agent handled",
    agentRows,
  );
  drawDispositionBars(
    doc,
    margin + (mixW + cardGap) * 2,
    y,
    mixW,
    mixH,
    "Disposition outcomes",
    "How conversations were closed",
    input.dispositions.map((row) => ({ label: row.label, value: row.value })),
  );
}
