# Lilylet

Lilylet is a LilyPond-like music notation language designed for Markdown rendering and symbolic music representation in AIGC applications.

## Why a New Language?

### 1. Leveraging LilyPond's Excellent Syntax

LilyPond uses a LaTeX-like text markup syntax with significant advantages:

- **Beginner-friendly**: Intuitive commands like `\clef`, `\key`, `\time` require no knowledge of complex binary formats
- **Human-readable**: Notes are represented directly as letters (c d e f g a b), durations as numbers (4 = quarter note)
- **Relative pitch mode**: Each note is calculated relative to the previous one—only octave shifts (`'` or `,`) are needed when the interval exceeds a fourth, dramatically reducing octave markers. See [LilyPond Relative Octave Entry](https://lilypond.org/doc/v2.23/Documentation/notation/writing-pitches#relative-octave-entry)

### 2. Reducing LilyPond's Excessive Flexibility

LilyPond is powerful but overly flexible—the same music can be written in multiple ways, which creates problems for AIGC scenarios:

| Issue | LilyPond | Lilylet |
|-------|----------|---------|
| Verbose context | Requires `\version`, `\header`, `\paper`, `\layout` boilerplate | Only core music content |
| Inconsistent formats | Relative pitch, absolute pitch, multiple chord notations | Unified format, reduced ambiguity |
| Complex nesting | `\new Staff << \new Voice \relative c' { ... } >>` | `\staff "1" ...` |

### 3. Optimized for AIGC

- **Shorter context description**: Removes redundant information, allowing LLMs to process more music content within limited context windows
- **Formatted layout**: Fixed syntax structure facilitates model learning and generation
- **Markdown-embeddable**: Music snippets can be directly embedded in documents

### Basic Syntax

| Element | Syntax | Description |
|---------|--------|-------------|
| Staff | `\staff "1"` | Specifies which staff the current voice belongs to |
| Key | `\key c \major` | C major |
| Time | `\time 4/4` | 4/4 time signature |
| Clef | `\clef "treble"` | Treble clef |
| Notes | `c4 d8 e16` | C quarter note, D eighth note, E sixteenth note |
| Accidentals | `cs` `cf` `css` `cff` | C sharp, C flat, C double-sharp, C double-flat |
| Octave | `c'` `c,` | One octave higher, one octave lower |
| Chord | `<c e g>4` | C major triad, quarter note |
| Voice separator | `\\` | Separates multiple voices within the same staff |
| Part separator | `\\\` | Separates different instrument tracks (parts) in a score |
| Bar line | `|` | Separates measures |

## Syntax Example

```lilylet
\staff "1" \key e \major \time 2/4 \clef "treble" \stemUp e8 [ ds16 e16 ] fs4 ~ \\
\staff "1" s4 \stemDown ds4 ~ \\
\staff "2" \key e \major \clef "bass" \stemUp e,,4 b4 \\
\staff "2" \stemDown e,,16 [ b'8 -> b16 ] b,16 [ b'8 -> b16 ] |
```
