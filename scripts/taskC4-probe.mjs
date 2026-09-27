#!/usr/bin/env node
/**
 * taskC4-probe.mjs — Phase C4 schema probes against the REAL pinned cores.
 *
 * B4 NOTE (2026-09-20, design-time artifact status): this probe was the
 * C4 DESIGN-TIME gate — it validated the config shapes BEFORE the C4
 * generator code was written, and it is NOT part of any official
 * battery (nothing in the C5/B-era suites reads it). Re-run against the
 * PINNED sing-box 1.14.0, its S4 negative expectation ("sing-box check
 * rejects a urltest referencing a missing outbound") does NOT hold:
 * `sing-box check` ACCEPTS such a config (exit 0) — dangling urltest
 * members surface at RUNTIME, not at check time. No migration code
 * ever relied on S4 holding (the C4 generator ships its own live
 * gates, taskC4-cfgtest against the real cores). The executable
 * semantics below stay byte-identical ON PURPOSE: the probe remains
 * the historical record of the C4 design-time assumptions, so running
 * it today exits 1 on S4 by design. If a future core pin bump changes
 * check-time validation, revisit THIS note — never a silent
 * expectation flip.
 *
 * BEFORE any generator code is written, every new config shape C4 will emit
 * is validated here (the established C3 discipline):
 *   Xray 25.1.1  `xray run -test -config <file>` (exit 0 = accepted):
 *     P1  balancer (random)   selector ["proxy"] + catch-all balancerTag rule
 *     P2  balancer roundRobin
 *     P3  balancer leastPing  + burstObservatory
 *     P4  balancer leastLoad  + burstObservatory
 *     P5  chain: proxy vless sockopt.dialerProxy -> "chain-hop" (socks outbound)
 *     P6  chain 3-deep: chain-hop itself dialerProxy -> freedom fragment dialer
 *     P7  chain + balancer combined (2 members both dialing through chain-hop)
 *     P8  NEGATIVE: unknown strategy must be REJECTED (proves the parser is
 *         strict, i.e. our P1-P4 passes are meaningful)
 *   sing-box 1.14.0 `sing-box check -c <file>`:
 *     S1  hysteria2 detour -> "chain-hop" (second hysteria2 outbound)
 *     S2  urltest group "balancer" + route.final = "balancer"
 *     S3  chain + urltest combined
 *     S4  NEGATIVE: urltest referencing a missing outbound must be REJECTED
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const XRAY = "/home/z/my-project/scripts/task11-validate/xray-bin/xray";
const SB = "/home/z/my-project/scripts/task11-validate/sing-box-1.14.0-linux-amd64/sing-box";
const TMP = "/home/z/my-project/memento-src/scripts/taskC4-probe-tmp";
fs.mkdirSync(TMP, { recursive: true });

const uuid = "0e0e6b3d-9f5a-4a17-8d3e-1c2b3a4d5e6f";

// Minimal valid Xray outbounds (ss + vless shapes reused from C3 probes).
const xVless = (tag, extra = {}) => ({
  tag, protocol: "vless",
  settings: { vnext: [{ address: "127.0.0.1", port: 443, users: [{ id: uuid, encryption: "none" }] }] },
  streamSettings: { network: "tcp", security: "none" },
  ...extra,
});
const xSS = (tag) => ({
  tag, protocol: "shadowsocks",
  settings: { servers: [{ address: "127.0.0.1", port: 8388, method: "aes-256-gcm", password: "x" }] },
  streamSettings: { network: "tcp" },
});
const xSocks = (tag) => ({
  tag, protocol: "socks",
  settings: { servers: [{ address: "127.0.0.1", port: 1080 }] },
});

function xrayBase(rules, outbounds, extraRoot = {}) {
  return {
    log: { access: "", error: "", loglevel: "warning" },
    inbounds: [{
      tag: "socks-in", port: 10808, listen: "127.0.0.1", protocol: "socks",
      sniffing: { enabled: true, destOverride: ["http", "tls"] },
      settings: { auth: "noauth", udp: true },
    }],
    outbounds,
    routing: { domainStrategy: "AsIs", rules },
    ...extraRoot,
  };
}

const balancerRule = [{ type: "field", network: "tcp,udp", balancerTag: "balancer" }];
const balancers = (strategy) => [{
  tag: "balancer",
  selector: ["proxy"],
  strategy: { type: strategy },
}];

const xrayCases = {
  P1_balancer_random: xrayBase(balancerRule, [xVless("proxy"), xSS("proxy2"), { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" }], { routingAppend: null, balancers: balancers("random") }),
  P2_balancer_roundRobin: xrayBase(balancerRule, [xVless("proxy"), xSS("proxy2"), { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" }], { balancers: balancers("roundRobin") }),
  P3_balancer_leastPing_burstObs: xrayBase(balancerRule, [xVless("proxy"), xSS("proxy2"), { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" }], {
    balancers: balancers("leastPing"),
    burstObservatory: {
      subjectSelector: ["proxy"],
      pingConfig: { destination: "https://generate_204", connectivity: "https://www.google.com/generate_204", interval: "60s", sampling: 2, timeout: "5s" },
    },
  }),
  P4_balancer_leastLoad_burstObs: xrayBase(balancerRule, [xVless("proxy"), xSS("proxy2"), { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" }], {
    balancers: balancers("leastLoad"),
    burstObservatory: {
      subjectSelector: ["proxy"],
      pingConfig: { destination: "https://generate_204", connectivity: "https://www.google.com/generate_204", interval: "60s", sampling: 2, timeout: "5s" },
    },
  }),
  P5_chain_simple: xrayBase([], [
    xVless("proxy", { streamSettings: { network: "tcp", security: "none", sockopt: { dialerProxy: "chain-hop" } } }),
    xSocks("chain-hop"),
    { protocol: "freedom", tag: "direct" },
    { protocol: "blackhole", tag: "blocked" },
  ]),
  P6_chain_three_deep_frag: xrayBase([], [
    xVless("proxy", { streamSettings: { network: "tcp", security: "none", sockopt: { dialerProxy: "chain-hop" } } }),
    xSocks("chain-hop"),
    {
      tag: "memento-frag-dialer", protocol: "freedom",
      settings: { domainStrategy: "AsIs", fragment: { packets: "tlshello", length: "100-200", interval: "10-20" } },
    },
    { protocol: "freedom", tag: "direct" },
    { protocol: "blackhole", tag: "blocked" },
  ]),
  P7_chain_plus_balancer: xrayBase(balancerRule, [
    xVless("proxy", { streamSettings: { network: "tcp", security: "none", sockopt: { dialerProxy: "chain-hop" } } }),
    xSS("proxy2"),
    xSocks("chain-hop"),
    { protocol: "freedom", tag: "direct" },
    { protocol: "blackhole", tag: "blocked" },
  ], { balancers: balancers("random") }),
  P8_NEG_unknown_strategy: xrayBase(balancerRule, [xVless("proxy"), xSS("proxy2"), { protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "blocked" }], { balancers: balancers("leastLoadFoo") }),
};

// Wait — balancers must live INSIDE routing, not at root. Fix the two shapes:
for (const [k, cfg] of Object.entries(xrayCases)) {
  if (cfg.balancers) {
    cfg.routing.balancers = cfg.balancers;
    delete cfg.balancers;
  }
  if (cfg.routingAppend === null) delete cfg.routingAppend;
}

// sing-box cases
const sbHysteria = (tag, extra = {}) => ({
  type: "hysteria2", tag, server: "127.0.0.1", server_port: 443,
  password: "pw", tls: { enabled: true, server_name: "h2.local", insecure: true },
  ...extra,
});
const sbBase = (outbounds, route) => ({
  log: { level: "warn" },
  inbounds: [
    { type: "socks", tag: "socks-in", listen: "127.0.0.1", listen_port: 10808 },
    { type: "http", tag: "http-in", listen: "127.0.0.1", listen_port: 10809 },
  ],
  outbounds,
  route,
});

const singboxCases = {
  S1_chain_detour: sbBase(
    [sbHysteria("proxy", { detour: "chain-hop" }), sbHysteria("chain-hop")],
    { final: "proxy" },
  ),
  S2_urltest_group: sbBase(
    [sbHysteria("proxy"), sbHysteria("proxy2"), { type: "urltest", tag: "balancer", outbounds: ["proxy", "proxy2"], url: "https://www.gstatic.com/generate_204", interval: "3m" }],
    { final: "balancer" },
  ),
  S3_chain_plus_urltest: sbBase(
    [sbHysteria("proxy", { detour: "chain-hop" }), sbHysteria("proxy2", { detour: "chain-hop" }), sbHysteria("chain-hop"), { type: "urltest", tag: "balancer", outbounds: ["proxy", "proxy2"], url: "https://www.gstatic.com/generate_204", interval: "3m" }],
    { final: "balancer" },
  ),
  S4_NEG_missing_member: sbBase(
    [sbHysteria("proxy"), { type: "urltest", tag: "balancer", outbounds: ["proxy", "ghost"], url: "https://www.gstatic.com/generate_204", interval: "3m" }],
    { final: "balancer" },
  ),
};

let pass = 0, fail = 0;
function probeXray(name, cfg, expectOk) {
  const f = path.join(TMP, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
  let out = "";
  try {
    out = execFileSync(XRAY, ["run", "-test", "-config", f], { encoding: "utf8", timeout: 30000 });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "") + String(e.message || "");
  }
  const ok = out.includes("Configuration OK") || /started|OK/i.test(out) && !/failed|error/i.test(out);
  const gotOk = ok && !/Failed to start|failed/i.test(out.split("\n").slice(-3).join(" "));
  const accepted = expectOk ? gotOk : !gotOk;
  if (accepted) { pass++; console.log(`PASS ${name} (expect ${expectOk ? "accept" : "reject"})`); }
  else { fail++; console.log(`FAIL ${name} (expect ${expectOk ? "accept" : "reject"})\n---\n${out.slice(0, 1200)}\n---`); }
}
function probeSB(name, cfg, expectOk) {
  const f = path.join(TMP, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
  let out = "";
  let code = 0;
  try {
    out = execFileSync(SB, ["check", "-c", f], { encoding: "utf8", timeout: 30000 });
  } catch (e) {
    code = e.status ?? 1;
    out = (e.stdout || "") + (e.stderr || "");
  }
  const accepted = code === 0;
  if (accepted === expectOk) { pass++; console.log(`PASS ${name} (expect ${expectOk ? "accept" : "reject"})`); }
  else { fail++; console.log(`FAIL ${name} (expect ${expectOk ? "accept" : "reject"})\n---\n${out.slice(0, 1200)}\n---`); }
}

console.log("=== Xray 25.1.1 ===");
for (const [name, cfg] of Object.entries(xrayCases)) probeXray(name, cfg, !name.includes("NEG"));
console.log("=== sing-box 1.14.0 ===");
for (const [name, cfg] of Object.entries(singboxCases)) probeSB(name, cfg, !name.includes("NEG"));
console.log(`\nPROBE RESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
