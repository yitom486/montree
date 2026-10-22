# Desktop contracts

`terminal.ts` defines app-specific terminal IPC messages; `inline-completion.ts` defines the editor ghost-text completion IPC shared by main, preload and renderer (including document/heading/block hints); `inline-completion-provider.ts` defines the dedicated completion provider config IPC, auth mode, ChatGPT login status, model list and dynamic `/models` listing; `web-doc.ts` extends the published online-document fetch contract with an optional Markdown source. Generic published contracts remain provided by `@yitom/contracts`; no local package substitution is used.
