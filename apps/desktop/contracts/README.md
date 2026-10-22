# Desktop contracts

`terminal.ts` defines app-specific terminal IPC messages; `inline-completion.ts` defines the editor ghost-text completion IPC shared by main, preload and renderer; `web-doc.ts` extends the published online-document fetch contract with an optional Markdown source. Generic published contracts remain provided by `@yitom/contracts`; no local package substitution is used.
