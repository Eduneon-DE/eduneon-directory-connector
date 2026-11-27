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
  nativeFetchImpl: ((request: Request) => Promise<Response>) | null = null;

  protected nativeFetch(request: Request): Promise<Response> {
    this.requests.push(request);
    if (this.nativeFetchImpl != null) {
      return this.nativeFetchImpl(request);
    }
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
    sut.next = () => json(401, { statusCode: 401, message: "Invalid or expired API token" });

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

  it("still says to log in again when clearing the rejected token fails", async () => {
    sut.next = () => json(401, { statusCode: 401, message: "Invalid or expired API token" });
    logout.mockRejectedValue(new Error("Failed to clear 1 auth token(s): accessToken"));

    await expect(
      sut.postDirectorySync({ dryRun: false, baseDn: "", entries: [] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("Log in again with a new token") });
  });

  it("sends X-Organization-ID with the stored organization, or the one typed at login", async () => {
    stateService.getCockpitOrganizationId.mockResolvedValue(42);
    sut.next = () => json(200, { mappings: [], issues: [] });

    await sut.postDirectorySync({ dryRun: false, baseDn: "", entries: [] });
    await sut.getConnectorStatus("new-token", undefined, 7);
    await sut.getConnectorStatus("new-token");

    expect(sut.requests.map((r) => r.headers.get("X-Organization-ID"))).toEqual(["42", "7", null]);
  });

  it("asks to choose an organization, listing them, and does not log out", async () => {
    sut.next = () =>
      json(401, {
        statusCode: 401,
        code: "ORGANIZATION_SELECTION_REQUIRED",
        accounts: [
          { organizationId: 3, organizationName: "Board A" },
          { organizationId: 5, organizationName: "Board B" },
        ],
      });

    await expect(
      sut.postDirectorySync({ dryRun: false, baseDn: "", entries: [] }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /several organizations: choose one.*3 \(Board A\), 5 \(Board B\)/,
      ),
    });
    expect(logout).not.toHaveBeenCalled();
  });

  it("keeps the token on a 401 that is not Cockpit rejecting it (a proxy, another server)", async () => {
    for (const answer of [
      () => json(401, { message: "Unauthorized" }),
      () =>
        new Response("<html>Login</html>", {
          status: 401,
          headers: { "content-type": "text/html" },
        }),
    ]) {
      sut.next = answer;
      await expect(
        sut.postDirectorySync({ dryRun: false, baseDn: "", entries: [] }),
      ).rejects.toMatchObject({ message: expect.stringContaining("The API token is kept") });
    }
    expect(logout).not.toHaveBeenCalled();
  });

  it("says the server is not Cockpit when it answers with a web page", async () => {
    sut.next = () =>
      new Response("<html>Sign in</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    await expect(sut.getConnectorStatus("t")).rejects.toThrow("is not Cockpit");
  });

  it("gives every request a time limit, and says when Cockpit did not answer in time", async () => {
    sut.next = () => json(200, {});
    await sut.getConnectorStatus("t");
    expect(sut.requests[0].signal).toBeDefined();

    sut.nativeFetchImpl = () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      return Promise.reject(e);
    };
    await expect(sut.getConnectorStatus("t")).rejects.toThrow("did not answer within 30 seconds");
  });

  it("explains a 413 with advice instead of a bare status", async () => {
    sut.next = () =>
      new Response("<html>413 Request Entity Too Large</html>", {
        status: 413,
        headers: { "content-type": "text/html" },
      });

    await expect(
      sut.postDirectorySync({ dryRun: false, baseDn: "", entries: [] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("too large (413)") });
  });
});
