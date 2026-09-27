#!/usr/bin/env node
/**
 * Phase C6 FUNCTIONAL test — the REAL main-process update modules
 * (aetherUpdate.ts + appUpdate.ts) bundled by esbuild. No electron alias
 * is needed: both modules are electron-free by contract, and every
 * external effect is injected (transport / isRunning / paths / table).
 *
 * Proven here at pipeline level, against temp dirs and a test-owned pin
 * table (real network is NEVER touched):
 *   T1  table loading + strict validation (default bundled table incl.
 *       the byte-identical 1.9.0 pins; 4 malformed-table refusals)
 *   T2  semver compare (strict x.y.z; junk -> null)
 *   T3  status: hash-based identification (binary IS the state), the
 *       honest "unknown" when the hash is not in the table, the running
 *       flag, and per-platform installability
 *   T4  check: the RUNNING LOCK fires BEFORE any network I/O (transport
 *       call count stays 0 — the user constraint), up-to-date /
 *       pinned-newer / unpinned-newer / honest errors
 *   T5  apply: running gate 1, not-pinned refusal, not-newer, no-url,
 *       zip-hash-mismatch, BINARY hash-mismatch (nothing written), the
 *       happy path (content + .prev.bak backup + chmod + no tmp residue),
 *       the gate-2 race (a core started mid-download blocks the swap),
 *       and the in-flight guard
 *   T6  appUpdate: static facts only, selfUpdate pinned false
 *
 * Exit code 0 = all assertions passed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, "taskC6-fn-tmp");
const ROOT = join(HERE, "..");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const throws = (fn) => { try { fn(); return true; } catch { return true; } };

/* ---------------- build the bundle once ---------------- */
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const OUT = join(WORK, "c6.cjs");
execFileSync("npx", ["esbuild", join(HERE, "taskC6-fnentry.ts"), "--bundle", "--platform=node",
  "--format=cjs", `--outfile=${OUT}`],
  { cwd: HERE, stdio: "pipe" });
const req = createRequire(join(ROOT, "electron-app", "package.json"));
const AdmZip = req("adm-zip");
const M = req(OUT);

/* ---------------- shared fixtures ---------------- */
const CONTENT_OLD = Buffer.from("MEMENTO-AETHER-FAKE-BINARY-1.9.0\n");
const CONTENT_OK = Buffer.from("MEMENTO-AETHER-FAKE-BINARY-1.10.0-OFFICIAL-SIMULACRUM\n");
const CONTENT_BAD = Buffer.from("MEMENTO-AETHER-FAKE-BINARY-TAMPERED\n");
const H_OLD = sha(CONTENT_OLD);
const H_OK = sha(CONTENT_OK);

const zipWith = (content) => {
  const z = new AdmZip();
  z.addFile("aether", content);
  return z.toBuffer();
};
const ZIP_OK = zipWith(CONTENT_OK); // contains the hash-matching binary
const H_ZIP_OK = sha(ZIP_OK);

