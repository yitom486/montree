import type {
  QuizGrade,
  QuizQuestion,
  QuizAnswerSubmission,
  QuizConfig,
  QuizQuestionType,
} from '@montree/contracts'
import { calculateQuizGrade } from '@montree/contracts'
import { sendQuizPrompt } from './quiz-acp-session'

/**
 * 构造批量出题的 Prompt（支持用户自定义题型配比、优先知识卡片与章节延伸，包含选择题、简答题、论述或设计题）
 */
export function buildBatchQuestionPrompt(
  passage: string,
  count: number = 3,
  chapterTitle?: string,
  config?: QuizConfig,
): string {
  const typesDesc = config?.enabledTypes && config.enabledTypes.length > 0
    ? `本次指定出题类型为：${config.enabledTypes
        .map((t) => (t === 'choice' ? '选择题(choice)' : t === 'short_answer' ? '简答题(short_answer)' : t === 'essay_design' ? '论述或设计题(essay_design)' : t))
        .join('、')}。请严格仅在这些指定类型中分配组合。`
    : `本次试卷涵盖三种系统题型：1. 客观选择题(choice)；2. 概念机制简答题(short_answer)；3. 场景论述或方案设计题(essay_design)。请系统化组合出卷。`

  return `你是一位博学严谨、擅长启发深度阅读与工程落地的书籍考官导师。请阅读以下图书文本及提炼要点：

【书籍章节】：${chapterTitle || '正文'}
【重点卡片与原书论述】：
"""
${passage.trim()}
"""

请针对上述内容，进行系统化深度出题（共设计 ${count} 道考题）：
【出题核心原则】：
1. 优先聚焦上述提炼出的核心概念、批注与重点卡片；若提供了章节其他背景，请将其作为问题情境与深度延展的依托，紧密结合书中的实际原理与技术实现；
2. ${typesDesc}

【三种系统题型的具体规约】：
- choice（选择题）：结合书中原理或事实细节，考查概念辨析。必须提供 options（4个选项，包含 A/B/C/D 前缀）、correctOption（正确项字母如 "A"）与 explanation（选项依据解析）；
- short_answer（简答题）：考查核心机制原理、因果逻辑链条或运行流程，要求读者精炼准确回答关键逻辑；
- essay_design（论述或设计题）：结合书中实际原理，提出一个真实或仿真的应用场景、复杂问题或系统设计需求，要求读者进行架构方案设计、参数权衡决策或批判反思推演，并提供 designRequirements（2~3个核心设计考查维度清单）。

请严格输出以下 JSON 格式，不要附带多余闲聊：
\`\`\`json
{
  "questions": [
    {
      "title": "简短标题(8字内)",
      "tag": "概念辨析/核心机理/方案设计/批判反思",
      "type": "choice 或 short_answer 或 essay_design",
      "prompt": "具体生动的提问或设计要求内容...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correctOption": "A",
      "explanation": "原书中明确阐述了...",
      "designRequirements": ["设计要点1", "设计要点2"],
      "keyPoints": [
        "核心采分要点1",
        "核心采分要点2"
      ]
    }
  ]
}
\`\`\`
`
}

/**
 * 构造批量判卷打分的 Prompt
 */
export function buildBatchEvaluationPrompt(
  questions: QuizQuestion[],
  userAnswers: Record<string, string>,
): string {
  const itemsText = questions
    .map((q, idx) => {
      const ans = (userAnswers[q.id] || '').trim() || '（未作答）'
      return `【第 ${idx + 1} 题】(ID: ${q.id})
题目：${q.title} [${q.tag || '重点理解'}]
提问：${q.prompt}
原书依据：“${q.sourceExcerpt}”
预设采分要点：
${q.keyPoints.map((kp, kIdx) => `  ${kIdx + 1}. ${kp}`).join('\n')}
读者作答：
"""
${ans}
"""`
    })
    .join('\n\n--------------------\n\n')

  return `你是一位严谨而循循善诱的书籍阅读考官。现在请对读者的整份答卷进行逐题批改并给出综合成绩。

${itemsText}

请仔细对比读者的作答与原书论述，对每道题客观评估：
1. score: 该题得分（0~100 分）；
2. hitKeyPoints: 读者已准确阐述或命中的采分要点；
3. missedKeyPoints: 读者遗漏或理解有偏差的采分要点；
4. feedback: 针对该题的精炼点评与启发（80字以内）。

并给出整卷总分 totalScore（各题平均分）与整体评价 overallFeedback。

请严格按以下 JSON 格式输出：
\`\`\`json
{
  "totalScore": 85,
  "overallFeedback": "整份答卷体现了对核心主旨的扎实理解，若能在反例辨析上展开会更加完整。",
  "evaluations": [
    {
      "questionId": "${questions[0]?.id || 'q-1'}",
      "score": 85,
      "hitKeyPoints": ["准确命中的要点"],
      "missedKeyPoints": ["遗漏的要点"],
      "feedback": "该题点评..."
    }
  ]
}
\`\`\`
`
}

