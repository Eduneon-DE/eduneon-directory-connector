import { execFileSync } from "node:child_process";

// Windows code signing for electron-builder, with Azure Artifact Signing (account "eduneon-signing").
//
// electron-builder calls this for every file it signs, BEFORE it writes the update manifest
// (latest.yml): signing afterwards would change the installer and break the updater's checksum.
// The release workflow logs in to Azure first (OIDC, no password) and installs the ArtifactSigning
// PowerShell module; locally, without AZURE_SIGNING_PROFILE, nothing is signed.
export default async function sign(configuration) {
  const profile = process.env.AZURE_SIGNING_PROFILE ?? "";
  if (profile === "" || !configuration.path.toLowerCase().endsWith(".exe")) {
    return;
  }
  console.log(`[*] Signing ${configuration.path}`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Invoke-ArtifactSigning" +
      " -Endpoint $env:AZURE_SIGNING_ENDPOINT" +
      " -CodeSigningAccountName $env:AZURE_SIGNING_ACCOUNT" +
      " -CertificateProfileName $env:AZURE_SIGNING_PROFILE" +
      " -Files $env:SIGN_FILE" +
      " -FileDigest SHA256" +
      " -TimestampRfc3161 http://timestamp.acs.microsoft.com" +
      " -TimestampDigest SHA256" +
      // Only the Azure CLI login of the workflow: probing the other credential types costs time per file.
      " -ExcludeEnvironmentCredential:$true -ExcludeWorkloadIdentityCredential:$true" +
      " -ExcludeManagedIdentityCredential:$true -ExcludeSharedTokenCacheCredential:$true" +
      " -ExcludeVisualStudioCredential:$true -ExcludeVisualStudioCodeCredential:$true" +
      " -ExcludeAzurePowerShellCredential:$true -ExcludeAzureDeveloperCliCredential:$true" +
      " -ExcludeInteractiveBrowserCredential:$true",
  ].join("; ");
  execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: "inherit",
    env: {
      ...process.env,
      AZURE_SIGNING_ENDPOINT:
        process.env.AZURE_SIGNING_ENDPOINT || "https://neu.codesigning.azure.net/",
      AZURE_SIGNING_ACCOUNT: process.env.AZURE_SIGNING_ACCOUNT || "eduneon-signing",
      SIGN_FILE: configuration.path,
    },
  });
}
