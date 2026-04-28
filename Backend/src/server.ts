import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { listarSeguros, criarSeguro, atualizarSeguro, desativarSeguro } from './routes/seguro.routes.js';
import { checarDisponibilidade, confirmarRetirada, confirmarDevolucao } from './routes/reserva.routes.js';
import { iniciarPagamento, receberWebhook as receberWebhookPagamento, statusPagamento } from './routes/payment.routes.js';
import { verifyWebhook, receiveWebhook } from './routes/whatsapp.routes.js';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { erro: 'Rota não encontrada.' });
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { erro: 'Método não permitido.' });
}

function handler(req: IncomingMessage, res: ServerResponse): void {
  const method = req.method || 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // Healthcheck
  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
    return;
  }

  // WhatsApp webhook
  if (path === '/whatsapp/webhook') {
    if (method === 'GET') return void verifyWebhook(req, res);
    if (method === 'POST') return void receiveWebhook(req, res);
    return methodNotAllowed(res);
  }

  // Seguros
  if (path === '/seguros') {
    if (method === 'GET') return void listarSeguros(req, res);
    if (method === 'POST') return void criarSeguro(req, res);
    return methodNotAllowed(res);
  }

  const seguroMatch = path.match(/^\/seguros\/([^/]+)$/);
  if (seguroMatch) {
    const planoId = seguroMatch[1] ?? '';
    if (method === 'PUT') return void atualizarSeguro(req, res, planoId);
    if (method === 'DELETE') return void desativarSeguro(req, res, planoId);
    return methodNotAllowed(res);
  }

  // Reservas
  if (method === 'GET' && path === '/reservas/disponibilidade') return void checarDisponibilidade(req, res);

  const retiradaMatch = path.match(/^\/reservas\/([^/]+)\/retirada$/);
  if (retiradaMatch) {
    const reservaId = retiradaMatch[1] ?? '';
    if (method === 'POST') return void confirmarRetirada(req, res, reservaId);
    return methodNotAllowed(res);
  }

  const devolucaoMatch = path.match(/^\/reservas\/([^/]+)\/devolucao$/);
  if (devolucaoMatch) {
    const reservaId = devolucaoMatch[1] ?? '';
    if (method === 'POST') return void confirmarDevolucao(req, res, reservaId);
    return methodNotAllowed(res);
  }

  // Pagamento
  if (path === '/pagamento/iniciar') {
    if (method === 'POST') return void iniciarPagamento(req, res);
    return methodNotAllowed(res);
  }

  if (path === '/pagamento/webhook') {
    if (method === 'POST') return void receberWebhookPagamento(req, res);
    return methodNotAllowed(res);
  }

  const pagamentoStatusMatch = path.match(/^\/pagamento\/status\/([^/]+)$/);
  if (pagamentoStatusMatch) {
    const reservaId = pagamentoStatusMatch[1] ?? '';
    if (method === 'GET') return void statusPagamento(req, res, reservaId);
    return methodNotAllowed(res);
  }

  notFound(res);
}

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
if (!Number.isFinite(PORT) || PORT <= 0) throw new Error(`Invalid PORT: ${process.env.PORT}`);

createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error('Erro não tratado:', err);
    if (!res.headersSent) sendJson(res, 500, { erro: 'Erro interno.' });
    else res.end();
  });
}).listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});