/**
 * 兼容旧版：构造单题出题 Prompt
 */
export function buildSingleQuestionPrompt(passage: string, chapterTitle?: string): string {
  return buildBatchQuestionPrompt(passage, 1, chapterTitle)
}

/**
 * 兼容旧版：构造单题判卷打分 Prompt
 */
export function buildEvaluationPrompt(question: QuizQuestion, userAnswer: string): string {
  return buildBatchEvaluationPrompt([question], { [question.id]: userAnswer })
}

/**
 * 稳健提取大模型返回的 JSON 对象或数组
 */
export function extractJsonFromResponse<T>(raw: string): T | null {
  try {
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    const jsonStr = codeBlockMatch ? codeBlockMatch[1] : raw.trim()

    const firstBrace = jsonStr.indexOf('{')
    const lastBrace = jsonStr.lastIndexOf('}')
    const firstBracket = jsonStr.indexOf('[')
    const lastBracket = jsonStr.lastIndexOf(']')

    let candidate = ''
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      if (lastBrace > firstBrace) {
        candidate = jsonStr.slice(firstBrace, lastBrace + 1)
      }
    } else if (firstBracket !== -1 && lastBracket > firstBracket) {
      candidate = jsonStr.slice(firstBracket, lastBracket + 1)
    }

    if (candidate) {
      return JSON.parse(candidate) as T
    }
    return null
  } catch {
    return null
  }
}

