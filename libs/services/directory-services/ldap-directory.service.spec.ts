import { mock, MockProxy } from "jest-mock-extended";

// Every search the service issues must go through our stub rather than a
// real socket, so we can assert on the options passed to it.
const searchMock = jest.fn();
const bindMock = jest.fn();
const unbindMock = jest.fn();
const startTLSMock = jest.fn();
const clientCtorMock = jest.fn();

jest.mock("ldapts", () => ({
  Client: jest.fn().mockImplementation((options: unknown) => {
    clientCtorMock(options);
    return { bind: bindMock, unbind: unbindMock, search: searchMock, startTLS: startTLSMock };
  }),
  Control: jest.fn().mockImplementation((type: string, options: unknown) => ({ type, options })),
}));

import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DirectoryType } from "@/libs/enums/directoryType";

import {
  getLdapConfiguration,
  getSyncConfiguration,
} from "../../../utils/openldap/config-fixtures";

import {
  LdapConnectTimeoutMs,
  LdapDirectoryService,
  LdapOperationTimeoutMs,
  LdapSearchTimeLimitSeconds,
} from "./ldap-directory.service";

describe("LdapDirectoryService search time limit", () => {
  let logService: MockProxy<LogService>;
  let i18nService: MockProxy<I18nService>;
  let stateService: MockProxy<StateService>;
  let directoryService: LdapDirectoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    searchMock.mockResolvedValue({ searchEntries: [], searchReferences: [] });
    bindMock.mockResolvedValue(undefined);
    unbindMock.mockResolvedValue(undefined);

    logService = mock();
    i18nService = mock();
    stateService = mock();
    i18nService.t.mockImplementation((id) => id);
    stateService.getDirectoryType.mockResolvedValue(DirectoryType.Ldap);
    stateService.getLastUserSync.mockResolvedValue(null);
    stateService.getDirectory
      .calledWith(DirectoryType.Ldap)
      .mockResolvedValue(getLdapConfiguration());

    directoryService = new LdapDirectoryService(logService, i18nService, stateService);
  });

  // Extracts the SearchOptions argument from every recorded client.search(path, options, controls) call.
  const searchOptionsUsed = () => searchMock.mock.calls.map((call) => call[1]);

  it("sets a generous server-side time limit instead of ldapts's 10-second default", async () => {
    stateService.getSync.mockResolvedValue(getSyncConfiguration({ users: true }));

    await directoryService.getEntries(true, true);

    expect(searchMock).toHaveBeenCalled();
    for (const options of searchOptionsUsed()) {
      expect(options.timeLimit).toBe(LdapSearchTimeLimitSeconds);
    }
  });

  it("applies the same time limit to every search, including the repeated user-filter lookup during group sync", async () => {
    stateService.getSync.mockResolvedValue(getSyncConfiguration({ users: true, groups: true }));

    await directoryService.getEntries(true, true);

    // getUsers() searches once for regular users, and getGroups() re-runs the user
    // filter again (to map member DNs) plus its own group search - at least 3 calls.
    const optionsUsed = searchOptionsUsed();
    expect(optionsUsed.length).toBeGreaterThanOrEqual(3);
    for (const options of optionsUsed) {
      expect(options.timeLimit).toBe(LdapSearchTimeLimitSeconds);
    }
  });

  it("still applies the time limit to the deleted-users lookup for Active Directory test syncs", async () => {
    stateService.getDirectory
      .calledWith(DirectoryType.Ldap)
      .mockResolvedValue(getLdapConfiguration({ ad: true }));
    stateService.getSync.mockResolvedValue(getSyncConfiguration({ users: true }));

    await directoryService.getEntries(true, true);

    // Regular users + the "Deleted Objects" search AD-specific search.
    const optionsUsed = searchOptionsUsed();
    expect(optionsUsed.length).toBeGreaterThanOrEqual(2);
    for (const options of optionsUsed) {
      expect(options.timeLimit).toBe(LdapSearchTimeLimitSeconds);
    }
  });
});

