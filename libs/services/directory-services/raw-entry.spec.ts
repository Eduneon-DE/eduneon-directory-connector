import {
  CloudSnapshotBuilder,
  fromLdapEntry,
  fromObject,
  isSecretAttribute,
  MAX_VALUE_LENGTH,
  ReadLimits,
} from "./raw-entry";

describe("fromLdapEntry", () => {
  it("lowercases names, keeps multiple values, base64-encodes binary and drops secrets", () => {
    const entry = fromLdapEntry({
      dn: "cn=A,dc=x",
      objectClass: ["top", "person"],
      Mail: "a@x",
      objectGUID: Buffer.from([1, 2, 3]),
      userPassword: "{SSHA}secret",
      "unicodePwd;binary": Buffer.from("x"),
      description: "",
    });

    expect(entry).toEqual({
      dn: "cn=A,dc=x",
      attributes: {
        objectclass: ["top", "person"],
        mail: ["a@x"],
        objectguid: ["AQID"],
      },
    });
  });
});

describe("fromLdapEntry limits", () => {
  it("leaves out photos, certificates and other binary values, but keeps objectGUID and objectSid", () => {
    const limits: ReadLimits = { binaryDropped: 0, truncated: 0 };
    const entry = fromLdapEntry(
      {
        dn: "cn=A,dc=x",
        cn: "A",
        jpegPhoto: Buffer.alloc(30000, 0xff),
        thumbnailPhoto: [Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xd9])],
        "userCertificate;binary": Buffer.from([0x30, 0x82]),
        // Valid UTF-8 photos come back from ldapts as text; still left out by name.
        photo: "abc",
        someUnknownBlob: Buffer.from([0xc3, 0x28]),
        objectGUID: Buffer.from([1, 2, 3]),
        objectSid: Buffer.from([4, 5, 6]),
      },
      limits,
    );

    expect(entry.attributes).toEqual({
      cn: ["A"],
      objectguid: ["AQID"],
      objectsid: ["BAUG"],
    });
    // userCertificate is left out as a secret name (Cockpit strips it too), so it is not counted here.
    expect(limits).toEqual({ binaryDropped: 5, truncated: 0 });
  });

  it("cuts a text value longer than the limit and counts it", () => {
    const limits: ReadLimits = { binaryDropped: 0, truncated: 0 };
    const long = "a".repeat(MAX_VALUE_LENGTH + 10);
    const entry = fromLdapEntry({ dn: "cn=A,dc=x", description: [long, "short"] }, limits);

    expect(entry.attributes.description).toEqual(["a".repeat(MAX_VALUE_LENGTH), "short"]);
    expect(limits).toEqual({ binaryDropped: 0, truncated: 1 });
  });
});

describe("isSecretAttribute", () => {
  it("matches password and key attributes in any case or with options", () => {
    expect(isSecretAttribute("userPassword")).toBe(true);
    expect(isSecretAttribute("ms-Mcs-AdmPwd")).toBe(true);
    expect(isSecretAttribute("msLAPS-Password")).toBe(true);
    expect(isSecretAttribute("mail")).toBe(false);
  });
});

describe("fromObject", () => {
  it("flattens nested API objects into dotted attribute names", () => {
    const entry = fromObject("uid=1", ["user"], {
      id: "1",
      name: { givenName: "Ada", familyName: "Lovelace" },
      emails: [{ address: "a@x" }, { address: "b@x" }],
      suspended: false,
      password: "never",
    });

    expect(entry.attributes).toEqual({
      objectclass: ["user"],
      id: ["1"],
      "name.givenname": ["Ada"],
      "name.familyname": ["Lovelace"],
      "emails.address": ["a@x", "b@x"],
      suspended: ["false"],
    });
  });
});

