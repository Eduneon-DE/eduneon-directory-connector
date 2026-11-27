import { AuthService } from "@/libs/abstractions/auth.service";
import { StateService } from "@/libs/abstractions/state.service";

import { Response } from "@/src-cli/models/response";
import { MessageResponse } from "@/src-cli/models/response/messageResponse";

export class LogoutCommand {
  constructor(
    private authService: AuthService,
    private stateService: StateService,
  ) {}

  async run() {
    try {
      // A logged-out connector keeps no password of the directory either. (A token Cockpit
      // rejects logs out without this: the directory's password stays for the next login.)
      await this.stateService.clearAllSecrets();
    } catch (e) {
      // Say which tokens are left instead of crashing; running logout again removes them.
      return Response.error(e);
    }
    this.authService.logOut(() => {
      /* Do nothing */
    });
    const res = new MessageResponse(
      "You have logged out.",
      "The API token and the directory's password or key were removed. " +
        "Set the password again before you log in and sync.",
    );
    return Response.success(res);
  }
}
