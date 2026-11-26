export abstract class AuthService {
  logIn: (credentials: {
    apiToken: string;
    directoryId?: number;
    organizationId?: number;
  }) => Promise<void>;
  logOut: (callback: () => void) => void;
}
