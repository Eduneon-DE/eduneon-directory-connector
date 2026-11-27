/**
 * What an admin types as "Server Hostname" is often a URL: "ldaps://dc1.school.local:636/",
 * "http://dc1", " dc1 ". The LDAP client needs the bare host name, so strip the scheme, any path
 * and the port, and trim spaces. A port found in the input is returned separately, for a port field
 * that is still empty.
 */
export function normalizeLdapHost(input: string | null | undefined): {
  hostname: string;
  port: number | null;
} {
  let host = (input ?? "").trim();
  host = host.replace(/^(ldaps?|https?):\/\//i, "");
  // A trailing path, query or fragment ("/", "/dc=x", "?…").
  host = host.replace(/[/?#].*$/, "");
  let port: number | null = null;
  // "[::1]:636" (IPv6 in brackets) or "host:636"; a bare IPv6 address has more than one ":".
  const bracketed = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2] != null ? Number(bracketed[2]) : null;
  } else {
    const withPort = host.match(/^([^:]+):(\d+)$/);
    if (withPort) {
      host = withPort[1];
      port = Number(withPort[2]);
    }
  }
  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    port = null;
  }
  return { hostname: host.trim(), port };
}

/** True when a port setting has no usable value. */
export function isPortEmpty(port: unknown): boolean {
  return port == null || String(port).trim() === "" || !(Number(port) > 0);
}

/**
 * Save what the admin typed as "Server Hostname" into the LDAP settings: the bare host, the port
 * written in it (over the port field), and the encryption its scheme names. "ldaps://dc1:636" means LDAPS on 636, also
 * when the port field still shows the default 389; "ldaps://dc1" means LDAPS on 636.
 */
export function applyLdapHostInput(ldap: {
  hostname: string;
  port: number;
  ssl: boolean;
  startTls: boolean;
}): void {
  if (ldap.hostname == null) {
    return;
  }
  const scheme = ldap.hostname
    .trim()
    .match(/^(ldaps?):\/\//i)?.[1]
    ?.toLowerCase();
  const { hostname, port } = normalizeLdapHost(ldap.hostname);
  ldap.hostname = hostname;
  if (scheme === "ldaps") {
    ldap.ssl = true;
    ldap.startTls = false;
  } else if (scheme === "ldap" && ldap.ssl && !ldap.startTls) {
    // ldap:// is plain LDAP or StartTLS, never LDAPS.
    ldap.ssl = false;
  }
  if (port != null) {
    ldap.port = port;
  } else if (scheme === "ldaps" && (isPortEmpty(ldap.port) || Number(ldap.port) === 389)) {
    ldap.port = 636;
  } else if (scheme === "ldap" && (isPortEmpty(ldap.port) || Number(ldap.port) === 636)) {
    ldap.port = 389;
  }
}

/** The port field's value as a port number (" 636" → 636); null when it is not one (0, "abc", 70000). */
export function parsePort(port: unknown): number | null {
  const value = typeof port === "string" ? Number(port.trim()) : port;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : null;
}
