import { StateService } from "@/libs/abstractions/state.service";
import { EnvironmentUrls } from "@/libs/models/domain/environmentUrls";

/** Environment variable that pins the server, e.g. to a local Cockpit during development. */
export const SERVER_URL_ENV = "EDUNEON_DC_SERVER_URL";

/**
 * When EDUNEON_DC_SERVER_URL is set, store it as the server before anything else runs, so the
 * app and the CLI never fall back to the cloud default. It is written to the saved settings
 * (not just held in memory) because the desktop renderer reads the URLs from there.
 *
 * Returns the URL that was applied, or null when the variable is not set.
 */
export async function applyServerOverride(
  stateService: StateService,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const url = env[SERVER_URL_ENV]?.trim().replace(/\/+$/, "");
  if (!url) {
    return null;
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Error(`${SERVER_URL_ENV} must start with http:// or https://, got "${url}"`);
  }

  const urls = new EnvironmentUrls();
  urls.base = url;
  await stateService.setEnvironmentUrls(urls);
  return url;
}
