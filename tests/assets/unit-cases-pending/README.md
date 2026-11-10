# Pending unit cases

Fixtures here hold lilylet syntax that the grammar does not accept yet, or that it
misreads (e.g. `\breve` lexing as the pitches `b r e v e`). They are deliberately
NOT under `tests/assets/unit-cases/`: every shared suite (`npm test`,
`test:lyl-roundtrip`, `test:roundtrip`, `test:xml-roundtrip`, `test:mei`,
`test:mei-hashes`) walks that directory, so a fixture that fails to parse, or that
encodes to wrong content, breaks the whole suite and — worse — invites recording a
wrong MEI hash as the baseline.

`tests/unit/syntaxGaps.test.ts` reads them from here and asserts the expected
behaviour; each assertion is expected to fail until the construct is implemented.
When one is implemented, move its `.lyl` back into `../unit-cases/` and record its
hash with `npx tsx tests/computeMeiHashes.ts --update`.