export interface ParsedBatchQuestion {
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

/**
 * 解析批量出题返回
 */
export function parseBatchQuestionsResponse(
  raw: string,
): ParsedBatchQuestion[] | null {
  const parsed = extractJsonFromResponse<
    | {
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
      }
    | Array<{
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
  >(raw)

  if (!parsed) return null

  const list = Array.isArray(parsed) ? parsed : parsed.questions
  if (!Array.isArray(list) || list.length === 0) return null

  const results: ParsedBatchQuestion[] = []
  for (const item of list) {
    if (item && item.prompt && item.prompt.trim()) {
      results.push({
        title: item.title?.trim() || '重点思考',
        tag: item.tag?.trim() || '核心理解',
        type: item.type || (Array.isArray(item.options) && item.options.length > 0 ? 'choice' : 'short_answer'),
        prompt: item.prompt.trim(),
        options: Array.isArray(item.options) ? item.options.map((o) => String(o).trim()).filter(Boolean) : undefined,
        correctOption: item.correctOption?.trim(),
        explanation: item.explanation?.trim(),
        designRequirements: Array.isArray(item.designRequirements)
          ? item.designRequirements.map((r) => String(r).trim()).filter(Boolean)
          : undefined,
        keyPoints: Array.isArray(item.keyPoints)
          ? item.keyPoints.map((k) => String(k).trim()).filter(Boolean)
          : ['深入理解核心论点'],
      })
    }
  }

  return results.length > 0 ? results : null
}

/**
 * 兼容旧版：解析单题返回
 */
export function parseQuestionResponse(
  raw: string,
): { title: string; prompt: string; keyPoints: string[] } | null {
  const batch = parseBatchQuestionsResponse(raw)
  if (batch && batch.length > 0) {
    return {
      title: batch[0].title,
      prompt: batch[0].prompt,
      keyPoints: batch[0].keyPoints,
    }
  }

  const parsed = extractJsonFromResponse<{
    title?: string
    prompt?: string
    keyPoints?: string[]
  }>(raw)

  if (!parsed || !parsed.prompt) return null

  return {
    title: parsed.title?.trim() || '重点要点思考',
    prompt: parsed.prompt.trim(),
    keyPoints: Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints.map((s) => String(s).trim()).filter(Boolean)
      : ['深入理解核心论点'],
  }
}

/**
 * 批量判卷解析
 */
export function parseBatchEvaluationResponse(
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

  if (!parsed || !Array.isArray(parsed.evaluations) || parsed.evaluations.length === 0) {
    return null
  }

  const submissions: Record<string, QuizAnswerSubmission> = {}
  let scoreSum = 0

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const evalItem =
      parsed.evaluations.find((e) => e.questionId === q.id) || parsed.evaluations[i]

    const rawScore = evalItem && typeof evalItem.score === 'number' ? evalItem.score : 70
    const score = Math.max(0, Math.min(100, Math.round(rawScore)))
    scoreSum += score

    const grade = calculateQuizGrade(score)
    const feedback = evalItem?.feedback?.trim() || '作答体现了一定理解，结合原书上下文深入思考会有更多收获。'
    const hitKeyPoints = Array.isArray(evalItem?.hitKeyPoints)
      ? evalItem!.hitKeyPoints.map((s) => String(s).trim()).filter(Boolean)
      : []
    const missedKeyPoints = Array.isArray(evalItem?.missedKeyPoints)
      ? evalItem!.missedKeyPoints.map((s) => String(s).trim()).filter(Boolean)
      : []

    submissions[q.id] = {
      questionId: q.id,
      userAnswer: userAnswers[q.id] || '',
      score,
      grade,
      feedback,
      hitKeyPoints,
      missedKeyPoints,
      gradedAt: new Date().toISOString(),
    }
  }

  const avg = Math.round(scoreSum / questions.length)
  const totalScore = typeof parsed.totalScore === 'number' ? parsed.totalScore : avg
  const overallFeedback =
    parsed.overallFeedback?.trim() || `整卷作答完毕，平均得分 ${totalScore} 分。`

  return {
    submissions,
    totalScore,
    grade: calculateQuizGrade(totalScore),
    overallFeedback,
  }
}

/**
 * 兼容旧版：解析单题判卷返回
 */
export function parseEvaluationResponse(raw: string): {
  score: number
  grade: QuizGrade
  feedback: string
  hitKeyPoints: string[]
  missedKeyPoints: string[]
} | null {
  const parsed = extractJsonFromResponse<{
    score?: number
    feedback?: string
    hitKeyPoints?: string[]
    missedKeyPoints?: string[]
  }>(raw)

  if (!parsed) return null

  const rawScore = typeof parsed.score === 'number' ? parsed.score : 70
  const score = Math.max(0, Math.min(100, Math.round(rawScore)))
  const grade = calculateQuizGrade(score)
  const feedback =
    parsed.feedback?.trim() || '作答体现了一定理解，结合原书上下文深入思考会有更多收获。'
  const hitKeyPoints = Array.isArray(parsed.hitKeyPoints)
    ? parsed.hitKeyPoints.map((s) => String(s).trim()).filter(Boolean)
    : []
  const missedKeyPoints = Array.isArray(parsed.missedKeyPoints)
    ? parsed.missedKeyPoints.map((s) => String(s).trim()).filter(Boolean)
    : []

  return {
    score,
    grade,
    feedback,
    hitKeyPoints,
    missedKeyPoints,
  }
}

/**
 * 离线启发式考官出题（支持 count 题，包含深度论述题与单选辨析等多角度生成）
 */
export function generateFallbackQuestions(
  passage: string,
  count: number = 3,
  chapterTitle?: string,
  markId?: string,
  config?: QuizConfig,
): QuizQuestion[] {
  const preview = passage.trim().slice(0, 32)
  const templates: Array<{
    title: string
    tag: string
    type: QuizQuestionType
    prompt: string
    options?: string[]
    correctOption?: string
    explanation?: string
    designRequirements?: string[]
    keyPoints: string[]
  }> = [
    {
      title: '核心观点理解与复述',
      tag: '概念理解',
      type: 'short_answer',
      prompt: `原书在此论述道：“${preview}……”。请结合上下文，用你自己的语言阐明作者在此处的核心论述与深层意图。`,
      keyPoints: ['准确提炼本段核心主旨', '阐明作者的核心论据或论证逻辑'],
    },
    {
      title: '逻辑因果与论证推演',
      tag: '逻辑推导',
      type: 'choice',
      prompt: `结合本段论述，作者得出该结论的核心前提假设或逻辑传导机制最符合以下哪一项？`,
      options: [
        'A. 论据建立在全局一致且不可逆的边界假定之上',
        'B. 仅仅是修辞上的比喻，不具备实际推导意义',
        'C. 忽略了历史背景，直接套用普遍经验',
        'D. 结论仅适用于极端特例情况',
      ],
      correctOption: 'A',
      explanation: '原文紧密围绕核心边界条件展开，A 项最精准地概括了作者论证所依托的逻辑基石。',
      keyPoints: ['剖析该结论的成立前提与背景', '阐释其与全书核心脉络的关联'],
    },
    {
      title: '批判思考与现实迁移',
      tag: '批判延伸',
      type: 'short_answer',
      prompt: `作者在这一段落的论点是否存在可能的局限性或反例？如果置于当代或不同背景下，应如何理解其适用边界？`,
      keyPoints: ['指出该观点的适用情境与局限边界', '能结合其他经验进行合理推论与反思'],
    },
    {
      title: '场景方案设计与权衡',
      tag: '方案设计',
      type: 'essay_design',
      prompt: `结合原书核心思想（“${preview}……”），请设想一个需要应用此原理的实际系统或业务场景，设计你的具体落地架构方案，并深入权衡其优缺点。`,
      designRequirements: ['方案完整性与边界界定', '核心关键指标达成路径', '风险预案与妥协权衡'],
      keyPoints: ['实际工程方案构思', '关键技术指标权衡', '局限性与风险反思'],
    },
    {
      title: '修辞意图与细节辨析',
      tag: '细节辨析',
      type: 'choice',
      prompt: `关注作者在文段中的用词与叙述口吻，最能体现作者学术立场或态度倾向的是哪一项？`,
      options: [
        'A. 严谨求证，审慎界定概念的外延与内涵',
        'B. 绝对武断，拒绝任何对立立场的讨论',
        'C. 随性抒情，缺乏严谨的理论支撑',
        'D. 模棱两可，未表达清晰的态度',
      ],
      correctOption: 'A',
      explanation: '作者在行文用词中体现了严密的逻辑思辨与对适用范围的严谨界定。',
      keyPoints: ['分析作者独特的用词意图', '体会行文背后的情感或学术立场'],
    },
    {
      title: '跨章节主旨连接',
      tag: '综合概括',
      type: 'short_answer',
      prompt: `将此段论述与您所了解的同类观点或前后文对比，您认为它带来最重要的启发或反直觉认识是什么？`,
      keyPoints: ['建立观点的多维对比链接', '提炼总结突破传统认知的启发点'],
    },
  ]

  // 若用户指定了题型，优先筛选符合配置的题型
  let pool = templates
  if (config?.enabledTypes && config.enabledTypes.length > 0) {
    const matched = templates.filter((t) => config.enabledTypes.includes(t.type))
    if (matched.length > 0) pool = matched
  }

  const selected = pool.slice(0, Math.min(count, pool.length))
  return selected.map((t, idx) => ({
    id: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    title: t.title,
    tag: t.tag,
    type: t.type,
    prompt: t.prompt,
    options: t.options,
    correctOption: t.correctOption,
    explanation: t.explanation,
    designRequirements: t.designRequirements,
    keyPoints: t.keyPoints,
    sourceExcerpt: passage.trim(),
    chapterTitle,
    markId,
  }))
}

/**
 * 兼容旧版：单题离线出题
 */
export function generateFallbackQuestion(
  passage: string,
  chapterTitle?: string,
  markId?: string,
): QuizQuestion {
  return generateFallbackQuestions(passage, 1, chapterTitle, markId)[0]
}

/**
 * 离线启发式批量判卷（支持选择题与论述题客观评分）
 */
export function evaluateFallbackAnswers(
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
    const rawAns = (userAnswers[q.id] || '').trim()

    if (q.type === 'choice' && q.correctOption) {
      // 选择题客观评分：比对选项字母前缀
      const userChoice = rawAns.toUpperCase()
      const isCorrect = userChoice.startsWith(q.correctOption.toUpperCase())
      const score = isCorrect ? 100 : rawAns ? 40 : 0
      const grade = calculateQuizGrade(score)
      const sub: QuizAnswerSubmission = {
        questionId: q.id,
        userAnswer: rawAns,
        score,
        grade,
        feedback: isCorrect
          ? `作答正确！${q.explanation || '准确抓住了核心逻辑关键点。'}`
          : `作答有误（正确答案为 ${q.correctOption}）。${q.explanation || '请比对原文要点重新审视题干。'}`,
        hitKeyPoints: isCorrect ? q.keyPoints : [q.keyPoints[0] || '核心概念认识'],
        missedKeyPoints: isCorrect ? [] : q.keyPoints.slice(1),
        gradedAt: new Date().toISOString(),
      }
      submissions[q.id] = sub
      total += score
      continue
    }

    // 主观论述题评分
    const score = rawAns.length > 50 ? 88 : rawAns.length > 15 ? 75 : rawAns.length > 0 ? 60 : 40
    const grade = calculateQuizGrade(score)
    const sub: QuizAnswerSubmission = {
      questionId: q.id,
      userAnswer: rawAns,
      score,
      grade,
      feedback: `作答清晰（共 ${rawAns.length} 字），较好地涉及了要点。结合前后章节思考理解将更加深刻。`,
      hitKeyPoints: [q.keyPoints[0] || '核心要点理解'],
      missedKeyPoints: q.keyPoints.slice(1),
      gradedAt: new Date().toISOString(),
    }
    submissions[q.id] = sub
    total += score
  }

