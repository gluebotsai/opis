export const FIXED_MONTH_DAYS = 30;
export const GST_RATE = 0.18;

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function calculateDailyPrice(monthlyPrice) {
  return Number(monthlyPrice) / FIXED_MONTH_DAYS;
}

export function calculateProratedAmount(monthlyPrice, remainingDays) {
  const dailyPrice = calculateDailyPrice(monthlyPrice);
  return roundMoney(dailyPrice * remainingDays);
}

export function calculateFullMonthlyAmount(monthlyPrice) {
  return roundMoney(monthlyPrice);
}

export function applyGst(subtotal, gstRate = GST_RATE) {
  const normalizedSubtotal = roundMoney(subtotal);
  return {
    subtotal: normalizedSubtotal,
    gstRate,
    grandTotal: roundMoney(normalizedSubtotal * (1 + gstRate)),
  };
}
