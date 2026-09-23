/**
 * Delivery channels. Email is pluggable: log-only by default, Resend when RESEND_API_KEY is set.
 * Telegram uses the Bot API when TELEGRAM_BOT_TOKEN is set.
 */
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

export interface EmailProvider {
  readonly name: string;
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export interface TelegramSender {
  send(chatId: string, text: string): Promise<void>;
}

export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';
  constructor(private readonly log: Logger) {}
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.log.info({ email: msg.to, subject: msg.subject }, 'email (log-only provider)');
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export class BotApiTelegramSender implements TelegramSender {
  constructor(private readonly token: string) {}
  async send(chatId: string, text: string): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export function channelsFromConfig(cfg: Config, log: Logger): { email: EmailProvider; telegram: TelegramSender | null } {
  return {
    email: cfg.RESEND_API_KEY ? new ResendEmailProvider(cfg.RESEND_API_KEY, cfg.EMAIL_FROM) : new LogEmailProvider(log),
    telegram: cfg.TELEGRAM_BOT_TOKEN ? new BotApiTelegramSender(cfg.TELEGRAM_BOT_TOKEN) : null,
  };
}
