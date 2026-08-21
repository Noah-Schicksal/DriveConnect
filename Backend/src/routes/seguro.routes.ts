import { IncomingMessage, ServerResponse } from 'http';
import {
  listarPlanos,
  criarPlano,
  atualizarPlano,
  desativarPlano,
} from '../services/seguro.service.js';
import { requireCaller, requireTipo } from '../middlewares/auth.js';

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

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

function mapearErro(err: unknown): { status: number; mensagem: string } {
  const mensagem = err instanceof Error ? err.message : 'Erro interno.';
  const status = mensagem.includes('inválid') || mensagem.includes('obrigatório') ? 400
    : mensagem.includes('não encontrad') ? 404
      : mensagem.includes('Não autorizado') ? 401
        : mensagem.includes('Sem permissão') ? 403
          : 500;
  return { status, mensagem };
}

// GET /seguros
// Lista todos os planos de seguro ativos da empresa.
// O plano Básico (obrigatório) sempre aparece primeiro.
export async function listarSeguros(_req: IncomingMessage, res: ServerResponse) {
  try {
    const planos = await listarPlanos();
    responder(res, 200, planos);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// POST /seguros
// Cria um novo plano de seguro global da empresa.
// Body: { nome, descricao?, percentual, obrigatorio? }
export async function criarSeguro(req: IncomingMessage, res: ServerResponse) {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'ADMIN');

    const corpo = await lerCorpo(req);
    const { nome, descricao, percentual, obrigatorio } = corpo;

    if (!nome || percentual === undefined) {
      responder(res, 400, { erro: 'Campos obrigatórios: nome, percentual.' });
      return;
    }

    if (typeof percentual !== 'number' || percentual < 0 || percentual > 100) {
      responder(res, 400, { erro: 'percentual deve ser um número entre 0 e 100.' });
      return;
    }

    const plano = await criarPlano({ nome, descricao, percentual, obrigatorio });
    responder(res, 201, plano);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// PUT /seguros/:id
// Atualiza nome, descrição ou percentual de um plano.
// Body: { nome?, descricao?, percentual? }
export async function atualizarSeguro(req: IncomingMessage, res: ServerResponse, planoId: string) {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'ADMIN');

    const corpo = await lerCorpo(req);
    const { nome, descricao, percentual } = corpo;

    const planoAtualizado = await atualizarPlano(planoId, { nome, descricao, percentual });

    if (!planoAtualizado) {
      responder(res, 404, { erro: 'Plano não encontrado ou sem campos para atualizar.' });
      return;
    }

    responder(res, 200, planoAtualizado);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// DELETE /seguros/:id
// Desativa (soft delete) um plano de seguro.
// Planos obrigatórios (Básico) não podem ser desativados.
export async function desativarSeguro(req: IncomingMessage, res: ServerResponse, planoId: string) {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'ADMIN');

    const resultado = await desativarPlano(planoId);

    if (!resultado.sucesso) {
      responder(res, 409, { erro: resultado.motivo });
      return;
    }

    responder(res, 200, { mensagem: 'Plano desativada com sucesso.' });
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}
