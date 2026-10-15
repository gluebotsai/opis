import type { ForecastSeries, RollupPoint } from "../types/insights.js";
export declare function buildForecasts(period: string, daily: RollupPoint[], weekly: RollupPoint[], monthly: RollupPoint[]): {
    volume: ForecastSeries;
    bounce: ForecastSeries;
};
