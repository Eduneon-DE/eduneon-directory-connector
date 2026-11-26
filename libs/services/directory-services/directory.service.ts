import { DirectoryEntry } from "../../models/cockpit";
import { GroupEntry } from "../../models/groupEntry";
import { UserEntry } from "../../models/userEntry";

/** Everything the last full read returned, unmapped, for Cockpit to map. */
export interface DirectorySnapshot {
  /** Root the entries were read from (LDAP base DN); empty for cloud directories. */
  baseDn: string;
  entries: DirectoryEntry[];
  /** The directory's objectClass definitions (RFC 4512), when it publishes them (LDAP). */
  objectClasses?: string[];
}

export interface IDirectoryService {
  getEntries(force: boolean, test: boolean): Promise<[GroupEntry[], UserEntry[]]>;
  /**
   * The raw users and groups read by the last getEntries call, including users the
   * UserEntry list leaves out (for example accounts without an email address).
   */
  getSnapshot?(): DirectorySnapshot;
  /**
   * Read the whole directory for Cockpit, independent of the user/group settings (which only shape
   * the local preview). Cockpit decides there what to import; it needs every object type to offer.
   */
  readSnapshot?(): Promise<DirectorySnapshot>;
}
