import { CloudSnapshotBuilder, fromLdapEntry, fromObject, isSecretAttribute } from "./raw-entry";

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
