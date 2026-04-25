import { IncomingMessage, ServerResponse } from 'http';
import {
  listarPlanosDaLocadora,
  criarPlano,
  atualizarPlano,
  desativarPlano,
} from '../services/seguro.service.js';

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
// GET /seguros?franquia_id=X
// Lista todos os planos de uma locadora.
// O plano Básico (obrigatório) sempre aparece primeiro.
// ──────────────────────────────────────────────
export async function listarSeguros(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const franquiaId = url.searchParams.get('franquia_id');

  if (!franquiaId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Parâmetro obrigatório: franquia_id.' }));
    return;
  }

  const planos = await listarPlanosDaLocadora(franquiaId);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(planos));
}

// ──────────────────────────────────────────────
// POST /seguros
// Cria um novo plano de seguro para uma locadora.
// Body: { franquia_id, nome, descricao?, percentual, obrigatorio? }
// ──────────────────────────────────────────────
export async function criarSeguro(req: IncomingMessage, res: ServerResponse) {
  const corpo = await lerCorpo(req);
  const { franquia_id, nome, descricao, percentual, obrigatorio } = corpo;

  if (!franquia_id || !nome || percentual === undefined) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Campos obrigatórios: franquia_id, nome, percentual.' }));
    return;
  }

  if (typeof percentual !== 'number' || percentual < 0 || percentual > 100) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'percentual deve ser um número entre 0 e 100.' }));
    return;
  }

  const plano = await criarPlano({ franquiaId: franquia_id, nome, descricao, percentual, obrigatorio });

  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(plano));
}

// ──────────────────────────────────────────────
// PUT /seguros/:id
// Atualiza nome, descrição ou percentual de um plano.
// Body: { franquia_id, nome?, descricao?, percentual? }
// ──────────────────────────────────────────────
export async function atualizarSeguro(req: IncomingMessage, res: ServerResponse, planoId: string) {
  const corpo = await lerCorpo(req);
  const { franquia_id, nome, descricao, percentual } = corpo;

  if (!franquia_id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Campo obrigatório: franquia_id.' }));
    return;
  }

  const planoAtualizado = await atualizarPlano(planoId, franquia_id, { nome, descricao, percentual });

  if (!planoAtualizado) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Plano não encontrado ou sem campos para atualizar.' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(planoAtualizado));
}

// ──────────────────────────────────────────────
// DELETE /seguros/:id
// Desativa (soft delete) um plano de seguro.
// Query: ?franquia_id=X
// Planos obrigatórios (Básico) não podem ser desativados.
// ──────────────────────────────────────────────
export async function desativarSeguro(req: IncomingMessage, res: ServerResponse, planoId: string) {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const franquiaId = url.searchParams.get('franquia_id');

  if (!franquiaId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Parâmetro obrigatório: franquia_id.' }));
    return;
  }

  const resultado = await desativarPlano(planoId, franquiaId);

  if (!resultado.sucesso) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: resultado.motivo }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ mensagem: 'Plano desativado com sucesso.' }));
}