describe("CloudSnapshotBuilder", () => {
  it("links users and groups both ways by DN", () => {
    const b = new CloudSnapshotBuilder("entra");
    b.addUser("u1", { id: "u1", mail: "a@x" });
    b.addGroup("g1", { id: "g1", displayName: "Teachers" }, ["u1"], ["g2"]);

    const { baseDn, entries } = b.build();

    expect(baseDn).toBe("");
    expect(entries).toEqual([
      {
        dn: "uid=u1,ou=users,o=entra",
        attributes: {
          objectclass: ["user"],
          id: ["u1"],
          mail: ["a@x"],
          memberof: ["cn=g1,ou=groups,o=entra"],
        },
      },
      {
        dn: "cn=g1,ou=groups,o=entra",
        attributes: {
          objectclass: ["group"],
          id: ["g1"],
          displayname: ["Teachers"],
          member: ["uid=u1,ou=users,o=entra", "cn=g2,ou=groups,o=entra"],
        },
      },
    ]);
  });
});

// conn-3: key material and hashes that the old list missed.
describe("isSecretAttribute, the names Cockpit strips", () => {
  it.each([
    "pKCS8PrivateKey;binary",
    "userPKCS12",
    "krbPwdHistory",
    "ipaNTHash",
    "ipatokenOTPkey",
    "msTPM-OwnerInformation",
    "krbMKey",
    "olcRootPW",
    "2.5.4.35",
    "OID.2.5.4.35;binary",
  ])("treats %s as secret", (name) => {
    expect(isSecretAttribute(name)).toBe(true);
  });

  it.each(["cn", "mail", "memberOf", "entryUUID", "objectGUID", "ms-DS-ConsistencyGuid"])(
    "keeps %s",
    (name) => {
      expect(isSecretAttribute(name)).toBe(false);
    },
  );

  it("sends no private key that the bind account can read", () => {
    const entry = fromLdapEntry({
      dn: "uid=bob,dc=x",
      cn: "Bob",
      userPKCS12: "FAKE-PKCS12",
      ipaNTHash: "FAKE-HASH",
      "2.5.4.35": "FAKE-PW",
    });
    expect(Object.keys(entry.attributes)).toEqual(["cn"]);
  });
});

// conn-5: values that are not text (photos, Latin-1 text) never arrive in Cockpit as base64 text.
describe("fromLdapEntry, values that are not text", () => {
  it("leaves out raw-byte values instead of sending them as base64 text", () => {
    const limits = { binaryDropped: 0, truncated: 0 };
    const entry = fromLdapEntry(
      {
        dn: "uid=a,dc=x",
        cn: "A",
        jpegPhoto: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        // ldapts gives raw bytes for every value of an attribute once one is not UTF-8.
        description: [Buffer.from("plain text"), Buffer.from([0x57, 0x65, 0x69, 0xdf])],
      },
      limits,
    );
    expect(entry.attributes).toEqual({ cn: ["A"] });
    expect(limits.binaryDropped).toBe(3);
  });
});

// conn-19: attribute names that are also names on Object.prototype.
describe("attributes named like Object.prototype members", () => {
  it.each(["constructor", "Constructor", "__proto__", "toString"])(
    "reads an LDAP attribute named %s",
    (name) => {
      const entry = fromLdapEntry({ dn: "cn=a,dc=x", cn: "a", [name]: "v" });
      expect(entry.attributes[name.toLowerCase()]).toEqual(["v"]);
      expect(JSON.parse(JSON.stringify(entry)).attributes[name.toLowerCase()]).toEqual(["v"]);
    },
  );

  it("reads a cloud object with a property named constructor", () => {
    const entry = fromObject("uid=a", ["user"], { constructor: "v" }, { constructor: ["w"] });
    expect(entry.attributes.constructor).toEqual(["v", "w"]);
  });
});

// conn-21: binary ids other than objectGUID.
describe("fromLdapEntry, binary ids", () => {
  it("sends ms-DS-ConsistencyGuid and GUID as base64, like objectGUID", () => {
    const guid = Buffer.from("F50\u0000\u0001ABCDEFGHIJK", "latin1");
    const entry = fromLdapEntry({
      dn: "cn=a,dc=x",
      "mS-DS-ConsistencyGuid": guid,
      GUID: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    });
    expect(entry.attributes["ms-ds-consistencyguid"]).toEqual([guid.toString("base64")]);
    expect(entry.attributes.guid).toEqual(["3q2+7w=="]);
  });
});
