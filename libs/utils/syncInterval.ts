/** The shortest time between automatic syncs, in minutes. */
export const MIN_SYNC_INTERVAL_MINUTES = 5;

/** True when the automatic sync can go by this interval (minutes). */
export function isValidSyncInterval(interval: unknown): interval is number {
  return (
    typeof interval === "number" &&
    Number.isFinite(interval) &&
    interval >= MIN_SYNC_INTERVAL_MINUTES
  );
}

/**
 * The interval to save: an empty or unusable value becomes the default, a value below the minimum
 * becomes the minimum. A number typed as text ("15") is read as that number.
 */
export function clampSyncInterval(interval: unknown): number {
  const value =
    typeof interval === "string" && interval.trim() !== "" ? Number(interval) : interval;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MIN_SYNC_INTERVAL_MINUTES;
  }
  return Math.max(MIN_SYNC_INTERVAL_MINUTES, value);
}
