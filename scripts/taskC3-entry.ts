// Phase C3 quickcheck entry: dump i18n key sets per language as JSON.
// Same harness as taskC2-entry.ts — the C3 quickcheck asserts the new
// rt.* keys + tab.routing exist in ALL four languages with parity.
import { translations } from "../src/i18n";

const out: Record<string, string[]> = {};
for (const [lang, dict] of Object.entries(translations)) {
  out[lang] = Object.keys(dict).sort();
}
process.stdout.write(JSON.stringify({ langs: out }));
