import * as program from "commander";

import { I18nService } from "@/libs/abstractions/i18n.service";
import { SyncService } from "@/libs/services/sync.service";

import { Response } from "@/src-cli/models/response";
import { StringResponse } from "@/src-cli/models/response/stringResponse";

/**
 * Reads the directory exactly as `sync` does and tells what would be uploaded, without sending
 * anything: the place to check the connection and the base DN before the first sync.
 */
export class TestCommand {
  constructor(
    private syncService: SyncService,
    private i18nService: I18nService,
  ) {}

  async run(_cmd: program.OptionValues): Promise<Response> {
    try {
      const preview = await this.syncService.preview();
      const lines = [
        `Read ${preview.total} entries${preview.baseDn ? ` under ${preview.baseDn}` : ""}. Nothing was sent.`,
        ...preview.byClass.map((c) => `  ${String(c.count).padStart(6)}  ${c.objectClass}`),
      ];
      if (preview.total === 0) {
        lines.push("A sync would send nothing: check the base DN and the bind user's rights.");
      }
      return Response.success(new StringResponse(lines.join("\n")));
    } catch (e) {
      return Response.error(e);
    }
  }
}
