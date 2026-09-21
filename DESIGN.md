---
name: SIXDOGS
description: One system, two registers. Briefing is a printed field order on paper; HUD is a tactical overlay on a dark field. Both share server gold, faction colours, the avatar and a phone-first type floor.
colors:
  gold: "#c9a227"
  faction-blue: "#3a7bd5"
  faction-red: "#d13b3b"
  faction-green: "#3aa655"
  briefing-paper: "#e2e4da"
  briefing-ink: "#14160f"
  briefing-ink-soft: "#3c4130"
  briefing-olive: "#4d5530"
  briefing-rule: "#9aa08a"
  briefing-stamp-red: "#a3261f"
  briefing-slip: "#f1f1ea"
  briefing-chip: "#2d3124"
  hud-field: "#0c0e0a"
  hud-terminal: "#080a07"
  hud-well: "#1a1507"
  hud-line: "#2e3326"
  hud-text: "#e9e8df"
  hud-dim: "#a7ab98"
  hud-gold-hi: "#e3bc3c"
  hud-alert: "#e5483f"
  hud-ok: "#5fc46f"
typography:
  briefing-display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "196px"
    fontWeight: 800
    lineHeight: 0.84
    letterSpacing: "-0.01em"
  briefing-headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "64px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
  briefing-title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "70px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
  briefing-body:
    fontFamily: "Barlow, Arial, sans-serif"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: 1.38
  briefing-label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
  hud-display:
    fontFamily: "Chakra Petch, sans-serif"
    fontSize: "172px"
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: "-0.02em"
  hud-title:
    fontFamily: "Chakra Petch, sans-serif"
    fontSize: "64px"
    fontWeight: 700
    lineHeight: 1
  hud-body:
    fontFamily: "Chakra Petch, sans-serif"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: 1.38
  lede:
    fontFamily: "Barlow, Chakra Petch, sans-serif"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1.35
  mono-command:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1
  mono-message:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1.45
  mono-label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
rounded:
  none: "0px"
  chip: "3px"
  sm: "4px"
  stamp: "6px"
  full: "50%"
spacing:
  hud-gutter: "64px"
  briefing-gutter: "72px"
  index-column: "120px"
  inset: "22px 26px"
  card: "30px 36px 34px"
  section: "56px"
components:
  briefing-header-strip:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.briefing-ink}"
    typography: "{typography.briefing-label}"
    padding: "26px 72px"
  typed-command:
    backgroundColor: "{colors.briefing-ink}"
    textColor: "{colors.briefing-slip}"
    typography: "{typography.mono-command}"
    rounded: "{rounded.sm}"
    padding: "{spacing.inset}"
  message-slip:
    backgroundColor: "{colors.briefing-slip}"
    textColor: "{colors.briefing-ink}"
    typography: "{typography.mono-message}"
    rounded: "{rounded.none}"
    padding: "{spacing.inset}"
  perk-icon-tab:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.briefing-ink}"
    rounded: "{rounded.sm}"
    size: "84px"
  hud-terminal:
    backgroundColor: "{colors.hud-terminal}"
    textColor: "{colors.hud-text}"
    typography: "{typography.mono-command}"
    rounded: "{rounded.none}"
    padding: "22px 24px"
  hud-status-unverified:
    textColor: "{colors.hud-alert}"
    typography: "{typography.mono-label}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
  hud-status-linked:
    textColor: "{colors.hud-ok}"
    typography: "{typography.mono-label}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
  hud-waypoint-card:
    textColor: "{colors.hud-dim}"
    typography: "{typography.hud-body}"
    rounded: "{rounded.none}"
    padding: "{spacing.card}"
  hud-hazard-warning:
    backgroundColor: "{colors.hud-well}"
    textColor: "{colors.hud-gold-hi}"
    rounded: "{rounded.none}"
    padding: "30px 34px"
---

# Design System: SIXDOGS

## Overview

**Creative North Star: "Orders From Your Commander"**

