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
/** Optional: the Cockpit organization to act in, when the token's login belongs to several. */
export const ORGANIZATION_ID_ENV = "EDUNEON_DC_ORGANIZATION_ID";

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
    const rawOrganizationId = process.env[ORGANIZATION_ID_ENV]?.trim();
    const organizationId = rawOrganizationId ? Number(rawOrganizationId) : undefined;

    try {
      await this.authService.logIn({ apiToken, directoryId, organizationId });
      const directory = await this.stateService.getEntityId();
      return Response.success(
        new MessageResponse(
          "You are logged in!",
          `Syncing into "${directory}" on ${await this.stateService.getApiUrl()}.`,
        ),
      );
    } catch (e) {
      const message = e?.message ?? "";
      if (/several organizations|chosen organization/.test(message)) {
        return Response.error(`${message} Set it in ${ORGANIZATION_ID_ENV}.`);
      }
      return Response.error(e);
    }
  }

  private async readApiToken(): Promise<string> {
    const fromEnv = process.env[API_TOKEN_ENV];
    if (fromEnv != null) {
      return fromEnv;
    }
    // Without a terminal to type in (a script, cron, input from /dev/null) there is nobody to ask:
    // the prompt would end with an uncaught error and exit code 0.
    if (process.env.EDUNEON_DC_NOINTERACTION === "true" || !process.stdin.isTTY) {
      return null;
    }
    try {
      const answer: inquirer.Answers = await inquirer.createPromptModule({
        output: process.stderr,
      })({
        type: "password",
        name: "apiToken",
        message: "Cockpit API token:",
        mask: "*",
      });
      return answer.apiToken;
    } catch {
      // The prompt was closed (Ctrl+C, end of input): no token, and the command fails.
      return null;
    }
  }
}
