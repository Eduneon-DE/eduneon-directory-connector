export class SyncConfiguration {
  users = false;
  groups = false;
  interval = 5;
  userFilter: string;
  groupFilter: string;
  removeDisabled = false;
  overwriteExisting = false;
  largeImport = false;
  inviteUsersAfterProvisioning = false;
  // Ldap properties
  groupObjectClass: string;
  userObjectClass: string;
  groupPath: string;
  userPath: string;
  groupNameAttribute: string;
  userEmailAttribute: string;
  memberAttribute: string;
  useEmailPrefixSuffix = false;
  emailPrefixAttribute: string;
  emailSuffix: string;
  creationDateAttribute: string;
  revisionDateAttribute: string;
}

/**
 * Settings that would leave users or groups out of what is read. An LDAP sync never leaves
 * anything out: it sends everything under the base DN, and Cockpit's mappings choose what is
 * imported. A value an earlier version saved is removed when the settings are saved with LDAP
 * chosen (see ConnectorUtils.adjustConfigForSave).
 */
export const LDAP_UNUSED_FILTERS = ["userFilter", "groupFilter", "removeDisabled"] as const;

/** The LDAP_UNUSED_FILTERS that hold a value. */
export function ldapUnusedFilters(sync: SyncConfiguration | null | undefined): string[] {
  return LDAP_UNUSED_FILTERS.filter((field) => {
    const value: unknown = sync?.[field];
    return typeof value === "string" ? value.trim() !== "" : value === true;
  });
}
