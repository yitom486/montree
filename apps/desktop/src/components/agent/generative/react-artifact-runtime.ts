import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'

// 浏览器构建输入：独立打包为 iframe 内联运行库，不在主进程加载 React。
Object.assign(globalThis, { __artifactModules: { react: React, 'react-dom/client': ReactDOM, 'react/jsx-runtime': JSXRuntime } })
