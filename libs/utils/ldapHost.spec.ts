import { applyLdapHostInput, isPortEmpty, normalizeLdapHost, parsePort } from "./ldapHost";

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

describe("applyLdapHostInput", () => {
  const ldap = (hostname: string, port: number | null = 389, ssl = false, startTls = false) => ({
    hostname,
    port,
    ssl,
    startTls,
  });

  it("takes LDAPS and port 636 from ldaps://host:636 over the default port 389", () => {
    const l = ldap("ldaps://dc1.school.local:636/");
    applyLdapHostInput(l);
    expect(l).toEqual({ hostname: "dc1.school.local", port: 636, ssl: true, startTls: false });
  });

  it("uses 636 for ldaps:// without a port", () => {
    const l = ldap("LDAPS://dc1");
    applyLdapHostInput(l);
    expect(l).toEqual({ hostname: "dc1", port: 636, ssl: true, startTls: false });
  });

  it("takes the port written in the host over the port field", () => {
    const l = ldap("dc1:1389");
    applyLdapHostInput(l);
    expect(l).toEqual({ hostname: "dc1", port: 1389, ssl: false, startTls: false });
  });

  it("turns LDAPS off for ldap://, but keeps StartTLS", () => {
    const plain = ldap("ldap://dc1", 636, true, false);
    applyLdapHostInput(plain);
    expect(plain).toEqual({ hostname: "dc1", port: 389, ssl: false, startTls: false });

    const startTls = ldap("ldap://dc1", 389, true, true);
    applyLdapHostInput(startTls);
    expect(startTls).toEqual({ hostname: "dc1", port: 389, ssl: true, startTls: true });
  });

  it("leaves a bare host's settings alone", () => {
    const l = ldap(" dc1 ", 636, true, false);
    applyLdapHostInput(l);
    expect(l).toEqual({ hostname: "dc1", port: 636, ssl: true, startTls: false });
  });
});

describe("parsePort", () => {
  it.each([
    [" 636", 636],
    [389, 389],
    ["65535", 65535],
    ["", null],
    [null, null],
    ["abc", null],
    [0, null],
    [70000, null],
    ["6.36", null],
  ])("reads %p as %p", (input, port) => {
    expect(parsePort(input)).toBe(port);
  });
});
