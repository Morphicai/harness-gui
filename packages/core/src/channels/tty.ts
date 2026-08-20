/**
 * tty channel —— 终端交互
 *
 * 无 TTY（管道 / CI）时 supports() 返回假，让选择器跳过它。否则会在没人能回答的环境里挂住。
 */

import * as readline from 'node:readline/promises'
import { Channel, Interaction, Outcome, isOneWay } from '../types.js'
import { renderText } from '../content.js'

export interface TtyChannelOptions {
  input?: NodeJS.ReadableStream & { isTTY?: boolean }
  output?: NodeJS.WritableStream
  /** 强制认为有 TTY（测试用） */
  forceTty?: boolean
}

export class TtyChannel implements Channel {
  readonly name = 'tty'
  private input: NodeJS.ReadableStream & { isTTY?: boolean }
  private output: NodeJS.WritableStream
  private forceTty: boolean

  constructor(opts: TtyChannelOptions = {}) {
    this.input = opts.input ?? process.stdin
    this.output = opts.output ?? process.stdout
    this.forceTty = opts.forceTty ?? false
  }

  supports(): boolean {
    return this.forceTty || this.input.isTTY === true
  }

  async present(i: Interaction): Promise<Outcome> {
    const write = (s: string) => this.output.write(s + '\n')

    switch (i.kind) {
      case 'notify': {
        const tag = i.level === 'error' ? '✖' : i.level === 'warn' ? '⚠' : 'ℹ'
        write(`\n${tag} ${i.title}\n  ${i.message}`)
        return { action: 'accept' }
      }

      case 'show': {
        write(`\n── ${i.title} ──\n${renderText(i.content)}`)
        if (!isOneWay(i)) return this.ask(i, async rl => {
          await rl.question('\n按回车继续… ')
          return { action: 'accept' as const }
        })
        return { action: 'accept' }
      }

      case 'confirm': {
        write(`\n${i.danger ? '⚠ ' : ''}${i.title}\n  ${i.message}`)
        return this.ask(i, async rl => {
          const raw = (await rl.question('  确认? [y/N] ')).trim().toLowerCase()
          const yes = raw === 'y' || raw === 'yes'
          // 明确回答 n / 直接回车都算主动放弃，而不是超时
          return { action: yes ? 'accept' : 'cancel', value: yes } as Outcome
        })
      }

      case 'select': {
        write(`\n${i.title}${i.message ? '\n  ' + i.message : ''}`)
        i.options.forEach((o, idx) => {
          write(`  ${idx + 1}) ${o.label}${o.description ? '  — ' + o.description : ''}`)
        })
        const hint = i.multiple ? '  选择（逗号分隔，留空取消）: ' : '  选择编号（留空取消）: '
        return this.ask(i, async rl => {
          const raw = (await rl.question(hint)).trim()
          if (!raw) return { action: 'cancel' }
          const picked = raw
            .split(',')
            .map(s => Number(s.trim()))
            .filter(n => Number.isInteger(n) && n >= 1 && n <= i.options.length)
            .map(n => i.options[n - 1].value)
          if (picked.length === 0) return { action: 'cancel' }
          return { action: 'accept', value: i.multiple ? picked : picked[0] }
        })
      }

      case 'form': {
        write(`\n${i.title}${i.message ? '\n  ' + i.message : ''}`)
        return this.ask(i, async rl => {
          const value: Record<string, unknown> = {}
          for (const f of i.fields) {
            if (f.type === 'select') {
              write(`  ${f.label}`)
              f.options.forEach((o, idx) => write(`    ${idx + 1}) ${o.label}`))
              const raw = (await rl.question('    编号: ')).trim()
              const n = Number(raw)
              value[f.name] = Number.isInteger(n) && n >= 1 && n <= f.options.length
                ? f.options[n - 1].value
                : f.default
            } else if (f.type === 'boolean') {
              const raw = (await rl.question(`  ${f.label} [y/N] `)).trim().toLowerCase()
              value[f.name] = raw === 'y' || raw === 'yes'
            } else {
              const suffix = f.default ? ` (${f.default})` : ''
              const raw = (await rl.question(`  ${f.label}${suffix}: `)).trim()
              const v = raw || f.default || ''
              value[f.name] = f.type === 'number' ? Number(v) : v
            }
          }
          return { action: 'accept', value }
        })
      }
    }
  }

  /**
   * 统一处理 readline 生命周期与超时。
   *
   * 超时用 AbortController 打断 question()，并**在这里就关掉 rl** —— 否则 readline 仍占着 stdin，
   * 后续交互读不到输入，表现为「第二次提问直接卡死」。
   */
  private async ask(i: Interaction, fn: (rl: readline.Interface) => Promise<Outcome>): Promise<Outcome> {
    const rl = readline.createInterface({ input: this.input as NodeJS.ReadableStream, output: this.output, terminal: true })
    const ac = new AbortController()
    const timer = i.timeoutMs ? setTimeout(() => ac.abort(), i.timeoutMs) : undefined
    // question 的 signal 要透过闭包传进去：readline/promises 的 question(query, { signal })
    const original = rl.question.bind(rl)
    ;(rl as unknown as { question: (q: string) => Promise<string> }).question = (q: string) =>
      original(q, { signal: ac.signal })

    try {
      return await fn(rl)
    } catch (e) {
      if (ac.signal.aborted) return { action: 'timeout' }
      throw e
    } finally {
      if (timer) clearTimeout(timer)
      rl.close()
    }
  }
}
