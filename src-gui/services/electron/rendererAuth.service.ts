export class RendererAuthService {
  async logIn(credentials: { apiToken: string; directoryId?: number }): Promise<void> {
    return ipc.auth.logIn(credentials);
  }

  logOut(): Promise<void> {
    return ipc.auth.logOut();
  }
}