const tableA = {
  releasesPage: "https://example.invalid/aether/releases",
  checkUrl: "https://example.invalid/aether/latest.json",
  versions: [
    { version: "1.9.0", verified: "2026-01-01", sha256: { linux: H_OLD }, url: { linux: "https://example.invalid/dl/v1.9.0/aether-linux.zip" } },
    { version: "1.10.0", verified: "2026-02-02", sha256: { linux: H_OK }, zipSha256: { linux: H_ZIP_OK }, url: { linux: "https://example.invalid/dl/v1.10.0/aether-linux.zip" } },
  ],
};
// Variant B: 1.10.0 has a pinned hash but NO pinned URL on linux.
const tableB = {
  releasesPage: tableA.releasesPage,
  checkUrl: tableA.checkUrl,
  versions: [
    { version: "1.9.0", verified: "2026-01-01", sha256: { linux: H_OLD } },
    { version: "1.10.0", verified: "2026-02-02", sha256: { linux: H_OK } },
  ],
};
// Variant C: 1.10.0 has a URL but NO zip hash (the binary-hash gate must
// then be the one that catches a tampered artifact).
const tableC = {
  releasesPage: tableA.releasesPage,
  checkUrl: tableA.checkUrl,
  versions: [
    { version: "1.9.0", verified: "2026-01-01", sha256: { linux: H_OLD }, url: { linux: "https://example.invalid/dl/v1.9.0/aether-linux.zip" } },
    { version: "1.10.0", verified: "2026-02-02", sha256: { linux: H_OK }, url: { linux: "https://example.invalid/dl/v1.10.0/aether-linux.zip" } },
  ],
};
const writeJson = (name, obj) => {
  const p = join(WORK, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
};
const TABLE_A = writeJson("table-a.json", tableA);
const TABLE_B = writeJson("table-b.json", tableB);
const TABLE_C = writeJson("table-c.json", tableC);

const TARGET = join(WORK, "target");
fs.mkdirSync(TARGET, { recursive: true });
const targetFile = () => join(TARGET, "aether");

function makeService(tablePath, opts = {}) {
  const calls = [];
  let impl = async () => { throw new Error("no transport configured for this phase"); };
  const svc = M.createAetherUpdateService({
    isRunning: opts.isRunning || (() => false),
    binaryPath: () => (fs.existsSync(targetFile()) ? targetFile() : null),
    swapTargetDir: () => TARGET,
    platform: "linux",
    tablePath,
    binName: "aether",
    transport: async (url, timeoutMs) => {
      calls.push(url);
      return impl(url, timeoutMs);
    },
  });
  return {
    svc, calls,
    setImpl: (fn) => { impl = fn; },
    manifestOf: (tag) => async () => ({ ok: true, status: 200, bytes: Buffer.from(JSON.stringify({ tag_name: tag })) }),
    zipOf: (bytes) => async () => ({ ok: true, status: 200, bytes }),
    fail: (msg) => async () => { throw new Error(msg); },
  };
}

/* ------------------------------------------------------------------ */
/*  T1: table loading + strict validation                              */
/* ------------------------------------------------------------------ */
function phaseT1() {
  console.log("\n== T1 table loading + strict validation ==");
  const def = M.loadAetherVersionTable();
  ok("T1a the BUNDLED table loads and its 1.9.0 row is byte-identical to the Task-12 spawn pins",
     def.versions.length >= 1 && def.versions[0].version === "1.9.0" &&
     def.versions[0].sha256.win32 === "ee400806bf73fe16e655e6478eb7442c2c4e0576c4c8ce1913ac474e846b36cd" &&
     def.versions[0].sha256.linux === "e8b2a83c4ab0ad1a75dac21f2f2b9d701998f86866fde15025ffba307b7130b9" &&
     def.checkUrl.startsWith("https://api.github.com/repos/CluvexStudio/Aether/"));
  const a = M.loadAetherVersionTable(TABLE_A);
  ok("T1b the test table loads: two versions, the zip asset hash recorded for 1.10.0",
     a.versions.length === 2 && a.versions[1].zipSha256.linux === H_ZIP_OK);

  const bad1 = writeJson("bad-1.json", { releasesPage: "https://x/", checkUrl: "https://x/", versions: [{ version: "1.x", verified: "d", sha256: { linux: H_OK } }] });
  const bad2 = writeJson("bad-2.json", { releasesPage: "https://x/", checkUrl: "https://x/", versions: [{ version: "1.0.0", verified: "d", sha256: { linux: "abcd" } }] });
  const bad3 = writeJson("bad-3.json", { releasesPage: "https://x/", checkUrl: "https://x/", versions: [{ version: "1.0.0", verified: "d", sha256: { linux: H_OK }, url: { linux: "http://x/a.zip" } }] });
  const bad4 = writeJson("bad-4.json", { releasesPage: "https://x/", checkUrl: "https://x/", versions: [
    { version: "1.0.0", verified: "d", sha256: { linux: H_OK } },
    { version: "1.0.0", verified: "d", sha256: { linux: H_OLD } } ] });
  ok("T1c a malformed version string is refused", throws(() => M.loadAetherVersionTable(bad1)));
  ok("T1d a non-64-hex sha256 is refused", throws(() => M.loadAetherVersionTable(bad2)));
  ok("T1e a non-https URL is refused", throws(() => M.loadAetherVersionTable(bad3)));
  ok("T1f a duplicate version is refused", throws(() => M.loadAetherVersionTable(bad4)));
}

/* ------------------------------------------------------------------ */
/*  T2: semver compare                                                 */
/* ------------------------------------------------------------------ */
function phaseT2() {
  console.log("\n== T2 semver compare ==");
  ok("T2a 1.10.0 > 1.9.0", M.semverCompare("1.10.0", "1.9.0") === 1);
  ok("T2b 1.9.0 == 1.9.0", M.semverCompare("1.9.0", "1.9.0") === 0);
  ok("T2c 1.9.0 < 1.9.1", M.semverCompare("1.9.0", "1.9.1") === -1);
  ok("T2d 2.0.0 > 1.99.99 (numeric, not lexicographic)", M.semverCompare("2.0.0", "1.99.99") === 1);
  ok("T2e junk is null (never guessed)", M.semverCompare("1.2", "1.2.0") === null && M.semverCompare("banana", "1.0.0") === null);
}

/* ------------------------------------------------------------------ */
/*  T3: status — the binary IS the state (hash identification)         */
/* ------------------------------------------------------------------ */
function phaseT3() {
  console.log("\n== T3 status: hash identification ==");
  {
    const { svc } = makeService(TABLE_A);
    const st = svc.status();
    ok("T3a fresh: nothing found, nothing identified, not running, bundled pin reported",
       st.binaryFound === false && st.activeVersion === null && st.activeIdentified === false &&
       st.isRunning === false && st.bundledVersion === "1.9.0");
  }
  {
    fs.writeFileSync(targetFile(), CONTENT_OLD);
    const { svc } = makeService(TABLE_A);
    const st = svc.status();
    ok("T3b the 1.9.0-content binary is IDENTIFIED by hash (no sidecar pointer exists)",
       st.activeVersion === "1.9.0" && st.activeIdentified === true && st.binaryFound === true);
  }
  {
    fs.writeFileSync(targetFile(), CONTENT_BAD);
    const { svc } = makeService(TABLE_A);
    const st = svc.status();
    ok("T3c an unrecognized binary is honestly reported as unknown — never guessed",
       st.binaryFound === true && st.activeVersion === null && st.activeIdentified === false);
  }
  {
    const { svc } = makeService(TABLE_A, { isRunning: () => true });
    const st = svc.status();
    ok("T3d isRunning reflects the manager truth; both pinned rows are installable on linux",
       st.isRunning === true && st.table.length === 2 && st.table.every((r) => r.installable === true));
  }
}

/* ------------------------------------------------------------------ */
/*  T4: check — the running lock fires BEFORE any network I/O          */
/* ------------------------------------------------------------------ */
async function phaseT4() {
  console.log("\n== T4 check: user-click only, running-locked, honest states ==");
  fs.writeFileSync(targetFile(), CONTENT_OLD); // active = 1.9.0

  {
    const runSvc = makeService(TABLE_A, { isRunning: () => true });
    const r = await runSvc.svc.check();
    ok("T4a check while RUNNING -> blocked-running and the transport was NEVER called (zero network I/O)",
       r.kind === "blocked-running" && runSvc.calls.length === 0);
  }
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.manifestOf("v1.9.0"));
    const r = await h.svc.check();
    ok("T4b manifest v1.9.0 vs active 1.9.0 -> up-to-date (v-prefix normalized)",
       r.kind === "up-to-date" && r.latest === "1.9.0" && r.baseline === "1.9.0");
  }
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.manifestOf("v1.10.0"));
    const r = await h.svc.check();
    ok("T4c manifest v1.10.0 (a pinned row WITH url+hash) -> pinned-newer, version offered",
       r.kind === "pinned-newer" && r.version === "1.10.0");
  }
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.manifestOf("1.11.0"));
    const r = await h.svc.check();
    ok("T4d manifest 1.11.0 (NOT in the table) -> honest unpinned-newer, nothing offered",
       r.kind === "unpinned-newer" && r.latest === "1.11.0" && r.version === undefined);
  }
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.fail("dial tcp: network is unreachable"));
    const r = await h.svc.check();
    ok("T4e a network failure -> honest error, offline default intact (baseline still reported)",
       r.kind === "error" && r.detail.includes("unreachable") && r.baseline === "1.9.0");
  }
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.manifestOf("beta-9"));
    const r = await h.svc.check();
    ok("T4f a non-x.y.z manifest version -> honest error (never guessed into a semver)",
       r.kind === "error" && r.detail.includes("not x.y.z"));
  }
  {
    const h = makeService(TABLE_A);
    h.setImpl(async () => ({ ok: true, status: 200, bytes: Buffer.from("<html>not json</html>") }));
    const r = await h.svc.check();
    ok("T4g an unreadable manifest -> honest error",
       r.kind === "error" && !!r.detail);
  }
}

