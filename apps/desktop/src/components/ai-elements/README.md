# components/ai-elements

AI Elements 社区展示组合；手动获取官方 registry，不运行安装器覆盖现有 UI。

|文件|用途|
|---|---|
|`conversation.tsx`|Conversation/Content/ScrollButton，基于 use-stick-to-bottom|
|`message.tsx`|Message/MessageContent 通用消息结构|
|`reasoning.tsx`|Reasoning/Trigger/Content 思考与计划折叠，Radix 管理受控状态|
|`prompt-input.tsx`|PromptInput/Textarea/Footer/Submit、附件标签/预览、IME/Enter/Shift+Enter/Backspace；AttachmentBridge 连接 Electron 附件元数据|
|`tool.tsx`|Tool 折叠组合、ACP 中文状态徽标；取消/未知不冒充成功|
|`LICENSE`|当前官方上游 Apache-2.0 许可证原文件|

来源（2026-10-12）：https://registry.ai-sdk.dev/{conversation,message,reasoning,prompt-input}.json；文档 https://elements.ai-sdk.dev 。**实际许可证为 Apache-2.0**（https://github.com/vercel/ai-elements/blob/main/LICENSE）；之前仅按文档写为 MIT 的记录已纠正。Tool 是文档组合适配，其他四件来自 registry 源码，截取实际使用导出。无发布版本可锁，按来源日期与上游 source content SHA-256 追溯：

|registry|SHA-256（UTF-8 source content）|
|---|---|
|conversation|3BB9EE948956C2F6BE118BCD8C48F5C21F84973F0CC4497EF49D4685B36B1689|
|message|F30F81E3DD357DFB65E56CC96068FBA955552072D77938739600CB24380CC964|
|reasoning|68371ED6EFF5CEE50B5550EE9F3E5AB4B1F86A08A8122A93A407D7A5778B3D58|
|prompt-input|E9551CE9685296ACB47797C7EA8177F1B3B3AA2BF110287ADBAC86CE05E2551A|

本地差异：复用已有 radix-ui，不引入 Next.js。Message Props 支持 React 19 ref；Reasoning 内容由已消毒的 AgentMarkdown 提供，默认收起且用户选择保留；删除未使用的语音/菜单/分支导出，默认文案中文。PromptInput 添 AttachmentBridge，文件字节、路径边界、图片能力与 ACP 编码仍由宿主处理；附件按钮支持键盘可见焦点、44px 命中、预览不超过窗口。ConversationScrollButton 使用 instant 避免强制动画。

真实依赖：use-stick-to-bottom 1.1.6、@radix-ui/react-use-controllable-state 1.2.6、nanoid 6.0.2；ai 7.0.137 仅 type imports（FileUIPart/UIMessage/ChatStatus），不创建 AI SDK Runtime、工具执行器或供应商客户端。Streamdown 2.7.0 及官方 code 2.0.0/mermaid 1.0.3/math 1.0.3/cjk 1.0.4 在 AgentMarkdown 懒块接入。锁文件 bun.lock 为准。

通用文字揭示、代码高亮/复制/下载、图表缩放、滚动跟随、输入键盘、弹窗焦点由社区接管。回合聚合、业务卡、审批幂等、文档身份/定位、沙箱策略是 Montree 产品桥接。assistant-ui ExternalStoreRuntime 本轮已评估：当前 ACP/Zustand 会话与审批仍是唯一执行源，未具备分支/编辑/再生成后端语义，额外 Runtime 没有本轮功能收益且要重复转换工具状态，故不接入。未来有对应产品功能时再评估。
