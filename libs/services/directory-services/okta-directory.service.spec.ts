/**
 * @jest-environment node
 */
import { EventEmitter } from "events";
import * as https from "https";
import * as net from "net";

import { mock, MockProxy } from "jest-mock-extended";

import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { StateService } from "@/libs/abstractions/state.service";

import { getSyncConfiguration } from "../../../utils/okta/config-fixtures";
import { DirectoryType } from "../../enums/directoryType";

import { OktaDirectoryService } from "./okta-directory.service";

/** A port on this machine that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Makes https.get answer with this status and body, and records the request options. */
function fakeHttpsAnswer(statusCode: number, body: string) {
  const calls: https.RequestOptions[] = [];
  jest.spyOn(https, "get").mockImplementation(((options: https.RequestOptions, cb: any) => {
    calls.push(options);
    const req = new EventEmitter() as any;
    req.setTimeout = () => req;
    req.destroy = (): void => undefined;
    const res = new EventEmitter() as any;
    res.statusCode = statusCode;
    res.headers = {};
    process.nextTick(() => {
      cb(res);
      res.emit("data", body);
      res.emit("end");
    });
    return req;
  }) as any);
  return calls;
}

describe("OktaDirectoryService requests", () => {
  let stateService: MockProxy<StateService>;
  let service: OktaDirectoryService;

  const useOrgUrl = (orgUrl: string) =>
    stateService.getDirectory.calledWith(DirectoryType.Okta).mockResolvedValue({
      orgUrl,
      token: "token",
    });

  beforeEach(() => {
    stateService = mock();
    const i18nService = mock<I18nService>();
    i18nService.t.mockImplementation((id) => id);
    stateService.getDirectoryType.mockResolvedValue(DirectoryType.Okta);
    stateService.getSync.mockResolvedValue(getSyncConfiguration({ users: true, groups: false }));
    stateService.getLastUserSync.mockResolvedValue(null);
    service = new OktaDirectoryService(mock<LogService>(), i18nService, stateService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects with a clear message when the server cannot be reached, instead of ending the app", async () => {
    useOrgUrl(`https://127.0.0.1:${await closedPort()}`);

    await expect(service.getEntries(true, true)).rejects.toThrow(
      /Okta request to 127\.0\.0\.1:\d+ failed: .*ECONNREFUSED/,
    );
  });

  it("rejects an organization URL that is not a URL", async () => {
    useOrgUrl("my-school.okta");

    await expect(service.getEntries(true, true)).rejects.toThrow(
      "The Okta organization URL is not valid: my-school.okta",
    );
  });

  it("uses the port written in the organization URL", async () => {
    const calls = fakeHttpsAnswer(200, "[]");
    useOrgUrl("https://okta.example.test:8443");

    await service.getEntries(true, true);

    expect(calls[0]).toMatchObject({ hostname: "okta.example.test", port: "8443" });
  });

  it("rejects an answer that is not JSON (a login page)", async () => {
    fakeHttpsAnswer(200, "<html>Sign in</html>");
    useOrgUrl("https://okta.example.test");

    await expect(service.getEntries(true, true)).rejects.toThrow("the answer is not JSON");
  });

  it("names the status Okta answered with", async () => {
    fakeHttpsAnswer(401, '{"errorCode":"E0000011"}');
    useOrgUrl("https://okta.example.test");

    await expect(service.getEntries(true, true)).rejects.toThrow(
      "Okta answered 401. Check the API token.",
    );
  });
});