  const avg = questions.length > 0 ? Math.round(total / questions.length) : 70
  return {
    submissions,
    totalScore: avg,
    grade: calculateQuizGrade(avg),
    overallFeedback: `整卷作答完毕，平均得分 ${avg} 分。`,
  }
}

/**
 * 兼容旧版：单题离线判卷
 */
export function evaluateFallbackAnswer(
  question: QuizQuestion,
  userAnswer: string,
): {
  score: number
  grade: QuizGrade
  feedback: string
  hitKeyPoints: string[]
  missedKeyPoints: string[]
} {
  const res = evaluateFallbackAnswers([question], { [question.id]: userAnswer })
  const sub = res.submissions[question.id]
  return {
    score: sub.score,
    grade: sub.grade,
    feedback: sub.feedback,
    hitKeyPoints: sub.hitKeyPoints,
    missedKeyPoints: sub.missedKeyPoints,
  }
}

/**
 * 发起 ACP / AI 批量出题（真实调用云端/本地大模型）
 * `fallback` 为真表示模型无响应，已退回离线启发题库（调用方须如实提示用户）。
 */
export async function generateQuestionsWithAi(
  passage: string,
  count: number = 3,
  chapterTitle?: string,
  markId?: string,
  config?: QuizConfig,
): Promise<{ questions: QuizQuestion[]; fallback: boolean }> {
  const promptText = buildBatchQuestionPrompt(passage, count, chapterTitle, config)
  const rawResponse = await sendQuizPrompt(promptText)

  if (!rawResponse) {
    return { questions: generateFallbackQuestions(passage, count, chapterTitle, markId, config), fallback: true }
  }

  const parsed = parseBatchQuestionsResponse(rawResponse)
  if (!parsed || parsed.length === 0) {
    return { questions: generateFallbackQuestions(passage, count, chapterTitle, markId, config), fallback: true }
  }

  return {
    questions: parsed.map((item, idx) => ({
      id: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      title: item.title,
      tag: item.tag,
      type: item.type,
      prompt: item.prompt,
      options: item.options,
      correctOption: item.correctOption,
      explanation: item.explanation,
      keyPoints: item.keyPoints,
      sourceExcerpt: passage.trim(),
      chapterTitle,
      markId,
    })),
    fallback: false,
  }
}