SIXDOGS visuals are standing orders for a team game: short, numbered, unmistakable, and followable on a phone in one pass. The system has two registers that carry the same content in the same order. **Briefing** is a printed field order: grey-green paper, black ink, gold used like a highlighter and tab fill, a rubber stamp for the one hard rule. **HUD** is a mission overlay: near-black olive field under a faint gold grid, gold strokes and corner brackets, hazard stripes for the one hard rule, a route of waypoints. Pick one register per surface; never blend them on one canvas.

Density is low and type is huge because the canvas is 1080px wide and is read at roughly 400px on a phone. Everything shared (gold, faction colours, avatar, voice, command syntax in mono, the legibility floor) is fixed; everything register-specific (paper vs field, Barlow vs Chakra Petch, stamp vs hazard, rules vs brackets) stays in its register.

**Key Characteristics:**
- Two registers, one content spine: rule, four steps, what you get.
- Server gold #c9a227 appears on every surface; the SIXDOGS avatar (gold disc, dark square "6", see design/logo/) sits top left.
- Real commands and codes are always set in JetBrains Mono, exactly as typed.
- Body text never below 34px on the 1080px canvas.
- Plain, warm, direct copy. No em dashes, no invented numbers.

## Colors

Shared gold and faction colours, plus one neutral set per register.

### Primary
- **Server Gold** (gold): the brand constant. Briefing uses it as fill (header strip, highlighter band, perk icon tabs, the code in a message); HUD uses it as stroke (grid, brackets, waypoint pins, route line, prompt).
- **Signal Gold** (hud-gold-hi): HUD only; the brighter gold for values the player types or reads (command arguments, the code, warning headline) on the dark field.

### Secondary
- **Faction Blue / Red / Green** (faction-blue, faction-red, faction-green): Blue = Lonestar, Red = Valkyra, Green = Manticore. Used only to identify teams, as small square swatches with the colour name beside them. Never decorative, never for status.

### Tertiary
- **Stamp Red** (briefing-stamp-red): Briefing only; the rubber stamp for the kick rule.
- **Alert Red** (hud-alert) and **Linked Green** (hud-ok): HUD only; the status readout before (UNVERIFIED) and after (LINKED).

### Neutral
- **Field Paper** (briefing-paper), **Carbon Ink** (briefing-ink), **Worn Ink** (briefing-ink-soft, body copy), **Drab Olive** (briefing-olive, "In game." / "In Discord." lead-ins and the success tick), **Pencil Rule** (briefing-rule, dashed dividers), **Message Slip** (briefing-slip), **Chip Dark** (briefing-chip, argument chips in typed commands).
- **Night Field** (hud-field), **Terminal Black** (hud-terminal), **Hazard Well** (hud-well, inside the hazard frame), **Grid Line** (hud-line, dividers), **Readout White** (hud-text), **Dim Readout** (hud-dim, body copy).

### Named Rules
**The Gold Everywhere Rule.** Every SIXDOGS surface carries #c9a227. Briefing fills with it, HUD strokes with it; neither swaps it for a nearby yellow.

**The Team Colour Rule.** Faction colours only ever mean a faction, and always appear with their colour name.

## Typography

**Briefing:** Barlow Condensed (display, headings, labels) with Barlow (body).
**HUD:** Chakra Petch (display, headings, body).
**Both:** JetBrains Mono for typed commands, codes, the in-game message and HUD readouts.

Fonts are self-hosted woff2 (`design/verify-guide/fonts/`) so renders are offline and exact.

**Character:** Briefing reads as stencilled print; HUD reads as squared-off instrument type. Mono is the shared "this is literal" voice.

### Hierarchy
- **Display** (Briefing 800, 196px, 0.84; HUD 700, 172px, 0.86): the one title, uppercase, stacked on two lines. HUD sets its second word in gold.
- **Headline** (Briefing 800, 64px): numbered order sections (1. Situation, 2. Execution, 3. What you get).
- **Title** (800/700, 62 to 70px): step and perk names, uppercase.
- **Lede** (500, 38px, 1.35): one sentence under the title, key clause bolded.
- **Body** (500, 34 to 36px, 1.38): step copy, max about 800 to 880px measure. Bold (600/700) marks the words a player must act on.
- **Label** (700, 28px, tracked 0.06 to 0.14em, uppercase): header strip, status readouts, footer, message header.

