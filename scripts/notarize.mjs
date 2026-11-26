import "dotenv/config";
import { execFileSync } from "node:child_process";
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
    // Without a certificate electron-builder signs nothing, and the app keeps only the linker's signature on its
    // main binary: a downloaded copy is then refused as "damaged", with no "Open Anyway". An ad-hoc signature over
    // the whole bundle is valid, so macOS offers "Open Anyway" instead. Not notarized either way.
    if (!process.env.CSC_LINK) {
      const app = `${appOutDir}/${context.packager.appInfo.productFilename}.app`;
      console.log(`[notarize] No certificate: ad-hoc signing ${app}`);
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
      execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
    }
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
