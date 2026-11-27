import { clampSyncInterval, isValidSyncInterval } from "./syncInterval";

describe("sync interval", () => {
  it.each([
    [null, 5],
    [undefined, 5],
    ["", 5],
    [Number.NaN, 5],
    [-5, 5],
    [0, 5],
    [2, 5],
    [4.9, 5],
    [5, 5],
    [5.5, 5.5],
    ["15", 15],
    [60, 60],
  ])("saves %p as %p", (input, saved) => {
    expect(clampSyncInterval(input)).toBe(saved);
  });

  it("runs the schedule only with a number of at least 5 minutes", () => {
    expect(isValidSyncInterval(5)).toBe(true);
    expect(isValidSyncInterval(60)).toBe(true);
    for (const v of [null, undefined, 0, 3, 4.9, "15", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidSyncInterval(v)).toBe(false);
    }
  });
});
