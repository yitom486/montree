# Desktop contracts

`agent-inspection.ts` defines window-scoped Agent resource inspection IPC: observed MCP health/tool schemas, locally discovered Skill metadata/full instructions, and revealing a discovered Skill file. It never transports MCP tokens or runtime credentials.

`html-preview.ts` defines the isolated local HTML preview: the `montree-html` scheme, register/update/release IPC, and the postMessage bridge messages between the preview page and the host (page messages are untrusted and only trigger restricted actions).

`terminal.ts` defines app-specific terminal IPC messages; `inline-completion.ts` defines the editor ghost-text completion IPC shared by main, preload and renderer (including document/heading/block hints); `inline-completion-provider.ts` defines the dedicated completion provider config IPC, auth mode, ChatGPT login status, model list and dynamic `/models` listing; `web-doc.ts` extends the published online-document fetch contract with an optional Markdown source. Generic published contracts remain provided by `@yitom/contracts`; no local package substitution is used.
