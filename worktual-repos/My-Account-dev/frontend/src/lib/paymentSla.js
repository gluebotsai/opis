const DEFAULT_SLA_HOURS = 48;
let cachedSlaHours = null;

export function setPaymentConfirmSlaHours(hours) {
  const parsed = Number(hours);
  if (Number.isFinite(parsed) && parsed > 0) {
    cachedSlaHours = parsed;
  }
}

export function getPaymentConfirmSlaHours() {
  if (cachedSlaHours) {
    return cachedSlaHours;
  }

  const configured = Number(
    typeof import.meta !== "undefined" && import.meta.env?.VITE_PAYMENT_CONFIRM_SLA_HOURS,
  );
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_SLA_HOURS;
}

export function paymentReportedSla(payment, slaHours = getPaymentConfirmSlaHours()) {
  const reportedAt = payment?.paymentReportedAt || payment?.paidAt;
  if (!reportedAt) {
    return {
      overdue: false,
      hoursWaiting: 0,
      label: "Awaiting finance confirmation",
    };
  }

  const reportedDate = new Date(reportedAt);
  const hoursWaiting = Math.max(
    0,
    Math.floor((Date.now() - reportedDate.getTime()) / (1000 * 60 * 60)),
  );
  const overdue = hoursWaiting >= slaHours;

  let label;
  if (hoursWaiting < 1) {
    label = "Reported just now — verify bank and confirm";
  } else if (hoursWaiting < 24) {
    label = `Reported ${hoursWaiting} hour${hoursWaiting === 1 ? "" : "s"} ago — verify bank and confirm`;
  } else {
    const days = Math.floor(hoursWaiting / 24);
    label = overdue
      ? `Reported ${days} day${days === 1 ? "" : "s"} ago — overdue for finance confirmation`
      : `Reported ${days} day${days === 1 ? "" : "s"} ago — verify bank and confirm`;
  }

  return { overdue, hoursWaiting, label };
}
