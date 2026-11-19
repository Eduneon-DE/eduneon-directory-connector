import "dotenv/config";
import { notarize } from "@electron/notarize";

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const hasApiKey = !!process.env.APP_STORE_CONNECT_TEAM_ISSUER;
  const hasAppleId =
    !!(process.env.APPLE_ID_USERNAME || process.env.APPLEID) && !!process.env.APPLE_TEAM_ID;
  if (!hasApiKey && !hasAppleId) {
    console.log("[notarize] No Apple credentials set, skipping notarization (unsigned build).");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  if (hasApiKey) {
    const appleApiIssuer = process.env.APP_STORE_CONNECT_TEAM_ISSUER;
    const appleApiKey = process.env.APP_STORE_CONNECT_AUTH_KEY_PATH;
    const appleApiKeyId = process.env.APP_STORE_CONNECT_AUTH_KEY;
    return await notarize({
      tool: "notarytool",
      appBundleId: "de.eduneon.directory-connector",
      appPath: `${appOutDir}/${appName}.app`,
      appleApiIssuer: appleApiIssuer,
      appleApiKey: appleApiKey,
      appleApiKeyId: appleApiKeyId,
    });
  } else {
    const appleId = process.env.APPLE_ID_USERNAME || process.env.APPLEID;
    const appleIdPassword = process.env.APPLE_ID_PASSWORD || `@keychain:AC_PASSWORD`;
    return await notarize({
      tool: "notarytool",
      appBundleId: "de.eduneon.directory-connector",
      appPath: `${appOutDir}/${appName}.app`,
      teamId: process.env.APPLE_TEAM_ID,
      appleId: appleId,
      appleIdPassword: appleIdPassword,
    });
  }
}