describe("LdapDirectoryService connection", () => {
  let logService: MockProxy<LogService>;
  let i18nService: MockProxy<I18nService>;
  let stateService: MockProxy<StateService>;
  let directoryService: LdapDirectoryService;

  const useConfig = (config: Parameters<typeof getLdapConfiguration>[0]) =>
    stateService.getDirectory
      .calledWith(DirectoryType.Ldap)
      .mockResolvedValue(getLdapConfiguration(config));
  const clientUrl = () => clientCtorMock.mock.calls[0][0].url;

  beforeEach(() => {
    jest.clearAllMocks();
    searchMock.mockResolvedValue({ searchEntries: [], searchReferences: [] });
    bindMock.mockResolvedValue(undefined);
    unbindMock.mockResolvedValue(undefined);
    startTLSMock.mockResolvedValue(undefined);

    logService = mock();
    i18nService = mock();
    stateService = mock();
    i18nService.t.mockImplementation((id) => id);
    stateService.getDirectoryType.mockResolvedValue(DirectoryType.Ldap);
    stateService.getSync.mockResolvedValue(getSyncConfiguration({ users: true }));
    useConfig({});
    directoryService = new LdapDirectoryService(logService, i18nService, stateService);
  });

  it("asks for StartTLS before the bind even when ssl is off, never binding in clear text", async () => {
    useConfig({ ssl: false, startTls: true });

    await directoryService.getEntries(true, true);

    expect(clientUrl()).toBe("ldap://localhost:1389");
    expect(startTLSMock).toHaveBeenCalledTimes(1);
    expect(startTLSMock.mock.invocationCallOrder[0]).toBeLessThan(
      bindMock.mock.invocationCallOrder[0],
    );
  });

  it("does not bind when StartTLS fails", async () => {
    useConfig({ startTls: true });
    startTLSMock.mockRejectedValue(new Error("TLS handshake failed"));

    await expect(directoryService.getEntries(true, true)).rejects.toThrow("TLS handshake failed");
    expect(bindMock).not.toHaveBeenCalled();
  });

  it("sets a connect and an operation timeout, longer than the server-side search limit", async () => {
    await directoryService.getEntries(true, true);

    const options = clientCtorMock.mock.calls[0][0];
    expect(options.connectTimeout).toBe(LdapConnectTimeoutMs);
    expect(options.timeout).toBe(LdapOperationTimeoutMs);
    expect(options.timeout).toBeGreaterThan(LdapSearchTimeLimitSeconds * 1000);
  });

  it("uses only the host of a hostname typed as a URL, and its port when the port is empty", async () => {
    useConfig({ hostname: " ldaps://DC1.school.local:636/dc=x ", port: null });

    await directoryService.getEntries(true, true);

    expect(clientUrl()).toBe("ldap://dc1.school.local:636");
  });

  it("says the hostname is missing instead of building an invalid URL", async () => {
    useConfig({ hostname: "  " });

    await expect(directoryService.getEntries(true, true)).rejects.toThrow("ldapHostnameMissing");
    expect(clientCtorMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      Object.assign(new Error("getaddrinfo ENOTFOUND dc1"), { code: "ENOTFOUND" }),
      "ldapErrorHostNotFound",
    ],
    [
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:389"), { code: "ECONNREFUSED" }),
      "ldapErrorConnectionRefused",
    ],
    [Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }), "ldapErrorTimeout"],
    [new Error("BindRequest: Operation timed out"), "ldapErrorTimeout"],
    [new Error("Connection timeout"), "ldapErrorTimeout"],
    [
      Object.assign(new Error("Invalid credentials during a bind operation. Code: 0x31"), {
        code: 49,
      }),
      "ldapErrorInvalidCredentials",
    ],
  ])("turns a bind error into a hint about the setting to check (case %#)", async (error, hint) => {
    bindMock.mockRejectedValue(error);

    await expect(directoryService.getEntries(true, true)).rejects.toThrow(hint);
    expect(logService.error).toHaveBeenCalledWith(expect.stringContaining(error.message));
  });

  it("turns a missing root path into a hint", async () => {
    searchMock.mockRejectedValue(
      Object.assign(new Error("The target object cannot be found. Code: 0x20"), { code: 32 }),
    );

    await expect(directoryService.getEntries(true, true)).rejects.toThrow("ldapErrorNoSuchObject");
  });

  it("keeps the message of other errors", async () => {
    bindMock.mockRejectedValue(new Error("Something else"));

    await expect(directoryService.getEntries(true, true)).rejects.toThrow("Something else");
  });

  it.each([
    ["Invalid credentials during a bind operation. Code: 0x31", "ldapErrorInvalidCredentials"],
    ["The target object cannot be found. Code: 0x20", "ldapErrorNoSuchObject"],
  ])("reads the LDAP result code from the text when the error has none: %p", async (text, hint) => {
    bindMock.mockRejectedValue(new Error(text));

    await expect(directoryService.getEntries(true, true)).rejects.toThrow(hint);
  });

  it.each([
    [{ ssl: true, startTls: false, sslCaPath: "/no/such/ca.pem" }, "CA certificate"],
    [{ ssl: true, startTls: false, sslCertPath: "/no/such/cert.pem" }, "client certificate"],
    [{ ssl: true, startTls: false, sslKeyPath: "/no/such/key.pem" }, "client key"],
    [{ ssl: true, startTls: true, tlsCaPath: "/no/such/ca.pem" }, "CA certificate"],
  ])("names a certificate file that cannot be read (case %#)", async (config, what) => {
    useConfig(config);

    await expect(directoryService.getEntries(true, true)).rejects.toThrow(
      new RegExp(`The ${what} file ".*" was not found or is not readable`),
    );
    expect(bindMock).not.toHaveBeenCalled();
  });
});
