import { mkdtemp } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

let tempUserData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserData,
  },
}))

import { closeAllBookDbs } from './book-db/open-book-db'
import { closeAllMontreeDbs } from './app-db/open-app-db'
import { callAdaptedMontreeTool } from './acp/mcp/montree-mcp-server'
import { appendQuizSession, readAllQuizSessions, readQuizSessionsByFile } from './quiz-service'
import { clearQuizFingerprintCache } from './quiz-db'
import { calculateQuizGrade, isOk } from '@montree/contracts'
import type {
  QuizAnswerSubmission,
  QuizConfig,
  QuizGrade,
  QuizQuestion,
  QuizQuestionType,
  QuizSessionRecord,
} from '@montree/contracts'

function extractJsonFromResponse<T>(raw: string): T | null {
  try {
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : raw).trim()
    const firstBrace = jsonStr.indexOf('{')
    const lastBrace = jsonStr.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(jsonStr.slice(firstBrace, lastBrace + 1)) as T
    }
    return JSON.parse(jsonStr) as T
  } catch {
    return null
  }
}

interface ParsedBatchQuestion {
  title: string
  tag?: string
  prompt: string
  keyPoints: string[]
  type?: QuizQuestionType
  options?: string[]
  correctOption?: string
  explanation?: string
  designRequirements?: string[]
}

function buildBatchQuestionPrompt(
  passage: string,
  count: number = 3,
  chapterTitle?: string,
  config?: QuizConfig,
): string {
  const typesDesc = config?.enabledTypes && config.enabledTypes.length > 0
    ? `指定类型：${config.enabledTypes.join('、')}`
    : `三种题型：choice, short_answer, essay_design`

  return `【章节】：${chapterTitle || '正文'}
【重点卡片与原书论述】：
${passage}
【出题要求】：共 ${count} 题。${typesDesc}
请输出 JSON 格式。`
}

function parseBatchQuestionsResponse(raw: string): ParsedBatchQuestion[] | null {
  const parsed = extractJsonFromResponse<{
    questions?: Array<{
      title?: string
      tag?: string
      type?: QuizQuestionType
      prompt?: string
      options?: string[]
      correctOption?: string
      explanation?: string
      designRequirements?: string[]
      keyPoints?: string[]
    }>
  }>(raw)

  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) return null

  return parsed.questions
    .filter((q) => q && q.prompt && q.prompt.trim())
    .map((item) => ({
      title: item.title?.trim() || '重点思考',
      tag: item.tag?.trim() || '核心理解',
      type: item.type || (Array.isArray(item.options) && item.options.length > 0 ? 'choice' : 'short_answer'),
      prompt: item.prompt!.trim(),
      options: Array.isArray(item.options) ? item.options.map((o) => String(o).trim()).filter(Boolean) : undefined,
      correctOption: item.correctOption?.trim(),
      explanation: item.explanation?.trim(),
      designRequirements: Array.isArray(item.designRequirements)
        ? item.designRequirements.map((r) => String(r).trim()).filter(Boolean)
        : undefined,
      keyPoints: Array.isArray(item.keyPoints)
        ? item.keyPoints.map((k) => String(k).trim()).filter(Boolean)
        : ['深入理解核心论点'],
    }))
}

function buildBatchEvaluationPrompt(
  questions: QuizQuestion[],
  userAnswers: Record<string, string>,
): string {
  return `判卷：
${questions.map((q) => `ID: ${q.id}, 读者作答: ${userAnswers[q.id] || ''}`).join('\n')}
请输出评分 JSON。`
}

