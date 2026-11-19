import { Jsonify } from "type-fest";

import { UserEntry } from "@/libs/models/userEntry";

// These must match the ldap server seed data in directory.ldif
const data: Jsonify<UserEntry>[] = [
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Roland Dyke,ou=Human Resources,dc=example,dc=com",
    externalId: "cn=Roland Dyke,ou=Human Resources,dc=example,dc=com",
    email: "dyker@220af87272f04218bb8dd81d50fb19f5.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Charin Goulfine,ou=Human Resources,dc=example,dc=com",
    externalId: "cn=Charin Goulfine,ou=Human Resources,dc=example,dc=com",
    email: "goulfinc@5fa9a69302a9422abedbd51aa69f472b.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Margit Peters,ou=Product Testing,dc=example,dc=com",
    externalId: "cn=Margit Peters,ou=Product Testing,dc=example,dc=com",
    email: "petersm@909269ac94be4e5b9ff6809f52b1dda3.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Shiela Harada,ou=Peons,dc=example,dc=com",
    externalId: "cn=Shiela Harada,ou=Peons,dc=example,dc=com",
    email: "haradas@2782a7fada1240d682fc754affb31519.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Angelle Guarino,ou=Human Resources,dc=example,dc=com",
    externalId: "cn=Angelle Guarino,ou=Human Resources,dc=example,dc=com",
    email: "guarinoa@720ab4266da34c8e9ccf5ef3370b892b.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Shela Khoury,ou=Peons,dc=example,dc=com",
    externalId: "cn=Shela Khoury,ou=Peons,dc=example,dc=com",
    email: "khourys@4dc1a2d970bb4c23aef0d860b6018ed6.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Micaela Doud,ou=Janitorial,dc=example,dc=com",
    externalId: "cn=Micaela Doud,ou=Janitorial,dc=example,dc=com",
    email: "doudm@b2de0606c7904578b184a63046aa1a59.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Marthe Kenik,ou=Product Testing,dc=example,dc=com",
    externalId: "cn=Marthe Kenik,ou=Product Testing,dc=example,dc=com",
    email: "kenikm@5ce7099e829941498f32f6630dda9440.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Angus Merizzi,ou=Management,dc=example,dc=com",
    externalId: "cn=Angus Merizzi,ou=Management,dc=example,dc=com",
    email: "merizzia@7f1912f54e7a4efa8a33a6ba82fc7102.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Edmund Kardos,ou=Product Testing,dc=example,dc=com",
    externalId: "cn=Edmund Kardos,ou=Product Testing,dc=example,dc=com",
    email: "kardose@5f41ae90bad64d5e97b0ef849f0cfd8f.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Joyann Frucci,ou=Administrative,dc=example,dc=com",
    externalId: "cn=Joyann Frucci,ou=Administrative,dc=example,dc=com",
    email: "fruccij@55f85638346c4f81b665496e3fee8d10.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Painterson Miki,ou=Product Development,dc=example,dc=com",
    externalId: "cn=Painterson Miki,ou=Product Development,dc=example,dc=com",
    email: "mikip@2c4fec4ef77046e1b1e4b34fd50dd6a9.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Jammie De Los,ou=Peons,dc=example,dc=com",
    externalId: "cn=Jammie De Los,ou=Peons,dc=example,dc=com",
    email: "delosj@8575686b747a4c5ab6b0a7ac30503d95.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Virgina Pichocki,ou=Product Development,dc=example,dc=com",
    externalId: "cn=Virgina Pichocki,ou=Product Development,dc=example,dc=com",
    email: "pichockv@2b7d385172624c81935f26cfb5f852c0.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Steffen Carsten,ou=Product Development,dc=example,dc=com",
    externalId: "cn=Steffen Carsten,ou=Product Development,dc=example,dc=com",
    email: "carstens@c8b8d0d540194a31b14e399b8e0ac7ff.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Elna Drescher,ou=Administrative,dc=example,dc=com",
    externalId: "cn=Elna Drescher,ou=Administrative,dc=example,dc=com",
    email: "dreschee@4ab96258683b45799b4cb34e5e13e2ee.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Gwen Kardomateas,ou=Product Development,dc=example,dc=com",
    externalId: "cn=Gwen Kardomateas,ou=Product Development,dc=example,dc=com",
    email: "kardomag@7bc2a22aa7d345f1bef866ce890bec49.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Reeta Roldan,ou=Administrative,dc=example,dc=com",
    externalId: "cn=Reeta Roldan,ou=Administrative,dc=example,dc=com",
    email: "roldanr@108c2ffc1189457d80b27e9b862163f4.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Grissel Currer,ou=Management,dc=example,dc=com",
    externalId: "cn=Grissel Currer,ou=Management,dc=example,dc=com",
    email: "currerg@248d38bb7c664c8f9d2a64525819610e.example.com",
  },
  {
    disabled: false,
    deleted: false,
    referenceId: "cn=Loella Mak,ou=Payroll,dc=example,dc=com",
    externalId: "cn=Loella Mak,ou=Payroll,dc=example,dc=com",
    email: "makl@6ab3e25ca49d4d64aaf44844288a8ef7.example.com",
  },
];

export const userFixtures = data.map((v) => UserEntry.fromJSON(v));
