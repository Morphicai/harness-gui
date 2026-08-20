/**
 * scripted channel —— 预置答案，供自动化测试
 *
 * 不启动任何界面、不产生任何 IO。这是「让依赖人工的流程无人值守跑通」的那把钥匙。
 */

import { Channel, Interaction, Outcome, isOneWay } from '../types.js'

export interface TranscriptEntry {
  kind: Interaction['kind']
  title: string
  /** 双向交互才有：本次交给它的预置答案 */
  answered?: Outcome
}

export class ScriptedChannel implements Channel {
  readonly name = 'scripted'
  private queue: Outcome[]
  private transcriptLog: TranscriptEntry[] = []

  constructor(answers: Outcome[] = []) {
    this.queue = [...answers]
  }

  /** 追加预置答案 */
  push(...answers: Outcome[]): this {
    this.queue.push(...answers)
    return this
  }

  supports(): boolean {
    return true
  }

  async present(i: Interaction): Promise<Outcome> {
    /*
     * 单向交互只记录、不消费预置答案：否则每写一条 notify 都得在测试里配一个答案，
     * 噪音大且容易让「答案对不上号」——而那种错位极难排查。
     */
    if (isOneWay(i)) {
      this.transcriptLog.push({ kind: i.kind, title: i.title })
      return { action: 'accept', channel: this.name }
    }

    if (this.queue.length === 0) {
      const n = this.transcriptLog.length + 1
      throw new Error(
        `[harness-gui:scripted] ran out of scripted answers on interaction #${n}: ` +
          `${i.kind} "${i.title}". An unexpected extra interaction in a test is usually a ` +
          `defect signal, so it is surfaced rather than swallowed.`
      )
    }

    const answered = this.queue.shift() as Outcome
    this.transcriptLog.push({ kind: i.kind, title: i.title, answered })
    return { ...answered, channel: this.name }
  }

  /** 已发生的交互记录，供测试断言「问了什么、问了几次」 */
  transcript(): readonly TranscriptEntry[] {
    return this.transcriptLog
  }

  /** 还剩几个未消费的预置答案 */
  remaining(): number {
    return this.queue.length
  }

  reset(answers: Outcome[] = []): void {
    this.queue = [...answers]
    this.transcriptLog = []
  }
}

/** 常用答案的简写 */
export const answer = {
  accept: <V>(value?: V): Outcome<V> => ({ action: 'accept', value }),
  cancel: (): Outcome => ({ action: 'cancel' }),
  timeout: (): Outcome => ({ action: 'timeout' }),
}