function parseBatchEvaluationResponse(
  raw: string,
  questions: QuizQuestion[],
  userAnswers: Record<string, string>,
): {
  submissions: Record<string, QuizAnswerSubmission>
  totalScore: number
  grade: QuizGrade
  overallFeedback: string
} | null {
  const parsed = extractJsonFromResponse<{
    totalScore?: number
    overallFeedback?: string
    evaluations?: Array<{
      questionId?: string
      score?: number
      feedback?: string
      hitKeyPoints?: string[]
      missedKeyPoints?: string[]
    }>
  }>(raw)

  if (!parsed || !Array.isArray(parsed.evaluations) || parsed.evaluations.length === 0) return null

  const submissions: Record<string, QuizAnswerSubmission> = {}
  let scoreSum = 0

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const evalItem = parsed.evaluations.find((e) => e.questionId === q.id) || parsed.evaluations[i]
    const rawScore = evalItem && typeof evalItem.score === 'number' ? evalItem.score : 70
    const score = Math.max(0, Math.min(100, Math.round(rawScore)))
    scoreSum += score
    const grade = calculateQuizGrade(score)

    submissions[q.id] = {
      questionId: q.id,
      userAnswer: userAnswers[q.id] || '',
      score,
      grade,
      feedback: evalItem?.feedback?.trim() || '作答合理。',
      hitKeyPoints: evalItem?.hitKeyPoints || [],
      missedKeyPoints: evalItem?.missedKeyPoints || [],
      gradedAt: '2026-10-07T08:00:00.000Z',
    }
  }

  const avg = Math.round(scoreSum / questions.length)
  const totalScore = typeof parsed.totalScore === 'number' ? parsed.totalScore : avg

  return {
    submissions,
    totalScore,
    grade: calculateQuizGrade(totalScore),
    overallFeedback: parsed.overallFeedback?.trim() || `整卷评分完成：${totalScore}分`,
  }
}

function generateFallbackQuestions(
  passage: string,
  count: number = 3,
  chapterTitle?: string,
  markId?: string,
  config?: QuizConfig,
): QuizQuestion[] {
  const results: QuizQuestion[] = []
  const types = config?.enabledTypes && config.enabledTypes.length > 0
    ? config.enabledTypes
    : (['choice', 'short_answer', 'essay_design'] as QuizQuestionType[])

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length]
    results.push({
      id: `fallback-q-${i + 1}`,
      title: `备用考题 ${i + 1}`,
      type,
      prompt: `结合论述：“${passage.slice(0, 30)}……”，谈谈你的理解。`,
      options: type === 'choice' ? ['A. 符合原意', 'B. 存在偏差', 'C. 完全无关', 'D. 局限特例'] : undefined,
      correctOption: type === 'choice' ? 'A' : undefined,
      explanation: type === 'choice' ? '符合原文表述' : undefined,
      designRequirements: type === 'essay_design' ? ['指标权衡', '架构落地'] : undefined,
      keyPoints: ['准确掌握要点'],
      sourceExcerpt: passage,
      chapterTitle,
      markId,
    })
  }
  return results
}

function evaluateFallbackAnswers(
  questions: QuizQuestion[],
  userAnswers: Record<string, string>,
): {
  submissions: Record<string, QuizAnswerSubmission>
  totalScore: number
  grade: QuizGrade
  overallFeedback: string
} {
  const submissions: Record<string, QuizAnswerSubmission> = {}
  let total = 0
  for (const q of questions) {
    const ans = (userAnswers[q.id] || '').trim()
    const score = ans ? 85 : 40
    submissions[q.id] = {
      questionId: q.id,
      userAnswer: ans,
      score,
      grade: calculateQuizGrade(score),
      feedback: '已收到作答并完成初评。',
      hitKeyPoints: ['准确掌握要点'],
      missedKeyPoints: [],
      gradedAt: '2026-10-07T08:00:00.000Z',
    }
    total += score
  }
  const avg = Math.round(total / questions.length)
  return {
    submissions,
    totalScore: avg,
    grade: calculateQuizGrade(avg),
    overallFeedback: `整卷作答完毕，平均得分 ${avg} 分。`,
  }
}

afterEach(() => {
  closeAllBookDbs()
  closeAllMontreeDbs()
  clearQuizFingerprintCache()
})

async function withIsolatedUserData(fn: (dir: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'montree-quiz-mcp-flow-'))
  tempUserData = dir
  try {
    await fn(dir)
  } finally {
    closeAllBookDbs()
    closeAllMontreeDbs()
    clearQuizFingerprintCache()
    tempUserData = ''
    rmSync(dir, { recursive: true, force: true })
  }
  return dir
}