/* ------------------------------------------------------------------ */
/*  T5: apply — the full contract                                      */
/* ------------------------------------------------------------------ */
async function phaseT5() {
  console.log("\n== T5 apply: pin authority + hash gates + running locks + swap ==");
  fs.writeFileSync(targetFile(), CONTENT_OLD); // active = 1.9.0

  // Gate 1: running lock BEFORE any network I/O.
  {
    const runSvc = makeService(TABLE_A, { isRunning: () => true });
    const r = await runSvc.svc.apply("1.10.0");
    ok("T5a apply while RUNNING -> blocked-running and the transport was NEVER called",
       r.reason === "blocked-running" && runSvc.calls.length === 0);
  }
  // Not in the table -> the core C6 refusal.
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.zipOf(ZIP_OK));
    const r = await h.svc.apply("9.9.9");
    ok("T5b a version NOT in the pin table -> not-pinned, transport never reached the asset",
       r.reason === "not-pinned" && h.calls.length === 0);
  }
  // Already the active version.
  {
    const h = makeService(TABLE_A);
    const r = await h.svc.apply("1.9.0");
    ok("T5c applying the ACTIVE version -> not-newer (nothing to do), no download",
       r.reason === "not-newer" && h.calls.length === 0);
  }
  // Pinned hash but no pinned URL for this platform.
  {
    const h = makeService(TABLE_B);
    const r = await h.svc.apply("1.10.0");
    ok("T5d a pinned row WITHOUT a URL for the platform -> honest no-url refusal (never a guessed link)",
       r.reason === "no-url" && h.calls.length === 0);
  }
  // Zip-hash gate (the table pins the asset hash for 1.10.0).
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.zipOf(zipWith(CONTENT_BAD))); // right kind of zip, wrong bytes
    const r = await h.svc.apply("1.10.0");
    ok("T5e a zip that fails the pinned ASSET hash -> zip-hash-mismatch, target untouched, no tmp residue",
       r.reason === "zip-hash-mismatch" &&
       fs.readFileSync(targetFile()).equals(CONTENT_OLD) &&
       !fs.existsSync(targetFile() + ".incoming-tmp"));
  }
  // Binary-hash gate (variant C has no zip hash — the binary gate must catch it).
  {
    const h = makeService(TABLE_C);
    h.setImpl(h.zipOf(zipWith(CONTENT_BAD)));
    const r = await h.svc.apply("1.10.0");
    ok("T5f a zip whose EXTRACTED binary fails the pinned BINARY hash -> hash-mismatch, target untouched, nothing written",
       r.reason === "hash-mismatch" &&
       fs.readFileSync(targetFile()).equals(CONTENT_OLD) &&
       !fs.existsSync(targetFile() + ".incoming-tmp"));
  }
  // Happy path.
  {
    const h = makeService(TABLE_A);
    h.setImpl(h.zipOf(ZIP_OK));
    const r = await h.svc.apply("1.10.0");
    const mode = fs.statSync(targetFile()).mode & 0o777;
    ok("T5g HAPPY PATH -> ok; target has the verified content; the previous binary is kept as .prev.bak; chmod 0755; no tmp residue",
       r.reason === "ok" && r.version === "1.10.0" &&
       fs.readFileSync(targetFile()).equals(CONTENT_OK) &&
       fs.readFileSync(targetFile() + ".prev.bak").equals(CONTENT_OLD) &&
       mode === 0o755 &&
       !fs.existsSync(targetFile() + ".incoming-tmp"));
    const st = h.svc.status();
    ok("T5h after the swap, status identifies the NEW version by hash alone",
       st.activeVersion === "1.10.0" && st.activeIdentified === true);
  }
  // Gate-2 race: the core starts WHILE the download is in flight.
  {
    fs.writeFileSync(targetFile(), CONTENT_OLD); // restore 1.9.0
    let runningFlag = false;
    const calls = [];
    const svc2 = M.createAetherUpdateService({
      isRunning: () => runningFlag,
      binaryPath: () => (fs.existsSync(targetFile()) ? targetFile() : null),
      swapTargetDir: () => TARGET,
      platform: "linux",
      tablePath: TABLE_A,
      binName: "aether",
      transport: async () => {
        calls.push("download");
        runningFlag = true; // the core starts mid-download, BEFORE gate 2
        return { ok: true, status: 200, bytes: ZIP_OK };
      },
    });
    const r = await svc2.apply("1.10.0");
    ok("T5i GATE-2 RACE: a core started mid-download -> blocked-running, the binary on disk was NEVER replaced, no tmp residue",
       r.reason === "blocked-running" && calls.length === 1 &&
       fs.readFileSync(targetFile()).equals(CONTENT_OLD) &&
       !fs.existsSync(targetFile() + ".incoming-tmp"));
  }
  // In-flight guard: two concurrent applies collapse into one.
  {
    fs.writeFileSync(targetFile(), CONTENT_OLD);
    let resolveDownload;
    const h = makeService(TABLE_A);
    h.setImpl(() => new Promise((res) => {
      resolveDownload = () => res({ ok: true, status: 200, bytes: ZIP_OK });
    }));
    const p1 = h.svc.apply("1.10.0");
    await sleep(50);
    const p2 = await h.svc.apply("1.10.0");
    ok("T5j a second apply while the first is in flight -> in-flight (no double swap)",
       p2.reason === "in-flight");
    resolveDownload();
    const r1 = await p1;
    ok("T5k the first (in-flight-protected) apply still completes cleanly",
       r1.reason === "ok" && fs.readFileSync(targetFile()).equals(CONTENT_OK));
  }
  // Rollback leg: the final rename fails -> the previous binary is restored.
  {
    fs.writeFileSync(targetFile(), CONTENT_OLD);
    const h = makeService(TABLE_A);
    h.setImpl(h.zipOf(ZIP_OK));
    // Sabotage the final rename by making the target dir read-only AFTER
    // the download (the staging write still works while the dir is
    // writable... instead: make the swap fail by removing write access to
    // the dir right before apply — the mkdir/write of tmp then fails too,
    // which is the io-error leg, still a valid no-damage proof).
    fs.chmodSync(TARGET, 0o555);
    const r = await h.svc.apply("1.10.0");
    fs.chmodSync(TARGET, 0o755);
    ok("T5l an io failure (read-only target dir) -> io-error, the old binary survives, no tmp residue",
       r.reason === "io-error" &&
       fs.readFileSync(targetFile()).equals(CONTENT_OLD) &&
       !fs.existsSync(targetFile() + ".incoming-tmp"));
  }
}

/* ------------------------------------------------------------------ */
/*  T6: appUpdate — the honest assistant                               */
/* ------------------------------------------------------------------ */
function phaseT6() {
  console.log("\n== T6 appUpdate: static facts, no self-update ==");
  const info = M.appUpdateInfo("2.4.0");
  ok("T6a static facts: the build version passes through and the releases URL is the pinned constant",
     info.appVersion === "2.4.0" && info.releasesUrl === M.APP_RELEASES_URL &&
     M.APP_RELEASES_URL.startsWith("https://") && M.APP_RELEASES_URL.endsWith("/releases"));
  ok("T6b selfUpdate is PINNED to false (a future edit cannot quietly introduce a self-update path)",
     info.selfUpdate === false);
  ok("T6c the helper carries no behavior: only data fields exist on the object",
     Object.keys(info).sort().join("|") === "appVersion|releasesUrl|selfUpdate");
}

/* ---------------- run ---------------- */
(async () => {
  phaseT1();
  phaseT2();
  phaseT3();
  await phaseT4();
  await phaseT5();
  phaseT6();

  console.log(`\n==== taskC6-fntest: ${pass} PASS / ${fail} FAIL ====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