/**
 * 兼容旧版：单题出题
 */
export async function generateQuestionWithAi(
  passage: string,
  chapterTitle?: string,
  markId?: string,
): Promise<QuizQuestion> {
  const { questions } = await generateQuestionsWithAi(passage, 1, chapterTitle, markId)
  return questions[0]
}

/**
 * 发起 ACP / AI 批量判卷
 * `fallback` 为真表示模型无响应，已退回离线启发式判卷（调用方须如实提示用户；
 * submissions 形状不变，直存测验库无污染）。
 */
export async function evaluateAnswersWithAi(
  questions: QuizQuestion[],
  userAnswers: Record<string, string>,
): Promise<{
  submissions: Record<string, QuizAnswerSubmission>
  totalScore: number
  grade: QuizGrade
  overallFeedback: string
  fallback: boolean
}> {
  const promptText = buildBatchEvaluationPrompt(questions, userAnswers)
  const rawResponse = await sendQuizPrompt(promptText)

  if (!rawResponse) {
    return { ...evaluateFallbackAnswers(questions, userAnswers), fallback: true }
  }

  const parsed = parseBatchEvaluationResponse(rawResponse, questions, userAnswers)
  if (!parsed) {
    return { ...evaluateFallbackAnswers(questions, userAnswers), fallback: true }
  }

  return { ...parsed, fallback: false }
}

/**
 * 兼容旧版：单题判卷
 */
export async function evaluateAnswerWithAi(
  question: QuizQuestion,
  userAnswer: string,
): Promise<QuizAnswerSubmission> {
  const result = await evaluateAnswersWithAi([question], { [question.id]: userAnswer })
  return result.submissions[question.id]
}
