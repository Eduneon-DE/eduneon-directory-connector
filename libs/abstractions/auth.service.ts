export abstract class AuthService {
  logIn: (credentials: { apiToken: string; directoryId?: number }) => Promise<void>;
  logOut: (callback: () => void) => void;
}
