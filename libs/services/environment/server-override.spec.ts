import { StateService } from "@/libs/abstractions/state.service";

import { applyServerOverride, SERVER_URL_ENV } from "./server-override";

describe("applyServerOverride", () => {
  let stateService: jest.Mocked<Pick<StateService, "setEnvironmentUrls">>;

  beforeEach(() => {
    stateService = { setEnvironmentUrls: jest.fn().mockResolvedValue(undefined) };
  });

  const run = (value?: string) =>
    applyServerOverride(
      stateService as unknown as StateService,
      value === undefined ? {} : { [SERVER_URL_ENV]: value },
    );

  it("does nothing when the variable is not set", async () => {
    await expect(run()).resolves.toBeNull();
    expect(stateService.setEnvironmentUrls).not.toHaveBeenCalled();
  });

  it("does nothing when the variable is blank", async () => {
    await expect(run("   ")).resolves.toBeNull();
    expect(stateService.setEnvironmentUrls).not.toHaveBeenCalled();
  });

  it("stores the URL as the base URL, without trailing slashes", async () => {
    await expect(run("http://localhost:5000//")).resolves.toBe("http://localhost:5000");
    expect(stateService.setEnvironmentUrls).toHaveBeenCalledWith(
      expect.objectContaining({ base: "http://localhost:5000", api: null, identity: null }),
    );
  });

  it("rejects a URL without a scheme instead of guessing", async () => {
    await expect(run("localhost:5000")).rejects.toThrow(SERVER_URL_ENV);
    expect(stateService.setEnvironmentUrls).not.toHaveBeenCalled();
  });
});
