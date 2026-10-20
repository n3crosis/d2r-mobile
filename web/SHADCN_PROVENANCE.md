# shadcn/ui source provenance

Components retrieved directly from the official shadcn/ui registry on 2026-10-20.
These are upstream component sources, not lookalike reimplementations.
The functional source adaptation is `from "cn"` → `from "@/lib/utils"` for the standard local clsx/tailwind-merge helper.

- `button.tsx`: https://ui.shadcn.com/r/styles/new-york-v4/button.json
  Registry response SHA-256: `4b8d7d848742727973c1b088af8d15f0b628272a1316f2d2fa344e73ddff9e9c`
- `card.tsx`: https://ui.shadcn.com/r/styles/new-york-v4/card.json
  Registry response SHA-256: `c7ebaa49ba2a0613838558f3892c5007523c2dc26d6b36a244145d454a796106`
- `alert.tsx`: https://ui.shadcn.com/r/styles/new-york-v4/alert.json
  Registry response SHA-256: `413c97869ec0e53efa4a37f590833bcf4a7a57255f5a2e909c6bb5bac7b4570d`

Setup: https://ui.shadcn.com/docs/installation/vite
License: MIT, https://github.com/shadcn-ui/ui/blob/main/LICENSE.md

The copied components also receive standard Prettier formatting under the workspace
configuration. The hashes above identify original registry responses, not the
locally formatted files. Formatting does not introduce custom component styles.
