import * as inquirer from "inquirer";

import { StateService } from "@/libs/abstractions/state.service";

import { Response } from "@/src-cli/models/response";
import { MessageResponse } from "@/src-cli/models/response/messageResponse";

/**
 * `eduneon-dc forget`: deletes everything this connector keeps in the keychain for its data folder,
 * the API token and every directory's secret, logged in or not. For a machine that stops syncing,
 * before an uninstall, or to start over. The settings themselves (data.json) stay.
 */
export class ForgetCommand {
  /**
   * @param where the keychain entries' name and the data folder, as the answers name them
   * @param ask a yes/no question on the terminal; the tests answer it
   */
  constructor(
    private stateService: StateService,
    private where: string,
    private ask: (question: string) => Promise<boolean> = askOnTerminal,
  ) {}

  async run(options: { yes?: boolean }): Promise<Response> {
    if (!options?.yes) {
      // Without a terminal (a script, a scheduled task) there is nobody to ask.
      if (process.env.EDUNEON_DC_NOINTERACTION === "true" || !process.stdin.isTTY) {
        return Response.badRequest("Nothing was deleted: add --yes to delete without asking.");
      }
      const confirmed = await this.ask(
        `Delete the API token and the directory passwords and keys of ${this.where}?`,
      );
      if (!confirmed) {
        return Response.error("Nothing was deleted.");
      }
    }

    try {
      await this.stateService.clearAllSecrets();
    } catch (e) {
      // Say which entries are left; running forget again tries them again.
      return Response.error(e);
    }
    return Response.success(
      new MessageResponse(
        `Deleted the API token and the directory passwords and keys of ${this.where}.`,
        "The settings are kept. To sync again, log in and set the directory's password or key.",
      ),
    );
  }
}

async function askOnTerminal(question: string): Promise<boolean> {
  try {
    const answer: inquirer.Answers = await inquirer.createPromptModule({
      output: process.stderr,
    })({ type: "confirm", name: "confirmed", message: question, default: false });
    return answer.confirmed === true;
  } catch {
    // The prompt was closed (Ctrl+C, end of input): no answer is no.
    return false;
  }
}
