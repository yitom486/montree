import { BookOpen, Code2, Columns2, Ellipsis, ExternalLink, Minimize2, Plus, Plug, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Agent 聊天头部 ⋯ 溢出菜单：新对话 / 清空 / 模式切换。
 * 头部常驻只剩连接区（运行时下拉 + 状态 + 连接/断开）与关闭，
 * 其余动作收进此处——窄面板不再挤成一排。
 */
export interface AgentHeaderOverflowMenuProps {
  /** 悬浮小窗模式（决定展示最小化/停靠还是悬浮化） */
  floating: boolean
  /** 对话进行中：新建/清空致灰 */
  actionDisabled?: boolean
  /** Agent 是否声明会话级 code mode（PTC）；未声明时不显示开关 */
  codeModeSupported?: boolean
  /** 当前线程的 code mode 请求；只影响下一次 new/resume */
  codeMode?: boolean
  onToggleCodeMode?: (enabled: boolean) => void
  onNewThread: () => void
  onClearMessages: () => void
  onMinimizeToCapsule?: () => void
  onDockPanel?: () => void
  onFloatPanel?: () => void
  onInspectMcp?: () => void
  onInspectSkills?: () => void
}

export function AgentHeaderOverflowMenu({
  floating,
  actionDisabled = false,
  codeModeSupported = false,
  codeMode = false,
  onToggleCodeMode,
  onNewThread,
  onClearMessages,
  onMinimizeToCapsule,
  onDockPanel,
  onFloatPanel,
  onInspectMcp,
  onInspectSkills,
}: AgentHeaderOverflowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg"
          title="更多面板操作"
          aria-label="更多面板操作"
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={actionDisabled} onClick={onNewThread}>
          <Plus className="size-4" />
          新对话
        </DropdownMenuItem>
        <DropdownMenuItem disabled={actionDisabled} onClick={onClearMessages}>
          <Trash2 className="size-4" />
          清空当前对话
        </DropdownMenuItem>
        {onInspectMcp ? <DropdownMenuItem onSelect={onInspectMcp}><Plug className="size-4" />MCP 连接详情</DropdownMenuItem> : null}
        {onInspectSkills ? <DropdownMenuItem onSelect={onInspectSkills}><BookOpen className="size-4" />Skills 技能详情</DropdownMenuItem> : null}
        {codeModeSupported ? (
          <DropdownMenuCheckboxItem
            checked={codeMode}
            onCheckedChange={(checked) => onToggleCodeMode?.(checked === true)}
            title="模型改为写代码，通过 tools.<name>() 调用全部工具；仅对下次新建/恢复会话生效"
          >
            <Code2 className="size-4" />
            Code mode（PTC）
          </DropdownMenuCheckboxItem>
        ) : null}
        {floating ? (
          <>
            {onMinimizeToCapsule ? (
              <DropdownMenuItem onClick={onMinimizeToCapsule}>
                <Minimize2 className="size-4" />
                最小化为极简胶囊
              </DropdownMenuItem>
            ) : null}
            {onDockPanel ? (
              <DropdownMenuItem onClick={onDockPanel}>
                <Columns2 className="size-4" />
                停靠回侧栏
              </DropdownMenuItem>
            ) : null}
          </>
        ) : onFloatPanel ? (
          <DropdownMenuItem onClick={onFloatPanel}>
            <ExternalLink className="size-4" />
            切换为悬浮伴读小窗
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
