import { IncomingMessage, ServerResponse } from 'http';
import { requireCaller, requireTipo } from '../middlewares/auth.js';
import { estornarPagamento, criarCobrancaExtra } from '../services/financeiro.service.js';

function lerCorpo(req: IncomingMessage): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
        let dados = '';
        req.on('data', (chunk) => (dados += chunk));
        req.on('end', () => {
            try { resolve(JSON.parse(dados || '{}')); }
            catch { reject(new Error('JSON inválido.')); }
        });
        req.on('error', reject);
    });
}

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

function mapearErro(err: unknown): { status: number; mensagem: string } {
  const mensagem = err instanceof Error ? err.message : 'Erro interno.';
  const status = mensagem.includes('inválid') || mensagem.includes('obrigatório') || mensagem.includes('ausente') ? 400
      : mensagem.includes('não encontrad') ? 404
      : mensagem.includes('Não autorizado') ? 401
      : mensagem.includes('Sem permissão') ? 403
      : 500;
  return { status, mensagem };
}

// POST /pagamentos/:id/estorno
export async function estornoHandler(req: IncomingMessage, res: ServerResponse, reservaId: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        await estornarPagamento(reservaId, caller);
        responder(res, 200, { mensagem: 'Estorno solicitado e processado com sucesso.' });
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// POST /reservas/:id/cobranca-extra
export async function cobrancaExtraHandler(req: IncomingMessage, res: ServerResponse, reservaId: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const corpo = await lerCorpo(req);
        const itens = corpo.itens;

        if (!Array.isArray(itens) || itens.length === 0) {
            responder(res, 400, { erro: 'O corpo deve conter um array "itens" com objetos { descricao, valor }.' });
            return;
        }

        const resultado = await criarCobrancaExtra(reservaId, itens, caller);
        responder(res, 201, resultado);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}
