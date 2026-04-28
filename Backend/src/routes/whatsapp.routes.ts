import { IncomingMessage, ServerResponse } from 'http';
import * as crypto from 'crypto';
import { processIncomingMessage } from '../services/whatsapp.service.js';

type CorpoLido = { raw: string; json: Record<string, any> };

function safeTimingEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyMetaSignature(rawBody: string, signatureHeader: string, appSecret: string): boolean {
  const [algo, signatureHex] = (signatureHeader || '').split('=');
  if (algo !== 'sha256' || !signatureHex) return false;

  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  return safeTimingEqualHex(signatureHex, expectedHex);
}

function lerCorpo(req: IncomingMessage): Promise<CorpoLido> {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (chunk) => (dados += chunk));
    req.on('end', () => {
      const raw = dados || '{}';
      try { resolve({ raw, json: JSON.parse(raw) }); }
      catch { reject(new Error('JSON inválido no corpo da requisição.')); }
    });
    req.on('error', reject);
  });
}

// ──────────────────────────────────────────────
// GET /whatsapp/webhook
// Verificação do webhook da Meta
// ──────────────────────────────────────────────
export async function verifyWebhook(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);

  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN ??
    process.env.VERIFY_TOKEN ??
    '';

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(challenge);
    return;
  }

  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ erro: 'Webhook verification failed.' }));
}

// ──────────────────────────────────────────────
// POST /whatsapp/webhook
// Recebe mensagens e notificações do WhatsApp
// ──────────────────────────────────────────────
export async function receiveWebhook(req: IncomingMessage, res: ServerResponse) {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? process.env.APP_SECRET;
  const requireSignature =
    (process.env.WEBHOOK_REQUIRE_SIGNATURE ??
      (process.env.NODE_ENV === 'production' ? '1' : '0')) === '1';

  if (requireSignature && !appSecret) {
    // erro de configuração
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'APP_SECRET não configurado para validação de assinatura.' }));
    return;
  }

  const { raw, json } = await lerCorpo(req);

  if (appSecret) {
    const signatureHeader = String(req.headers['x-hub-signature-256'] ?? '');
    const ok = verifyMetaSignature(raw, signatureHeader, appSecret);
    if (!ok) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Assinatura inválida.' }));
      return;
    }
  }

  // Resposta rápida para a Meta
  res.writeHead(200);
  res.end();

  // Processamento assíncrono (evita timeout do webhook)
  void processIncomingMessage(json).catch((err) => {
    console.error('[WhatsApp] Erro ao processar webhook:', err);
  });
}
