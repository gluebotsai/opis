import { describe, expect, it } from "vitest";

import {
  idleWaveformLevels,
  isCustomerSpeaking,
  levelsFromTimeDomain,
  smoothWaveformLevels,
  WAVEFORM_BAR_COUNT,
} from "./use-remote-customer-waveform";

describe("levelsFromTimeDomain", () => {
  it("spreads amplitude across the full waveform, not only the first bars", () => {
    const samples = Uint8Array.from({ length: 144 }, (_, index) => {
      const bucket = Math.floor(index / 2);
      return bucket % 3 === 0 ? 200 : 128;
    });

    const levels = levelsFromTimeDomain(samples, WAVEFORM_BAR_COUNT);
    const left = levels.slice(0, 8).filter((level) => level > 0.2).length;
    const middle = levels.slice(12, 20).filter((level) => level > 0.2).length;
    const right = levels.slice(-8).filter((level) => level > 0.2).length;

    expect(levels).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(left).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it("keeps a quiet stream flat when there is no customer audio", () => {
    const samples = Uint8Array.from({ length: 72 }, () => 128);
    const levels = levelsFromTimeDomain(samples, 8);
    expect(levels.every((level) => level === 0.12)).toBe(true);
    expect(isCustomerSpeaking(levels)).toBe(false);
    expect(idleWaveformLevels(8)).toEqual(levels);
  });

  it("lifts normal conversational speech above the idle floor", () => {
    const samples = Uint8Array.from({ length: 96 }, (_, index) => (index % 4 === 0 ? 138 : 128));
    const levels = levelsFromTimeDomain(samples, 8);
    expect(Math.max(...levels)).toBeGreaterThan(0.45);
    expect(isCustomerSpeaking(levels)).toBe(true);
  });

  it("eases toward the next frame so the wave does not race", () => {
    const eased = smoothWaveformLevels([0.12, 0.12], [0.6, 0.6], 0.28);
    expect(eased[0]).toBeGreaterThan(0.12);
    expect(eased[0]).toBeLessThan(0.3);
  });
});
