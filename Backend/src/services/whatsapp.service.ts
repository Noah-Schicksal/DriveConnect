// Serviço para integrar com WhatsApp Cloud API
import 'dotenv/config';
import { answerWhatsAppMessage } from '../ai/rag.js';
import { atenderClienteComAgent } from '../ai/agent.js';
import { query } from '../db/index.js';
import {
  buscarVeiculoDisponivelPorFilial,
  calcularValorTotal,
  criarReservaPendente,
} from './reserva.service.js';
import {
  ensureConversation,
  getConversationHistory,
  getWhatsappReserva,
  linkReservaToConversation,
  markWhatsappReservaNotified,
  storeMessage,
  updateMessageStatus,
  pauseConversation,
  resumeConversation,
  sendManagerMessage,
} from './whatsappStorage.service.js';
import { notifyNovaConversa, notifyNovaMensagemAtendimento } from './fcm.service.js';
import { criarCliente } from './usuario.service.js';
import crypto from 'crypto';

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

type Cached<T> = { value: T; expiresAt: number };
const cache = new Map<string, Cached<any>>();

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

type RegistrationDraft = { cpf: string | null; email: string | null; expiresAt: number };
const REGISTRATION_TTL_MS = Number.parseInt(process.env.WHATSAPP_REGISTRATION_TTL_MS || '900000', 10); // 15 min
const registrationDrafts = new Map<string, RegistrationDraft>();

import { setFilialContextForPhone, getFilialContextForPhone } from './filialContext.service.js';

function cleanupRegistrationDrafts(): void {
  const now = Date.now();
  for (const [key, value] of registrationDrafts.entries()) {
    if (now > value.expiresAt) registrationDrafts.delete(key);
  }
}

setInterval(cleanupRegistrationDrafts, Math.max(30_000, Math.floor(REGISTRATION_TTL_MS / 2))).unref();

function setCache<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function getCache<T>(key: string): T | null {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.value as T;
}

/**
 * Função para enviar uma mensagem via WhatsApp
 * @param to Número de telefone do destinatário
 * @param text Texto da mensagem a ser enviada
 */
