import * as inquirer from "inquirer";

import { AuthService } from "@/libs/abstractions/auth.service";
import { StateService } from "@/libs/abstractions/state.service";
import { Utils } from "@/libs/utils/utils";

import { Response } from "@/src-cli/models/response";
import { MessageResponse } from "@/src-cli/models/response/messageResponse";

/** Environment variable that supplies the Cockpit API token without a prompt. */
export const API_TOKEN_ENV = "EDUNEON_DC_API_TOKEN";
/** Optional: the Cockpit directory ID, when the organization has several connector directories. */
export const DIRECTORY_ID_ENV = "EDUNEON_DC_DIRECTORY_ID";

export class LoginCommand {
  constructor(
    private authService: AuthService,
    private stateService: StateService,
  ) {}

  async run() {
    const apiToken = await this.readApiToken();
    if (Utils.isNullOrWhitespace(apiToken)) {
      return Response.error(
        `An API token is required. Pass it in ${API_TOKEN_ENV} or run the command interactively.`,
      );
    }

    const rawDirectoryId = process.env[DIRECTORY_ID_ENV]?.trim();
    const directoryId = rawDirectoryId ? Number(rawDirectoryId) : undefined;

    try {
      await this.authService.logIn({ apiToken, directoryId });
      const directory = await this.stateService.getEntityId();
      return Response.success(
        new MessageResponse(
          "You are logged in!",
          `Syncing into "${directory}" on ${await this.stateService.getApiUrl()}.`,
        ),
      );
    } catch (e) {
      return Response.error(e);
    }
  }

  private async readApiToken(): Promise<string> {
    const fromEnv = process.env[API_TOKEN_ENV];
    if (fromEnv != null) {
      return fromEnv;
    }
    if (process.env.EDUNEON_DC_NOINTERACTION === "true") {
      return null;
    }
    const answer: inquirer.Answers = await inquirer.createPromptModule({
      output: process.stderr,
    })({
      type: "password",
      name: "apiToken",
      message: "Cockpit API token:",
      mask: "*",
    });
    return answer.apiToken;
  }
}
