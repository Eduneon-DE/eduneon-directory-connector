import { Observable, Subject } from "rxjs";

import { EnvironmentService } from "@/libs/abstractions/environment.service";
import { StateService } from "@/libs/abstractions/state.service";
import { DEFAULT_API_URL, DEFAULT_IDENTITY_URL, DEFAULT_SERVER_URL } from "@/libs/constants";
import { EnvironmentUrls } from "@/libs/models/domain/environmentUrls";

export class DefaultEnvironmentService implements EnvironmentService {
  private readonly urlsSubject = new Subject<EnvironmentUrls>();
  urls: Observable<EnvironmentUrls> = this.urlsSubject;

  private baseUrl: string;
  private webVaultUrl: string;
  private apiUrl: string;
  private identityUrl: string;

  /**
   * Callers must `await setUrlsFromStorage()` before issuing requests. Loading the URLs cannot
   * happen here: a constructor cannot await, so a fire-and-forget call left the getters
   * returning the cloud defaults until it settled, which silently sent logins for a custom
   * server to the default cloud.
   */
  constructor(private stateService: StateService) {}

  hasBaseUrl() {
    return this.baseUrl != null;
  }

  isCloud() {
    return this.getApiUrl() === DEFAULT_API_URL && this.getIdentityUrl() === DEFAULT_IDENTITY_URL;
  }

  getWebVaultUrl() {
    if (this.webVaultUrl != null) {
      return this.webVaultUrl;
    }

    if (this.baseUrl) {
      return this.baseUrl;
    }
    return DEFAULT_SERVER_URL;
  }

  getSendUrl() {
    return this.getWebVaultUrl() + "/#/send/";
  }

  getApiUrl() {
    if (this.apiUrl != null) {
      return this.apiUrl;
    }

    if (this.baseUrl) {
      return this.baseUrl + "/api";
    }

    return DEFAULT_API_URL;
  }

  getIdentityUrl() {
    if (this.identityUrl != null) {
      return this.identityUrl;
    }

    if (this.baseUrl) {
      return this.baseUrl + "/identity";
    }

    return DEFAULT_IDENTITY_URL;
  }

  async setUrlsFromStorage(): Promise<void> {
    const urls = await this.stateService.getEnvironmentUrls();
    if (urls == null) {
      return;
    }

    const envUrls = new EnvironmentUrls();

    this.baseUrl = envUrls.base = urls.base;
    this.webVaultUrl = urls.webVault;
    this.apiUrl = envUrls.api = urls.api;
    this.identityUrl = envUrls.identity = urls.identity;
  }

  async setUrls(urls: EnvironmentUrls): Promise<void> {
    // "https://cockpit.example.org/api" typed as the server: the API path is added here.
    urls.base = this.formatUrl(urls.base)?.replace(/\/api$/i, "") ?? null;
    urls.webVault = this.formatUrl(urls.webVault);
    urls.api = this.formatUrl(urls.api);
    urls.identity = this.formatUrl(urls.identity);

    await this.stateService.setEnvironmentUrls({
      base: urls.base,
      api: urls.api,
      identity: urls.identity,
      webVault: urls.webVault,
    });

    this.baseUrl = urls.base;
    this.webVaultUrl = urls.webVault;
    this.apiUrl = urls.api;
    this.identityUrl = urls.identity;

    this.urlsSubject.next(urls);
  }

  getUrls() {
    return {
      base: this.baseUrl,
      webVault: this.webVaultUrl,
      api: this.apiUrl,
      identity: this.identityUrl,
    };
  }

  private formatUrl(url: string): string {
    url = url?.trim();
    if (url == null || url === "") {
      return null;
    }

    url = url.replace(/\/+$/g, "");
    // "HTTP://host" is http://host, not https://HTTP://host.
    url = url.replace(/^(https?):\/\//i, (scheme) => scheme.toLowerCase());
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    return url;
  }
}
