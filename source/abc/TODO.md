# ABC Grammar TODO

Issues found by comparing `abc.jison` against the abcjs parser implementation.

---

## High Priority

### 1. Church modes in key signatures

`key_mode` only distinguishes `major` / `minor`. The `NAME` fallback does a naive
`startsWith("ma")` check, which mis-classifies all church modes:

- Dorian (`Dor`, `dorian`)
- Phrygian (`Phr`, `phrygian`)
- Lydian (`Lyd`, `lydian`)
- Mixolydian (`Mix`, `mixolydian`)
- Aeolian (`Aeo`, `aeolian`)
- Locrian (`Loc`, `locrian`)
- Scottish bagpipe: `HP`, `Hp`

These should be recognized as distinct modes rather than silently falling back to
major or minor. The `abcDecoder.ts` key-mapping logic will also need updating to
handle these modes.

### 2. Bare-number Q: tempo (`Q:120`)

`numeric_tempo` only matches `frac '=' number` (e.g. `Q:1/4=120`). Two common
forms are not parsed:

- `Q:120` — plain BPM number (unit inferred from the current meter/L: value)
- `Q:"Allegro"` — text-only tempo marking
- `Q:"Allegro" 1/4=120` — combined text + numeric form

`Q:120` is the most frequently seen form in real-world ABC files.

---

## Medium Priority

### 3. Missing rest type: `y` (spacer)

The `rest_phonet` rule covers `z`, `Z`, `x` but not `y` (an invisible spacer rest
used for spacing/layout). Files containing `y` currently cause a parse error.

### 4. Volta ending bracket (`endEnding`)

The `bar` rule appends the ending number directly to the bar token string
(`'|' + N → "|1"`). There is no representation of the *closing* bracket of a
first-ending, so `[1 ... [2` style repeat structures cannot be round-tripped.
abcjs tracks `startEnding` / `endEnding` flags on bar elements; consider a
similar approach.

---

## Low Priority

### 5. `~` maps to `mordent` instead of `irishroll`

`abc.jison` line 507: `'~' → articulation("mordent")`.  
The standard ABC specification defines `~` as an *Irish roll* ornament, not a
mordent. abcjs uses the name `irishroll`. The mordent is correctly represented by
`M`. This is a semantic mismatch that may affect downstream rendering/export.

### 6. Microtonal accidentals (`^/`, `_/`)

The `accidentals` rule does not cover quarter-tone accidentals:

- `^/` → quarter sharp
- `_/` → quarter flat

These are recognised by abcjs. Files using microtonal notation will silently drop
the accidental.

### 7. Short trill decoration `t`

The single-letter `t` (half/short trill, `trillh` in abcjs) is not handled. The
current `P`/`PP` lexer patterns only match uppercase ornament letters
(`HJLMOPRSTuv`), so lowercase `t` falls through as an unknown token.

### 8. Overlay voices (`&`)

The `&` operator (alternative voice within a single bar, same staff) is not
supported. abcjs resolves overlays into separate voices via `resolveOverlays()`.
This is a moderately common pattern in two-voice piano or lute transcriptions.

---

## Out of Scope (noted for awareness)

- **Lyrics** (`w:` / `W:` fields): not handled at the ABC grammar level; notes
  have no `lyric` property. Would require grammar additions and decoder support.
- **Extended clef types**: only `treble`, `bass`, `tenor` are recognised. abcjs
  also handles `alto`, `baritone`, `mezzo`, `soprano`, `tab`, `perc`, etc.
- **Decoration name aliases**: abcjs normalises `tr`→`trill`, `emphasis`→`accent`,
  `marcato`→`umarcato`, `<`/`>`→`accent`. The lilylet grammar passes `NAME`
  through as-is; the decoder would need to handle the aliases explicitly.
