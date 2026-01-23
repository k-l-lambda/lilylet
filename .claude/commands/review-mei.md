# Review MEI Test Cases

Review each lilylet test case systematically, comparing:
1. The `.lyl` source file (in `tests/assets/`)
2. The generated `.mei` file (in `tests/output/`)
3. The rendered `.svg` file (in `tests/output/`)

## Review Process

For each test case:
1. Read the `.lyl` source file
2. Read the corresponding `.mei` file
3. Check the `.svg` rendering (if needed)
4. Verify the MEI output correctly represents the lilylet source:
   - Notes: pitch (pname), octave (oct), duration (dur), accidentals (accid)
   - Rests: duration, type (rest/mRest/space)
   - Chords: all pitches present
   - Articulations: correct artic values
   - Dynamics: correct dynam content
   - Beams: notes wrapped in `<beam>` elements
   - Slurs: correct slur attribute (i/t)
   - Ties: correct tie attribute (i/m/t)
   - Key signatures: correct key.sig value
   - Time signatures: correct meter.count/meter.unit
   - Clefs: correct clef.shape/clef.line
   - Tuplets: correct num/numbase, all notes inside
   - Grace notes: grace="unacc" attribute
   - Stem direction: stem.dir attribute
   - Ottava: ottava context change

## Stop Condition

**STOP immediately when you find the FIRST issue.** Do not continue reviewing other files.

## Output Format

When an issue is found, report:

```
## Bug Found

**File:** [filename].lyl

**Source:**
```lilylet
[source code]
```

**Expected:** [what the MEI should contain]

**Actual:** [what the MEI actually contains]

**Issue:** [clear description of the bug]

**Location:** [parser/encoder/other] - [specific file and line if known]
```

## Test Files to Review

Review files in this order (alphabetically):
1. accidentals-*
2. articulations-*
3. basic-notes-*
4. beams-*
5. chords-*
6. clefs-*
7. dots-*
8. durations-*
9. dynamics-*
10. grace-notes-*
11. hairpins-*
12. key-signatures-*
13. multiple-*
14. octaves-*
15. pedals-*
16. rest-*
17. stem-direction-*
18. tempo-*
19. ties-and-slurs-*
20. time-signatures-*
21. tremolos-*
22. tuplets-*

Skip demo files for now.

## Start Review

Begin reviewing from the first file. Read both the .lyl and .mei files for each test case.
