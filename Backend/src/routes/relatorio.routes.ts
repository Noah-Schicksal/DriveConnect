import { IncomingMessage, ServerResponse } from 'http';
import { requireCaller, requireTipo } from '../middlewares/auth.js';
import { obterFaturamento, obterOcupacao, obterOperacao } from '../services/relatorio.service.js';

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

export async function faturamentoHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const dataInicio = url.searchParams.get('data_inicio');
        const dataFim = url.searchParams.get('data_fim');
        const filialId = url.searchParams.get('filial_id') ?? undefined;

        if (!dataInicio || !dataFim) {
            responder(res, 400, { erro: 'Parâmetros obrigatórios: data_inicio, data_fim.' });
            return;
        }

        const dados = await obterFaturamento(caller, dataInicio, dataFim, filialId);
        responder(res, 200, dados);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

export async function ocupacaoHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const dataInicio = url.searchParams.get('data_inicio');
        const dataFim = url.searchParams.get('data_fim');
        const filialId = url.searchParams.get('filial_id') ?? undefined;

        if (!dataInicio || !dataFim) {
            responder(res, 400, { erro: 'Parâmetros obrigatórios: data_inicio, data_fim.' });
            return;
        }

        const dados = await obterOcupacao(caller, dataInicio, dataFim, filialId);
        responder(res, 200, dados);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

export async function operacaoHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const dataInicio = url.searchParams.get('data_inicio');
        const dataFim = url.searchParams.get('data_fim');
        const filialId = url.searchParams.get('filial_id') ?? undefined;

        if (!dataInicio || !dataFim) {
            responder(res, 400, { erro: 'Parâmetros obrigatórios: data_inicio, data_fim.' });
            return;
        }

        const dados = await obterOperacao(caller, dataInicio, dataFim, filialId);
        responder(res, 200, dados);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}
