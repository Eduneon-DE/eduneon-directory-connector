import { APPLICATION_NAME } from "@/libs/constants";

import { secureStorageServiceName } from "./secureStorageName";

const MAC_DEFAULT = "/Users/admin/Library/Application Support/Eduneon Directory Connector";
const WIN_DEFAULT = "C:\\Users\\admin\\AppData\\Roaming\\Eduneon Directory Connector";
const LINUX_DEFAULT = "/home/admin/.config/Eduneon Directory Connector";

describe("secureStorageServiceName", () => {
  it("keeps the name existing installs use for the default data folder", () => {
    expect(secureStorageServiceName(MAC_DEFAULT, MAC_DEFAULT, "darwin")).toBe(APPLICATION_NAME);
    expect(secureStorageServiceName(WIN_DEFAULT, WIN_DEFAULT, "win32")).toBe(APPLICATION_NAME);
    expect(secureStorageServiceName(LINUX_DEFAULT, LINUX_DEFAULT, "linux")).toBe(APPLICATION_NAME);
  });

  it("keeps the name when no data folder is known", () => {
    expect(secureStorageServiceName(null, MAC_DEFAULT, "darwin")).toBe(APPLICATION_NAME);
  });

  it("treats the default folder written another way as the default folder", () => {
    expect(secureStorageServiceName(MAC_DEFAULT + "/", MAC_DEFAULT, "darwin")).toBe(
      APPLICATION_NAME,
    );
    expect(
      secureStorageServiceName(
        "c:\\users\\ADMIN\\appdata\\roaming\\eduneon directory connector\\",
        WIN_DEFAULT,
        "win32",
      ),
    ).toBe(APPLICATION_NAME);
  });

  it("gives another data folder a name of its own, with a suffix taken from the folder", () => {
    const name = secureStorageServiceName("/var/lib/eduneon-dc", LINUX_DEFAULT, "linux");

    expect(name).not.toBe(APPLICATION_NAME);
    expect(name).toMatch(/^Eduneon Directory Connector \([0-9a-f]{12}\)$/);
  });

  it("gives the same folder the same name on every start, and two folders two names", () => {
    const a = secureStorageServiceName("/srv/school-a", LINUX_DEFAULT, "linux");

    expect(secureStorageServiceName("/srv/school-a/", LINUX_DEFAULT, "linux")).toBe(a);
    expect(secureStorageServiceName("/srv/school-b", LINUX_DEFAULT, "linux")).not.toBe(a);
  });

  it("does not depend on the folder's case where the file system ignores it", () => {
    expect(secureStorageServiceName("D:\\Eduneon\\Data", WIN_DEFAULT, "win32")).toBe(
      secureStorageServiceName("d:\\eduneon\\data", WIN_DEFAULT, "win32"),
    );
    expect(secureStorageServiceName("/srv/Data", LINUX_DEFAULT, "linux")).not.toBe(
      secureStorageServiceName("/srv/data", LINUX_DEFAULT, "linux"),
    );
  });
});
