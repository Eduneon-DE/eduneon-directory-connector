import { AuthService } from "@/libs/abstractions/auth.service";

import { Response } from "@/src-cli/models/response";
import { MessageResponse } from "@/src-cli/models/response/messageResponse";

export class LogoutCommand {
  constructor(
    private authService: AuthService,
    private logoutCallback: () => Promise<void>,
  ) {}

  async run() {
    try {
      await this.logoutCallback();
    } catch (e) {
      // Say which tokens are left instead of crashing; running logout again removes them.
      return Response.error(e);
    }
    this.authService.logOut(() => {
      /* Do nothing */
    });
    const res = new MessageResponse("You have logged out.", null);
    return Response.success(res);
  }
}