### Named Rules
**The Phone Floor Rule.** The canvas is 1080px and is read at about 400px wide. Body text is at least 34px; labels and argument chips are at least 28px. Nothing smaller ships.

**The Literal Mono Rule.** Anything the player types or reads back (commands, arguments, codes, the in-game message) is JetBrains Mono. Nothing else is.

## Layout

Single fixed column, 1080px wide, exported as a tall PNG. Briefing uses a 72px gutter and a 120px left index column holding section numbers and phase letters (A to D), with content to its right; sections are split by 4px ink rules. HUD uses a 64px gutter; steps hang off a dashed gold route line with 78px hex waypoint pins in a 108px left lane. Both follow the same order: identity bar, title, lede, the rule, four steps, perks, footer (help line plus team swatches). Vertical rhythm is generous (40 to 66px between blocks) because the image is scrolled, not scanned.

## Elevation & Depth

Flat. No drop shadows in either register. Briefing gets depth from material: a multiplied paper-grain noise and an ink-bleed filter on the stamp. HUD gets depth from layering: a 54px gold grid at 5.5% opacity, faint scanlines, translucent gold fills (8%) and borders (45 to 55%).

### Named Rules
**The Material Not Shadow Rule.** Paper texture or field grid carries depth. Nothing floats.

## Shapes

Briefing is square with slight wear: 4px on command bars and icon tabs, 3px on argument chips, 6px on the stamp (rotated -9deg), circles for the avatar and success tick. HUD is hard-edged: 0px everywhere except the round avatar, with gold L-shaped corner brackets (34px, 4px stroke) on cards and the loadout panel, hexagonal waypoint pins, and a -45deg gold/black hazard stripe frame.

## Components

### Identity Bar
- **Briefing:** full-bleed gold strip, avatar (62px, ink ring then gold ring) plus SIXDOGS, surface name right, label type.
- **HUD:** avatar plus tracked SIXDOGS left, bordered status readout right (UNVERIFIED in alert red with a square pip).

### Typed Command
The signature shared component: shows exactly what to type. Dark bar, mono 38px, argument name in a muted chip, sample value in gold, a gold caret. Briefing: ink bar, 4px radius, thin caret. HUD: terminal black with 2px olive border, square corners, block cursor, gold prompt.

### In-Game Message
Mono 34px mock of the private message with a 28px mono header; the code on a gold band. Briefing: light slip with 3px ink border. HUD: 2px gold border over an 8% gold wash. Mockups are illustrative until real screenshots exist.

### The Rule (kick warning)
- **Briefing:** a red rotated rubber stamp beside the Situation paragraph, the key clause gold-highlighted.
- **HUD:** hazard-stripe frame (14px) around a dark well, warning triangle, headline in signal gold.

### Steps
- **Briefing:** lettered phases in the index column, dashed pencil dividers, olive "In game." / "In Discord." lead-in.
- **HUD:** bracketed cards on the route, gold lead-in; the route ends in a green pin and STATUS: LINKED.

### Perks
- **Briefing:** 84px gold icon tab with ink line icon, ink rule above each.
- **HUD:** "Loadout unlocked" heading with fading gold rule, bracketed panel, gold line icons.

Icons are inline SVG line drawings (4px stroke on a 52 grid), never glyph fonts.

## Do's and Don'ts

### Do:
- **Do** put gold #c9a227 and the SIXDOGS avatar on every surface.
- **Do** choose one register per surface and keep its fonts, neutrals and depth devices together.
- **Do** keep body at 34px or more and labels at 28px or more on a 1080px canvas.
- **Do** show commands exactly as typed, in mono, with a realistic sample value.
- **Do** show faction colours as swatch plus colour name (Blue, Red, Green).

### Don't:
- **Don't** mix registers (no paper grain on the HUD field, no brackets or hazard stripes on the Briefing).
- **Don't** use rounded app cards or drop shadows in either register.
- **Don't** use faction colours for status or decoration.
- **Don't** write em dashes, stock AI phrasing, or invented stats and player counts.

## Chosen register

The owner picked **Briefing** as the SIXDOGS house style (2026-09-19). New graphics use the Briefing register; HUD stays documented as an alternate.
