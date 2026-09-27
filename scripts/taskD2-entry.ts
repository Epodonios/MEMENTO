// Phase D2 quickcheck entry: dump i18n key sets per language as JSON.
// NOTE: this import path is for the IN-TREE copy (memento-src/scripts — the
// canonical one the smoke runs). The historical outer copy at
// /home/z/my-project/scripts/taskD2-entry.ts keeps its own
// "../memento-src/src/i18n" path; do not blindly copy one over the other.
import { translations } from "../src/i18n";

const out: Record<string, string[]> = {};
for (const [lang, dict] of Object.entries(translations)) {
  out[lang] = Object.keys(dict).sort();
}
process.stdout.write(JSON.stringify({ langs: out }));
