// Phase D3 quickcheck entry: dump i18n key sets per language as JSON.
// NOTE: path is for the IN-TREE copy (memento-src/scripts — canonical).
import { translations } from "../src/i18n";

const out: Record<string, string[]> = {};
for (const [lang, dict] of Object.entries(translations)) {
  out[lang] = Object.keys(dict).sort();
}
process.stdout.write(JSON.stringify({ langs: out }));
