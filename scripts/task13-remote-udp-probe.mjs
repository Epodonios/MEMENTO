/**
 * Diagnostic: talk SOCKS5 UDP ASSOCIATE DIRECTLY to the remote sample server
 * 45.77.244.108:1080 (no local xray involved). Classifies the remote's UDP
 * policy: rep 0 = supported, 0x07 = command not supported, else refused.
 * This decides whether the smoke's 0-byte UDP reply is a remote policy
 * (expected/OK) or a defect in our generated outbound.
 */
import net from "node:net";
import dgram from "node:dgram";

const HOST = "45.77.244.108", PORT = 1080;

function rawSocks(cmd, dstHost, dstPort) {
  return new Promise((resolve) => {
    const res = { greeting: null, reply: null, bnd: null, data: null, error: null };
    const tcp = net.connect({ host: HOST, port: PORT, timeout: 8000 });
    const finish = () => { try { tcp.destroy(); } catch {} resolve(res); };
    const t = setTimeout(finish, 9000);
    let stage = 0, rbuf = Buffer.alloc(0);
    tcp.on("error", e => { res.error = e.message; clearTimeout(t); finish(); });
    tcp.on("timeout", () => { res.error = "idle timeout"; clearTimeout(t); finish(); });
    tcp.on("connect", () => tcp.write(Buffer.from([5, 1, 0])));
    tcp.on("data", d => {
      rbuf = Buffer.concat([rbuf, d]);
      if (stage === 0 && rbuf.length >= 2) {
        res.greeting = [rbuf[0], rbuf[1]];
        tcp.write(Buffer.from([5, cmd, 0, 1, ...(cmd === 3 ? [0, 0, 0, 0] : []), 0, 0]));
        stage = 1; rbuf = rbuf.slice(2);
        return;
      }
      if (stage === 1 && rbuf.length >= 10) {
        res.reply = rbuf[1];
        const atyp = rbuf[3];
        let off;
        if (atyp === 1) { res.bnd = Array.from(rbuf.slice(4, 8)).join(".") + ":" + rbuf.readUInt16BE(8); off = 10; }
        else if (atyp === 3) { const l = rbuf[4]; res.bnd = rbuf.slice(5, 5 + l).toString() + ":" + rbuf.readUInt16BE(5 + l); off = 5 + l + 2; }
        else { res.bnd = "(ipv6):" + rbuf.readUInt16BE(4 + 16); off = 4 + 16 + 2; }
        stage = 2; rbuf = rbuf.slice(off);
        if (cmd !== 3 || res.reply !== 0) { clearTimeout(t); finish(); return; }
        // send one DNS datagram for example.com A to 1.1.1.1:53
        const ip = [1, 1, 1, 1];
        const q = Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0,
          7, ...Buffer.from("example"), 3, ...Buffer.from("com"), 0, 0, 1, 0, 1]);
        const udp = dgram.createSocket("udp4");
        const [ba, bp] = res.bnd.split(":");
        const rAddr = ba === "0.0.0.0" ? HOST : ba, rPort = Number(bp);
        udp.on("message", m => { res.data = m.length; udp.close(); clearTimeout(t); finish(); });
        udp.on("error", () => {});
        udp.send(Buffer.concat([Buffer.from([0, 0, 0, 1, ...ip, 0, 53]), q]), rPort, rAddr, () => {});
        setTimeout(() => { try { udp.close(); } catch {} clearTimeout(t); finish(); }, 6000);
        stage = 3;
      }
    });
  });
}

console.log(`remote ${HOST}:${PORT} — TCP CONNECT probe (control):`);
const c = await rawSocks(1, "1.1.1.1", 80);
console.log("  ", JSON.stringify(c));

console.log(`remote ${HOST}:${PORT} — UDP ASSOCIATE probe:`);
const u = await rawSocks(3, "1.1.1.1", 53);
console.log("  ", JSON.stringify(u));

const code = u.reply === 0 ? 0 : 2;
if (u.reply === 0 && !u.data) console.log("  -> remote ACCEPTS UDP ASSOCIATE but returned no DNS answer (outbound UDP 53 likely blocked server-side)");
if (u.reply === 7) console.log("  -> remote REJECTS UDP ASSOCIATE (cmd not supported): server-side policy, local xray UDP path is correct");
if (u.reply === 0 && u.data) console.log("  -> remote FULLY supports UDP relay; local chain datagram loss needs investigation");
process.exit(code);
