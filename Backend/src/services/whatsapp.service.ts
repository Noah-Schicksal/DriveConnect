// ──────────────────────────────────────────────
// Serviço para integrar com WhatsApp Cloud API
// ──────────────────────────────────────────────

import 'dotenv/config';

type WhatsAppTextMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

type WebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppTextMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
};

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const DEDUPE_TTL_MS = Number.parseInt(process.env.WHATSAPP_DEDUPE_TTL_MS || process.env.DEDUPE_TTL_MS || '600000', 10);
const seenMessageIds = new Map<string, number>();

function hasSeenMessage(messageId: string | undefined): boolean {
  if (!messageId) return false;
  const now = Date.now();
  const seenAt = seenMessageIds.get(messageId);
  if (seenAt && now - seenAt < DEDUPE_TTL_MS) return true;
  seenMessageIds.set(messageId, now);
  return false;
}

function cleanupSeen(): void {
  const now = Date.now();
  for (const [key, value] of seenMessageIds.entries()) {
    if (now - value >= DEDUPE_TTL_MS) seenMessageIds.delete(key);
  }
}

setInterval(cleanupSeen, Math.max(30_000, Math.floor(DEDUPE_TTL_MS / 2))).unref();

/**
 * Função para enviar uma mensagem via WhatsApp
 * @param to Número de telefone do destinatário
 * @param text Texto da mensagem a ser enviada
 */
export async function sendMessage(to: string, text: string): Promise<void> {
  const graphApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.GRAPH_API_VERSION ?? 'v19.0';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.ACCESS_TOKEN ?? mustGetEnv('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? process.env.PHONE_NUMBER_ID ?? mustGetEnv('WHATSAPP_PHONE_NUMBER_ID');

  const timeoutMs = Number.parseInt(process.env.WHATSAPP_TIMEOUT_MS || process.env.AXIOS_TIMEOUT_MS || '10000', 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          text: { body: text },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Graph API error: HTTP ${response.status} ${body}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Função para processar a chegada de um webhook (mensagens recebidas, atualizações de status)
 * @param payload Dados em JSON recebidos pelo Webhook
 */
export async function processIncomingMessage(payload: any): Promise<void> {
  const typed = payload as WebhookPayload;

  const entry = typed.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];

  if (!message) return;
  if (hasSeenMessage(message.id)) return;

  const from = message.from;
  const text = message.text?.body ?? '';

  const logBody = (process.env.WHATSAPP_LOG_MESSAGE_BODY ?? process.env.LOG_MESSAGE_BODY ?? '0') === '1';
  const logPayload: Record<string, unknown> = { id: message.id, from };
  if (logBody) logPayload.body = text;
  console.log('[WhatsApp Service] Mensagem recebida:', JSON.stringify(logPayload));

  // Resposta padrão (pode ser trocada por regras do seu domínio depois)
  const reply = `Recebi sua mensagem: "${text}". BOT em modo de testes.`;
  await sendMessage(from, reply);
}
