export class RendererAuthService {
  async logIn(credentials: {
    apiToken: string;
    directoryId?: number;
    organizationId?: number;
  }): Promise<void> {
    return ipc.auth.logIn(credentials);
  }

  /** @param forgetSecrets also remove the directory secrets: a logout the user asked for. */
  logOut(forgetSecrets = false): Promise<void> {
    return ipc.auth.logOut(forgetSecrets);
  }
}
