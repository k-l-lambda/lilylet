---
name: refine-xml-decoder
description: Methodology and known bug patterns for fixing MusicXML→MEI marking loss in lilylet's musicXmlDecoder/meiEncoder
metadata:
  tags: lilylet, musicxml, mei, decoder, encoder, verovio, debugging
---

## When to use

Use this skill when:
- A MusicXML score round-trips through lilylet but loses performance markings
  (pedals, hairpins/wedges, dynamics, text directions, ottava, slurs)
- Comparing lilylet's MEI output against verovio and the counts disagree
- Adding or auditing marking support in `source/lilylet/musicXmlDecoder.ts` or
  `source/lilylet/meiEncoder.ts`

## Golden rule: the SOURCE XML is ground truth, NOT verovio

Verovio is a useful second opinion but it makes opinionated choices and has its
own quirks. **Always count the marking directly in the MusicXML and compare BOTH
routes against that number.** Concrete trap observed: verovio folds expressive
`<words>` like "cresc."/"dim." into `<dynam>`, inflating dynamics from the true 14
to 28. Matching verovio there would have been wrong — the words belong in `<dir>`.

When two routes disagree, decide per-marking which is faithful:
- count `<pedal type=...>`, `<wedge type=...>`, `<dynamics>`, `<words>`,
  `<slur type="start">` in the XML;
- a hairpin SPAN count = number of `crescendo`+`diminuendo` starts (each closed by
  one `stop`), not the raw wedge count.

## Tooling

- `npm run test:mei-diff [file.xml ...]` — the multi-dimensional two-route diff
  (`tests/musicxml-mei-diff.ts`). Categorizes dimensions as structure / performance
  / layout, normalizes element-vs-attribute forms, and cross-checks loss-prone
  markings against the source XML. Writes both MEI files + `report.json` under
  `tests/output/musicxml-mei-diff/`.
- Trace the **doc model** (between decode and encode) to localize a loss to decoder
  vs encoder. A throwaway `.local.ts` script (gitignored via `*.local.*`) that walks
  `doc.measures[].parts[].voices[].events[].marks[]` and tallies `markType` counts
  pinpoints exactly which stage drops the marking:
  `source count → doc-model count → MEI count`.

## Known bug patterns (and fixes)

### 1. Decoder drops marks trailing the last note of a measure
`pendingMarks` is a per-measure `Map<voice, Mark[]>` attached to the *next* note in
that voice. Post-positioned directions — hairpin/pedal **stops**, anything after a
`<backup>` in piano scores — have no following note and are silently discarded at
the measure boundary. **Fix:** at the end of `convertMeasure`, flush leftover
`pendingMarks` onto the voice's last `NoteEvent` (search backward; `RestEvent` has
no `marks` field). This recovered pedals 104→matches-source on chopin-etude.

### 2. Encoder single-slot span tracker collapses overlapping spans
`currentHairpin` held ONE open hairpin; a new start while one was open overwrote it,
and only an explicit `end` emitted a span. Flattened cross-staff streams interleave
hairpins (`crescStart crescStart`, `crescStart dimStart`). **Fix:** use a stack of
open hairpins; pair an end to the most-recent **same-form** open (LIFO fallback);
flush still-open spans at layer end to the last note id; carry the oldest as the
cross-measure `pendingHairpin`. To pair by form, make `extractMarkOptions` emit
`crescEnd`/`dimEnd` instead of a formless `end`.

### 3. Scalar field can't hold multiple marks of one kind on a note
`result.pedal` was scalar, so a note carrying both a pedal-up and pedal-down (a
pedal "bounce" at the same beat — common, and more common after fix #1 stacks marks
on the last note) emitted only one. **Fix:** make it `result.pedals: ('up'|'down')[]`
and push all. Watch for the same scalar-vs-array trap on any per-note marking.

### 4. Tuplet encoder doesn't propagate inner-note control events
`tupletEventToMEI` collected slurs/dynamics/fermatas from inner notes but not
pedals/hairpins, so marks on notes inside a tuplet vanished. **Fix:** add the
missing arrays to `TupletEventResult`, collect them in the inner-note loop, and
merge them in the layer loop where the tuplet result is consumed. (Independent
events like pedals are easy; spans like hairpins crossing tuplet boundaries are
harder — handle or document.)

### 5. Parsed-but-never-stored markings
`<words>` were parsed into `direction.words` but only consumed when they matched
`TEMPO_WORDS`; non-tempo text ("dolce", "con forza", "cresc.") was dropped.
**Fix:** in `directionToMarks`, convert non-tempo words to a `MarkupMark`
(`{markType:'markup', content, placement}`) → MEI `<dir>`. Guard against
double-emitting tempo words already consumed as a tempo `ContextChange`.
Note `Placement` is an enum, not a bare string literal — map it explicitly.

## Verification checklist

- `npm run test:mei` — 200 cases, verovio must still load every produced MEI (a
  malformed span fails this).
- `npm run test` (parser), `npm run test:roundtrip` (lilypond), `gpt-review-issues`.
- `npm run test:mei-hashes` — intentional output changes show as mismatches; confirm
  the diff is **additive** (more markings, `<note>` count unchanged) before running
  `npx tsx tests/computeMeiHashes.ts --update`.
- Before claiming a roundtrip failure is yours, `git stash` the change and re-run:
  the musicxml-roundtrip suite has ~6 pre-existing cross-staff failures unrelated to
  markings.
- `npx tsc -p tsconfig.build.json --noEmit` for type errors.

## Out of scope (representation, not loss — don't "fix" toward verovio)

- accid element-vs-attribute, and verovio's extra courtesy/cautionary accidentals.
- tie per-note (`@tie`) vs per-span (`<tie>`) counting.
- verovio's running clef/keySig/meterSig repeats and `<space>` fillers.
- verovio folding words into `<dynam>` (keep dynamics at the true count).