describe('AI 出题工具链与 MCP 全链路集成测试', () => {
  const testFile = 'D:/books/distributed-systems.pdf'
  const bookTitle = '分布式系统原理与工程实战'

  it('1. 完整链路：MCP 提取知识卡片与正文 → Mock 大模型出题(多题型) → 判卷与总评建议 → 数据库持久化验证', async () => {
    await withIsolatedUserData(async () => {
      // 步骤 A: 模拟大模型 Agent 调用 MCP 工具 montree_list_marks 提取读者高亮卡片
      const mockMcpContext = {
        readSnapshot: vi.fn(async (target: string, payload?: unknown) => {
          if (target === 'marks') {
            return JSON.stringify([
              {
                id: 'mark-cap',
                excerpt: '在网络分区发生时，系统必须在一致性与可用性之间做出取舍。',
                note: 'CAP 定理核心权衡原则',
                category: 'concept',
                title: 'CAP定理权衡',
              },
            ])
          }
          if (target === 'viewport.txt') {
            return '第一章 分布式共识基础：Raft 算法通过强 Leader 机制保障线性一致性写与日志复制。'
          }
          return ''
        }),
      }

      const marksMcpRes = await callAdaptedMontreeTool('montree_list_marks', mockMcpContext, { filter: 'all' })
      expect(marksMcpRes.content[0].text).toContain('CAP定理权衡')

      const readMcpRes = await callAdaptedMontreeTool('montree_read', mockMcpContext, { scope: 'viewport' })
      expect(readMcpRes.content[0].text).toContain('分布式共识基础')

      // 步骤 B: 读者配置试卷偏好（选择题、简答题、论述设计题），生成 Prompt
      const config: QuizConfig = {
        totalCount: 3,
        enabledTypes: ['choice', 'short_answer', 'essay_design'],
        focusOnCards: true,
        includeContext: true,
      }
      const prompt = buildBatchQuestionPrompt(
        `${marksMcpRes.content[0].text}\n\n${readMcpRes.content[0].text}`,
        3,
        '第一章 分布式共识基础',
        config,
      )
      expect(prompt).toContain('分布式共识基础')
      expect(prompt).toContain('choice')
      expect(prompt).toContain('essay_design')

      // 步骤 C: Mock 大模型返回结构化多题型考题（包含选择题、简答题、方案设计题）
      const mockLlmQuestionResponse = `\`\`\`json
{
  "questions": [
    {
      "title": "一致性协议辨析",
      "tag": "概念辨析",
      "type": "choice",
      "prompt": "在发生网络分区容错时，以下关于 CAP 定理的表述最严谨的是哪一项？",
      "options": [
        "A. 强一致性 (CP) 与高可用性 (AP) 必须做出取舍，无法同时达成",
        "B. 只要硬件性能足够，任何系统均可达成 CA 兼备且无视分区",
        "C. 分区容错性 (P) 是可选项，日常局域网中完全不会发生分区",
        "D. 最终一致性等价于强一致性"
      ],
      "correctOption": "A",
      "explanation": "原书中明确指出网络分区是客观物理事实，系统必须在 CP 与 AP 之间做出权衡。",
      "keyPoints": ["网络分区不可避免", "一致性与可用性的权衡机制"]
    },
    {
      "title": "Raft机制原理",
      "tag": "核心机理",
      "type": "short_answer",
      "prompt": "简述 Raft 算法如何利用任期 (Term) 与强 Leader 机制保障日志条目的线性提交？",
      "keyPoints": ["单任期唯一 Leader 保证", "过半数日志落盘确认机制"]
    },
    {
      "title": "同城双活架构方案",
      "tag": "方案设计",
      "type": "essay_design",
      "prompt": "请结合原书共识机制，设计一套同城双机房零数据丢失 (RPO=0) 的金融级部署方案，并权衡其延迟影响。",
      "designRequirements": [
        "零数据丢失 (RPO=0) 保障路径",
        "跨机房网络延迟与仲裁节点部署",
        "故障自动倒换与脑裂防御策略"
      ],
      "keyPoints": ["三副本跨机房放置（2+1+仲裁）", "同步日志复制协议", "网络延迟折中评估"]
    }
  ]
}
\`\`\``

      const parsedQuestions = parseBatchQuestionsResponse(mockLlmQuestionResponse)
      expect(parsedQuestions).not.toBeNull()
      expect(parsedQuestions).toHaveLength(3)

      const questions: QuizQuestion[] = parsedQuestions!.map((q, idx) => ({
        id: `q-flow-${idx + 1}`,
        title: q.title,
        tag: q.tag,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        correctOption: q.correctOption,
        explanation: q.explanation,
        designRequirements: q.designRequirements,
        keyPoints: q.keyPoints,
        sourceExcerpt: '分布式共识基础章节',
        chapterTitle: '第一章 分布式共识基础',
      }))

      // 步骤 D: 读者作答
      const userAnswers: Record<string, string> = {
        'q-flow-1': 'A. 强一致性 (CP) 与高可用性 (AP) 必须做出取舍',
        'q-flow-2': '通过严格递增的 Term 保证单一 Leader 权威，所有写操作必须经由 Leader 并在多数节点落盘后提交。',
        'q-flow-3': '采用 Raft 三节点模式，主机房 2 副本，同城备机房 1 副本加独立仲裁节点。通过同步网络复制实现 RPO=0，跨机房光纤延迟增加约 2ms。',
      }

      // 步骤 E: 构造判卷 Prompt 并 Mock 大模型判卷评分与整卷学习诊断建议
      const evalPrompt = buildBatchEvaluationPrompt(questions, userAnswers)
      expect(evalPrompt).toContain('读者作答')

      const mockLlmEvalResponse = `\`\`\`json
{
  "totalScore": 95,
  "overallFeedback": "整卷表现优异！读者对 CAP 权衡与 Raft 核心原理理解透彻，在同城双活架构设计中提出的三节点跨机房部署方案完整可行，展现了出色的工程落地权衡视野。",
  "evaluations": [
    {
      "questionId": "q-flow-1",
      "score": 100,
      "hitKeyPoints": ["网络分区不可避免", "一致性与可用性的权衡机制"],
      "missedKeyPoints": [],
      "feedback": "作答准确无误，完全理解 CAP 的核心权衡。"
    },
    {
      "questionId": "q-flow-2",
      "score": 92,
      "hitKeyPoints": ["单任期唯一 Leader 保证", "过半数日志落盘确认机制"],
      "missedKeyPoints": [],
      "feedback": "条理清晰，抓住了 Term 与多数确认的核心机制。"
    },
    {
      "questionId": "q-flow-3",
      "score": 93,
      "hitKeyPoints": ["三副本跨机房放置（2+1+仲裁）", "同步日志复制协议", "网络延迟折中评估"],
      "missedKeyPoints": [],
      "feedback": "方案严谨，双活机房延迟权衡与仲裁节点考量到位。"
    }
  ]
}
\`\`\``

      const evalResult = parseBatchEvaluationResponse(mockLlmEvalResponse, questions, userAnswers)
      expect(evalResult).not.toBeNull()
      expect(evalResult?.totalScore).toBe(95)
      expect(evalResult?.grade).toBe('A')
      expect(evalResult?.overallFeedback).toContain('整卷表现优异')

      // 步骤 F: 落库写入真实的 SQLite 数据库
      const sessionRecord: QuizSessionRecord = {
        id: 'session-integration-flow-1',
        bookTitle,
        filePath: testFile,
        chapterTitle: '第一章 分布式共识基础',
        createdAt: '2026-10-07T08:00:00.000Z',
        totalScore: evalResult!.totalScore,
        grade: evalResult!.grade,
        overallFeedback: evalResult!.overallFeedback,
        questions,
        submissions: evalResult!.submissions,
      }

      const appendRes = await appendQuizSession(sessionRecord)
      expect(isOk(appendRes)).toBe(true)

      // 步骤 G: 从数据库中查询并进行保真度回放断言
      const queried = await readQuizSessionsByFile(testFile)
      expect(isOk(queried)).toBe(true)
      if (!isOk(queried)) return

      expect(queried.value).toHaveLength(1)
      const persisted = queried.value[0]

      // 1. 整卷成绩与 AI 综合学习建议无损
      expect(persisted.totalScore).toBe(95)
      expect(persisted.grade).toBe('A')
      expect(persisted.overallFeedback).toBe(evalResult?.overallFeedback)

      // 2. 选择题选项、正确项与深度剖析完整无损
      const pChoice = persisted.questions.find((q) => q.id === 'q-flow-1')
      expect(pChoice?.type).toBe('choice')
      expect(pChoice?.options).toHaveLength(4)
      expect(pChoice?.correctOption).toBe('A')
      expect(pChoice?.explanation).toContain('CP 与 AP')

      // 3. 方案设计题考核维度清单完整无损
      const pDesign = persisted.questions.find((q) => q.id === 'q-flow-3')
      expect(pDesign?.type).toBe('essay_design')
      expect(pDesign?.designRequirements).toEqual([
        '零数据丢失 (RPO=0) 保障路径',
        '跨机房网络延迟与仲裁节点部署',
        '故障自动倒换与脑裂防御策略',
      ])

      // 4. 逐题批改与采分点比对完整无损
      expect(persisted.submissions['q-flow-1'].score).toBe(100)
      expect(persisted.submissions['q-flow-2'].hitKeyPoints).toHaveLength(2)
      expect(persisted.submissions['q-flow-3'].feedback).toContain('双活机房')
    })
  })

  it('2. 大模型输出鲁棒性测试：带对话闲聊前缀/后缀时精准提取 JSON 出题与判卷', async () => {
    // 模拟部分大模型在 JSON 前后输出自然语言问候
    const noisyQuestionOutput = `很高兴为您服务！根据您提供的章节内容，我设计了如下测验试卷：
{
  "questions": [
    {
      "title": "两阶段提交缺陷",
      "tag": "机制反思",
      "type": "choice",
      "prompt": "两阶段提交 (2PC) 协议最显著的系统性风险是什么？",
      "options": ["A. 协调者单点故障导致参与者阻塞", "B. 无法处理并发写", "C. 必须依赖外部时钟", "D. 仅支持单机运行"],
      "correctOption": "A",
      "explanation": "2PC 中协调者崩溃会导致所有处于 Prepare 状态的参与者无限期阻塞。",
      "keyPoints": ["单点故障", "资源阻塞"]
    }
  ]
}
希望这份考题对您的阅读有所启发，祝您学习愉快！`

    const parsed = parseBatchQuestionsResponse(noisyQuestionOutput)
    expect(parsed).not.toBeNull()
    expect(parsed).toHaveLength(1)
    expect(parsed![0].title).toBe('两阶段提交缺陷')
    expect(parsed![0].correctOption).toBe('A')

    // 判卷带对话前缀与代码块
    const noisyEvalOutput = `您好，我已经完成整份答卷的评阅工作，以下是批改报告：
\`\`\`json
{
  "totalScore": 88,
  "overallFeedback": "回答准确抓住了 2PC 协调者单点阻塞的痛点，继续保持！",
  "evaluations": [
    {
      "questionId": "q-1",
      "score": 88,
      "hitKeyPoints": ["单点故障"],
      "missedKeyPoints": [],
      "feedback": "核心答点命中准确。"
    }
  ]
}
\`\`\`
`
    const dummyQ: QuizQuestion = {
      id: 'q-1',
      title: '2PC缺陷',
      prompt: '问题',
      keyPoints: ['单点故障'],
      sourceExcerpt: '正文',
    }
    const evalRes = parseBatchEvaluationResponse(noisyEvalOutput, [dummyQ], { 'q-1': 'A' })
    expect(evalRes).not.toBeNull()
    expect(evalRes?.totalScore).toBe(88)
    expect(evalRes?.overallFeedback).toContain('回答准确抓住了 2PC')
  })

  it('3. 离线启发式平滑降级测试：大模型不可用时保证多题型生成、客观批改与安全落库', async () => {
    await withIsolatedUserData(async () => {
      // 当大模型超时或离线时，调用 generateFallbackQuestions
      const config: QuizConfig = {
        totalCount: 3,
        enabledTypes: ['choice', 'short_answer', 'essay_design'],
      }
      const fallbackQuestions = generateFallbackQuestions(
        '在金融分布式核心系统中，数据高可靠是第一原则。',
        3,
        '第一章 架构概述',
        'mark-1',
        config,
      )
      expect(fallbackQuestions).toHaveLength(3)
      // 必须包含选择题
      expect(fallbackQuestions.some((q) => q.type === 'choice')).toBe(true)

      // 读者作答
      const answers: Record<string, string> = {}
      for (const q of fallbackQuestions) {
        if (q.type === 'choice' && q.correctOption) {
          answers[q.id] = q.correctOption
        } else {
          answers[q.id] = '这是一段关于金融高可靠性架构方案的深度阐述。'
        }
      }

      // 离线客观判卷
      const evalRes = evaluateFallbackAnswers(fallbackQuestions, answers)
      expect(evalRes.totalScore).toBeGreaterThanOrEqual(60)
      expect(evalRes.overallFeedback).toContain('整卷作答完毕')

      // 落库验证
      const session: QuizSessionRecord = {
        id: 'session-fallback-e2e',
        bookTitle: '离线测试图书',
        filePath: 'D:/books/offline.epub',
        createdAt: new Date().toISOString(),
        totalScore: evalRes.totalScore,
        grade: evalRes.grade,
        overallFeedback: evalRes.overallFeedback,
        questions: fallbackQuestions,
        submissions: evalRes.submissions,
      }

      expect(isOk(await appendQuizSession(session))).toBe(true)
      const all = await readAllQuizSessions()
      expect(isOk(all)).toBe(true)
      if (!isOk(all)) return
      expect(all.value.some((s) => s.id === 'session-fallback-e2e')).toBe(true)
    })
  })
})
