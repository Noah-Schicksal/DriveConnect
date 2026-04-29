import { IncomingMessage, ServerResponse } from 'http';
import {
  listarFiliais,
  buscarFilialPorId,
  atualizarFilial,
  listarGerentes,
  buscarMeuPerfilGerente,
} from '../services/filial.service.js';
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

// ──────────────────────────────────────────────
// GET /filiais
// Acesso: GERENTE, ADMIN — lista todas (dados públicos)
// ──────────────────────────────────────────────
export async function listarTodasFiliais(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const filiais = await listarFiliais();
    responder(res, 200, filiais);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// ──────────────────────────────────────────────
// GET /filiais/:id
// Acesso: GERENTE, ADMIN — detalhe completo (endereço)
// ──────────────────────────────────────────────
export async function detalharFilial(req: IncomingMessage, res: ServerResponse, filialId: string): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const filial = await buscarFilialPorId(filialId);
    if (!filial) { responder(res, 404, { erro: 'Filial não encontrada.' }); return; }

    responder(res, 200, filial);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// ──────────────────────────────────────────────
// PUT /filiais/:id
// Acesso: GERENTE (só sua filial) | ADMIN (qualquer)
// ──────────────────────────────────────────────
export async function editarFilial(req: IncomingMessage, res: ServerResponse, filialId: string): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const corpo = await lerCorpo(req);
    const { nome, cep, uf, cidade, bairro, rua, numero, complemento } = corpo;

    const filialAtualizada = await atualizarFilial(filialId, caller, {
      nome, cep, uf, cidade, bairro, rua, numero, complemento,
    });

    if (!filialAtualizada) { responder(res, 400, { erro: 'Nenhum campo válido para atualizar.' }); return; }

    responder(res, 200, filialAtualizada);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// ──────────────────────────────────────────────
// GET /gerentes
// Acesso: apenas ADMIN
// ──────────────────────────────────────────────
export async function listarTodosGerentes(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'ADMIN');

    const gerentes = await listarGerentes();
    responder(res, 200, gerentes);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// ──────────────────────────────────────────────
// GET /gerentes/me
// Acesso: GERENTE — retorna o próprio perfil
// ──────────────────────────────────────────────
export async function buscarMeuPerfilDeGerente(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE');

    const perfil = await buscarMeuPerfilGerente(caller.usuarioId);
    if (!perfil) { responder(res, 404, { erro: 'Perfil de gerente não encontrado.' }); return; }

    responder(res, 200, perfil);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}
