/**
 * UDP finalization probes:
 *  A) control — raw UDP DNS from this machine to 1.1.1.1:53 (proves payload validity)
 *  B) through remote relay BND 45.77.244.108 — DNS to 8.8.8.8:53 (second resolver)
 *  C) through remote relay — TCP CONNECT to 1.1.1.1:443 (control that remote data path is alive)
 */
import net from "node:net";
import dgram from "node:dgram";

const q = () => Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0,
  7, ...Buffer.from("example"), 3, ...Buffer.from("com"), 0, 0, 1, 0, 1]);

function rawUdpDns(server, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const u = dgram.createSocket("udp4");
    let bytes = 0;
    const t = setTimeout(() => { try { u.close(); } catch {} resolve({ bytes, dns: false }); }, timeoutMs);
    u.on("message", m => { bytes = m.length; clearTimeout(t); try { u.close(); } catch {} resolve({ bytes, dns: m.length > 12 && (m[2] & 0x80) !== 0 }); });
    u.send(payload, 53, server, e => { if (e) { clearTimeout(t); try { u.close(); } catch {} resolve({ bytes: 0, dns: false, err: e.message }); } });
  });
}

/** UDP ASSOCIATE via remote, then one datagram to dst. */
function remoteUdpRelay(dstIp, dstPort, payload) {
  return new Promise((resolve) => {
    const res = { assoc: null, bnd: null, sent: false, bytes: 0, dns: false };
    const tcp = net.connect({ host: "45.77.244.108", port: 1080, timeout: 8000 });
    const done = () => { try { tcp.destroy(); } catch {} resolve(res); };
    const t = setTimeout(done, 12000);
    let stage = 0, rbuf = Buffer.alloc(0);
    tcp.on("error", e => { res.err = e.message; clearTimeout(t); done(); });
    tcp.on("connect", () => tcp.write(Buffer.from([5, 1, 0])));
    tcp.on("data", d => {
      rbuf = Buffer.concat([rbuf, d]);
      if (stage === 0 && rbuf.length >= 2) { tcp.write(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0])); stage = 1; rbuf = rbuf.slice(2); return; }
      if (stage === 1 && rbuf.length >= 10) {
        res.assoc = rbuf[1];
        res.bnd = Array.from(rbuf.slice(4, 8)).join(".") + ":" + rbuf.readUInt16BE(8);
        rbuf = rbuf.slice(10);
        if (res.assoc !== 0) { clearTimeout(t); done(); return; }
        const ip = dstIp.split(".").map(Number);
        const dg = Buffer.concat([Buffer.from([0, 0, 0, 1, ...ip, (dstPort >> 8) & 255, dstPort & 255]), payload]);
        const udp = dgram.createSocket("udp4");
        udp.on("message", m => { res.bytes = m.length; res.dns = m.length > 12 && (m[2] & 0x80) !== 0 && (m[3] & 0x0f) === 0; try { udp.close(); } catch {} clearTimeout(t); done(); });
        udp.on("error", () => {});
        udp.send(dg, Number(res.bnd.split(":")[1]), res.bnd.split(":")[0], e => { if (e) res.err = "send:" + e.message; else res.sent = true; });
        stage = 2;
      }
    });
  });
}

const A = await rawUdpDns("1.1.1.1", q());
console.log("A) local UDP DNS 1.1.1.1:53 directly:", JSON.stringify(A));
const B = await remoteUdpRelay("8.8.8.8", 53, q());
console.log("B) remote relay UDP DNS 8.8.8.8:53:  ", JSON.stringify(B));
process.exit(0);
