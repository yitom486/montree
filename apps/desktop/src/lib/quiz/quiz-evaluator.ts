import type { QuizGrade, QuizQuestion, QuizAnswerSubmission } from '@montree/contracts'
import { calculateQuizGrade } from '@montree/contracts'
import { sendQuizPrompt } from './quiz-acp-session'

/**
 * 构造批量出题的 Prompt（随机多元启发式，默认 count 道）
 */
export function buildBatchQuestionPrompt(
  passage: string,
  count: number = 3,
  chapterTitle?: string,
): string {
  return `你是一位博学敏锐、擅长启发深度阅读的导师。请阅读以下图书文本：

【书籍章节】：${chapterTitle || '正文'}
【原书重点论述】：
"""
${passage.trim()}
"""

请针对上述重点文段，随机且多角度地设计 ${count} 道富有启发性的深度思考题（避免死记硬背的字面填空，注重考查理解推演、因果逻辑、批判反思或现实联想）。
每道题请提供：
1. title: 简短题目标题（8字以内）
2. tag: 轻量认知分类标签（如：概念认知、逻辑因果、批判反思、实践迁移、细节辨析）
3. prompt: 具体的思考题内容（措辞富有启发性与引导性）
4. keyPoints: 2~3 个核心采分要点（用于后续衡量读者回答是否击中要害）

请严格输出以下 JSON 格式，不要附带多余闲聊：
\`\`\`json
{
  "questions": [
    {
      "title": "题目标题",
      "tag": "概念认知",
      "prompt": "具体的提问内容...",
      "keyPoints": [
        "采分要点1",
        "采分要点2"
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

/**
 * 解析批量出题返回
 */
export function parseBatchQuestionsResponse(
  raw: string,
): Array<{ title: string; tag?: string; prompt: string; keyPoints: string[] }> | null {
  const parsed = extractJsonFromResponse<
    | { questions?: Array<{ title?: string; tag?: string; prompt?: string; keyPoints?: string[] }> }
    | Array<{ title?: string; tag?: string; prompt?: string; keyPoints?: string[] }>
  >(raw)

  if (!parsed) return null

  const list = Array.isArray(parsed) ? parsed : parsed.questions
  if (!Array.isArray(list) || list.length === 0) return null

  const results: Array<{ title: string; tag?: string; prompt: string; keyPoints: string[] }> = []
  for (const item of list) {
    if (item && item.prompt && item.prompt.trim()) {
      results.push({
        title: item.title?.trim() || '重点思考',
        tag: item.tag?.trim() || '核心理解',
        prompt: item.prompt.trim(),
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
 * 离线启发式考官出题（支持 count 题，多角度生成）
 */
export function generateFallbackQuestions(
  passage: string,
  count: number = 3,
  chapterTitle?: string,
  markId?: string,
): QuizQuestion[] {
  const preview = passage.trim().slice(0, 32)
  const templates = [
    {
      title: '核心观点理解与复述',
      tag: '概念理解',
      prompt: `原书在此论述道：“${preview}……”。请结合上下文，用你自己的语言阐明作者在此处的核心论述与深层意图。`,
      keyPoints: ['准确提炼本段核心主旨', '阐明作者的核心论据或论证逻辑'],
    },
    {
      title: '逻辑因果与论证推演',
      tag: '逻辑推导',
      prompt: `结合本段重点，作者做出这一判断的前提假设是什么？它与全书的主题有何逻辑呼应？`,
      keyPoints: ['剖析该结论的成立前提与背景', '阐释其与全书核心脉络的关联'],
    },
    {
      title: '批判思考与现实迁移',
      tag: '批判延伸',
      prompt: `作者在这一段落的论点是否存在可能的局限性或反例？如果置于当代或不同背景下，应如何理解其适用边界？`,
      keyPoints: ['指出该观点的适用情境与局限边界', '能结合其他经验进行合理推论与反思'],
    },
    {
      title: '修辞意图与细节辨析',
      tag: '细节辨析',
      prompt: `关注作者在文段中的用词与叙述口吻，为什么选择这样的表述？表达了作者怎样的态度倾向？`,
      keyPoints: ['分析作者独特的用词意图', '体会行文背后的情感或学术立场'],
    },
    {
      title: '跨章节主旨连接',
      tag: '综合概括',
      prompt: `将此段论述与您所了解的同类观点或前后文对比，您认为它带来最重要的启发或反直觉认识是什么？`,
      keyPoints: ['建立观点的多维对比链接', '提炼总结突破传统认知的启发点'],
    },
  ]

  const selected = templates.slice(0, Math.min(count, templates.length))
  return selected.map((t, idx) => ({
    id: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    title: t.title,
    tag: t.tag,
    prompt: t.prompt,
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
 * 离线启发式批量判卷
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
    const ans = (userAnswers[q.id] || '').trim()
    const score = ans.length > 50 ? 88 : ans.length > 15 ? 75 : ans.length > 0 ? 60 : 40
    const grade = calculateQuizGrade(score)
    const sub: QuizAnswerSubmission = {
      questionId: q.id,
      userAnswer: ans,
      score,
      grade,
      feedback: `作答清晰（共 ${ans.length} 字），较好地涉及了要点。结合前后章节思考理解将更加深刻。`,
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
): Promise<{ questions: QuizQuestion[]; fallback: boolean }> {
  const promptText = buildBatchQuestionPrompt(passage, count, chapterTitle)
  const rawResponse = await sendQuizPrompt(promptText)

  if (!rawResponse) {
    return { questions: generateFallbackQuestions(passage, count, chapterTitle, markId), fallback: true }
  }

  const parsed = parseBatchQuestionsResponse(rawResponse)
  if (!parsed || parsed.length === 0) {
    return { questions: generateFallbackQuestions(passage, count, chapterTitle, markId), fallback: true }
  }

  return {
    questions: parsed.map((item, idx) => ({
      id: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      title: item.title,
      tag: item.tag,
      prompt: item.prompt,
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
