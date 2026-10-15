/** Active dashboard period pill — keeps chat aligned with the page the user is viewing. */

const PERIOD_KEY = 'analyticsPeriod';

/** @returns {'today'|'week'|'month'|'overall'} */
export function getAnalyticsPeriod() {
  try {
    const raw = sessionStorage.getItem(PERIOD_KEY);
    if (raw === 'today' || raw === 'week' || raw === 'month' || raw === 'overall') {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return 'month';
}

/** @param {'today'|'week'|'month'|'overall'} period */
export function setAnalyticsPeriod(period) {
  try {
    sessionStorage.setItem(PERIOD_KEY, period);
  } catch {
    /* ignore */
  }
}