export async function sendMessage(to: string, text: string): Promise<string | null> {
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
          type: 'text',
          text: { body: text },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Graph API error: HTTP ${response.status} ${body}`);
    }

    const json = await response.json().catch(() => ({}));
    const messageId = Array.isArray(json?.messages) ? json.messages[0]?.id : null;
    return messageId ?? null;
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
  const statuses = Array.isArray(value?.statuses)
    ? (value?.statuses as Array<{ id?: string; status?: string }>)
    : [];

  if (statuses.length > 0) {
    for (const status of statuses) {
      const statusId = status?.id;
      const statusValue = status?.status;
      if (statusId && statusValue) {
        await updateMessageStatus(statusId, statusValue);
      }
    }
  }

  if (!message) return;
  if (hasSeenMessage(message.id)) return;

  const from = message.from;
  const text = message.text?.body ?? '';

  const logBody = (process.env.WHATSAPP_LOG_MESSAGE_BODY ?? process.env.LOG_MESSAGE_BODY ?? '0') === '1';
  const logPayload: Record<string, unknown> = { id: message.id, from };
  if (logBody) logPayload.body = text;
  console.log('[WhatsApp Service] Mensagem recebida:', JSON.stringify(logPayload));

  const conversation = await ensureConversation(from);
  if (!conversation?.id) {
    console.error('[WhatsApp Service] Não foi possível abrir conversa para', from);
    return;
  }

  // Verificar se conversa está pausada pelo gerente
  const convCheck = await query(
    'SELECT status FROM whatsapp_conversation WHERE id = $1',
    [conversation.id],
  );
  if (convCheck.rows[0]?.status === 'PAUSED') {
    // Marca como recebida mas não responde
    await storeMessage({
      conversationId: conversation.id,
      direction: 'IN',
      waMessageId: message.id,
      text,
      rawPayload: message,
      status: 'received',
    });
    // Notifica gerentes/admin sobre nova mensagem mesmo se conversa estiver pausada
    void notifyNovaMensagemAtendimento({ phone: from, conversationId: conversation.id, message: text }).catch((err) => {
      console.error('[WhatsApp] Falha ao notificar nova mensagem via FCM:', err);
    });
    return;
  }

  await storeMessage({
    conversationId: conversation.id,
    direction: 'IN',
    waMessageId: message.id,
    text,
    rawPayload: message,
    status: 'received',
  });

  // Notifica gerentes/admins: se é criação de conversa, nova conversa; caso contrário, nova mensagem
  if ((conversation as any).created) {
    void notifyNovaConversa({ phone: from, conversationId: conversation.id, message: text }).catch((err) => {
      console.error('[WhatsApp] Falha ao notificar nova conversa via FCM:', err);
    });
  } else {
    void notifyNovaMensagemAtendimento({ phone: from, conversationId: conversation.id, message: text }).catch((err) => {
      console.error('[WhatsApp] Falha ao notificar nova mensagem via FCM:', err);
    });
  }

  if (!text) {
    const fallback = 'Mensagem de mídia recebida, consigo processar apenas texto no momento.';
    const fallbackMessageId = await sendMessage(from, fallback);
    await storeMessage({
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: fallbackMessageId,
      text: fallback,
      status: 'sent',
    });
    return;
  }

  const history = await getConversationHistory(conversation.id, Number.parseInt(process.env.WHATSAPP_HISTORY_LIMIT || '12', 10));

  // Cadastro automático: se o usuário enviar CPF e/ou email (mesmo sem mencionar "alugar")
  // e ainda não existir cliente para esse telefone, tenta cadastrar/localizar.
  const registrationResult = await tryHandleAutoRegistration({
    messageText: text,
    phone: from,
    conversationId: conversation.id,
    history,
  });

  if (registrationResult?.handled) {
    const replyMessageId = await sendMessage(from, registrationResult.replyText);
    await storeMessage({
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: replyMessageId,
      text: registrationResult.replyText,
      status: 'sent',
    });
    return;
  }

  const filiaisResult = await tryHandleListFiliaisIntent({ messageText: text });
  if (filiaisResult?.handled) {
    const replyMessageId = await sendMessage(from, filiaisResult.replyText);
    await storeMessage({
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: replyMessageId,
      text: filiaisResult.replyText,
      status: 'sent',
    });
    return;
  }

  const veiculosFilialResult = await tryHandleListVeiculosByFilialIntent({
    messageText: text,
    history,
    phone: from,
  });
  if (veiculosFilialResult?.handled) {
    const replyMessageId = await sendMessage(from, veiculosFilialResult.replyText);
    await storeMessage({
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: replyMessageId,
      text: veiculosFilialResult.replyText,
      status: 'sent',
    });
    return;
  }

  const paymentResult = await tryHandlePaymentIntent({
    messageText: text,
    phone: from,
    conversationId: conversation.id,
    history,
  });

  if (paymentResult?.handled) {
    const replyMessageId = await sendMessage(from, paymentResult.replyText);
    await storeMessage({
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: replyMessageId,
      text: paymentResult.replyText,
      status: 'sent',
    });
    return;
  }

  const quickReplyMsRaw = process.env.WHATSAPP_QUICK_REPLY_MS ?? '0';
  const quickReplyMs = Number.parseInt(quickReplyMsRaw, 10);
  const quickReplyText = (process.env.WHATSAPP_QUICK_REPLY_TEXT || '').trim();

  let placeholderTimer: NodeJS.Timeout | null = null;
  if (Number.isFinite(quickReplyMs) && quickReplyMs > 0 && quickReplyText) {
    const safeQuickReplyMs = quickReplyMs >= 200 ? quickReplyMs : 1500;
    placeholderTimer = setTimeout(() => {
      void sendMessage(from, quickReplyText).catch((err) => {
        console.error('[WhatsApp Service] Erro enviando quick reply:', err);
      });
    }, safeQuickReplyMs);
    placeholderTimer.unref();
  }

  try {
    // Usar Agent para requisições estruturadas (reserva, cotação, etc)
    // Fallback para RAG para perguntas genéricas
    let reply: string;
    
    const useAgent = (process.env.WHATSAPP_USE_AGENT ?? 'true').toLowerCase() !== 'false';
    if (useAgent) {
      const agentResult = await atenderClienteComAgent(text, { history });
      reply = sanitizeAiPaymentReply(agentResult.resposta);

      // Evita enviar placeholder sem URL real; tenta o fluxo transacional primeiro.
      if (hasPaymentPlaceholderWithoutRealUrl(reply)) {
        const paymentFallback = await tryHandlePaymentIntent({
          messageText: text,
          phone: from,
          conversationId: conversation.id,
          history,
        });

        if (paymentFallback?.handled && paymentFallback.replyText) {
          reply = paymentFallback.replyText;
        } else {
          reply = 'Estou gerando seu link de pagamento seguro. Assim que concluir, envio aqui.';
        }
      }

      console.log(`[WhatsApp Service] Agent executado: intenção=${agentResult.intencao}, tools=${agentResult.tools_usadas.join(',')}`);
      
      // Enviar foto se solicitada (apenas 1 foto)
      if (agentResult.fotos && agentResult.fotos.length > 0 && agentResult.fotos[0]) {
        const { sendImageByUrl } = await import('./whatsapp-media.service.js');
        const messageId = await sendImageByUrl(from, agentResult.fotos[0]).catch((err) => {
          console.error('[WhatsApp] Erro ao enviar foto:', err);
          return null;
        });

        if (!messageId) {
          const fallbackPhotoLink = agentResult.fotos[0];
          const fallbackText = `Não consegui enviar a imagem diretamente agora, mas aqui está o link: ${fallbackPhotoLink}`;
          await sendMessage(from, fallbackText).catch((err) => {
            console.error('[WhatsApp] Erro enviando fallback da foto:', err);
          });
        }
      }
    } else {
      reply = sanitizeAiPaymentReply(await answerWhatsAppMessage(text, { history }));
    }
    
    if (placeholderTimer) clearTimeout(placeholderTimer);

    const replyMessageId = await sendMessage(from, reply);
    await storeMessage({
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: replyMessageId,
      text: reply,
      status: 'sent',
    });
  } catch (error) {
    if (placeholderTimer) clearTimeout(placeholderTimer);
    console.error('[WhatsApp Service] Erro gerando resposta da IA:', error);
    const fallback = 'Desculpe, não consegui acessar a base de conhecimento agora. Pode tentar novamente em instantes?';
    const fallbackMessageId = await sendMessage(from, fallback);
    await storeMessage({
      conversationId: conversation.id,
      direction: 'OUT',
      waMessageId: fallbackMessageId,
      text: fallback,
      status: 'sent',
      error: String((error as Error)?.message || error),
    });
  }
}

function extractDateRange(messageText: string): { startDate: string | null; endDate: string | null } {
  const raw = messageText || '';

  // 1) Datas numéricas (DD/MM/AAAA ou DD/MM/AA ou ISO)
  const numericMatches = raw.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|20\d{2}-\d{2}-\d{2})\b/g);
  if (numericMatches && numericMatches.length > 0) {
    const startDate = parseDateToIso(numericMatches[0]);
    const endDate = parseDateToIso(numericMatches[1] || numericMatches[0]);
    return { startDate, endDate };
  }

  // 2) Datas por extenso (pt-BR), ex:
  // - "15 de maio de 2026"
  // - "15 a 16 de maio de 2026"
  const long = extractPtBrLongDates(raw);
  if (long.startDate || long.endDate) return long;

  return { startDate: null, endDate: null };
}

function parseDateToIso(text: string | null): string | null {
  if (!text) return null;
  const t = text.trim();

  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Aceita DD/MM/YYYY ou DD/MM/YY
  const br = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (br) {
    const [, ddRaw, mmRaw, yyyyRaw] = br;
    if (!ddRaw || !mmRaw || !yyyyRaw) return null;
    const dd = ddRaw.padStart(2, '0');
    const mm = mmRaw.padStart(2, '0');
    
    // Se ano tem 2 dígitos, assumir 20XX
    let yyyy = yyyyRaw;
    if (yyyy.length === 2) {
      const twoDigitYear = parseInt(yyyy, 10);
      // Assumir 20XX se ano está entre 00 e 99
      yyyy = `20${yyyy.padStart(2, '0')}`;
    }
    
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWord(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const n = escapeRegex(needle);
  return new RegExp(`\\b${n}\\b`, 'i').test(haystack);
}

function extractPtBrLongDates(messageText: string): { startDate: string | null; endDate: string | null } {
  const t = normalizeText(messageText);
  if (!t) return { startDate: null, endDate: null };

  const monthMap: Record<string, string> = {
    janeiro: '01',
    fevereiro: '02',
    marco: '03',
    abril: '04',
    maio: '05',
    junho: '06',
    julho: '07',
    agosto: '08',
    setembro: '09',
    outubro: '10',
    novembro: '11',
    dezembro: '12',
  };

  const toIso = (ddRaw: string, monthName: string, yyyyRaw: string): string | null => {
    const dd = String(ddRaw).padStart(2, '0');
    const mm = monthMap[monthName];
    const yyyy = String(yyyyRaw);
    if (!mm) return null;
    if (!/^\d{2}$/.test(dd) || !/^\d{2}$/.test(mm) || !/^20\d{2}$/.test(yyyy)) return null;
    return `${yyyy}-${mm}-${dd}`;
  };

  // Range compacto: "15 a 16 de maio de 2026"
  const range = t.match(/\b(\d{1,2})\s*(?:a|ate|até|e|-|–|—)\s*(\d{1,2})\s*de\s*(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*de\s*(20\d{2})\b/);
  if (range) {
    const ddStart = range[1];
    const ddEnd = range[2];
    const monthName = range[3];
    const yyyy = range[4];
    if (!ddStart || !ddEnd || !monthName || !yyyy) return { startDate: null, endDate: null };

    const startDate = toIso(ddStart, monthName, yyyy);
    const endDate = toIso(ddEnd, monthName, yyyy);
    return { startDate, endDate };
  }

  // Duas datas completas no texto: "15 de maio de 2026 ... 16 de maio de 2026"
  const regex = /\b(\d{1,2})\s*(?:de\s*)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de\s*)?(20\d{2})\b/g;
  const dates: string[] = [];
  for (const m of t.matchAll(regex)) {
    const iso = toIso(String(m[1]), String(m[2]), String(m[3]));
    if (iso) dates.push(iso);
    if (dates.length >= 2) break;
  }
  if (dates.length >= 1) {
    const startDate = dates[0] ?? null;
    const endDate = (dates[1] ?? dates[0]) ?? null;
    return { startDate, endDate };
  }

  return { startDate: null, endDate: null };
}

function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

/**
 * Gera uma senha temporária com entropia criptográfica.
 */
function generateSecurePassword(): string {
  const length = 12;
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*';
  const all = `${upper}${lower}${digits}${special}`;

  const picks: string[] = [
    upper[crypto.randomInt(upper.length)]!,
    lower[crypto.randomInt(lower.length)]!,
    digits[crypto.randomInt(digits.length)]!,
    special[crypto.randomInt(special.length)]!,
  ];

  while (picks.length < length) {
    picks.push(all[crypto.randomInt(all.length)]!);
  }

  for (let i = picks.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [picks[i], picks[j]] = [picks[j]!, picks[i]!];
  }

  return picks.join('');
}

/**
 * Valida formato de email
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Valida formato de CPF (apenas formato, não verifica se é real)
 */
function isValidCpfFormat(cpf: string): boolean {
  const cleanCpf = cpf.replace(/\D/g, '');
  return cleanCpf.length === 11 && /^\d{11}$/.test(cleanCpf);
}

function extractCpf(text: string): string | null {
  const t = (text || '').trim();
  const cpfPatterns = [
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // 123.456.789-01
    /\b\d{11}\b/, // 12345678901
  ];
  for (const pattern of cpfPatterns) {
    const match = t.match(pattern);
    if (match) return match[0].replace(/\D/g, '');
  }
  return null;
}

function extractEmail(text: string): string | null {
  const t = (text || '').trim();
  const emailMatch = t.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i);
  return emailMatch ? emailMatch[0] : null;
}

/**
 * Extrai CPF e email de uma mensagem de texto
 */
function extractCpfAndEmail(text: string): { cpf: string | null; email: string | null } {
  return { cpf: extractCpf(text), email: extractEmail(text) };
}

function looksLikeDangerousCardDataRequest(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t) return false;
  // Detecta pedidos explícitos de dados sensíveis (nunca devemos fazer isso)
  const dangerousPatterns = [
    'me envie o número do cartão',
    'digite o numero do cartao',
    'qual é o cvv',
    'qual o cvv',
    'código de segurança do seu cartão',
    'codigo de seguranca do cartao',
    'titular do seu cartão',
    'titular do seu cartao',
    'dados do seu cartão',
    'dados do seu cartao',
    'me mande o cartão',
    'mande seu cartão',
    'número da validade',
    'numero da validade',
  ];
  return dangerousPatterns.some((p) => t.includes(p));
}

function sanitizeAiPaymentReply(text: string): string {
  // Se houver um link de pagamento (seguro), deixa passar normalmente
  // O link é externo (InfinitePay) e oferece todas as opções de pagamento
  const lower = text.toLowerCase();
  if (lower.includes('link de pagamento') || lower.includes('checkout') || lower.includes('https://')) {
    return text;
  }
  
  // Se parecer um pedido perigoso de dados de cartão, bloqueia
  if (looksLikeDangerousCardDataRequest(text)) {
    return 'Para finalizar, eu envio um link de pagamento seguro. Me informe o modelo do carro e as datas (retirada e devolução).';
  }
  
  // Caso contrário, deixa a resposta da IA passar normalmente
  return text;
}

function hasPaymentPlaceholderWithoutRealUrl(text: string): boolean {
  const content = String(text || '');
  const lower = content.toLowerCase();
  if (!lower) return false;

  const mentionsPaymentLink =
    lower.includes('[link para pagamento]') ||
    lower.includes('<link para pagamento>') ||
    lower.includes('link para pagamento');

  const hasRealUrl = /https?:\/\//i.test(content);
  return mentionsPaymentLink && !hasRealUrl;
}

function isPaymentIntent(text: string): boolean {
  const t = (text || '').toLowerCase();
  const intentWords = ['pagar', 'pagamento', 'link', 'checkout', 'finalizar', 'fechar'];
  return intentWords.some((w) => t.includes(w));
}

function isReservationIntent(text: string): boolean {
  const t = normalizeText(text || '');
  if (!t) return false;

  // Evita falso positivo em frases de consulta como "gostaria de listar filiais"
  if (isListFiliaisIntent(t)) return false;

  const reservationVerbs = ['alugar', 'aluguel', 'locar', 'locacao', 'reserva', 'reservar', 'fechar locacao', 'contratar'];
  const hasReservationVerb = reservationVerbs.some((w) => t.includes(w));

  // Não exige termos como "carro"/"modelo" para não perder casos como:
  // "quero alugar um BMW 320i ..."
  return hasReservationVerb;
}

function isListFiliaisIntent(text: string): boolean {
  const t = normalizeText(text || '');
  if (!t) return false;
  const patterns = [
    'filial',
    'filiais',
    'unidade',
    'unidades',
    'enderecos',
    'onde voces estao',
    'onde fica',
    'localizacao',
    'lista de filiais',
  ];
  return patterns.some((p) => t.includes(p));
}

function isListVeiculosByFilialIntent(text: string): boolean {
  const t = normalizeText(text || '');
  if (!t) return false;

  const veiculoTerms = ['carro', 'carros', 'veiculo', 'veiculos', 'frota', 'modelos'];
  const filialTerms = ['filial', 'filiais', 'unidade', 'unidades'];
  const listTerms = ['mostrar', 'listar', 'lista', 'quais', 'catalogo', 'catálogo', 'opcoes', 'opções'];
  const reservationTerms = ['alugar', 'locar', 'reservar', 'reserva', 'checkout', 'pagamento'];

  const hasVeiculo = veiculoTerms.some((k) => t.includes(k));
  const hasFilial = filialTerms.some((k) => t.includes(k));
  const hasListAction = listTerms.some((k) => t.includes(k));
  const hasReservationSignal = reservationTerms.some((k) => t.includes(k));

  // Quando há sinal claro de reserva, não trata como listagem para evitar desvio de fluxo.
  if (hasReservationSignal && !hasListAction) return false;

  // Listagem explícita ou pergunta de frota por filial
  return hasVeiculo && (hasFilial || hasListAction);
}

function isConfirmation(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  const confirmations = [
    'sim',
    'ok',
    'claro',
    'confirmo',
    'quero',
    'pode',
    'isso',
    'perfeito',
    'segue',
    'pode sim',
    'pode prosseguir',
  ];
  return confirmations.some((c) => t === c || t.startsWith(`${c} `));
}

function historyHasReservationContext(history: HistoryMessage[] | undefined): boolean {
  if (!history || history.length === 0) return false;
  const combined = history.map((m) => m.content).join(' ').toLowerCase();
  const hasDate = /\b(\d{1,2}\/\d{1,2}\/20\d{2}|20\d{2}-\d{2}-\d{2})\b/.test(combined);
  const hasKeywords = ['modelo', 'unidade', 'retirada', 'devolução', 'devolucao', 'reserva'].some((k) => combined.includes(k));
  return hasDate || hasKeywords;
}

function buildPaymentContextText(messageText: string, history: HistoryMessage[] | undefined): string {
  if (!history || history.length === 0) return messageText;

  const recentContext = history
    .slice(-8)
    .map((m) => `${m.role === 'assistant' ? 'assistente' : 'cliente'}: ${m.content}`)
    .filter(Boolean);

  const combined = [...recentContext, messageText].filter(Boolean).join(' ');
  return combined.trim() || messageText;
}

function buildNextReservationPrompt(params: {
  customerMissing: boolean;
  modelMissing: boolean;
  filialMissing: boolean;
  datesMissing: boolean;
}): string {
  if (params.customerMissing) {
    return 'Para seguir, me envie seu CPF e e-mail. Se preferir, pode mandar em mensagens separadas.';
  }
  if (params.modelMissing) {
    return 'Qual modelo você quer reservar?';
  }
  if (params.datesMissing) {
    return 'Me envie as datas de retirada e devolução, por favor.';
  }
  return 'Me envie mais um detalhe para eu continuar.';
}

async function detectModelo(messageText: string): Promise<{ id: number; descricao: string } | null> {
  const t = (messageText || '').toLowerCase();
  const cached = getCache<Array<{ id: number; nome: string; marca: string }>>('modelos');
  const rows = cached ?? (await query('SELECT id, nome, marca FROM modelo ORDER BY nome')).rows;
  if (!cached) setCache('modelos', rows, 5 * 60_000);
  for (const row of rows) {
    const nome = String(row.nome || '').trim();
    const marca = String(row.marca || '').trim();
    if (!nome) continue;
    const nomeLower = nome.toLowerCase();
    const marcaLower = marca.toLowerCase();
    const combos = [
      nomeLower,
      marcaLower ? `${marcaLower} ${nomeLower}` : '',
      marcaLower ? `${nomeLower} ${marcaLower}` : '',
    ].filter(Boolean);
    if (combos.some((c) => t.includes(c))) {
      return { id: Number(row.id), descricao: `${marca} ${nome}`.trim() };
    }
  }
  return null;
}

async function detectFilialId(messageText: string): Promise<string | null> {
  const t = normalizeText(messageText || '');
  const cached = getCache<Array<{ id: string; nome: string; cidade: string; uf: string }>>('filiais');
  const rows = cached ?? (await query(
    `SELECT id, nome, cidade, uf FROM filial WHERE deletado_em IS NULL AND ativo = TRUE ORDER BY nome`,
  )).rows;
  if (!cached) setCache('filiais', rows, 5 * 60_000);

  if (rows.length === 1) return String(rows[0].id);

  for (const row of rows) {
    const nome = normalizeText(String(row.nome || ''));
    const cidade = normalizeText(String(row.cidade || ''));
    const uf = normalizeText(String(row.uf || ''));

    if (nome && t.includes(nome)) return String(row.id);
    if (cidade && t.includes(cidade)) return String(row.id);

    // Match por "apelido" / token (ex: usuário escreve só "rio", cidade é "rio de janeiro")
    if (cidade) {
      const cityTokens = cidade.split(' ').filter((x) => x.length >= 3);
      if (cityTokens.some((tok) => containsWord(t, tok))) return String(row.id);
    }

    if (uf && containsWord(t, uf)) return String(row.id);
  }
  return null;
}

async function getDefaultActiveFilialId(): Promise<string | null> {
  const rows = (await query(
    `SELECT id
     FROM filial
     WHERE deletado_em IS NULL AND ativo = TRUE
     ORDER BY nome
     LIMIT 1`,
  )).rows;
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function findClienteByPhone(phone: string): Promise<{ id: string; nome: string; email: string; telefone?: string | null } | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  try {
    const result = await query(
      `SELECT c.id, c.nome_completo, u.email, c.telefone
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE regexp_replace(c.telefone, '\\D', '', 'g') = $1
       LIMIT 1`,
      [normalized],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      nome: row.nome_completo,
      email: row.email,
      telefone: row.telefone ?? null,
    };
  } catch (err) {
    console.error('[WhatsApp] Erro buscando cliente por telefone:', err);
    return null;
  }
}

async function findClienteByCpfOrEmail(params: { cpfDigits?: string | null; email?: string | null }): Promise<{ id: string; nome: string; email: string; telefone?: string | null } | null> {
  const cpfDigits = params.cpfDigits ? params.cpfDigits.replace(/\D/g, '') : null;
  const email = params.email ? String(params.email).trim() : null;
  if (!cpfDigits && !email) return null;

  try {
    // CPF no banco é armazenado como 000.000.000-00, então comparamos pelos dígitos via regexp_replace.
    const result = await query(
      `SELECT c.id, c.nome_completo, u.email, c.telefone
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE ( $1::text IS NOT NULL AND regexp_replace(c.cpf, '\\D', '', 'g') = $1 )
          OR ( $2::text IS NOT NULL AND lower(u.email) = lower($2) )
       ORDER BY c.criado_em DESC
       LIMIT 1`,
      [cpfDigits, email],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, nome: row.nome_completo, email: row.email, telefone: row.telefone ?? null };
  } catch (err) {
    console.error('[WhatsApp] Erro buscando cliente por CPF/email:', err);
    return null;
  }
}

async function updateClienteTelefoneIfNeeded(clienteId: string, phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!clienteId || !normalized) return;
  try {
    await query(
      `UPDATE cliente
       SET telefone = $1
       WHERE id = $2
         AND (telefone IS NULL OR regexp_replace(telefone, '\\D', '', 'g') = '')`,
      [normalized, clienteId],
    );
  } catch (err) {
    console.error('[WhatsApp] Erro atualizando telefone do cliente:', err);
  }
}

function historyAskedForCadastro(history: HistoryMessage[] | undefined): boolean {
  if (!history || history.length === 0) return false;
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content?.toLowerCase() ?? '';
  return (
    lastAssistant.includes('cadastro') &&
    lastAssistant.includes('cpf') &&
    (lastAssistant.includes('e-mail') || lastAssistant.includes('email'))
  );
}

function buildRecentUserContext(messageText: string, history: HistoryMessage[] | undefined, maxUserMessages = 4): string {
  if (!history || history.length === 0) return messageText;
  const recentUser = history.filter((m) => m.role === 'user').slice(-maxUserMessages).map((m) => m.content);
  return [...recentUser, messageText].filter(Boolean).join(' ').trim() || messageText;
}

async function tryHandleAutoRegistration(params: {
  messageText: string;
  phone: string;
  conversationId: string;
  history?: HistoryMessage[];
}): Promise<{ handled: boolean; replyText: string }> {
  const { messageText, phone, history } = params;

  const alreadyCliente = await findClienteByPhone(phone);
  if (alreadyCliente) {
    registrationDrafts.delete(phone);
    return { handled: false, replyText: '' };
  }

  const cpfDigits = extractCpf(messageText);
  const email = extractEmail(messageText);

  const draft = registrationDrafts.get(phone);
  const mergedCpf = cpfDigits ?? draft?.cpf ?? null;
  const mergedEmail = email ?? draft?.email ?? null;

  const shouldTrackDraft = Boolean(cpfDigits || email || historyAskedForCadastro(history));
  if (shouldTrackDraft) {
    registrationDrafts.set(phone, {
      cpf: mergedCpf,
      email: mergedEmail,
      expiresAt: Date.now() + REGISTRATION_TTL_MS,
    });
  }

  const hasBoth = Boolean(mergedCpf && mergedEmail);
  const valid = Boolean(mergedCpf && mergedEmail && isValidCpfFormat(mergedCpf) && isValidEmail(mergedEmail));

  // Só tenta cadastrar se:
  // - ele forneceu CPF/email agora, OU
  // - estamos no fluxo de cadastro (bot pediu antes) e já temos dados acumulados.
  const shouldAttempt = valid && (Boolean(cpfDigits || email) || historyAskedForCadastro(history));
  if (!shouldAttempt) return { handled: false, replyText: '' };

  // Se já existir cliente com esse CPF/email, só vincula o telefone e segue.
  const existing = await findClienteByCpfOrEmail({ cpfDigits: mergedCpf, email: mergedEmail });
  if (existing) {
    await updateClienteTelefoneIfNeeded(existing.id, phone);
    registrationDrafts.delete(phone);

    const contextText = buildRecentUserContext(messageText, history);
    const { startDate, endDate } = extractDateRange(contextText);
    const modelo = await detectModelo(contextText);
    const filialId = await detectFilialId(contextText);

    if (startDate && endDate && modelo && filialId) {
      const inicio = new Date(startDate);
      const fim = new Date(endDate);
      console.log(`[WhatsApp][DEBUG] tryHandleAutoRegistration checando disponibilidade modeloId=${modelo.id} descricao=${modelo.descricao} filialId=${filialId} inicio=${inicio.toISOString()} fim=${fim.toISOString()}`);
      const veiculoId = await buscarVeiculoDisponivelPorFilial(modelo.id, filialId, inicio, fim);
      if (!veiculoId) {
        return {
          handled: true,
          replyText: `Encontrei seu cadastro ✅\n\nNão encontrei disponibilidade para *${modelo.descricao}* nessas datas. Quer tentar outras datas ou outra categoria?`,
        };
      }
      const valor = await calcularValorTotal(modelo.id, filialId, inicio, fim);
      return {
        handled: true,
        replyText:
          `Encontrei seu cadastro ✅\n\n` +
          `Tenho disponibilidade para *${modelo.descricao}* de ${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}.\n` +
          `Valor estimado: R$ ${Number(valor).toFixed(2)}.\n\n` +
          `Quer que eu gere o link de pagamento? Responda *sim*.`,
      };
    }

    return {
      handled: true,
      replyText: `Encontrei seu cadastro ✅\n\nAgora me informe o modelo do carro, a unidade (ex: Rio) e as datas (retirada e devolução).`,
    };
  }

  try {
    const nomeCliente = `Cliente WhatsApp ${phone.slice(-4)}`;
    const senhaGerada = generateSecurePassword();

    const resultadoCadastro = await criarCliente({
      email: mergedEmail!,
      senha: senhaGerada,
      nomeCompleto: nomeCliente,
      cpf: mergedCpf!,
      telefone: phone,
    });

    console.log(`[WhatsApp] Cliente cadastrado automaticamente: ${resultadoCadastro.usuarioId}`);
    registrationDrafts.delete(phone);

    const contextText = buildRecentUserContext(messageText, history);
    const { startDate, endDate } = extractDateRange(contextText);
    const modelo = await detectModelo(contextText);
    const filialId = await detectFilialId(contextText);

    const baseCreds =
      `✅ Cadastro realizado com sucesso!\n\n` +
      `📧 Email: ${mergedEmail}\n` +
      `🔑 Senha temporária: ${senhaGerada}\n\n` +
      `⚠️ Guarde essas informações! Você pode alterar a senha no app ou site.\n\n`;

    if (startDate && endDate && modelo && filialId) {
      const inicio = new Date(startDate);
      const fim = new Date(endDate);
      console.log(`[WhatsApp][DEBUG] tryHandleAutoRegistration (new user) checando disponibilidade modeloId=${modelo.id} descricao=${modelo.descricao} filialId=${filialId} inicio=${inicio.toISOString()} fim=${fim.toISOString()}`);
      const veiculoId = await buscarVeiculoDisponivelPorFilial(modelo.id, filialId, inicio, fim);
      if (!veiculoId) {
        return {
          handled: true,
          replyText: baseCreds + `Não encontrei disponibilidade para *${modelo.descricao}* nessas datas. Quer tentar outras datas ou outra categoria?`,
        };
      }
      const valor = await calcularValorTotal(modelo.id, filialId, inicio, fim);
      return {
        handled: true,
        replyText:
          baseCreds +
          `Tenho disponibilidade para *${modelo.descricao}* de ${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}.\n` +
          `Valor estimado: R$ ${Number(valor).toFixed(2)}.\n\n` +
          `Quer que eu gere o link de pagamento? Responda *sim*.`,
      };
    }

    return {
      handled: true,
      replyText: baseCreds + `Agora posso te ajudar com sua reserva. Me informe o modelo do carro, unidade e datas (retirada e devolução).`,
    };
  } catch (error) {
    console.error('[WhatsApp] Erro no cadastro automático:', error);
    return {
      handled: true,
      replyText:
        `Não consegui fazer seu cadastro automático.\n\n` +
        `Envie assim (pode ser sem pontuação):\n` +
        `cpf 00000000000\nemail nome@dominio.com`,
    };
  }
}

async function tryHandlePaymentIntent(params: {
  messageText: string;
  phone: string;
  conversationId: string;
  history?: HistoryMessage[];
}): Promise<{ handled: boolean; replyText: string }> {
  const { messageText, phone, conversationId, history } = params;

  const isCatalogIntent =
    isListFiliaisIntent(messageText) ||
    isListVeiculosByFilialIntent(messageText);

  // Evita cair no fluxo de pagamento/reserva quando a intenção é só consulta de catálogo/filiais.
  if (isCatalogIntent && !isPaymentIntent(messageText) && !isConfirmation(messageText)) {
    return { handled: false, replyText: '' };
  }

  let cliente = await findClienteByPhone(phone);
  const shouldHandle = isPaymentIntent(messageText) ||
    isReservationIntent(messageText) ||
    (isConfirmation(messageText) && historyHasReservationContext(history));
  if (!shouldHandle) {
    return { handled: false, replyText: '' };
  }

  const intentText = buildPaymentContextText(messageText, history);
  const userContextText = buildRecentUserContext(messageText, history);
  const { startDate, endDate } = extractDateRange(intentText);
  // Prioriza a mensagem atual para evitar "contaminação" do histórico
  // (ex.: conversa anterior com BMW e nova tentativa com Audi A4).
  let modelo = await detectModelo(messageText);
  let modeloSource: 'message' | 'context' = 'message';
  if (!modelo) {
    modelo = await detectModelo(intentText);
    modeloSource = 'context';
  }
  let filialId = await detectFilialId(messageText);
  if (!filialId) filialId = await detectFilialId(userContextText);
  if (filialId) {
    setFilialContextForPhone(phone, filialId);
  } else {
    filialId = getFilialContextForPhone(phone) || await getDefaultActiveFilialId();
    if (filialId) setFilialContextForPhone(phone, filialId);
  }

  if (!cliente) {
    const customerContext = extractCpfAndEmail(intentText);
    if (customerContext.cpf && customerContext.email && isValidCpfFormat(customerContext.cpf) && isValidEmail(customerContext.email)) {
      try {
        const existing = await findClienteByCpfOrEmail({
          cpfDigits: customerContext.cpf,
          email: customerContext.email,
        });

        if (existing) {
          await updateClienteTelefoneIfNeeded(existing.id, phone);
          cliente = {
            id: existing.id,
            nome: existing.nome,
            email: existing.email,
            telefone: existing.telefone ?? phone,
          };

          const mensagemCadastroExistente =
            `✅ Encontrei seu cadastro pelo CPF/e-mail e já vou continuar sua reserva.`;
          await sendMessage(phone, mensagemCadastroExistente);
        } else {
        const nomeCliente = `Cliente WhatsApp ${phone.slice(-4)}`;
        const senhaGerada = generateSecurePassword();

        const resultadoCadastro = await criarCliente({
          email: customerContext.email,
          senha: senhaGerada,
          nomeCompleto: nomeCliente,
          cpf: customerContext.cpf,
          telefone: phone,
        });

        console.log(`[WhatsApp] Cliente cadastrado automaticamente: ${resultadoCadastro.usuarioId}`);
        cliente = await findClienteByPhone(phone);
        if (!cliente) {
          cliente = {
            id: resultadoCadastro.clienteId,
            nome: nomeCliente,
            email: customerContext.email,
            telefone: phone,
          };
        }

        if (cliente) {
          const mensagemCredenciais =
            `✅ Cadastro realizado com sucesso!\n\n` +
            `📧 Email: ${customerContext.email}\n` +
            `🔑 Senha temporária: ${senhaGerada}\n\n` +
            `⚠️ Guarde essas informações! Você pode alterar a senha no app ou site.\n\n` +
            `Agora continuo com sua reserva.`;

          await sendMessage(phone, mensagemCredenciais);
        }
        }
      } catch (error) {
        console.error('[WhatsApp] Erro no cadastro automático:', error);
        return {
          handled: true,
          replyText: buildNextReservationPrompt({
            customerMissing: true,
            modelMissing: !modelo,
            filialMissing: !filialId,
            datesMissing: !(startDate && endDate),
          }),
        };
      }
    }
  }

  if (startDate && endDate) {
    const inicio = new Date(startDate);
    const fim = new Date(endDate);
    if (!(inicio instanceof Date) || !(fim instanceof Date) || Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      return {
        handled: true,
        replyText: 'As datas informadas estão inválidas. Pode enviar no formato DD/MM/AAAA?',
      };
    }
    if (fim.getTime() <= inicio.getTime()) {
      return {
        handled: true,
        replyText: 'A data de devolução precisa ser depois da retirada. Me envie as datas corretas, por favor.',
      };
    }
  }

  if (!cliente || !startDate || !endDate || !modelo || !filialId) {
    return {
      handled: true,
      replyText: buildNextReservationPrompt({
        customerMissing: !cliente,
        modelMissing: !modelo,
        filialMissing: !filialId,
        datesMissing: !(startDate && endDate),
      }),
    };
  }

  const inicio = new Date(startDate);
  const fim = new Date(endDate);
  console.log(
    `[WhatsApp][DEBUG] tryHandlePaymentIntent modeloSource=${modeloSource} modeloId=${modelo.id} descricao=${modelo.descricao} filialId=${filialId} inicio=${inicio.toISOString()} fim=${fim.toISOString()}`,
  );
  console.log(`[WhatsApp][DEBUG] tryHandlePaymentIntent checando disponibilidade modeloId=${modelo.id} descricao=${modelo.descricao} filialId=${filialId} inicio=${inicio.toISOString()} fim=${fim.toISOString()}`);
  const veiculoId = await buscarVeiculoDisponivelPorFilial(modelo.id, filialId, inicio, fim);

  // Se encontramos um veículo, atualiza o contexto de filial para a filial deste veículo
  if (veiculoId) {
    try {
      const vRes = await query('SELECT filial_id FROM veiculo WHERE id = $1', [veiculoId]);
      const veicFilial = vRes.rows[0]?.filial_id;
      if (veicFilial) {
        setFilialContextForPhone(phone, String(veicFilial));
        // sincroniza variável local também
        filialId = String(veicFilial);
        console.log(`[WhatsApp][DEBUG] Atualizada filial do telefone ${phone} para filialId=${filialId} baseada no veiculo ${veiculoId}`);
      }
    } catch (err) {
      console.error('[WhatsApp] Erro ao atualizar filial pelo veiculo selecionado:', err);
    }
  }

  if (!veiculoId) {
    return {
      handled: true,
      replyText: 'Não encontrei disponibilidade para esse modelo e período. Quer que eu verifique outra categoria ou datas próximas?',
    };
  }

  const valorAluguel = await calcularValorTotal(modelo.id, filialId, inicio, fim);
  
  let reserva;
  try {
    reserva = await criarReservaPendente({
      clienteId: cliente.id,
      veiculoId,
      filialRetiradaId: filialId,
      filialDevolucaoId: filialId,
      dataInicio: inicio,
      dataFim: fim,
      valorAluguel,
      nomeCliente: cliente.nome,
      emailCliente: cliente.email,
      telefoneCliente: cliente.telefone ?? phone,
      descricaoModelo: modelo.descricao,
      origem: 'WHATSAPP',
    });
  } catch (error) {
    console.error('[WhatsApp] Erro ao criar reserva:', error);
    return {
      handled: true,
      replyText: 'Desculpe, não consegui processar sua reserva agora. Pode tentar novamente em instantes?',
    };
  }

  // Validação: se o link não foi gerado, retornar erro
  if (!reserva.linkPagamento) {
    console.error('[WhatsApp] Reserva criada mas sem link de pagamento:', reserva.reservaId);
    return {
      handled: true,
      replyText: 'Sua reserva foi registrada, mas ocorreu um problema ao gerar o link de pagamento. Em breve, você receberá o link por aqui ou por email.',
    };
  }

  await linkReservaToConversation({
    reservaId: reserva.reservaId,
    phone,
    conversationId,
  });

  return {
    handled: true,
    replyText: `Perfeito! Aqui está seu link de pagamento: ${reserva.linkPagamento}\nAssim que o pagamento for confirmado, eu te aviso por aqui.`,
  };
}

async function tryHandleListFiliaisIntent(params: {
  messageText: string;
}): Promise<{ handled: boolean; replyText: string }> {
  const { messageText } = params;
  if (!isListFiliaisIntent(messageText)) {
    return { handled: false, replyText: '' };
  }

  try {
    const rows = (await query(
      `SELECT nome, cidade, uf, rua, numero, bairro
       FROM filial
       WHERE deletado_em IS NULL AND ativo = TRUE
       ORDER BY nome`,
    )).rows;

    if (!rows.length) {
      return {
        handled: true,
        replyText: 'No momento não encontrei filiais ativas. Se quiser, posso te ajudar com a reserva online.',
      };
    }

    const linhas = rows.map((r) => {
      const nome = String(r.nome || 'Unidade');
      const cidade = String(r.cidade || '').trim();
      const uf = String(r.uf || '').trim();
      const rua = String(r.rua || '').trim();
      const numero = String(r.numero || '').trim();
      const bairro = String(r.bairro || '').trim();

      const local = [cidade, uf].filter(Boolean).join('/');
      const endereco = [rua, numero, bairro].filter(Boolean).join(', ');

      if (local && endereco) return `• ${nome} — ${local} (${endereco})`;
      if (local) return `• ${nome} — ${local}`;
      if (endereco) return `• ${nome} (${endereco})`;
      return `• ${nome}`;
    });

    return {
      handled: true,
      replyText: `Temos estas unidades:\n${linhas.join('\n')}\n\nSe quiser, já te ajudo a escolher uma para a sua reserva.`,
    };
  } catch (error) {
    console.error('[WhatsApp] Erro ao listar filiais:', error);
    return {
      handled: true,
      replyText: 'Não consegui listar as filiais agora. Tente novamente em instantes, por favor.',
    };
  }
}

async function tryHandleListVeiculosByFilialIntent(params: {
  messageText: string;
  history?: HistoryMessage[];
  phone?: string;
}): Promise<{ handled: boolean; replyText: string }> {
  const { messageText, history, phone } = params;
  if (!isListVeiculosByFilialIntent(messageText)) {
    return { handled: false, replyText: '' };
  }

  const userContextText = buildRecentUserContext(messageText, history);
  let filialId = await detectFilialId(messageText);
  if (!filialId) filialId = await detectFilialId(userContextText);
  if (!filialId && phone) filialId = getFilialContextForPhone(phone);
  if (filialId && phone) setFilialContextForPhone(phone, filialId);

  if (!filialId) {
    try {
      const result = await query(
        `SELECT f.nome AS filial_nome,
                m.nome AS modelo,
                m.marca,
                COUNT(*)::int AS quantidade
         FROM veiculo v
         JOIN modelo m ON m.id = v.modelo_id
         JOIN filial f ON f.id = v.filial_id
         WHERE v.deletado_em IS NULL
           AND f.deletado_em IS NULL
           AND f.ativo = TRUE
           AND v.status = 'DISPONIVEL'
         GROUP BY f.nome, m.nome, m.marca
         ORDER BY f.nome, m.nome
         LIMIT 24`,
      );

      if (!result.rows.length) {
        return {
          handled: true,
          replyText: 'No momento não encontrei veículos disponíveis nas filiais.',
        };
      }

      const linhas = result.rows.map((r) => {
        const modelo = `${String(r.marca || '').trim()} ${String(r.modelo || '').trim()}`.trim();
        const filial = String(r.filial_nome || 'Filial').trim();
        const qtd = Number(r.quantidade || 0);
        return `• ${modelo} (Filial ${filial})${qtd > 1 ? ` - ${qtd} disponíveis` : ''}`;
      });

      return {
        handled: true,
        replyText: `Veículos disponíveis no geral:\n${linhas.join('\n')}\n\nSe preferir, eu filtro por uma filial específica também.`,
      };
    } catch (error) {
      console.error('[WhatsApp] Erro ao listar veículos no geral:', error);
      return {
        handled: true,
        replyText: 'Não consegui listar os veículos agora. Tente novamente em instantes.',
      };
    }
  }

  try {
    const result = await query(
      `SELECT f.nome AS filial_nome, f.cidade, f.uf,
              m.nome AS modelo, m.marca, tc.nome AS categoria,
              v.placa
       FROM veiculo v
       JOIN modelo m ON m.id = v.modelo_id
       JOIN tipo_carro tc ON tc.id = m.tipo_carro_id
       JOIN filial f ON f.id = v.filial_id
       WHERE v.deletado_em IS NULL
         AND f.deletado_em IS NULL
         AND f.ativo = TRUE
         AND v.status = 'DISPONIVEL'
         AND v.filial_id = $1
       ORDER BY tc.nome, m.nome
       LIMIT 12`,
      [filialId],
    );

    if (!result.rows.length) {
      return {
        handled: true,
        replyText: 'No momento não encontrei veículos disponíveis nessa filial. Quer que eu consulte outra unidade?',
      };
    }

    const headerRow = result.rows[0];
    const local = [headerRow?.filial_nome, headerRow?.cidade, headerRow?.uf]
      .filter(Boolean)
      .join(' / ');

    const linhas = result.rows.map((r) => {
      const modelo = `${String(r.marca || '').trim()} ${String(r.modelo || '').trim()}`.trim();
      const categoria = String(r.categoria || '').trim();
      const placa = String(r.placa || '').trim();
      return `• ${modelo}${categoria ? ` (${categoria})` : ''}${placa ? ` - ${placa}` : ''}`;
    });

    return {
      handled: true,
      replyText: `Veículos disponíveis em ${local || 'sua filial'}:\n${linhas.join('\n')}\n\nSe quiser, eu já monto a reserva para um deles.`,
    };
  } catch (error) {
    console.error('[WhatsApp] Erro ao listar veículos por filial:', error);
    return {
      handled: true,
      replyText: 'Não consegui listar os veículos dessa filial agora. Tente novamente em instantes.',
    };
  }
}

export async function notifyPaymentConfirmed(reservaId: string): Promise<void> {
  if (!reservaId) return;

  const vinculo = await getWhatsappReserva(reservaId);
  if (!vinculo || vinculo.notifiedAt) return;

  const dados = await query(
    `SELECT r.id, r.data_inicio, r.data_fim, f.nome AS filial_nome, f.cidade, f.uf,
            m.nome AS modelo, m.marca
     FROM reserva r
     JOIN veiculo v ON v.id = r.veiculo_id
     JOIN modelo m ON m.id = v.modelo_id
     JOIN filial f ON f.id = r.filial_retirada_id
     WHERE r.id = $1`,
    [reservaId],
  );

  const row = dados.rows[0];
  const inicio = row?.data_inicio ? new Date(row.data_inicio).toLocaleDateString('pt-BR') : null;
  const fim = row?.data_fim ? new Date(row.data_fim).toLocaleDateString('pt-BR') : null;
  const modelo = row?.modelo ? `${row.modelo}${row.marca ? ` ${row.marca}` : ''}` : 'seu veículo';
  const local = [row?.filial_nome, row?.cidade, row?.uf].filter(Boolean).join(' / ');

  const texto = `Pagamento confirmado! Sua reserva está confirmada para ${inicio} até ${fim}.` +
    `${modelo ? ` Modelo: ${modelo}.` : ''}` +
    `${local ? ` Unidade: ${local}.` : ''}` +
    ' Obrigado! Se precisar ajustar algo, me avise.';

  const conversation = vinculo.conversationId
    ? { id: vinculo.conversationId }
    : await ensureConversation(vinculo.phone);

  if (!conversation?.id) return;

  const messageId = await sendMessage(vinculo.phone, texto);
  await storeMessage({
    conversationId: conversation.id,
    direction: 'OUT',
    waMessageId: messageId,
    text: texto,
    status: 'sent',
  });

  await markWhatsappReservaNotified(reservaId);
}
