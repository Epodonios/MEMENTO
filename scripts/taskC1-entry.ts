// Phase C1 quickcheck entry: dump i18n key sets per language as JSON.
// Same harness as taskD4-entry.ts — the C1 quickcheck asserts the new
// builder.fragment* + connection.traffic* keys exist in ALL four languages
// with parity.
import { translations } from "../src/i18n";

const out: Record<string, string[]> = {};
for (const [lang, dict] of Object.entries(translations)) {
  out[lang] = Object.keys(dict).sort();
}
process.stdout.write(JSON.stringify({ langs: out }));
