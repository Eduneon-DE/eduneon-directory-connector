import { mock, MockProxy } from "jest-mock-extended";

import { StateService } from "@/libs/abstractions/state.service";

import { ForgetCommand } from "./forget.command";

// inquirer ships only as ESM; the tests answer the question themselves.
jest.mock("inquirer", () => ({ createPromptModule: jest.fn() }));

/** Whether stdin is a terminal for the test, as it is when someone runs the command by hand. */
function setTty(isTTY: boolean | undefined) {
  Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
}

const WHERE = 'the keychain entries "Eduneon Directory Connector (0123456789ab)"';

describe("ForgetCommand", () => {
  let stateService: MockProxy<StateService>;
  let ask: jest.Mock<Promise<boolean>, [string]>;
  let command: ForgetCommand;

  beforeEach(() => {
    delete process.env.EDUNEON_DC_NOINTERACTION;
    setTty(true);
    stateService = mock<StateService>();
    ask = jest.fn().mockResolvedValue(true);
    command = new ForgetCommand(stateService, WHERE, ask);
  });

  it("asks first, then deletes the token and every directory secret", async () => {
    const result = await command.run({});

    expect(ask).toHaveBeenCalledWith(expect.stringContaining(WHERE));
    expect(stateService.clearAllSecrets).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect((result.data as unknown as { title: string }).title).toContain(WHERE);
  });

  it("deletes nothing when the answer is no", async () => {
    ask.mockResolvedValue(false);

    const result = await command.run({});

    expect(result.success).toBe(false);
    expect(stateService.clearAllSecrets).not.toHaveBeenCalled();
  });

  it("does not ask with --yes", async () => {
    const result = await command.run({ yes: true });

    expect(ask).not.toHaveBeenCalled();
    expect(stateService.clearAllSecrets).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it.each([
    ["EDUNEON_DC_NOINTERACTION is set", () => (process.env.EDUNEON_DC_NOINTERACTION = "true")],
    ["there is no terminal", () => setTty(false)],
  ])("deletes nothing and asks for --yes when %s", async (_why, arrange) => {
    arrange();

    const result = await command.run({});

    expect(ask).not.toHaveBeenCalled();
    expect(stateService.clearAllSecrets).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("--yes");
  });

  it("says what could not be deleted", async () => {
    stateService.clearAllSecrets.mockRejectedValue(
      new Error("Failed to clear 1 auth token(s): accessToken (keychain locked)"),
    );

    const result = await command.run({ yes: true });

    expect(result.success).toBe(false);
    expect(result.message).toContain("accessToken");
  });
});
