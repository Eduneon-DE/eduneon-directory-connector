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
