// Phase D4 quickcheck entry: dump i18n key sets per language as JSON.
// Same harness as taskD3-entry.ts — the D4 quickcheck asserts the new
// set.*/tab.settings keys exist in ALL four languages with parity.
import { translations } from "../src/i18n";

const out: Record<string, string[]> = {};
for (const [lang, dict] of Object.entries(translations)) {
  out[lang] = Object.keys(dict).sort();
}
process.stdout.write(JSON.stringify({ langs: out }));
