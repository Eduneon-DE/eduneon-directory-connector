import {
  ConnectorStatusResponse,
  DirectorySyncRequest,
  DirectorySyncResponse,
} from "@/libs/models/cockpit";

export abstract class ApiService {
  /** Checks a Cockpit API token; uses the stored token when none is given. */
  getConnectorStatus: (apiToken?: string, directoryId?: number) => Promise<ConnectorStatusResponse>;
  postDirectorySync: (request: DirectorySyncRequest) => Promise<DirectorySyncResponse>;
}
