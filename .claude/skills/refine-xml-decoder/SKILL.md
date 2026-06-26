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

## Structural fidelity (measure count / pitch / tick) — `tests/structural-audit.local.ts`
Beyond markings, audit the SKELETON against source XML: measure count, pitch
multiset (MIDI semitones — enharmonic/notation-agnostic, so only genuinely wrong/
missing notes flag), and per-measure tick totals. Corpus result after the fixes
below: **measure count 0 mismatches, 93% files fully tick-clean.** Build the
audit carefully — three of its own bugs masked real ones until fixed:
- doc `phonet` is a **string** (`"e"`), not a 0-6 index — map letters.
- **grace notes** carry a nominal duration but DON'T advance time — skip them in the
  tick walk (lilylet flags them `grace:true`; counting them inflated 806 false hits).
- **tuplet inner notes** carry plain durations; the ratio lives on `TupletEvent.ratio`
  — apply it once at the tuplet level (don't expect `.tuplet` on each inner note).

### 13. Whole-measure rest mis-sized (FIXED)
Two forms: `<rest measure="yes">`, and the convention of a `type="whole"` rest whose
`<duration>` ≠ a whole note (centred whole rest = whole bar, 210 corpus files).
`convertDuration` rounded the bare duration to a power-of-two division → a whole rest
(e.g. 96 ticks) in a 3/4 bar (72), over-filling by +24. **Fix:** detect both forms in
`parseNote`, set `RestEvent.fullMeasure`; encoders emit `<mRest>`/`R` and timing comes
from the meter. Tick-mismatch files 1436→442.

### 14. Unclosed / nested tuplet swallows the rest of the piece (FIXED — was the "multi-voice block drop")
The `PITCH multiset` audit's headline (25 files, always `missing>0 extra=0`): a
CONTIGUOUS RUN of measures decoded to ZERO notes (库劳 Op.20 m15→end, 云雀 −583,
Op.740 −393, 说散就散 −84). The earlier guess ("transient extra voice corrupts
`VoiceTracker`") was WRONG — the trigger is just nearby, not the cause. **Real root
cause:** `TupletTracker` is created once per *part* (`convertPart`) and NEVER reset
per measure, but a tuplet's `stop` notation can be **missing from the source** (库劳
m15 has `<tuplet type="start" number="1">` and no matching stop anywhere in the
file). With no stop, `activeTuplets` stays non-empty forever, `isActive()` is
permanently true, and every following note in the loop is diverted into the zombie
tuplet via `addEvent` instead of `voiceTracker.addEvent` — so it never reaches a
voice's event list. The drop cascades to the end of the piece. A second, milder bug:
`addEvent` pushed each note into ALL active tuplets regardless of voice, and into
every enclosing tuplet when nested — so a voice-1 tuplet ate voice-2 notes, and
nested `start#1 start#2 stop#1 stop#2` emitted each note twice (`extra>0`: K.466 +6,
Op.740 +2, 28.旋律 +2).
**Fix (3 parts, all in `TupletTracker`):**
1. **Bind each tuplet to its voice/staff** (`startTuplet(number, voice, staff)`);
   make `isActive(voice)` and `addEvent(event, voice)` voice-scoped so a tuplet only
   captures notes of its own voice.
2. **Force-close at the bar line** — `flushAll()` at measure end emits every
   still-open tuplet onto its owning voice (a tuplet is a within-measure time
   modification and cannot span a bar; a missing stop is then bounded to one measure,
   not the whole piece). Call it BEFORE the `pendingMarks` flush so trailing marks
   still find the tuplet's notes as the voice's last events.
3. **Innermost-only** — `addEvent` pushes to the single most-recently-started
   same-voice tuplet (the doc model's flat `TupletEvent` can't hold a nested
   TupletEvent, so adding to every enclosing tuplet double-counts).
Result: pitch-loss files 25→16, clean files 6014→6027, tick-diff 273→260, and tick
diffs on the affected files collapsed (库劳 15→0, K.466 3→0, Op.740 3→0, 28.旋律
55→2). Residual pitch diffs are single-digit source-defect remnants (a measure with
genuinely unbalanced in-measure tuplet start/stop — ~3/420 sampled files).
**Diagnostic that cracked it:** `tests/measure-pitch.local.ts` — per-measure pitched-
note count source-vs-doc, printing the voice/staff signature at each drop; then a
one-off DOM walk tallying `<tuplet type>` per measure exposed the unmatched start.

### 15. `<forward>` gaps not filled (FIXED)
20% of the corpus (1269 files, 18883 forwards) uses `<forward>`. lilylet's doc model
is a flat per-voice event list with NO absolute tick anchor (`currentPosition` is
maintained but never read for placement — it's dead), so a `<forward>` that skips
time inside a voice vanished: following notes slid earlier and the bar decoded short
(`forward2,note,note,forward2,…` → 8 ticks for a 16-tick bar). **Fix:** accumulate
forward ticks in `pendingForward` and flush as invisible spacer rests
(`RestEvent.invisible` → MEI `<space>` / lilypond `s`) into the NEXT note's voice —
the forward has no `<voice>` of its own, so like `pendingMarks` it belongs to the
voice that follows. Decompose arbitrary gaps into power-of-two (optionally dotted)
spacers so non-2^n gaps (1.5/2.5/3 quarters) stay exact.
**The trap that caused a regression:** a forward NOT followed by an in-voice note —
the extremely common `backup N / forward N` measure-end positioning idiom — is
cursor movement, NOT a content gap. Materialising it doubles the bar. So `pendingForward`
must be DROPPED at `<backup>` and measure end, and only flushed when a real note
consumes it. Tick mismatches 442→273 files (96% fully clean).

## Clef / staff POSITION consistency — the two-route diff that isolates the SERIALIZER
The MEI clef COUNT (in musicxml-mei-diff) is categorized `layout` and rarely flags,
but clef *position* and *staff attribution* can still be corrupted by the `.lyl` text
round-trip. Audit it with a different two-route diff:
- Route A: `xml → decode → doc → meiEncoder` (MEI directly).
- Route B: `xml → decode → doc → serializeLilyletDoc → parseCode → doc2 → meiEncoder`.
Route B inserts a full `.lyl` serialize+parse. Comparing clef position signatures
(`m<measure>/s<staff>@<eventIdx>:<shape><line>`, staffDef = index -1) isolates loss to
the **serializer/parser**, not the decoder/encoder (both routes share the encoder).
Tool: `tests/clef-consistency.local.ts` (`--all` / `--limit N` / file args). On the
6292-file corpus this went 360-ish → 12 → 2 as the bugs below were fixed.

### Serializer/parser asymmetry — the parser's staff default is the contract
The parser (`lilylet.jison` `voice()`) assigns every voice with NO leading `\staff`
directive to **staff 1**, unconditionally — it does NOT carry staff across voices or
measures. The serializer, however, tracks a cross-measure `currentStaff` carry and a
per-staff `emittedClefs`/`allStaffClefs` map. Three concrete round-trip corruptions
came from the serializer trusting its own state instead of the parser's flat default
(all in `serializeVoice`/`serializeTupletEvent` in `source/lilylet/serializer.ts`):
1. **Stale clef restated onto a clef-less sibling voice.** Staff 2 carries bass; a
   later measure's voice A (staff 2) changes to treble, sibling voice B (staff 2) has
   no clef of its own → the `?? allStaffClefs[staff]` fallback re-emitted the stale
   carried-in bass. **Fix:** the carry fallback may only ESTABLISH a staff whose clef
   was never emitted (`emittedClefs[staff] === undefined`); never restate one already
   shown this serialization (it would revert the sibling's change). Same guard at both
   mid-voice staff-switch sites (`ctx.staff` change and `note.staff` change).
2. **Whole measure on staff 2 dropped its `\staff` anchor.** A measure whose voices
   are all staff 2 (so per-measure `partIsGrandStaff` is false) after a prior staff-2
   measure: `effectiveInitialStaff == currentStaff == 2`, so no `\staff` emitted → the
   parser defaulted the voice to staff 1 and its leading clef rode along. **Fix:** emit
   `\staff "N"` whenever `effectiveInitialStaff !== 1` (the parser's default), even when
   the cross-measure carry matches it.
3. **Single-voice cross-staff: leading clef rode to the wrong staff.** Voice home-staff
   1 with a leading bass clef but first NOTE on staff 2 (`note.staff`): serializer wrote
   `\clef "bass" \staff "2" …`, and on re-parse the first `\staff "2"` was read as the
   LEADING staff (binding home to 2), dragging the clef to staff 2. **Fix:** scan the
   first musical event's effective staff (`firstMusicalStaff`, honouring `note.staff`,
   independent of the leading-clef scan which a clef stops early); if it differs from
   the home staff, force a `\staff "<home>"` anchor up front.
4. **Clef/ottava change INSIDE a tuplet was silently dropped.** `serializeTupletEvent`
   handled only `staff` and `stemDirection` context events in its inner loop (and as an
   `else-if` chain, so a compound staff+clef event lost the clef). **Fix:** emit each
   present component (`staff`, `clef`, `ottava`, `stemDirection`) independently. This
   also fixed an ottava-cross-measure unit case.

**Guard test:** `tests/lyl-roundtrip.ts` (`npm run test:lyl-roundtrip`) — runs
`parseCode → serializeLilyletDoc → parseCode` over all unit-cases and asserts the MEI
clef position set is identical. This is DISTINCT from `lilypond-roundtrip.ts`, which
round-trips through the LilyPond encoder/decoder and so preserves clefs via LilyPond's
own explicit context model — it canNOT catch `.lyl` serializer bugs (verified: all 4
cases above pass the lilypond path even pre-fix). Unit cases added:
`clefs-multivoice-shared-staff-change`, `clefs-whole-measure-staff2-change`,
`clefs-cross-staff-leading-clef` (each breaks pre-fix, stable post-fix). Compare via
MEI, not raw doc context events, so benign redundant clef restatements (encoder-deduped)
don't false-flag. Residual 2/6292: a voice whose home staff is 1 but whose FIRST event
is a pure `\staff "2"` context switch — inexpressible as "home 1 then immediately 2"
without `\staff "1" \staff "2"`; clef counts still match (A=B=src), only the event-index
annotation drifts. Acceptable; do not over-engineer.

## Clef CROSS-ENGINE diff (verovio vs lilylet) — finds DECODER clef loss
A second clef tool compares verovio's `xml→MEI` against lilylet's `xml→lyl→MEI`
(`tests/clef-verovio-diff.local.ts`). UNLIKE the round-trip diff above, the two routes
share NOTHING, so a divergence can come from anywhere — apply the golden rule and count
clefs in the SOURCE XML, not trust verovio. Normalize two verovio quirks first or it
floods with false positives: (a) verovio's initial clef is a `<clef>` CHILD of
`<staffDef>` (lilylet uses the `clef.shape=` attribute) — treat both as the staff's
initial clef; (b) verovio emits a SHAPELESS `<clef>` as a cautionary/system-break repeat
— drop empty-shape clefs and collapse consecutive identical clefs, then compare the
per-staff clef (shape,line) MULTISET. ~1011/6292 files error as verovio `loadData false`
(verovio rejects them; not lilylet's fault). This diff surfaced three DECODER clef-loss
bugs (all in `convertMeasure`/`convertPart`, fixed; corpus multiset-diff 360→93):

### D1. Initial clef of a staff silent at the opening is lost
A two-staff part where staff 2 has no notes until a later measure (accompaniment enters
late): staff 2's bass clef is declared only in measure 1's `<attributes>`, but staff 2
has no voice there to attach it to, so it was dropped and staff 2 defaulted to treble.
**Fix:** `pendingInitialClefs` map — a clef declared for a staff with no voice this
measure is held and flushed onto that staff's FIRST appearing voice (any later measure).

### D2. Mid-measure clef change collapsed (the dominant gap)
`clefs.set(staff, …)` keeps only ONE clef per staff per measure and emits it at the bar
start. A clef that changes PARTWAY through a measure (scale/arpeggio études where the LH
crosses up: source m1 staff2 = `F,G,F`) lost all but the last, and its position. **Fix:**
track `staffHasNotes` + `lastVoiceOnStaff` per measure; when a clef arrives for a staff
that already has notes this measure, append it INLINE via `voiceTracker.addEvent` at the
current position instead of the measure-start map. Tag the inline clef with its `staff`
(`{type:'context', staff, clef}`) — in a cross-staff voice a bare clef is ambiguous and
the serializer drops/misplaces it; the explicit staff makes it self-describing. Also
scan each built voice's events for the last clef per staff and update `lastClefs`, so the
next measure's dedup compares against the post-change clef (else a later restatement is
wrongly suppressed).

### D3. Clef change in an intermittently-empty staff is lost
Generalizes D1: any measure declaring a clef for a staff with no voice that bar (a
cross-staff passage written entirely on the other staff for several bars) — carry the
clef forward in `pendingInitialClefs` and emit it (if changed vs `lastClefs`) when the
staff reappears. Without this, clef changes landing in empty-staff measures vanished.

**Residual (~23/6292 round-trip, ~93/6292 vs verovio):** dense polyphonic / cross-staff
scores (fugues, 练习曲) where a mid-measure clef sits in a voice-3-style cross-staff
voice. The decoder now captures these clefs (route A gains them vs source), but the
serializer/parser don't perfectly round-trip a compound `[staff,clef]` inside a voice
that interleaves staves — off-by-1-2 clefs. Same hard cross-staff family as the deferred
cross-voice slurs; the net is strongly positive (real source-confirmed recovery) and no
unit-suite MEI hash changed. **Don't chase the last dense-polyphony clefs at the cost of
the serializer's cross-staff stability.**

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
- `npm run test:lyl-roundtrip` — `.lyl` serialize→parse clef/staff position stability
  (guards the serializer bugs above; a serializer change touching `\staff`/`\clef`
  emission MUST keep this at 0 failed).
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
