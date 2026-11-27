// End-to-end test of an INSTALLED eduneon-dc, the way an admin sets up a server from a terminal:
// configure the directory, test it, log in to Cockpit with an API token, sync, and check what Cockpit
// received. A test LDAP and a test Cockpit run in this process, so it works on any machine, CI included.
//
//   node test/e2e/e2e.mjs <path to eduneon-dc>
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ldap from "ldapjs";

const CLI = process.argv[2];
if (!CLI) {
  console.error("Usage: node e2e.mjs <path to eduneon-dc>");
  process.exit(2);
}

const TOKEN = "e2e-token";
const LDAP_PORT = 1389;
const COCKPIT_PORT = 3099;
const BASE = "dc=school,dc=test";

// --- test directory: 1 school, 2 groups, 5 people (one with a password hash that must never leave) ---
const entries = [
  {
    dn: BASE,
    attributes: {
      objectclass: ["top", "dcObject", "organization"],
      dc: "school",
      o: "Test School",
    },
  },
  { dn: `ou=people,${BASE}`, attributes: { objectclass: ["organizationalUnit"], ou: "people" } },
  ...["anna", "ben", "clara", "david", "emma"].map((uid, i) => ({
    dn: `uid=${uid},ou=people,${BASE}`,
    attributes: {
      objectclass: ["top", "person", "organizationalPerson", "inetOrgPerson"],
      uid,
      cn: uid,
      sn: uid,
      mail: `${uid}@school.test`,
      entryuuid: `00000000-0000-4000-8000-00000000000${i}`,
      userpassword: "{SSHA}must-never-be-uploaded",
    },
  })),
  ...["teachers", "class-5a"].map((cn) => ({
    dn: `cn=${cn},${BASE}`,
    attributes: {
      objectclass: ["top", "groupOfNames"],
      cn,
      member: [`uid=anna,ou=people,${BASE}`],
    },
  })),
];

const directory = ldap.createServer();
directory.bind(BASE, (req, res, next) => {
  if (req.dn.toString() !== `cn=admin,${BASE}` || req.credentials !== "secret") {
    return next(new ldap.InvalidCredentialsError());
  }
  res.end();
  return next();
});
directory.bind("", (req, res, next) => {
  res.end();
  return next();
});
const search = (req, res, next) => {
  const base = req.dn.toString().toLowerCase();
  for (const entry of entries) {
    const dn = entry.dn.toLowerCase();
    if ((dn === base || dn.endsWith(`,${base}`)) && req.filter.matches(entry.attributes, false)) {
      res.send({ dn: entry.dn, attributes: entry.attributes });
    }
  }
  res.end();
  return next();
};
directory.search(BASE, search);
directory.search("", (req, res, next) => {
  res.end();
  return next();
});

// --- test Cockpit: the two endpoints the connector uses ---
const received = { parts: 0, entries: [] };
const cockpit = http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers["x-api-key"] !== TOKEN) {
    return reply(401, { message: "Unauthorized" });
  }
  const provider = { id: 7, name: "E2E directory" };
  if (req.method === "GET" && req.url.startsWith("/api/v1/directory-connector/status")) {
    return reply(200, {
      provider,
      syncStatus: "ok",
      lastSyncAt: null,
      setupComplete: true,
      lastUpload: null,
    });
  }
  if (req.method === "POST" && req.url.startsWith("/api/v1/directory-connector/sync")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const upload = JSON.parse(body);
      received.parts += 1;
      received.entries.push(...upload.entries);
      const done = upload.part === (upload.parts ?? 1) - 1;
      reply(200, {
        provider,
        status: done ? "synced" : "receiving",
        uploadId: upload.uploadId ?? "u",
        dryRun: false,
        received: received.entries.length,
        mappings: done
          ? [
              {
                targetModel: "AuthenticationAccount",
                total: 5,
                created: 5,
                updated: 0,
                skipped: 0,
                errors: 0,
                conflicts: 0,
                deprovisioned: 0,
              },
            ]
          : [],
        issues: [],
      });
    });
    return undefined;
  }
  return reply(404, { message: "Not found" });
});

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

