import * as path from "path";

import chalk from "chalk";
import { Command, OptionValues } from "commander";

import { APPLICATION_NAME } from "@/libs/constants";

import { BaseProgram } from "@/src-cli/baseProgram";
import { UpdateCommand } from "@/src-cli/commands/update.command";
import { Response } from "@/src-cli/models/response";
import { StringResponse } from "@/src-cli/models/response/stringResponse";

import { ClearCacheCommand } from "./commands/clearCache.command";
import { ConfigCommand, SETTINGS } from "./commands/config.command";
import { ForgetCommand } from "./commands/forget.command";
import { LastSyncCommand } from "./commands/lastSync.command";
import { LoginCommand } from "./commands/login.command";
import { LogoutCommand } from "./commands/logout.command";
import { SyncCommand } from "./commands/sync.command";
import { TestCommand } from "./commands/test.command";
import { Main } from "./eduneon-dc";
import { configFileLock } from "./services/node/configLock";

const writeLn = (s: string, finalLine = false, error = false) => {
  const stream = error ? process.stderr : process.stdout;
  if (finalLine && process.platform === "win32") {
    stream.write(s);
  } else {
    stream.write(s + "\n");
  }
};

export class Program extends BaseProgram {
  constructor(private main: Main) {
    super(main.stateService, writeLn);
  }

