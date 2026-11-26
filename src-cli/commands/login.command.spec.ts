import { mock, MockProxy } from "jest-mock-extended";

import { AuthService } from "@/libs/abstractions/auth.service";
import { StateService } from "@/libs/abstractions/state.service";

import { API_TOKEN_ENV, LoginCommand } from "./login.command";

jest.mock("inquirer", () => ({
  createPromptModule: () => () => ({ apiToken: "prompted-token" }),
}));

describe("LoginCommand", () => {
  let authService: MockProxy<AuthService>;
  let loginCommand: LoginCommand;

  beforeEach(() => {
    delete process.env[API_TOKEN_ENV];
    delete process.env.EDUNEON_DC_NOINTERACTION;
    authService = mock();
    const stateService = mock<StateService>();
    stateService.getEntityId.mockResolvedValue("Lincoln High");
    stateService.getApiUrl.mockResolvedValue("http://localhost:5000/api");
    loginCommand = new LoginCommand(authService, stateService);
  });

  it("uses the token from the environment", async () => {
    process.env[API_TOKEN_ENV] = "env-token";

    const result = await loginCommand.run();

    expect(authService.logIn).toHaveBeenCalledWith({ apiToken: "env-token" });
    expect(result).toMatchObject({ success: true, data: { title: "You are logged in!" } });
  });

  it("asks for the token when none is set", async () => {
    await loginCommand.run();
    expect(authService.logIn).toHaveBeenCalledWith({ apiToken: "prompted-token" });
  });

  it("fails without prompting when interaction is off", async () => {
    process.env.EDUNEON_DC_NOINTERACTION = "true";

    const result = await loginCommand.run();

    expect(authService.logIn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false });
  });
});
