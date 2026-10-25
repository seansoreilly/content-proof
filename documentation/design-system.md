# ContentProof design system: "Seal"

The visual identity is a notary's seal. The issued record (a QR code) sits
inside a round embossed seal whose rim carries the attestation text, and every
page is the bond paper the seal presses into. Surfaces separate by relief
(inset shadow), never by borders or rounded cards. One colour: notary
stamp-ink violet. One motion: the seal pressing when a record is issued or
verified.

This file is the contract between the token layer, the primitives, and the
pages. Change it before changing them.

## Tokens

Defined once as CSS custom properties in `src/app/globals.css`, light on
`:root`, dark under `@media (prefers-color-scheme: dark)`. Tailwind reads them
through `theme.extend.colors` so classes are `bg-paper`, `text-ink`,
`text-accent`, and so on. Never write a hex value in a component.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--paper` | page and surface background | `#F7F7F4` | `#1E1E22` |
| `--relief` | emboss shadow (dark edge) | `#D9D8D0` | `#0E0E11` |
| `--relief-hi` | emboss highlight (light edge) | `#FFFFFF` | `#2E2E34` |
| `--ink` | text | `#26262B` | `#ECECEA` |
| `--mute` | secondary text, labels | `#6B6B72` | `#A0A0A8` |
| `--accent` | stamp ink: buttons, seal rim, verified | `#5B3FA3` | `#A78BDF` |
| `--tint` | accent at low strength, for selected or hover fills | `#ECE7F5` | `#2A2537` |
| `--void` | failure, errors, destructive | `#A3312B` | `#E06A5F` |

Semantic rule: a verified record is `accent` (a seal is the pass state), a
failed one is `void`. There is no green.

Tailwind colour names: `paper`, `relief`, `relief-hi`, `ink`, `mute`, `accent`,
`tint`, `void`. Remove every old palette (`primary-*`, `light-*`,
`light-blue-*`, `dark-blue-*`, `accent-*`).

## Type

Loaded with `next/font/google` in `src/app/layout.tsx`, exposed as CSS
variables, mapped in Tailwind `fontFamily`:

| Role | Family | CSS var | Tailwind | Use |
|---|---|---|---|---|
| display | Bricolage Grotesque (variable, `opsz` + `wght`) | `--font-display` | `font-display` | headings in heavy uppercase, seal rim, buttons, eyebrow labels |
| body | Source Serif 4 (variable, `opsz` + `wght`) | `--font-body` | `font-body` (also `font-sans`) | all running text and form text |
| mono | JetBrains Mono | `--font-mono` | `font-mono` | hashes, keys, raw records |

Scale (desktop / phone): h1 `72px / 40px`, weight 800, uppercase,
`letter-spacing: -0.03em`, `line-height: 0.95`. h2 `28px / 22px`, weight 600,
uppercase, `letter-spacing: -0.01em`. Eyebrow `12px`, weight 600, uppercase,
`letter-spacing: 0.12em`, colour `mute`. Body `17px / 16px`, line-height 1.55,
max width `60ch`. Data `13px` mono.

## Surfaces and relief

No borders, no `rounded-*` on panels, no drop shadows on cards.

- `Panel`: `background: var(--paper); box-shadow: inset 1px 1px 2px var(--relief-hi), inset -2px -2px 4px var(--relief)`.
- Pressed (inputs, the seal when pressed): `inset -1px -1px 2px var(--relief-hi), inset 2px 2px 4px var(--relief)`.
- Raised (the seal at rest): the Panel shadow plus `6px 8px 18px -8px var(--relief)`.

## Primitives (`src/components/ui/`)

All exported with explicit return types, no `any`.

- `Button` props: `variant?: "primary" | "secondary"`, `href?: string` (renders a
  `next/link`), `disabled?`, `disabledReason?: string` (rendered as `title`),
  `type?`, `onClick?`, `className?`, `children`. Display face, 13px, uppercase,
  `letter-spacing: 0.06em`, padding `12px 22px`. Primary: `bg-accent`, white
  text. Secondary: `text-accent` with `box-shadow: inset 0 0 0 1.5px var(--accent)`.
  Disabled: 50% opacity, `cursor-not-allowed`. Focus-visible: `outline: 2px solid var(--accent); outline-offset: 2px`.
- `Panel` props: `className?`, `children`, `as?` (default `div`). Padding
  `24px` desktop, `18px` phone.
- `Eyebrow` props: `className?`, `children`. The eyebrow style above.
- `TextField`, `TextArea`, `FileField` props: `id` (required), `label`,
  `hint?`, plus the native input props. Pressed relief, `font-body`, label in
  eyebrow style, focus ring `accent`. `FileField` styles the native file button
  as a secondary Button.
- `RecordSummary` props: `record: SignatureRecord`, `logIndex?: number | null`,
  `showHash?: boolean`, `timeFormat?: "local" | "iso"` (default local). Renders
  a `<dl>` with rows: Attested for, At, File SHA-256 (when `showHash`), Service
  key, Account holder's key (or "none, service attestation only"), Log entry
  (when `logIndex !== undefined`; `null` renders "not recorded"). Labels in
  eyebrow style, values in body, keys and hashes in mono with `break-all`.
