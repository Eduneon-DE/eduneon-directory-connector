import { ApiService as ApiServiceAbstraction } from "@/libs/abstractions/api.service";
import { AppIdService } from "@/libs/abstractions/appId.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { StateService } from "@/libs/abstractions/state.service";
import { TokenService } from "@/libs/abstractions/token.service";
import {
  ConnectorStatusResponse,
  DirectorySyncRequest,
  DirectorySyncResponse,
} from "@/libs/models/cockpit";
import { ErrorResponse } from "@/libs/models/response/errorResponse";
import { Utils } from "@/libs/utils/utils";

/** Cockpit's 401 codes for a login that must name (or named a wrong) organization. */
const ORGANIZATION_CODES = ["ORGANIZATION_SELECTION_REQUIRED", "INVALID_ORGANIZATION_SELECTION"];

/**
 * Talks to Cockpit. Every request carries the Cockpit API token of a service account as
 * `X-API-Key`; there is no session or token exchange.
 */
export class ApiService implements ApiServiceAbstraction {
  constructor(
    // Kept so the constructor matches the desktop and CLI subclasses; tokens are not refreshed.
    _tokenService: TokenService,
    private platformUtilsService: PlatformUtilsService,
    private stateService: StateService,
    _appIdService: AppIdService,
    private logoutCallback: (expired: boolean) => Promise<void>,
    private customUserAgent: string = null,
  ) {}

  getConnectorStatus(
    apiToken?: string,
    directoryId?: number,
    organizationId?: number,
  ): Promise<ConnectorStatusResponse> {
    const query = directoryId ? `?providerId=${directoryId}` : "";
    return this.send(
      "GET",
      "/v1/directory-connector/status" + query,
      null,
      apiToken,
      organizationId,
    );
  }

  postDirectorySync(request: DirectorySyncRequest): Promise<DirectorySyncResponse> {
    return this.send("POST", "/v1/directory-connector/sync", request);
  }

  protected nativeFetch(request: Request): Promise<Response> {
    return fetch(request);
  }

  private async send<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    apiToken?: string,
    organizationId?: number,
  ): Promise<T> {
    const apiUrl = await this.stateService.getApiUrl();
    const requestUrl = apiUrl + path;
    if (new URL(requestUrl).href !== requestUrl) {
      throw new Error("Invalid request url path.");
    }

    // An explicit token is a login attempt: a rejection then means "wrong token", not "log out".
    const loggingIn = apiToken != null;
    const token = apiToken ?? (await this.stateService.getAccessToken());
    if (Utils.isNullOrWhitespace(token)) {
      throw new Error("Not logged in to Cockpit.");
    }

    const headers = new Headers({
      Accept: "application/json",
      "X-API-Key": token,
      "Eduneon-Client-Name": this.platformUtilsService.getClientType(),
      "Eduneon-Client-Version": await this.platformUtilsService.getApplicationVersion(),
    });
    // A login with accounts in several organizations must name the one to act in.
    const orgId = loggingIn ? organizationId : await this.stateService.getCockpitOrganizationId();
    if (orgId != null) {
      headers.set("X-Organization-ID", String(orgId));
    }
    if (this.customUserAgent != null) {
      headers.set("User-Agent", this.customUserAgent);
    }
    if (method === "GET") {
      headers.set("Cache-Control", "no-store");
    }
    if (body != null) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }

    let response: Response;
    try {
      response = await this.nativeFetch(
        new Request(requestUrl, {
          method,
          headers,
          cache: "no-store",
          body: body == null ? undefined : JSON.stringify(body),
        }),
      );
    } catch (e) {
      throw new Error(
        `Could not reach Cockpit at ${apiUrl}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const json = this.isJsonResponse(response)
      ? await response.json().catch((): null => null)
      : null;
    if (response.ok) {
      return json as T;
    }

    // A token that is still valid but needs an organization chosen is no reason to log out.
    const needsOrganization = response.status === 401 && ORGANIZATION_CODES.includes(json?.code);
    if (response.status === 401 && !loggingIn && !needsOrganization) {
      try {
        await this.logoutCallback(true);
      } catch {
        // The re-login message below matters more than a failed token cleanup, which the logout
        // logs itself.
      }
    }
    throw new ErrorResponse(this.errorBody(json, response, loggingIn), response.status);
  }

  /** Cockpit answers `{ statusCode, message }`, where message may be a list of validation errors. */
  private errorBody(json: any, response: Response, loggingIn: boolean): { message: string } {
    if (response.status === 401 && json?.code === "ORGANIZATION_SELECTION_REQUIRED") {
      const choices = Array.isArray(json.accounts)
        ? json.accounts
            .map((a: { organizationId?: number; organizationName?: string }) =>
              a.organizationName
                ? `${a.organizationId} (${a.organizationName})`
                : `${a.organizationId}`,
            )
            .join(", ")
        : "";
      return {
        message:
          "This account belongs to several organizations: choose one and log in again with its organization ID" +
          (choices ? `: ${choices}.` : "."),
      };
    }
    if (response.status === 401 && json?.code === "INVALID_ORGANIZATION_SELECTION") {
      return {
        message:
          "This account has no active access to the chosen organization. Log in again with another organization ID.",
      };
    }
    if (response.status === 401) {
      return {
        message: loggingIn
          ? "Cockpit did not accept this API token. Check that it is copied completely and has not expired."
          : "Cockpit no longer accepts the API token. Log in again with a new token.",
      };
    }
    if (response.status === 403) {
      return {
        message:
          "The API token's account is not allowed to manage directories in Cockpit. Give the service account a role that can edit identity providers.",
      };
    }
    const message = json?.message ?? json?.Message;
    if (Array.isArray(message)) {
      return { message: message.join("\n") };
    }
    if (typeof message === "string" && message.length > 0) {
      return { message };
    }
    return { message: `Cockpit answered ${response.status} ${response.statusText}`.trim() };
  }

  private isJsonResponse(response: Response): boolean {
    const typeHeader = response.headers.get("content-type");
    return typeHeader != null && typeHeader.indexOf("application/json") > -1;
  }
}
