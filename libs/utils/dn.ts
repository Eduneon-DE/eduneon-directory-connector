/**
 * A DN in one spelling, for comparing two DNs: LDAP compares attribute names and (for the usual
 * string attributes) values without case, and ignores spaces around "," and "=". So
 * "UID=U1, OU=People,dc=x" and "uid=u1,ou=people,dc=x" name the same entry.
 */
export function normalizeDn(dn: string): string {
  return (dn ?? "")
    .trim()
    .replace(/\s*([,=+])\s*/g, "$1")
    .toLowerCase();
}