- `VerifyResult` props: `tone: "pending" | "sealed" | "void"`, `title: string`,
  `children` (the explanation; may carry `data-testid` elements), `className?`.
  Grid: title (eyebrow style, coloured by tone: pending `mute`, sealed
  `accent`, void `void`), explanation, and a 52px `SealMark` on the right.
- `SealMark` props: `tone: "pending" | "sealed" | "void"`, `size?: number`
  (default 52), `label?: string` (default by tone: "Seal", "Sealed", "Void").
  A circle: sealed = double accent ring; void = single void ring with a
  diagonal strike; pending = single relief ring. Also the site mark in the
  header at 28px with tone `sealed` and label "CP".

## Seal (`src/components/Seal.tsx`, `src/lib/seal-image.ts`)

- `rimTextFor(record: SignatureRecord): string` (pure, tested) returns
  `ContentProof · attested · YYYY-MM-DD HH:MM UTC · <k> ·` using `record.t`
  and `record.k`.
- `Seal` props: `rimText: string`, `size?: number` (default 288, max-width
  100%), `pressed?: boolean`, `children` (the QR `<img>` or placeholder). Round,
  raised relief, two accent rings (outer 1.2 and inner 0.6 in a 100-unit
  viewBox), rim text on an SVG `textPath` in the display face at a size that
  fits the rim without clipping, uppercase, `letter-spacing: 0.18em`. The
  centre slot is 44% of the diameter, white, 6% padding, and holds the
  children. When `pressed` flips to true, run the press animation once (scale
  1.05 to 0.99 to 1 over 700ms, shadow deepening); none under
  `prefers-reduced-motion`.
- `composeSealPng(options: { qrDataUrl: string; rimText: string; size?: number; colors: { paper: string; accent: string } }): Promise<string>`
  draws the same seal on a canvas and returns a PNG data URL, for download.
  The QR is drawn unchanged, near-black on white, in the centre slot; the
  violet only ever touches the rings and rim text. `size` default 1024.

## Pages

Centred single column, `max-width: 42rem` for forms and `60ch` for prose,
certificate-like margins (`padding-block: 64px` desktop, `40px` phone), 16px
side gutter minimum.

- Header (`layout.tsx`): static, not absolute. Left: `SealMark` 28px + the
  wordmark "ContentProof" in display face, 600, uppercase, `letter-spacing: 0.12em`.
  Right: How it works, Privacy, and sign in / account state. Footer: build info only.
- Landing: `Seal` (rim text for a fixed example record), h1 "Attested.",
  lede: "Hash a file in your browser and receive a sealed record of who
  submitted it and when. Anyone can check the seal against our published
  keys, with no account and no upload." Then primary "Sign a file" (disabled
  with reason "Sign in to sign a file" when signed out), secondary "Verify a
  file". Below, three short paragraphs under eyebrows, no cards, no icons:
  "Your file stays with you", "Two signatures", "Verify anywhere".
- Sign a file (`/upload`): h1 "Sign a file", `Panel` holding the drop zone
  and progress, then the result: `Seal` around the QR (pressed when the record
  arrives), `RecordSummary`, primary "Download seal" (uses `composeSealPng`),
  secondary "Copy link", details "Raw record" with "Copy record".
- Verify (`/verify`): h1 "Verify", one `Panel` with sections "Load the
  record" and "Check the file" separated by a relief rule, then
  `VerifyResult`. Keep every existing `data-testid` and the existing
  behaviour; only the presentation changes.
- Record (`/sig/[signature]`): h1 "Record", `Seal` around a QR of the record,
  `RecordSummary` with hash and log index, raw record details, primary
  "Verify a file against this record".
- Prose pages (`/how-it-works`, `/privacy`): `prose` from the typography
  plugin themed to tokens (`--tw-prose-body: var(--ink)` and so on), headings in
  display face.
- `error.tsx`, `not-found.tsx`: `Panel` with eyebrow, a one-line explanation,
  one Button.
- Icons: `src/app/icon.tsx` and `src/app/apple-icon.tsx` render the `SealMark`
  with `ImageResponse`; delete the PNG and ICO icons in `src/app` and `src/`.

## Removed

`AnimatedBackground`, `GradientHeading`, `page.module.css`, emoji icons, the
"Secure • Ed25519 Verified" badge, and in `globals.css`: `.glass`,
`.glass-dark`, `.glow-*`, `.text-gradient-*`, `.card-hover`, the
`body::before` tint, the Arial font stack, the `.text-4xl` media override, and
the `float` / `pulse-slow` animations. `documentation/button-components-guide.md`
is superseded by this file.

## Copy rules

State the one true claim everywhere (README, metadata, hero): your browser
hashes the file and signs the hash with a key held in this browser;
ContentProof countersigns who, what and when; the service never holds your
key; anyone can verify against the published keys. Metadata description: "A
notary for files. Your browser hashes a file and signs it, ContentProof
countersigns who, what and when, and anyone can verify the seal."

## Guard rails

QR modules stay near-black on a white quiet zone. Keyboard focus is visible
on every control. `prefers-reduced-motion` disables the press. Existing tests
and `data-testid` hooks keep passing.