  async run() {
    const program = new Command()
      .option("--pretty", "Format output. JSON is tabbed with two spaces.")
      .option("--raw", "Return raw output instead of a descriptive message.")
      .option("--response", "Return a JSON formatted version of response output.")
      .option("--cleanexit", "Exit with a success exit code (0) unless an error is thrown.")
      .option("--quiet", "Don't return anything to stdout.")
      .option("--nointeraction", "Do not prompt for interactive user input.")
      .version(await this.main.platformUtilsService.getApplicationVersion(), "-v, --version");

    program.on("option:pretty", () => {
      process.env.BW_PRETTY = "true";
    });

    program.on("option:raw", () => {
      process.env.BW_RAW = "true";
    });

    program.on("option:quiet", () => {
      process.env.BW_QUIET = "true";
    });

    program.on("option:response", () => {
      process.env.BW_RESPONSE = "true";
    });

    program.on("option:cleanexit", () => {
      process.env.BW_CLEANEXIT = "true";
    });

    program.on("option:nointeraction", () => {
      process.env.EDUNEON_DC_NOINTERACTION = "true";
    });

    program.on("command:*", () => {
      writeLn(chalk.redBright("Invalid command: " + program.args.join(" ")), false, true);
      writeLn("See --help for a list of available commands.", true, true);
      process.exitCode = 1;
    });

    program.on("--help", () => {
      writeLn("\n  Examples:");
      writeLn("");
      writeLn("    eduneon-dc login");
      writeLn("    eduneon-dc test");
      writeLn("    eduneon-dc sync");
      writeLn("    eduneon-dc last-sync");
      writeLn("    eduneon-dc config server https://cockpit.example.com");
      writeLn("    eduneon-dc forget");
      writeLn("    eduneon-dc update");
      writeLn("", true);
    });

    program
      .command("login")
      .description(
        "Log in to Cockpit with an API token. It is read from EDUNEON_DC_API_TOKEN, or asked for.",
      )
      .action(async () => {
        await this.exitIfAuthed();
        const command = new LoginCommand(this.main.authService, this.stateService);
        const response = await command.run();
        this.processResponse(response);
      });

    program
      .command("logout")
      .description("Log out, and remove the directory's password or key as well.")
      .on("--help", () => {
        writeLn("\n  Examples:");
        writeLn("");
        writeLn("    eduneon-dc logout");
        writeLn("", true);
      })
      .action(async () => {
        await this.exitIfNotAuthed();
        const command = new LogoutCommand(this.main.authService, this.main.stateService);
        const response = await command.run();
        this.processResponse(response);
      });

    program
      .command("forget")
      .description(
        "Delete the API token and the directory passwords and keys this data folder keeps in the keychain.",
      )
      .option("--yes", "Delete without asking first.")
      .on("--help", () => {
        writeLn("\n  Notes:");
        writeLn("");
        writeLn("    The settings (data.json) are kept; it logs out too. Other data folders");
        writeLn("    (EDUNEON_DC_APPDATA_DIR) have entries of their own and keep them.");
        writeLn("");
        writeLn("  Examples:");
        writeLn("");
        writeLn("    eduneon-dc forget");
        writeLn("    eduneon-dc forget --yes");
        writeLn("", true);
      })
      .action(async (options: OptionValues) => {
        const command = new ForgetCommand(this.main.stateService, this.secretsLocation());
        const response = await command.run(options);
        this.processResponse(response);
      });

    program
      .command("test")
      .description(
        "Read the directory as a sync would and show what it would upload. Sends nothing.",
      )
      .on("--help", () => {
        writeLn("\n  Needs no login: use it to check the directory settings first.");
        writeLn("");
        writeLn("  Examples:");
        writeLn("");
        writeLn("    eduneon-dc test");
        writeLn("", true);
      })
      .action(async (options: OptionValues) => {
        const command = new TestCommand(this.main.syncService, this.main.i18nService);
        const response = await command.run(options);
        this.processResponse(response);
      });

    program
      .command("sync")
      .description("Sync the directory.")
      .on("--help", () => {
        writeLn("\n  Examples:");
        writeLn("");
        writeLn("    eduneon-dc sync");
        writeLn("", true);
      })
      .action(async () => {
        await this.exitIfNotAuthed();
        const command = new SyncCommand(this.main.syncService, this.main.i18nService);
        const response = await command.run();
        this.processResponse(response);
      });

    program
      .command("last-sync <object>")
      .description("Get the last successful sync date.")
      .on("--help", () => {
        writeLn("\n  Notes:");
        writeLn("");
        writeLn("    Returns empty response if no sync has been performed for the given object.");
        writeLn("");
        writeLn("  Examples:");
        writeLn("");
        writeLn("    eduneon-dc last-sync groups");
        writeLn("    eduneon-dc last-sync users");
        writeLn("", true);
      })
      .action(async (object: string) => {
        await this.exitIfNotAuthed();
        const command = new LastSyncCommand(this.main.stateService);
        const response = await command.run(object);
        this.processResponse(response);
      });

    program
      .command("config <setting> [value]")
      .description("Configure settings.")
      .option("--secretenv <variable-name>", "Read secret from the named environment variable.")
      .option("--secretfile <filename>", "Read secret from first line of the named file.")
      .on("--help", () => {
        writeLn("\n  Commands:");
        writeLn("");
        writeLn("    show                  Show the settings (secrets only as set / not set).");
        writeLn("    export [file]         Write all settings except secrets as JSON.");
        writeLn(
          "    import <file>         Read settings written by export (secrets are set separately).",
        );
        writeLn("    server <url>          The Cockpit address, e.g. https://app.eduneon.com.");
        writeLn("    directory <type>      ldap, entra, gsuite, okta or onelogin.");
        writeLn(
          "    gsuite.keyfile <file> A Google service account's JSON key (e-mail and private key).",
        );
        writeLn("\n  Settings:");
        writeLn("");
        for (const [name, definition] of Object.entries(SETTINGS)) {
          const secret = definition.kind === "secret" ? " (secret)" : "";
          writeLn(`    ${name.padEnd(36)}${definition.help}${secret}`);
        }
        writeLn("");
        writeLn(
          "  A secret can come from --secretenv <variable> or --secretfile <file> instead of the",
        );
        writeLn("  command line, so it does not end up in the shell history.");
        writeLn("");
        writeLn("  Examples:");
        writeLn("");
        writeLn("    eduneon-dc config server https://app.eduneon.com");
        writeLn("    eduneon-dc config directory ldap");
        writeLn("    eduneon-dc config ldap.hostname dc01.school.local");
        writeLn("    eduneon-dc config ldap.port 636");
        writeLn("    eduneon-dc config ldap.ssl true");
        writeLn('    eduneon-dc config ldap.rootPath "dc=school,dc=local"');
        writeLn('    eduneon-dc config ldap.username "cn=sync,cn=users,dc=school,dc=local"');
        writeLn("    eduneon-dc config ldap.password --secretenv LDAP_PASSWORD");
        writeLn("    eduneon-dc config show");
        writeLn("", true);
      })
      .action(async (setting: string, value: string, options: OptionValues) => {
        const command = new ConfigCommand(
          this.main.i18nService,
          this.main.stateService,
          this.main.environmentService,
          configFileLock(this.main.dataFilePath),
        );
        const response = await command.run(setting, value, options);
        this.processResponse(response);
      });

    program
      .command("data-file")
      .description("Path to data.json database file.")
      .on("--help", () => {
        writeLn("\n  Examples:");
        writeLn("");
        writeLn("    eduneon-dc data-file");
        writeLn("", true);
      })
      .action(() => {
        this.processResponse(
          Response.success(new StringResponse(path.join(this.main.dataFilePath, "data.json"))),
        );
      });

    program
      .command("clear-cache")
      .description("Clear the sync cache.")
      .on("--help", () => {
        writeLn("\n  Examples:");
        writeLn("");
        writeLn("    eduneon-dc clear-cache");
        writeLn("", true);
      })
      .action(async (options: OptionValues) => {
        const command = new ClearCacheCommand(this.main.i18nService, this.main.stateService);
        const response = await command.run(options);
        this.processResponse(response);
      });

    program
      .command("update")
      .description("Check for updates.")
      .on("--help", () => {
        writeLn("\n  Notes:");
        writeLn("");
        writeLn("    Returns the URL to download the newest version of this CLI tool.");
        writeLn("");
        writeLn("    Use the `--raw` option to return only the download URL for the update.");
        writeLn("");
        writeLn("  Examples:");
        writeLn("");
        writeLn("    eduneon-dc update");
        writeLn("    eduneon-dc update --raw");
        writeLn("", true);
      })
      .action(async () => {
        const command = new UpdateCommand(
          this.main.platformUtilsService,
          this.main.i18nService,
          "eduneon-directory-connector",
          "eduneon-dc",
          false,
        );
        const response = await command.run();
        this.processResponse(response);
      });

    program.parse(process.argv);

    if (process.argv.slice(2).length === 0) {
      program.outputHelp();
    }
  }

  async exitIfAuthed() {
    const authed = await this.stateService.getIsAuthenticated();
    if (authed) {
      const id = await this.stateService.getEntityId();
      this.processResponse(
        Response.error(`You are already logged in (directory "${id}"). Run logout first.`),
        true,
      );
    }
  }

  async exitIfNotAuthed() {
    const authed = await this.stateService.getIsAuthenticated();
    if (!authed) {
      let message = "You are not logged in.";
      if (!this.main.plaintextSecrets && this.main.secureStorageServiceName !== APPLICATION_NAME) {
        // Before, every data folder shared the default folder's token: one set up that way logs in
        // again for its own.
        message +=
          ` The data folder ${this.main.dataFilePath} keeps its own token and directory password` +
          " in the keychain: log in, and set the password, for this folder.";
      }
      this.processResponse(Response.error(message), true);
    }
  }

  /** Where the secrets of this data folder are kept, for the answers of `forget`. */
  private secretsLocation(): string {
    const folder = this.main.dataFilePath;
    return this.main.plaintextSecrets
      ? `the settings file in ${folder}`
      : `the keychain entries "${this.main.secureStorageServiceName}" (data folder ${folder})`;
  }
}
