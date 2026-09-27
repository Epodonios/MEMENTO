/**
 * Task 13 self-test — runs BEFORE the formal smoke (which waits for user
 * approval). Tests the REAL parseSingleLink from src/store.ts and the REAL
 * fetchSubscription #-filter from src/utils/subscription.ts via esbuild
 * bundles. Exit code 0 = all pass.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseSingleLink } = require("./task13-store.cjs");
const { fetchSubscription } = require("./task13-sub.cjs");

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const b64url = (s) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

console.log("\n== A1 valid variants (5 approved + extras) ==");

// V1 — anonymous host:port
{
  const p = parseSingleLink("socks://1.2.3.4:1080");
  check("V1 anonymous", p.isValid && p.protocol === "socks" && p.address === "1.2.3.4" &&
    Number(p.port) === 1080 && p.username === "" && p.password === "" && p.core === "xray",
    JSON.stringify(p));
}
// V2 — plain creds, password contains ':', remark decoded
{
  const p = parseSingleLink("socks://user:pa:ss@1.2.3.4:1080#My%20Srv");
  check("V2 plain user:pass (first-colon split) + remark", p.isValid && p.address === "1.2.3.4" &&
    p.username === "user" && p.password === "pa:ss" && p.name === "My Srv", JSON.stringify(p));
}
// V3 — base64 userinfo (unpadded)
{
  const p = parseSingleLink(`socks://${b64("user:pass")}@1.2.3.4:1080`);
  check("V3 base64 userinfo (unpadded)", p.isValid && p.username === "user" && p.password === "pass",
    JSON.stringify(p));
}
// V3b — base64url userinfo (urlsafe, unpadded)
{
  const p = parseSingleLink(`socks://${b64url("u:p@ss")}@1.2.3.4:1080`);
  check("V3b base64url userinfo", p.isValid && p.username === "u" && p.password === "p@ss",
    JSON.stringify(p));
}
// V4 — "Og" = base64(":") = anonymous (user's sample shape)
{
  const p = parseSingleLink("socks://Og@45.77.244.108:1080");
  check("V4 Og userinfo = anonymous", p.isValid && p.address === "45.77.244.108" &&
    Number(p.port) === 1080 && p.username === "" && p.password === "", JSON.stringify(p));
}
// V5 — legacy whole-string base64
{
  const p = parseSingleLink(`socks://${b64("user:pass@1.2.3.4:1080")}`);
  check("V5 legacy whole-b64", p.isValid && p.address === "1.2.3.4" && Number(p.port) === 1080 &&
    p.username === "user" && p.password === "pass", JSON.stringify(p));
}
// V6 — socks5:// alias + query ignored + unicode remark
{
  const p = parseSingleLink(`socks5://user:pass@srv.example.com:8443?timeout=5#${encodeURIComponent("سرور")}`);
  check("V6 socks5 alias + query ignored + fa remark", p.isValid && p.protocol === "socks" &&
    p.address === "srv.example.com" && Number(p.port) === 8443 && p.name === "سرور", JSON.stringify(p));
}
// V7 — bracketed IPv6
{
  const p = parseSingleLink("socks://user:pass@[2001:db8::1]:1080");
  check("V7 bracketed IPv6", p.isValid && p.address === "2001:db8::1" && Number(p.port) === 1080,
    JSON.stringify(p));
}
// V8 — percent-encoded colon in plain userinfo (v2rayN URL-decode parity)
{
  const p = parseSingleLink("socks://user%3App@1.2.3.4:1080");
  check("V8 percent-decoded userinfo", p.isValid && p.username === "user" && p.password === "pp",
    JSON.stringify(p));
}

console.log("\n== A1 malformed inputs (user requirement: >=2-3, clear rejection) ==");

const bad = [
  ["M1 legacy b64 decodes to garbage (no user:pass@host:port)", `socks://${b64("not-a-valid-format")}`],
  ["M2 port out of range", "socks://user:pass@1.2.3.4:99999"],
  ["M3 empty host", "socks://:1080"],
  ["M4 non-numeric port", "socks://1.2.3.4:abc"],
  ["M5 unusable userinfo (decodes without ':')", "socks://zzz@1.2.3.4:1080"],
  ["M6 scheme only", "socks5://"],
  ["M7 missing port, not base64 either", "socks://1.2.3.4"],
  ["M8 legacy b64 creds without ':'", `socks://${b64("userpass@1.2.3.4:1080")}`],
  ["M9 port 0", "socks://1.2.3.4:0"],
  ["M10 legacy b64 with two '@'", `socks://${b64("a:b@1.2.3.4:1080@x")}`],
];
for (const [name, link] of bad) {
  let p;
  try { p = parseSingleLink(link); } catch (e) {
    check(name, false, "THREW: " + e.message); continue;
  }
  check(name, p.isValid === false && !!p.errorMessage,
    `unexpectedly valid or no error: ${JSON.stringify({ isValid: p.isValid, errorMessage: p.errorMessage, address: p.address, port: p.port })}`);
}

console.log("\n== Regression: other parsers untouched ==");

// vmess sample
{
  const vm = { v: "2", ps: "n", add: "9.9.9.9", port: "443", id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", net: "tcp", scy: "auto" };
  const p = parseSingleLink("vmess://" + b64(JSON.stringify(vm)));
  check("R1 vmess still parses", p.isValid && p.protocol === "vmess" && p.address === "9.9.9.9", JSON.stringify(p));
}
{
  const p = parseSingleLink("trojan://secrets@1.1.1.1:443?sni=x.com#T");
  check("R2 trojan still parses", p.isValid && p.protocol === "trojan" && p.address === "1.1.1.1" && p.password === "secrets", JSON.stringify(p));
}
{
  const p = parseSingleLink("ss://YWVzLTI1Ni1nY206cHc=@1.1.1.1:8388#S");
  check("R3 ss still parses", p.isValid && p.protocol === "ss" && p.address === "1.1.1.1" && p.password === "pw", JSON.stringify(p));
}
// a non-socks unknown scheme still reports "Unknown protocol"
{
  const p = parseSingleLink("ftp://1.2.3.4");
  check("R4 unknown scheme rejected as before", !p.isValid && String(p.errorMessage).startsWith("Unknown protocol"), JSON.stringify(p));
}

console.log("\n== A2 fetchSubscription '#'-header skip (REAL function, data: URL) ==");

const body = [
  "#profile-title: base64:8J+GkyBHaXRodWI=",
  "#profile-update-interval: 1",
  "#subscription-userinfo: upload=29; download=12;",
  "#support-url: https://example.com",
  "",
  "vless://3f2504e0-4f89-11d3-9a0c-0305e82c3301@1.2.3.4:443#n1",
  "socks://1.2.3.4:1080",
].join("\n");
const dataUrl = "data:text/plain;base64," + b64(body);
try {
  const lines = await fetchSubscription(dataUrl, 8000);
  check("B1 # lines skipped, links kept", lines.length === 2 &&
    lines[0].startsWith("vless://") && lines[1].startsWith("socks://"), JSON.stringify(lines));
} catch (e) {
  check("B1 # lines skipped, links kept", false, "fetch threw: " + e.message);
}
const b64body = b64(["#profile-title: x", "trojan://pw@5.5.5.5:443#t"].join("\n"));
try {
  const lines = await fetchSubscription("data:text/plain;base64," + b64body, 8000);
  check("B2 base64 body with # header also filtered", lines.length === 1 && lines[0].startsWith("trojan://"), JSON.stringify(lines));
} catch (e) {
  check("B2 base64 body with # header also filtered", false, "fetch threw: " + e.message);
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
