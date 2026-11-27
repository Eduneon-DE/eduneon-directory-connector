import { ApiService } from "@/libs/abstractions/api.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { StateService } from "@/libs/abstractions/state.service";
import { Utils } from "@/libs/utils/utils";

/**
 * Logging in = checking a Cockpit API token against the server and remembering it. The token is
 * kept in the OS keychain; the directory it syncs into is remembered for display.
 */
export class AuthService {
  constructor(
    private apiService: ApiService,
    private messagingService: MessagingService,
    private stateService: StateService,
  ) {}

  /**
   * @param credentials.directoryId the Cockpit directory to sync into; needed only when the
   *   organization has more than one Directory Connector directory (Cockpit shows the id).
   * @param credentials.organizationId the Cockpit organization to act in; needed only when the token's
   *   login has accounts in several organizations (Cockpit then asks to choose).
   */
  async logIn(credentials: { apiToken: string; directoryId?: number; organizationId?: number }) {
    const apiToken = credentials.apiToken?.trim();
    if (Utils.isNullOrWhitespace(apiToken)) {
      throw new Error("An API token is required.");
    }
    const { directoryId } = credentials;
    if (directoryId != null && !(Number.isInteger(directoryId) && directoryId > 0)) {
      throw new Error("The directory ID is the number Cockpit shows for the directory.");
    }

    const { organizationId } = credentials;
    if (organizationId != null && !(Number.isInteger(organizationId) && organizationId > 0)) {
      throw new Error("The organization ID is the number Cockpit lists for the organization.");
    }

    const status = await this.apiService.getConnectorStatus(apiToken, directoryId, organizationId);
    // Checked before anything is saved: a half-saved login is worse than none.
    if (
      status?.provider == null ||
      !(Number.isInteger(status.provider.id) && status.provider.id > 0)
    ) {
      throw new Error(
        "This server is not Cockpit, or it did not name a directory. Check the server URL and log in again.",
      );
    }

    await this.stateService.setAccessToken(apiToken);
    await this.stateService.setCockpitOrganizationId(
      organizationId ?? status.organization?.id ?? null,
    );
    await this.stateService.setEntityId(status.provider.name);
    await this.stateService.setOrganizationId(String(status.provider.id));
  }

  logOut(callback: () => void) {
    callback();
    this.messagingService.send("loggedOut");
  }
}
