# Third-Party Notices

Montree itself is licensed under the MIT License (see [LICENSE](./LICENSE)).

This distribution includes third-party software and assets under their own
licenses. The sections below list the principal components that are bundled
with or required at runtime by Montree. The complete dependency graph and
versions are recorded in `bun.lock`.

Full license texts for the licenses referenced here are available under
[`LICENSES/`](./LICENSES/). Components that ship their own license file keep
that file in the source tree.

## Apache License 2.0

The following components are licensed under the Apache License, Version 2.0.
A copy of the license is provided in [`LICENSES/Apache-2.0.txt`](./LICENSES/Apache-2.0.txt).

| Component | Copyright / project |
|---|---|
| PDF.js (`pdfjs-dist`) | Mozilla and PDF.js contributors |
| Readability (`@mozilla/readability`) | Mozilla and Readability contributors |
| Tinymist / Typst runtime | Myriad-Dreamin, Typst GmbH and contributors (see `LICENSES/Tinymist.txt`) |
| Vercel AI SDK (`ai`, `@ai-sdk/*`) | Vercel, Inc. |
| Google GenAI SDK (`@google/genai`) | Google LLC |
| Streamdown (`streamdown`, `@streamdown/*`) | Vercel, Inc. |
| Univer (`@univerjs/*`) | Univer team |
| Agent Client Protocol SDK (`@agentclientprotocol/sdk`) | Zed Industries and contributors |
| AI Elements (`apps/desktop/src/components/ai-elements`) | Vercel, Inc. (see `apps/desktop/src/components/ai-elements/LICENSE`) |
| `docx-preview` | docx-preview contributors |
| `fast-diff` | Jason Chen |
| `xlsx` | SheetJS LLC |
| `codemirror-lang-typst` | codemirror-lang-typst contributors |

## MIT License

The following components are licensed under the MIT License. The project's
own MIT text is in [`LICENSE`](./LICENSE); each package also retains its
original copyright notice.

| Component | Copyright / project |
|---|---|
| foliate-js | Copyright (c) 2022 John Factotum (see `third-party/foliate-js/LICENSE`) |
| beUI | Copyright (c) 2026 Saurabh Chauhan (see `apps/desktop/src/components/agent/LICENSE.beui`) |
| beautiful-ui | Copyright (c) 2026 Shane Levine (see `apps/desktop/src/components/agent/LICENSE.beautiful-ui`) |
| shadcn/ui | Copyright (c) 2023 shadcn (see `apps/desktop/src/components/ui/LICENSE.md`) |
| assistant-ui (`@assistant-ui/react`) | assistant-ui contributors |
| React / React DOM | Meta Platforms, Inc. and affiliates |
| Radix UI (`radix-ui`) | WorkOS and Radix contributors |
| Zustand | Poimandres contributors |
| TanStack Query | TanStack contributors |
| CodeMirror packages | Marijn Haverbeke and contributors |
| markdown-it and plugins | markdown-it contributors |
| Mermaid | Mermaid contributors |
| KaTeX | Khan Academy and KaTeX contributors |
| Sonner | Emil Kowalski |
| `@firecrawl/pdf-inspector` | Firecrawl |
| `electron` | Electron contributors |
| `electron-updater` | Electron Builder contributors |
| `node-pty` | Microsoft Corporation |
| `@montree/*` workspace packages | Montree contributors |
| `@yitom/*` packages | Yitom contributors |

Other MIT-licensed transitive dependencies are listed in `bun.lock` and keep
their license metadata in their published packages.

## BSD 3-Clause

| Component | Copyright / project |
|---|---|
| `highlight.js` | highlight.js contributors (see `LICENSES/BSD-3-Clause.txt`) |
| `zip.js` (vendored by foliate-js) | zip.js contributors |
| PDF.js CMaps | Adobe and PDF.js contributors (see `third-party/foliate-js/vendor/pdfjs/cmaps/LICENSE`) |

## ISC License

| Component | Copyright / project |
|---|---|
| `lucide-react` | Lucide contributors (see `LICENSES/ISC.txt`) |
| `d3-drag`, `d3-selection` | Mike Bostock |
| `markdown-it-task-lists` | Markdown-It contributors |
| `vanilla-jsoneditor` | Jos de Jong |

## Dual-licensed components

| Component | License choice |
|---|---|
| `dompurify` | `MPL-2.0 OR Apache-2.0`; Montree uses the Apache-2.0 option |
| `jszip` | `MIT OR GPL-3.0-or-later`; Montree uses the MIT option |

## Build-time only

`lightningcss` is MPL-2.0 and is used only while building the renderer CSS.
It is not included in the packaged application.

## Fonts and standard font resources

PDF.js standard font data and CMaps are distributed with their original
license files:

- `third-party/foliate-js/vendor/pdfjs/standard_fonts/LICENSE_FOXIT`
- `third-party/foliate-js/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION`
- `third-party/foliate-js/vendor/pdfjs/cmaps/LICENSE`

## Notes

- This file is provided for attribution and compliance; it is not legal
  advice.
- If you redistribute Montree, keep this file, the root `LICENSE`, the
  `LICENSES/` directory, and any per-component license files with the
  distribution.
