import { FakeStorageService } from "@/utils/fakeStorageService";
import { mock } from "jest-mock-extended";

import { AuthService } from "@/libs/abstractions/auth.service";
import { DirectoryType } from "@/libs/enums/directoryType";
import { LdapConfiguration } from "@/libs/models/ldapConfiguration";
import { DefaultStateService } from "@/libs/services/state-service/default-state.service";

import { LogoutCommand } from "./logout.command";

describe("LogoutCommand", () => {
  it("removes the API token and the bind password from the keychain", async () => {
    const storage = new FakeStorageService();
    const keychain = new FakeStorageService();
    const state = new DefaultStateService(storage, keychain, mock(), null, true);
    await state.setDirectoryType(DirectoryType.Ldap);
    await state.setDirectory(DirectoryType.Ldap, {
      hostname: "dc1.school.test",
      username: "cn=sync,dc=school,dc=test",
      password: "fake-bind-password",
    } as LdapConfiguration);
    await state.setAccessToken("fake-token");

    const result = await new LogoutCommand(mock<AuthService>(), state).run();

    expect(result.success).toBe(true);
    expect((result.data as unknown as { message: string }).message).toContain("password");
    expect(keychain.store.size).toBe(0);
    // The settings stay: only the secrets go.
    expect((await state.getLdapConfiguration()).hostname).toBe("dc1.school.test");
  });

  it("says which entries are left when one cannot be removed", async () => {
    const state = mock<DefaultStateService>();
    state.clearAllSecrets.mockRejectedValue(new Error('secure storage key "secretLdap:x" failed'));

    const result = await new LogoutCommand(mock<AuthService>(), state).run();

    expect(result.success).toBe(false);
    expect(result.message).toContain("secretLdap");
  });
});
