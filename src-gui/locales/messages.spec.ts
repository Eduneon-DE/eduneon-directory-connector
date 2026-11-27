import * as fs from "fs";
import * as path from "path";

const messages: Record<string, { message: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "en", "messages.json"), "utf8"),
);

describe("English messages", () => {
  // conn-16: Bitwarden's wording for the one server address this app has.
  it("says the server address was saved", () => {
    expect(messages.environmentSaved.message).toBe("Server address saved.");
  });

  // conn-18, conn-8: every key the code now uses exists.
  it.each([
    "syncFailed",
    "testFailed",
    "loginFailed",
    "ldapErrorInvalidDn",
    "ldapErrorSizeLimit",
    "ldapErrorInsufficientAccess",
    "ldapErrorEncryptionRequired",
    "ldapErrorTimeLimit",
  ])("has %s", (key) => {
    expect(messages[key]?.message).toEqual(expect.any(String));
  });
});
