// @vitest-environment node
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

// Runs the real script against a fake project: fake .env.local values, planted .next files.
const SCRIPT = join(__dirname, "../../scripts/check-client-bundle.sh");
let root: string;

function plant(path: string, contents: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
}

function check(): { exit: number; out: string } {
  try {
    const out = execFileSync(join(root, "scripts/check-client-bundle.sh"), { encoding: "utf8", stdio: "pipe" });
    return { exit: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { exit: e.status, out: e.stdout };
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bundle-check-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(SCRIPT, join(root, "scripts/check-client-bundle.sh"));
  plant(".env.local", 'GOOGLE_GEOCODING_KEY="AIzaFAKE123456"\nADMIN_PASSCODE=hunter22\n');
  plant(".next/static/chunks/app.js", "var a=1;");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("passes a clean build", () => {
  const { exit, out } = check();

  expect(exit).toBe(0);
  expect(out).toMatch(/^ok {5}GOOGLE_GEOCODING_KEY$/m);
  expect(out).toMatch(/^ok {5}GEMINI_API_KEY \(name only/m);
});

test("fails on a key value in the client chunks", () => {
  plant(".next/static/chunks/leak.js", 'x="AIzaFAKE123456"');

  const { exit, out } = check();

  expect(exit).toBe(1);
  expect(out).toContain("LEAK   GOOGLE_GEOCODING_KEY (value found");
  expect(out).not.toContain("AIzaFAKE123456");
});

test("fails on a key value in prerendered HTML", () => {
  plant(".next/server/app/admin/seed.html", "<p>hunter22</p>");

  const { exit, out } = check();

  expect(exit).toBe(1);
  expect(out).toContain("LEAK   ADMIN_PASSCODE (value found");
});

test("fails on a key name, even with no value to compare", () => {
  plant(".next/static/chunks/env.js", "process.env.GEMINI_API_KEY");

  const { exit, out } = check();

  expect(exit).toBe(1);
  expect(out).toContain("LEAK   GEMINI_API_KEY (name found");
});

test("ignores the build cache", () => {
  plant(".next/cache/webpack/x.pack", "hunter22 GEMINI_API_KEY");

  expect(check().exit).toBe(0);
});

test("errors when there is no build", () => {
  rmSync(join(root, ".next"), { recursive: true });

  expect(check().exit).toBe(1);
});
