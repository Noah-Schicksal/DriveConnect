import { IncomingMessage, ServerResponse } from 'http';
import { processIncomingMessage } from '../services/whatsapp.service.js';

// Utilitário temporário para ler o corpo caso não esteja no app geral
function lerCorpo(req: IncomingMessage): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
        let dados = '';
        req.on('data', (chunk) => (dados += chunk));
        req.on('end', () => {
            try { resolve(JSON.parse(dados || '{}')); }
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
    // A lógica de verificação (challenge, token) ficará aqui
    res.writeHead(200);
    res.end('Webhook ready');
}

// ──────────────────────────────────────────────
// POST /whatsapp/webhook
// Recebe mensagens e notificações do WhatsApp
// ──────────────────────────────────────────────
export async function receiveWebhook(req: IncomingMessage, res: ServerResponse) {
    const corpo = await lerCorpo(req);

    // Aqui repassa as mensagens para o serviço processar
    await processIncomingMessage(corpo);

    res.writeHead(200);
    res.end();
}
