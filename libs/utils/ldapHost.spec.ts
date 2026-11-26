import { isPortEmpty, normalizeLdapHost } from "./ldapHost";

describe("normalizeLdapHost", () => {
  it.each([
    ["dc1.school.local", "dc1.school.local", null],
    ["  dc1.school.local  ", "dc1.school.local", null],
    ["ldap://dc1.school.local", "dc1.school.local", null],
    ["LDAPS://dc1.school.local:636", "dc1.school.local", 636],
    ["ldaps://dc1.school.local:636/dc=school,dc=local", "dc1.school.local", 636],
    ["https://dc1.school.local/", "dc1.school.local", null],
    ["http://10.0.0.5:389", "10.0.0.5", 389],
    ["dc1:1389", "dc1", 1389],
    ["ldap://[::1]:389", "::1", 389],
    ["fe80::1", "fe80::1", null],
    ["", "", null],
    [null, "", null],
    ["ldap://", "", null],
  ])("%p gives host %p and port %p", (input, hostname, port) => {
    expect(normalizeLdapHost(input as string)).toEqual({ hostname, port });
  });
});

describe("isPortEmpty", () => {
  it("treats null, blank and 0 as empty", () => {
    expect(isPortEmpty(null)).toBe(true);
    expect(isPortEmpty("")).toBe(true);
    expect(isPortEmpty(0)).toBe(true);
    expect(isPortEmpty(389)).toBe(false);
    expect(isPortEmpty("636")).toBe(false);
  });
});
