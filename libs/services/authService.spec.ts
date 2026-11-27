import { mock, MockProxy } from "jest-mock-extended";

import { ApiService } from "@/libs/abstractions/api.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { StateService } from "@/libs/abstractions/state.service";

import { AuthService } from "./auth.service";

describe("AuthService", () => {
  let apiService: MockProxy<ApiService>;
  let stateService: MockProxy<StateService>;
  let authService: AuthService;

  beforeEach(() => {
    apiService = mock();
    stateService = mock();
    authService = new AuthService(apiService, mock<MessagingService>(), stateService);
  });

  it("checks the token with Cockpit, then stores it and the directory", async () => {
    apiService.getConnectorStatus.mockResolvedValue({
      provider: { id: 12, name: "Lincoln High" },
      syncStatus: null,
      lastSyncAt: null,
      setupComplete: false,
      lastUpload: null,
    });

    await authService.logIn({ apiToken: "  token-123 " });

    expect(apiService.getConnectorStatus).toHaveBeenCalledWith("token-123", undefined, undefined);
    expect(stateService.setAccessToken).toHaveBeenCalledWith("token-123");
    expect(stateService.setEntityId).toHaveBeenCalledWith("Lincoln High");
    expect(stateService.setOrganizationId).toHaveBeenCalledWith("12");
  });

  it("stores nothing when Cockpit rejects the token", async () => {
    apiService.getConnectorStatus.mockRejectedValue(new Error("rejected"));

    await expect(authService.logIn({ apiToken: "bad" })).rejects.toThrow("rejected");
    expect(stateService.setAccessToken).not.toHaveBeenCalled();
  });

  it("passes the directory ID when one is given", async () => {
    apiService.getConnectorStatus.mockResolvedValue({
      provider: { id: 4, name: "Second" },
      syncStatus: null,
      lastSyncAt: null,
      setupComplete: true,
      lastUpload: null,
    });

    await authService.logIn({ apiToken: "t", directoryId: 4 });

    expect(apiService.getConnectorStatus).toHaveBeenCalledWith("t", 4, undefined);
    expect(stateService.setOrganizationId).toHaveBeenCalledWith("4");
  });

  it("logs in to the chosen organization and remembers it for later requests", async () => {
    apiService.getConnectorStatus.mockResolvedValue({
      provider: { id: 4, name: "Second" },
      syncStatus: null,
      lastSyncAt: null,
      setupComplete: true,
      lastUpload: null,
    });

    await authService.logIn({ apiToken: "t", organizationId: 77 });

    expect(apiService.getConnectorStatus).toHaveBeenCalledWith("t", undefined, 77);
    expect(stateService.setCockpitOrganizationId).toHaveBeenCalledWith(77);
  });

  it("rejects a directory ID that is not a number Cockpit shows", async () => {
    await expect(authService.logIn({ apiToken: "t", directoryId: 1.5 })).rejects.toThrow(
      "directory ID",
    );
  });

  it("requires a token", async () => {
    await expect(authService.logIn({ apiToken: " " })).rejects.toThrow("API token is required");
    expect(apiService.getConnectorStatus).not.toHaveBeenCalled();
  });

  it("saves nothing when the server answers but is not Cockpit", async () => {
    for (const answer of [null, {}, { provider: null }, { provider: { id: 0, name: "" } }]) {
      apiService.getConnectorStatus.mockResolvedValue(answer as any);

      await expect(authService.logIn({ apiToken: "t" })).rejects.toThrow("not Cockpit");
    }
    expect(stateService.setAccessToken).not.toHaveBeenCalled();
    expect(stateService.setOrganizationId).not.toHaveBeenCalled();
  });
});
