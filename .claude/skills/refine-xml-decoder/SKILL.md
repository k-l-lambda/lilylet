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

### 6. UTF-16 / BOM source files fail to parse (highest-impact, 16% of real exports)
MuseScore/Finale/Sibelius routinely export `.xml` as **UTF-16 LE with a BOM**.
Reading bytes as UTF-8 yields mojibake and "expected score-partwise, got
undefined". **Fix:** `readXmlString(string | Uint8Array)` sniffs BOM (UTF-16
LE/BE, UTF-8), falls back to the prolog's declared `encoding=`, and strips a
leading U+FEFF (xmldom rejects it before `<?xml`). `decode()` accepts bytes;
`decodeFile()` reads raw bytes, not `'utf-8'`. Always batch-audit a real corpus
for encoding before trusting marking counts — 23/149 sampled files were UTF-16.

### 7. Rests silently consume (and discard) pending directions
The measure loop fetched `pendingMarks.get(voice)` and **deleted** it for *every*
note — including rests, which have no `marks` field. A pedal/hairpin **stop** that
lands just before rests (`<pedal stop/>` then rests fill the voice — extremely
common in piano LH) was dropped, and the end-of-measure flush had nothing left to
flush. **Fix:** `const marks = note.isRest ? [] : pendingMarks.get(voice)`; only
`delete` when not a rest, so the stop survives to the next real note / the flush.
This is the dominant pedal-stop loss (recovered pedals to ≥ source corpus-wide).

### 8. Tuplets don't propagate inner-note fingerings / markups (extends #4)
`tupletEventToMEI`'s `TupletEventResult` collected slurs/dynamics/pedals/fermatas
but **not** `fingerings` or `markups`, so every `<fing>`/`<dir>` on a tuplet-inner
note vanished — and in étude-style scores nearly all fingerings are inside tuplets
(fingering went 8828→10761 of 10763 once fixed). **Fix:** add both arrays to
`TupletEventResult`, collect in the inner-note loop, merge at the consumer.
Rest-fermatas inside tuplets need the same plumbing (see #10).

### 9. Scalar mark fields — recurring trap (extends #3)
Beyond `pedal`, the same scalar-vs-array bug hit **fingering** and **dynamics**:
- decoder `MusicXmlNote.fingering: number` kept only the first of several
  `<fingering>` on a chord note (one per member); a `1-5` clamp also dropped valid
  `0`/substitution fingerings. → `fingerings: number[]`, clamp `0-9`.
- encoder `NoteEventResult.dynamic?: string` emitted only the first of stacked
  dynamics on one note. → add `dynamics: string[]`, iterate at every consumer.
Audit *every* per-note marking for this; the rest/flush fixes make stacking MORE
likely by piling marks onto one note.

### 10. Fermata over a rest (held silence / grand pause)
A fermata frequently sits on a rest, not a note — and `notationsToMarks` was only
run for pitched notes, so ~3 of every 4 fermatas (which live on rests) were lost.
**Fix:** add optional `RestEvent.marks`; decoder attaches the rest's fermata
notation; `restEventToMEI` returns a `fermata` flag keyed to the emitted
rest/mRest id; both the layer loop and tuplet inner-rest loop push
`<fermata startid=...>`. MEI-path only — the lilypond serializer/parser are left
untouched (no roundtrip case exercises rest marks yet).

### 11. Ottava span start/stop split across staves
`<octave-shift>` start and stop both name the same `<staff>`, but the stop usually
trails a `<backup>`, so the *next note* the decoder saw was on the OTHER staff —
start and stop landed in different MEI layers and the encoder couldn't pair them
(span dropped). **Fix:** tag `pendingContextChanges` with `direction.staff`; an
ottava change only flushes onto a note on the **same staff** (tempo flushes
anywhere), with an end-of-measure flush onto a matching-staff voice. Ottava went
132→164 of 166. Residual losses are cross-measure span-carry cases in the encoder
(harder; the per-measure `pendingOctave` continuation state is fragile).

### 12. Slur span tracker — single slot + single-carry (same family as #2)
The encoder held ONE open slur in `currentSlur`; a new start while one was open
overwrote it (piano writing runs up to ~3 concurrent slurs per voice), and the
cross-measure `SlurState` carried only ONE startId, so all-but-one open slur died
at the bar line. **Fix:** `openSlurs` stack paired LIFO; `SlurState` carries the
whole open-slur stack (`string[]`) per voice key, always recorded (even empty) so a
fully-closed measure clears the carry. Same-voice concurrent + cross-measure slurs
now pair; normal files stay exact (e.g. 6/6, 30/29).
**Residual — cross-voice slurs (hard):** in dense piano scores a slur often starts
in one `<voice>` and stops in another (paired by MusicXML `number`), e.g. Chopin
Op.25 études have 362 such in one file. The layer-by-layer encoder pairs within one
layer's stream, so these stay unpaired. They're RARE corpus-wide (~27 of 3700 in a
299-file sample; total slur 99401 ≥ source 99342), so the safe stack fix above was
shipped and the cross-voice pairing deferred — a true fix needs staff-level pairing
by `number` (already carried into the `Slur` mark) across all layers, a high-risk
refactor of the hottest marking path. **Do not chase a few hundred étude slurs at
the cost of 99k working ones.**

### Not yet implemented: glissando / slide
`<glissando>`/`<slide>` (a note-to-note spanner → MEI `<gliss startid endid>`) is
entirely absent from types/decoder/encoder — a clean feature gap, not a loss bug.
~2% of files use it (662 spans corpus-wide). Mirror the slur spanner (track
start/stop by `number`).

### Counting caveat — source `<note>` is NOT the note total
Full-corpus `notes` always shows lilylet "short" because MusicXML `<note>` counts
**chord members** (`<chord/>`) and **rests** (`<note><rest/></note>`) as separate
`<note>` elements, while MEI emits one `<note>` per chord pitch and `<rest>`
separately. Confirm with `lilylet <note> == verovio <note>` (they match exactly) —
it is representation, never loss. Likewise `arpeg` (per-note `<arpeggiate>` in source
vs per-chord `<arpeg>` in MEI).

## Corpus batch auditing
The high-value bugs above were ALL found by auditing a real score corpus
(`~/data/scores/fmenu`, 6292 piano `.xml`) against **source-XML ground truth**, not
the unit cases. A throwaway `tests/batch-xml-audit.local.ts` (gitignored `*.local.*`)
decodes a sampled file list, tallies each loss-prone marking source→lilylet (verovio
optional/FYI), and prints per-marking totals + the worst-dropper files. Key metric
discipline: combine `<dir>`+`<tempo>` when checking `<words>` (tempo words split off
correctly), and treat `arpeg` (per-note source vs per-chord MEI) and `<note>` counts
(source counts `<note><rest/></note>`) as representation, confirmed by `ours == verovio`.

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
