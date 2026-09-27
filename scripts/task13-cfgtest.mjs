// Task 13 config-shape check — REAL generateV2RayConfig, socks ParsedConfig.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { generateV2RayConfig } = require("./task13-cfg.cjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log(`  FAIL  ${n}${d ? " — " + d : ""}`)); };

const base = { id: "x", protocol: "socks", name: "s", isValid: true };

// no-auth
{
  const cfg = generateV2RayConfig({ ...base, address: "1.2.3.4", port: 1080, username: "", password: "" });
  const ob = JSON.parse(cfg.json).outbounds[0];
  check("C1 no-auth outbound shape", ob.protocol === "socks" && ob.tag === "proxy" &&
    JSON.stringify(ob.settings) === JSON.stringify({ servers: [{ address: "1.2.3.4", port: 1080 }] }) &&
    ob.streamSettings === undefined, JSON.stringify(ob));
}
// with auth
{
  const cfg = generateV2RayConfig({ ...base, address: "45.77.244.108", port: 1080, username: "u", password: "p" });
  const ob = JSON.parse(cfg.json).outbounds[0];
  const srv = ob.settings.servers[0];
  check("C2 auth outbound: users[] present", ob.protocol === "socks" &&
    JSON.stringify(srv.users) === JSON.stringify([{ user: "u", pass: "p", level: 0 }]), JSON.stringify(ob));
  check("C3 no udp field on outbound (inbound-only flag)",
    !("udp" in ob.settings) && !("udp" in srv), JSON.stringify(Object.keys(ob.settings)));
}
// local inbound still udp:true
{
  const cfg = generateV2RayConfig({ ...base, address: "1.2.3.4", port: 1080 });
  const full = JSON.parse(cfg.json);
  const socksIn = full.inbounds.find(i => i.tag === "socks-in");
  check("C4 local socks-in keeps udp:true", socksIn.settings.udp === true, JSON.stringify(socksIn));
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