const env = {
  ...process.env,
  EDUNEON_DC_APPDATA_DIR: mkdtempSync(join(tmpdir(), "eduneon-dc-e2e-")),
  EDUNEON_DC_NOINTERACTION: "true",
  EDUNEON_DC_PLAINTEXT_SECRETS: "true",
  LDAP_PASSWORD: "secret",
};
// Asynchronous on purpose: the test LDAP and the test Cockpit answer from this same process, which a
// blocking spawnSync would freeze.
const dc = (...args) =>
  new Promise((resolve) => {
    const child = spawn(CLI, args, { env: { ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 120000);
    child.on("close", (code) => {
      clearTimeout(timer);
      out = out.trim();
      console.log(`$ eduneon-dc ${args.join(" ")}\n${out.replace(/^/gm, "  ")}`);
      resolve({ code, out });
    });
  });

await new Promise((resolve) => directory.listen(LDAP_PORT, "127.0.0.1", resolve));
await new Promise((resolve) => cockpit.listen(COCKPIT_PORT, "127.0.0.1", resolve));
try {
  check(
    /\d{4}\.\d+\.\d+/.test((await dc("--version")).out),
    "the CLI starts and reports its version",
  );
  for (const [key, value] of [
    ["server", `http://127.0.0.1:${COCKPIT_PORT}`],
    ["directory", "ldap"],
    ["ldap.hostname", "127.0.0.1"],
    ["ldap.port", String(LDAP_PORT)],
    ["ldap.ssl", "false"],
    ["ldap.ad", "false"],
    ["ldap.pagedSearch", "false"],
    ["ldap.rootPath", BASE],
    ["ldap.username", `cn=admin,${BASE}`],
  ]) {
    check((await dc("config", key, value)).code === 0, `config ${key}`);
  }
  check(
    (await dc("config", "ldap.password", "--secretenv", "LDAP_PASSWORD")).code === 0,
    "config ldap.password from an environment variable",
  );
  check((await dc("config", "ldap.port", "abc")).code !== 0, "a wrong value is refused");
  const shown = (await dc("config", "show")).out;
  check(
    shown.includes("ldap.password: (set)") && !shown.includes("secret"),
    "config show hides the password",
  );
  const tested = await dc("test");
  check(
    // The base entry is read and sent, but not counted: it is not part of the directory below it.
    tested.code === 0 && /Read 8 entries/.test(tested.out),
    "test reads the whole directory without a login",
  );
  check(received.parts === 0, "test sends nothing");
  check((await dc("sync")).code !== 0, "sync is refused before login");
  const login = await dc("login");
  check(login.code !== 0, "login without a token is refused");
  env.EDUNEON_DC_API_TOKEN = TOKEN;
  check((await dc("login")).code === 0, "login with the API token");
  const synced = await dc("sync");
  check(
    synced.code === 0 && /5 created/.test(synced.out),
    "sync uploads and reports Cockpit's result",
  );
  check(
    received.entries.length === 9,
    `Cockpit received all 9 entries (got ${received.entries.length})`,
  );
  const leaked = received.entries.some((e) =>
    Object.keys(e.attributes).some((a) => /password/i.test(a)),
  );
  check(!leaked, "no password attribute was uploaded");
  check(
    (await dc("config", "sync.userfilter", "(uid=alice)")).code !== 0,
    "an LDAP user filter is refused: an LDAP sync sends everything under the base DN",
  );
  check((await dc("logout")).code === 0, "logout");
  check(
    (await dc("config", "show")).out.includes("ldap.password: (not set)"),
    "logout removes the bind password too",
  );
  check((await dc("forget")).code !== 0, "forget without a terminal asks for --yes");
  check((await dc("forget", "--yes")).code === 0, "forget --yes deletes the secrets");
} finally {
  directory.close();
  cockpit.close();
}

console.log(
  failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed.`,
);
process.exit(failures.length === 0 ? 0 : 1);
