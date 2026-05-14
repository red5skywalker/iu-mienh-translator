# Iu Mienh Translator — AI Agent Instructions

## Project Overview

This is an English → Iu Mienh (Iu Mien / Yao) translator web application. It uses a hybrid approach: dictionary lookup + parallel example retrieval + LLM generation with grammar rules to produce translations for a low-resource language with no existing machine translation support.

## Architecture

- **`index.html`** — Entire frontend (HTML + CSS + JS, single file ~1800 lines). Handles dictionary browsing, translation UI, LLM integration, and community corrections.
- **`server.mjs`** — Node.js HTTP server. Proxies LLM API calls (GitHub Models, OpenAI, Copilot), serves static files. Run with `npm start` (port 3456).
- **`dict-slim.json`** — Dictionary with 8,159 entries. Format: `{"english term": [{"m":"mienh translation","c":"context","f":"full sentence"}]}`. Pretty-printed, sorted alphabetically.
- **`examples.json`** — 4,528 parallel sentence pairs. Format: `[{"eng":"...","imn":"...","cat":"category"}]`. Categories: conversation, bible-psalms, bible-proverbs, bible-genesis, bible-matthew.
- **`grammar_rules_distilled.txt`** — 31 grammar rules distilled from a PhD thesis, used in the LLM system prompt.

## Key Data Files

| File | Entries | Purpose |
|------|---------|---------|
| `dict-slim.json` | 8,159 | Word/phrase → Mienh translation lookup |
| `examples.json` | 4,528 | Parallel text for few-shot LLM prompting |
| `grammar_rules_distilled.txt` | 31 rules | Grammar reference for LLM system prompt |

## How Translation Works

1. User enters English text
2. `findRelevantVocab()` looks up dictionary entries matching input words (with stemming)
3. `selectRelevantExamples()` picks top 15 parallel examples by word overlap score (non-bible examples get 2x boost)
4. `buildAIPrompt()` assembles: grammar rules + dictionary entries + relevant examples + user input
5. LLM generates translation, word-by-word breakdown, and grammar explanation
6. `validateTranslation()` checks output words against known Mienh vocabulary

## Utility Scripts

- **`merge-corrections.mjs`** — Fetches community corrections from Supabase, merges into dict-slim.json. Needs `SUPABASE_SERVICE_KEY` env var to delete merged rows.
- **`extract-bible.mjs`** — Extracts parallel verse pairs from Bible.com (Iu Mienh version 233 + NIV version 111). Configurable by book/chapter range.
- **`import-spreadsheet.mjs`** — Imports entries from xlsx spreadsheets with cleaning logic (removes Bible refs, English contamination, WT annotations).

## Iu Mienh Language Notes

### Orthography
- Roman-based script (Unified Script / IuMiNR)
- Tone marks are final consonants: c (tone 1), v (tone 2), no mark (tone 3), x (tone 4), no mark (tone 5), silent final stop (tone 6), z (tone 7), h (tone 8)
- Digraphs: mb, nd, nj, nq, nz, hn, ng, ny, aa (long vowel), etc.
- Hyphenated compounds are common: `tin-hungh` (God), `njien-yiouh` (happy)

### Key Grammar (summary)
- Topic-prominent language (Topic → Focus, not rigid SVO)
- Particle `nyei`: possession (X nyei Y), relative clauses (Clause nyei N), assertive (sentence-final)
- Aspect markers follow the verb: jienv (continuous), jiex (experiential), liuz (perfective), aqv (change of state)
- Negation: maiv/mv before verb
- Questions: statement + fai (yes/no), or interrogative words in situ (haaix dauh "who", hnangv haaix nor "how")
- Serial verb constructions: V1 V2 V3 without conjunctions
- Classifiers required with numbers: NUM + CLF + N (dauh=people, norm=things, diuh=long objects)
- See `grammar_rules_distilled.txt` for full 31-rule reference

### Common Pitfalls
- **Don't invent Mienh words.** If you don't know a word, leave it in English or flag it. The language has specific vocabulary that cannot be guessed.
- **Bible text bias.** The examples are ~85% Bible verses. Conversational translations need different register/vocabulary.
- **nyei is overloaded.** It's possessive, relative clause marker, AND sentence-final assertive. Context determines meaning.
- **zuoqv ≠ love.** It means faithfulness/loyalty. hnamv = love. Be careful with statistical word alignments.
- **Tone spelling matters.** `daic` (die) vs `daix` (kill) — one consonant changes meaning entirely.

## How to Improve the Translator

### Adding Dictionary Entries
Edit `dict-slim.json` directly. Format:
```json
"english term": [
  {
    "m": "mienh translation",
    "c": "context or usage note (optional)",
    "f": "full example sentence (optional)"
  }
]
```
Keep entries sorted alphabetically. Multiple definitions per term are supported as array items.

### Adding Parallel Examples
Add to `examples.json`:
```json
{"eng": "English sentence", "imn": "Iu Mienh translation", "cat": "category"}
```
Categories: `conversation`, `bible-psalms`, `bible-proverbs`, `bible-genesis`, `bible-matthew`, or any new category. Non-bible categories get boosted in example selection.

### Improving Grammar Rules
Edit `grammar_rules_distilled.txt`. These are injected into the LLM system prompt via the `GRAMMAR_RULES` constant in `index.html` (around line 1329). Keep rules concise and practical — they need to fit in a prompt alongside dictionary entries and examples.

The rules were distilled from "An Iu Mien Grammar" by Tatsuro Daniel Arisawa (PhD thesis, La Trobe University, 2016). The full PDF is at `/home/jpierce/projects/Iu_Mien_Grammar.pdf` (925 pages, not in repo).

### Extracting More Bible Text
Use `extract-bible.mjs`. Bible.com has the full Iu Mienh Bible (version 233, IuMiNR script). English NIV is version 111. Currently extracted: Psalms 1-150, Proverbs 1-31, Genesis 1-50, Matthew 1-28.

URL pattern: `https://www.bible.com/bible/233/GEN.1.iuminr`
Book codes: GEN, EXO, LEV, NUM, DEU, JOS, JDG, RUT, 1SA, 2SA, 1KI, 2KI, ... PSA, PRO, ... MAT, MRK, LUK, JHN, ACT, ROM, ...

### Community Corrections
Users can submit corrections via the web UI → stored in Supabase (`corrections` table). Run `node merge-corrections.mjs` to pull them into the dictionary. Set `SUPABASE_SERVICE_KEY` env var to auto-delete merged rows.

## Development

```bash
npm install        # install dependencies (xlsx)
npm start          # start server on port 3456
```

The app loads `dict-slim.json` and `examples.json` client-side via fetch. No build step needed — edit index.html and refresh.

## Supabase Config
- Project URL: check index.html for `SUPABASE_URL` constant
- Table: `corrections` (columns: english, mienh, notes, type)
- Anon key in index.html (read-only access to corrections)
- Service key needed for deletes (not committed, set as env var)

## Source Materials (not in repo)
- `/home/jpierce/projects/Iu_Mien_Grammar.pdf` — 925-page PhD thesis on Iu Mienh grammar
- `/home/jpierce/projects/iumienhdictnew.xlsx` — Spreadsheet with ~5000 dictionary entries (already imported)
- Purnell's "An Iu-Mienh–English Dictionary with Cultural Notes" — No digital version exists; hardcover only from Silkworm Books
