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
   */
  async logIn(credentials: { apiToken: string; directoryId?: number }) {
    const apiToken = credentials.apiToken?.trim();
    if (Utils.isNullOrWhitespace(apiToken)) {
      throw new Error("An API token is required.");
    }
    const { directoryId } = credentials;
    if (directoryId != null && !(Number.isInteger(directoryId) && directoryId > 0)) {
      throw new Error("The directory ID is the number Cockpit shows for the directory.");
    }

    const status = await this.apiService.getConnectorStatus(apiToken, directoryId);

    await this.stateService.setAccessToken(apiToken);
    await this.stateService.setEntityId(status.provider.name);
    await this.stateService.setOrganizationId(String(status.provider.id));
  }

  logOut(callback: () => void) {
    callback();
    this.messagingService.send("loggedOut");
  }
}
