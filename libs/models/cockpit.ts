/**
 * The contract with Cockpit's Directory Connector endpoints
 * (`/api/v1/directory-connector/*` in apps/cockpit-api, directory-connector.controller.ts).
 */

/**
 * One directory object as read, before any mapping: Cockpit maps it onto its own models with the
 * mapping the admin configured there. Attribute names are lowercase, every value is a string, and
 * binary values (objectGUID, objectSid) are base64.
 */
export interface DirectoryEntry {
  dn: string;
  attributes: Record<string, string[]>;
}

export interface DirectorySyncRequest {
  /** Needed only when the organization has more than one Directory Connector directory. */
  providerId?: number;
  dryRun: boolean;
  /** Root the entries were read from (LDAP base DN); empty for cloud directories. */
  baseDn: string;
  /** One upload, possibly in several parts: all parts carry the same uploadId. */
  uploadId?: string;
  part?: number;
  parts?: number;
  /** This part's entries. The full snapshot is all parts; Cockpit treats a missing entry as gone. */
  entries: DirectoryEntry[];
  /** The directory's objectClass definitions (RFC 4512), with the first part. */
  objectClasses?: string[];
}

export interface DirectorySyncIssue {
  targetModel: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface DirectorySyncResponse {
  provider: { id: number; name: string };
  /**
   * receiving: a part was stored, send the next. awaiting-setup: stored, but the import is not set
   * up in Cockpit yet. stored: kept in Cockpit, not imported (automatic import is off there).
   * previewed / synced: applied (dry run or for real).
   */
  status: "receiving" | "awaiting-setup" | "stored" | "previewed" | "synced";
  uploadId: string;
  dryRun: boolean;
  received: number;
  mappings: Array<{
    targetModel: string;
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    conflicts: number;
    deprovisioned: number;
    /** Gone from the directory, but kept until the grace period set in Cockpit ends. */
    pending?: number;
  }>;
  issues: DirectorySyncIssue[];
}

export interface ConnectorStatusResponse {
  provider: { id: number; name: string };
  syncStatus: string | null;
  lastSyncAt: string | null;
  /** True once an admin ran the first import in Cockpit; uploads are applied from then on. */
  setupComplete: boolean;
  lastUpload: { receivedAt: string; entryCount: number; baseDn: string } | null;
}
