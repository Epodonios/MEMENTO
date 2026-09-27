// Phase C2 quickcheck entry: dump i18n key sets per language as JSON.
// Same harness as taskC1-entry.ts — the C2 quickcheck asserts the new
// configs.urlTest*/pinger.urlTest/connection.urlTest*/set.testUrl* keys
// exist in ALL four languages with parity.
import { translations } from "../src/i18n";

const out: Record<string, string[]> = {};
for (const [lang, dict] of Object.entries(translations)) {
  out[lang] = Object.keys(dict).sort();
}
process.stdout.write(JSON.stringify({ langs: out }));
