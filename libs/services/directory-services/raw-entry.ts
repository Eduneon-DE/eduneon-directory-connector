import { DirectoryEntry } from "../../models/cockpit";

/**
 * Attributes that hold passwords, password hashes or keys. They are never sent to Cockpit, even
 * when the bind account is allowed to read them.
 */
const SECRET_ATTRIBUTES = new Set([
  "userpassword",
  "unicodepwd",
  "dbcspwd",
  "ntpwdhistory",
  "lmpwdhistory",
  "supplementalcredentials",
  "pwdhistory",
  "sambantpassword",
  "sambalmpassword",
  "sambapasswordhistory",
  "krb5key",
  "krbprincipalkey",
  "msds-managedpassword",
  "msds-keycredentiallink",
  "ms-mcs-admpwd",
  "mslaps-password",
  "mslaps-encryptedpassword",
  "mslaps-encryptedpasswordhistory",
  "msfve-recoverypassword",
  "msfve-keypackage",
  "authpassword",
]);

/** True for attributes that must not leave the customer's network. */
export function isSecretAttribute(name: string): boolean {
  const key = name.toLowerCase().split(";")[0];
  return SECRET_ATTRIBUTES.has(key) || key.includes("password");
}

type RawValue = string | number | boolean | Buffer | Uint8Array | null | undefined;

function toStrings(value: RawValue | RawValue[]): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const v of list) {
    if (v == null) {
      continue;
    }
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      out.push(Buffer.from(v).toString("base64"));
    } else {
      const s = String(v);
      if (s.length > 0) {
        out.push(s);
      }
    }
  }
  return out;
}

/**
 * Turn an LDAP search entry (ldapts: `{ dn, attr: value | value[] }`) into the entry Cockpit
 * expects: lowercase attribute names, every value a string, binary values base64.
 */
export function fromLdapEntry(entry: Record<string, unknown> & { dn: string }): DirectoryEntry {
  const attributes: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(entry)) {
    if (name === "dn" || isSecretAttribute(name)) {
      continue;
    }
    const values = toStrings(value as RawValue | RawValue[]);
    if (values.length > 0) {
      const key = name.toLowerCase();
      attributes[key] = [...(attributes[key] ?? []), ...values];
    }
  }
  return { dn: entry.dn, attributes };
}

/**
 * Flatten an object from a cloud directory API (Microsoft Graph, Google Admin) into an entry.
 * Nested objects become dotted names (`name.givenName` → `name.givenname`), arrays of scalars
 * stay multi-valued, arrays of objects are flattened per field.
 */
export function fromObject(
  dn: string,
  objectClass: string[],
  source: Record<string, unknown>,
  extra: Record<string, string[]> = {},
): DirectoryEntry {
  const attributes: Record<string, string[]> = { objectclass: objectClass };
  const add = (name: string, values: string[]) => {
    if (values.length === 0) {
      return;
    }
    if (isSecretAttribute(name)) {
      return;
    }
    const key = name.toLowerCase();
    attributes[key] = [...(attributes[key] ?? []), ...values];
  };
  const walk = (prefix: string, value: unknown) => {
    if (value == null) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(prefix, item);
      }
    } else if (typeof value === "object" && !Buffer.isBuffer(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(prefix ? `${prefix}.${k}` : k, v);
      }
    } else {
      add(prefix, toStrings(value as RawValue));
    }
  };
  walk("", source);
  for (const [k, v] of Object.entries(extra)) {
    add(k, v);
  }
  return { dn, attributes };
}

/**
 * Collects the users and groups of a cloud directory (Entra ID, Google Workspace) during a read
 * and turns them into entries with stable, LDAP-shaped DNs. Groups get `member` and users get
 * `memberOf` (direct membership, as DNs), so Cockpit filters such as `(memberOf=…)` work the same
 * way they do for LDAP.
 */
export class CloudSnapshotBuilder {
  private users = new Map<string, { source: Record<string, unknown> }>();
  private groups = new Map<
    string,
    { source: Record<string, unknown>; userIds: Set<string>; groupIds: Set<string> }
  >();

  constructor(private readonly directory: "entra" | "google") {}

  userDn(id: string): string {
    return `uid=${id},ou=users,o=${this.directory}`;
  }

  groupDn(id: string): string {
    return `cn=${id},ou=groups,o=${this.directory}`;
  }

  clear(): void {
    this.users.clear();
    this.groups.clear();
  }

  addUser(id: string, source: object): void {
    this.users.set(id, { source: source as Record<string, unknown> });
  }

  addGroup(id: string, source: object, userIds: Iterable<string>, groupIds: Iterable<string>) {
    this.groups.set(id, {
      source: source as Record<string, unknown>,
      userIds: new Set(userIds),
      groupIds: new Set(groupIds),
    });
  }

  build(): { baseDn: string; entries: DirectoryEntry[] } {
    const memberOf = new Map<string, string[]>();
    for (const [groupId, group] of this.groups) {
      for (const userId of group.userIds) {
        memberOf.set(userId, [...(memberOf.get(userId) ?? []), this.groupDn(groupId)]);
      }
    }
    const entries: DirectoryEntry[] = [];
    for (const [id, user] of this.users) {
      entries.push(
        fromObject(this.userDn(id), ["user"], user.source, { memberof: memberOf.get(id) ?? [] }),
      );
    }
    for (const [id, group] of this.groups) {
      const member = [
        ...[...group.userIds].map((u) => this.userDn(u)),
        ...[...group.groupIds].map((g) => this.groupDn(g)),
      ];
      entries.push(fromObject(this.groupDn(id), ["group"], group.source, { member }));
    }
    return { baseDn: "", entries };
  }
}
