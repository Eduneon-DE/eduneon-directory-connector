import * as fs from "fs";
import * as path from "path";

const messages: Record<string, { message: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "en", "messages.json"), "utf8"),
);

/** Every template under src-gui/app, by path. */
const templates = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return templates(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });

/** The keys a template reads through the i18n pipe: `{{ 'key' | i18n }}` or `"{{ "key" | i18n }}"`. */
const keysOf = (html: string): string[] =>
  [...html.matchAll(/['"]([A-Za-z0-9_]+)['"]\s*\|\s*i18n\b/g)].map((match) => match[1]);

describe("templates", () => {
  // A key missing from messages.json shows as nothing at all: a tooltip or label with no text.
  it("only read keys that messages.json has", () => {
    const missing = templates(path.join(__dirname, "..", "app")).flatMap((file) =>
      keysOf(fs.readFileSync(file, "utf8"))
        .filter((key) => messages[key]?.message === undefined)
        .map((key) => `${path.basename(file)}: ${key}`),
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  it("finds the keys of the show / hide buttons", () => {
    const settings = fs.readFileSync(
      path.join(__dirname, "..", "app", "tabs", "settings.component.html"),
      "utf8",
    );
    expect(keysOf(settings)).toContain("toggleVisibility");
  });
});
