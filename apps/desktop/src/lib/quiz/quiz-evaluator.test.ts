import { describe, expect, it } from 'vitest'
import {
  buildEvaluationPrompt,
  buildSingleQuestionPrompt,
  evaluateFallbackAnswer,
  generateFallbackQuestion,
  generateFallbackQuestions,
  parseBatchEvaluationResponse,
  parseBatchQuestionsResponse,
  parseEvaluationResponse,
  parseQuestionResponse,
} from './quiz-evaluator'
import type { QuizQuestion } from '@montree/contracts'

describe('quiz-evaluator', () => {
  it('builds question prompt containing passage and chapter', () => {
    const prompt = buildSingleQuestionPrompt('满纸荒唐言，一把辛酸泪。', '第一回')
    expect(prompt).toContain('满纸荒唐言')
    expect(prompt).toContain('第一回')
    expect(prompt).toContain('json')
  })

  it('parses valid question JSON from markdown response', () => {
    const raw = `
当然，这里为您准备的深度思考题如下：
\`\`\`json
{
  "title": "太虚幻境与命运谶语辨析",
  "prompt": "请结合贾宝玉梦游太虚幻境的经历，分析作者如何借判词实现‘预叙’手法的运用？",
  "keyPoints": ["判词与人物悲剧命运的映射", "宏观预叙结构的文学功能"]
}
\`\`\`
希望对您的阅读有所启发！
`
    const parsed = parseQuestionResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.title).toBe('太虚幻境与命运谶语辨析')
    expect(parsed?.keyPoints).toHaveLength(2)
  })

  it('builds evaluation prompt with question and user answer', () => {
    const q: QuizQuestion = {
      id: 'q1',
      title: '测试题目',
      prompt: '请分析作者意图。',
      keyPoints: ['要点1', '要点2'],
      sourceExcerpt: '这是原书段落。',
    }
    const evalPrompt = buildEvaluationPrompt(q, '我的作答是关于要点1的深入分析。')
    expect(evalPrompt).toContain('测试题目')
    expect(evalPrompt).toContain('这是原书段落')
    expect(evalPrompt).toContain('我的作答是关于要点1')
  })

  it('parses valid evaluation JSON response and assigns proper grade', () => {
    const raw = `
\`\`\`json
{
  "score": 92,
  "hitKeyPoints": ["要点1"],
  "missedKeyPoints": ["要点2"],
  "feedback": "作答精准，逻辑严密，建议后续关注结构呼应。"
}
\`\`\`
`
    const parsed = parseEvaluationResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.score).toBe(92)
    expect(parsed?.grade).toBe('A')
    expect(parsed?.hitKeyPoints).toContain('要点1')
  })

  it('provides sensible fallback question and evaluation when offline', () => {
    const fallbackQ = generateFallbackQuestion('三十年为一世，而道更也。', '编者按', 'mark-1')
    expect(fallbackQ.sourceExcerpt).toBe('三十年为一世，而道更也。')
    expect(fallbackQ.markId).toBe('mark-1')

    const fallbackEval = evaluateFallbackAnswer(
      fallbackQ,
      '作者认为三十年是一个时代的大周期，思想与社会结构在此发生更替。',
    )
    expect(fallbackEval.score).toBeGreaterThan(60)
    expect(fallbackEval.feedback).toContain('字')
  })

  it('parses raw unfenced JSON with leading conversational preamble', () => {
    const raw = `Natural English: Please design an insightful deep-reading question about the highlighted passage and provide two or three standard scoring points in the specified JSON format.
{
  "title": "多重视角下的中国农村研究",
  "prompt": "这四部著作分别从受苦者叙事、农民反行为、村庄生活和农业不确定性等角度研究中国农村。它们共同提示我们：理解农村历史是否必须结合个体经验、社会行为、村庄日常与次级结构？请说明这些视角之间可能形成的互补关系，并分析单一视角可能带来的局限。",
  "keyPoints": [
    "指出四部著作分别代表微观故事、社会行为、村庄生活与宏观结构的相互补充。",
    "说明综合这些视角有助于把个体苦难、群体行动、日常生活的制度或环境因素联系起来。",
    "能够批判性分析单一视角的局限，如过度微观化、忽视主体经验、或过度抽象化、难以解释整体机制。"
  ]
}`
    const parsed = parseQuestionResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.title).toBe('多重视角下的中国农村研究')
    expect(parsed?.prompt).toContain('这四部著作分别从受苦者叙事')
    expect(parsed?.keyPoints).toHaveLength(3)
  })

  it('builds and parses multi-question batch responses with tags', () => {
    const raw = `
\`\`\`json
{
  "questions": [
    {
      "title": "农村微观经验认知",
      "tag": "概念认知",
      "prompt": "请概括作者所说的微观受苦者经验的核心意涵。",
      "keyPoints": ["个体受苦叙事", "日常生活逻辑"]
    },
    {
      "title": "次级制度逻辑推演",
      "tag": "逻辑推导",
      "prompt": "村庄制度与农民反行为之间存在怎样的互动逻辑？",
      "keyPoints": ["反行为的诱因", "制度弹性的双向制约"]
    },
    {
      "title": "跨学科视角反思",
      "tag": "批判反思",
      "prompt": "结合当代视角，过度强调微观叙事可能带来哪些认识局限？",
      "keyPoints": ["宏观结构遮蔽", "主体主观化偏差"]
    }
  ]
}
\`\`\`
`
    const parsed = parseBatchQuestionsResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed).toHaveLength(3)
    expect(parsed![0].title).toBe('农村微观经验认知')
    expect(parsed![0].tag).toBe('概念认知')
    expect(parsed![1].tag).toBe('逻辑推导')
    expect(parsed![2].tag).toBe('批判反思')
  })

  it('generates fallback questions with requested count', () => {
    const questions = generateFallbackQuestions('书籍重点文字段落', 3, '第二章')
    expect(questions).toHaveLength(3)
    expect(questions[0].tag).toBe('概念理解')
    expect(questions[1].tag).toBe('逻辑推导')
    expect(questions[2].tag).toBe('批判延伸')
  })

  it('parses batch evaluation response across all questions', () => {
    const q1: QuizQuestion = {
      id: 'q-1',
      title: '第1题',
      prompt: '问题1',
      keyPoints: ['要点1'],
      sourceExcerpt: '摘录',
    }
    const q2: QuizQuestion = {
      id: 'q-2',
      title: '第2题',
      prompt: '问题2',
      keyPoints: ['要点2'],
      sourceExcerpt: '摘录',
    }
    const raw = `
\`\`\`json
{
  "totalScore": 88,
  "overallFeedback": "整卷作答展现了深刻的逻辑见解。",
  "evaluations": [
    {
      "questionId": "q-1",
      "score": 90,
      "hitKeyPoints": ["要点1"],
      "missedKeyPoints": [],
      "feedback": "第1题回答很棒。"
    },
    {
      "questionId": "q-2",
      "score": 86,
      "hitKeyPoints": ["要点2"],
      "missedKeyPoints": [],
      "feedback": "第2题论证扎实。"
    }
  ]
}
\`\`\`
`
    const evaluated = parseBatchEvaluationResponse(raw, [q1, q2], {
      'q-1': '我的答案1',
      'q-2': '我的答案2',
    })
    expect(evaluated).not.toBeNull()
    expect(evaluated?.totalScore).toBe(88)
    expect(evaluated?.grade).toBe('B')
    expect(evaluated?.submissions['q-1'].score).toBe(90)
    expect(evaluated?.submissions['q-2'].score).toBe(86)
  })
})
