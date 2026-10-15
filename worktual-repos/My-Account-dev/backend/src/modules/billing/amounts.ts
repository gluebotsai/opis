export const FIXED_MONTH_DAYS = 30;
export const GST_RATE = 0.18;

function roundMoney(value: any) {
  return Math.round(Number(value) * 100) / 100;
}

export function calculateDailyPrice(monthlyPrice: any) {
  return Number(monthlyPrice) / FIXED_MONTH_DAYS;
}

export function calculateProratedAmount(monthlyPrice: any, remainingDays: any) {
  const dailyPrice = calculateDailyPrice(monthlyPrice);
  return roundMoney(dailyPrice * remainingDays);
}

export function calculateFullMonthlyAmount(monthlyPrice: any) {
  return roundMoney(monthlyPrice);
}

export function applyGst(subtotal: any, gstRate = GST_RATE) {
  const normalizedSubtotal = roundMoney(subtotal);
  return {
    subtotal: normalizedSubtotal,
    gstRate,
    grandTotal: roundMoney(normalizedSubtotal * (1 + gstRate)),
  };
}
