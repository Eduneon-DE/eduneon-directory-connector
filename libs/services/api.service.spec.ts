/**
 * @jest-environment node
 *
 * ApiService constructs `Request` objects, which jsdom does not provide.
 */
import { mock, MockProxy } from "jest-mock-extended";

import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { StateService } from "@/libs/abstractions/state.service";
import { ErrorResponse } from "@/libs/models/response/errorResponse";
import { ApiService } from "@/libs/services/api.service";

/** Records every outbound request and answers with the queued response; no network is touched. */
class TestApiService extends ApiService {
  readonly requests: Request[] = [];
  next: () => Response = () => json(200, {});

  protected nativeFetch(request: Request): Promise<Response> {
    this.requests.push(request);
    return Promise.resolve(this.next());
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ApiService", () => {
  let stateService: MockProxy<StateService>;
  let logout: jest.Mock;
  let sut: TestApiService;

  beforeEach(() => {
    const platformUtilsService = mock<PlatformUtilsService>();
    platformUtilsService.getClientType.mockReturnValue("connector" as never);
    platformUtilsService.getApplicationVersion.mockResolvedValue("2026.11.0");
    stateService = mock<StateService>();
    stateService.getApiUrl.mockResolvedValue("http://localhost:5000/api");
    stateService.getAccessToken.mockResolvedValue("stored-token");
    logout = jest.fn().mockResolvedValue(undefined);

    sut = new TestApiService(null, platformUtilsService, stateService, null, logout, "UA/1");
  });

  it("checks a token with X-API-Key against the status endpoint", async () => {
    sut.next = () =>
      json(200, { provider: { id: 3, name: "School" }, syncStatus: null, lastSyncAt: null });

    await expect(sut.getConnectorStatus("new-token")).resolves.toMatchObject({
      provider: { id: 3 },
    });

    const req = sut.requests[0];
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://localhost:5000/api/v1/directory-connector/status");
    expect(req.headers.get("X-API-Key")).toBe("new-token");
    expect(req.headers.get("Authorization")).toBeNull();
  });

  it("posts the snapshot as JSON with the stored token", async () => {
    sut.next = () => json(200, { mappings: [], issues: [] });

    await sut.postDirectorySync({ dryRun: false, baseDn: "dc=x", entries: [] });

    const req = sut.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://localhost:5000/api/v1/directory-connector/sync");
    expect(req.headers.get("X-API-Key")).toBe("stored-token");
    expect(req.headers.get("Content-Type")).toContain("application/json");
    await expect(req.json()).resolves.toEqual({ dryRun: false, baseDn: "dc=x", entries: [] });
  });

  it("logs out when Cockpit rejects the stored token", async () => {
    sut.next = () => json(401, { message: "Unauthorized" });

    await expect(
      sut.postDirectorySync({ dryRun: false, baseDn: "", entries: [] }),
    ).rejects.toBeInstanceOf(ErrorResponse);
    expect(logout).toHaveBeenCalledWith(true);
  });

  it("does not log out when a token typed at login is wrong", async () => {
    sut.next = () => json(401, { message: "Unauthorized" });

    await expect(sut.getConnectorStatus("typo")).rejects.toMatchObject({
      message: expect.stringContaining("did not accept this API token"),
    });
    expect(logout).not.toHaveBeenCalled();
  });

  it("passes Cockpit's error message through", async () => {
    sut.next = () =>
      json(404, { statusCode: 404, message: "No Directory Connector directory is set up" });

    await expect(sut.getConnectorStatus("t")).rejects.toMatchObject({
      statusCode: 404,
      message: "No Directory Connector directory is set up",
    });
  });

  it("explains an unreachable server", async () => {
    sut.next = () => {
      throw new TypeError("fetch failed");
    };

    await expect(sut.getConnectorStatus("t")).rejects.toThrow(
      "Could not reach Cockpit at http://localhost:5000/api: fetch failed",
    );
  });
});
