---
name: montree-render
description: Montree reply-rendering rules for rich answers. Read when producing diagrams, comparisons, quizzes, or interactive widgets in the Montree Agent panel. Pure documentation; no scripts, no tools.
---

# Montree Render Skill (pure documentation)

This skill is a **knowledge source only**. It registers no tools and executes
nothing. Montree MCP tools (`montree_diagram_guide`, `montree_markdown_guide`,
`montree_present`, `montree_generate_diagram`) remain the only tool entry points;
their schemas come from MCP `tools/list`.

## When to read this skill

- The user asks for a flowchart, sequence, architecture, mind map, swimlane,
  timeline, fishbone, cycle, or ER diagram.
- The user wants to compare chapters, explore citations, or take a reading quiz.
- A custom interactive widget is genuinely needed (last resort).

## Diagram path (bounded simple graphs only)

1. Call `montree_diagram_guide(diagramType)` first and follow its exact bounds.
2. Call `montree_present(kind="preset", preset="diagram", diagramType, title,
   nodes, edges)`: parameters only, never SVG/JSX source or coordinates.
3. Keep labels short; label decision exits. Mind maps must be a connected
   parent-to-child tree. Split oversized graphs instead of overflowing.
4. Simple flowcharts/sequences/mindmaps may use a fenced ```mermaid block
   with short node labels instead of a tool call.

## Present presets (already-read content only)

- `chapter-comparison`: 2–6 already-read chapters, explicit dimension/excerpt items.
- `citation-guide`: 1–6 chapters, citations [{label,chapterKey,excerpt,note?}];
  excerpts must match the source.
- `reading-quiz`: 1–6 chapters, questions [{question,options:[text,...]}];
  selections come back to this session for feedback, not automatic scoring.
- `html-artifact`: single offline file, no external resources.
- `react-artifact`: one JSX/TSX default-export component (<=96KiB),
  css <=16KiB; only react, react/jsx-runtime, react-dom/client imports.
  No CDN, network, filesystem, or host API.

Claim a component exists only after the tool call succeeds.
Simple facts need only text.

## Markdown documents (not chat)

For interactive content inside a Markdown file, call
`montree_markdown_guide` first and edit through the document tools
(`montree_text_edit` with fresh revision). `montree_present` only displays
in chat and never inserts content into a file.

## Inline reply semantics (Agent panel Markdown)

GFM tables, task lists (read-only), footnotes, KaTeX (`$…$` inline,
`$$…$$` block), Shiki fenced code (always tag the language), Mermaid.
`<details><summary>Title</summary>…</details>` (`open` allowed).
`==highlight==`, `^sup^`, `~sub~`, `<kbd>keys</kbd>`.
Raw HTML beyond `details`/`summary`/`kbd` is stripped—never emit
div/span/script/iframe/img tags, and never write React/JSX source in reply
text (it renders as plain text, not components).

## Positioning a result inside a reply

After a successful montree_present call, you may embed its result between explanatory paragraphs using a standalone fenced block with language montree-present and only the returned result id as its body. Reference each result once, in the same user turn; never invent ids or put HTML/JSX in this block. Unreferenced results remain separate cards. This syntax is chat-only, not the Markdown document format.

Example (replace the id with the tool result id):

Explanation before.

```montree-present
present-result-id
```

Explanation after.
