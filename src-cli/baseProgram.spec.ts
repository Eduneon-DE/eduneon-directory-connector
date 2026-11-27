// chalk ships only as ESM, which this Jest setup does not load.
jest.mock("chalk", () => ({
  __esModule: true,
  default: { greenBright: (s: string) => s, redBright: (s: string) => s },
}));

import { BaseProgram } from "./baseProgram";
import { Response } from "./models/response";
import { MessageResponse } from "./models/response/messageResponse";

class TestProgram extends BaseProgram {
  print(response: Response) {
    this.processResponse(response);
  }
}

// conn-30
describe("BaseProgram --raw", () => {
  let lines: string[];
  let program: TestProgram;

  beforeEach(() => {
    lines = [];
    program = new TestProgram(null, (s) => lines.push(s));
    process.env.BW_RAW = "true";
  });

  afterEach(() => {
    delete process.env.BW_RAW;
    process.exitCode = undefined;
  });

  it("prints the message of an answer that has no raw form", () => {
    program.print(Response.success(new MessageResponse("Syncing complete.", "Sent 4 entries.")));

    expect(lines.join("\n")).toContain("Sent 4 entries.");
  });

  it("prints only the raw form when there is one", () => {
    const res = new MessageResponse("Update available", "Download it here.");
    res.raw = "https://example.test/download";

    program.print(Response.success(res));

    expect(lines).toEqual(["https://example.test/download"]);
  });
});
