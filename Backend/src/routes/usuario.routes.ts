import { IncomingMessage, ServerResponse } from 'http';
import {
  autenticarUsuario,
  criarCliente,
  criarGerente,
  listarClientes,
  buscarClientePorId,
  atualizarCliente,
  alterarSenha,
  desativarUsuario,
  buscarMeuPerfilCliente,
  atualizarMeuPerfilCliente,
} from '../services/usuario.service.js';
import { requireCaller, requireTipo, requireOwnership } from '../middlewares/auth.js';


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

async function tratarErro(res: ServerResponse, err: unknown): Promise<void> {
  const mensagem = err instanceof Error ? err.message : 'Erro interno.';
  const status = mensagem.includes('inválid') || mensagem.includes('deve') ? 400
    : mensagem.includes('não encontrad') ? 404
    : mensagem.includes('Credenciais') ? 401
    : mensagem.includes('Não autorizado') ? 401
    : mensagem.includes('Sem permissão') ? 403
    : 500;
  responder(res, status, { erro: mensagem });
}

// ──────────────────────────────────────────────
// POST /usuarios/login
// Body: { email, senha }
// ──────────────────────────────────────────────
export async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { email, senha } = await lerCorpo(req);

    if (!email || !senha) {
      responder(res, 400, { erro: 'Campos obrigatórios: email, senha.' });
      return;
    }

    const usuario = await autenticarUsuario({ email, senha });
    responder(res, 200, usuario);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// POST /usuarios/clientes
// Body: { email, senha, nome_completo, cpf, rg?, cnh? }
// ──────────────────────────────────────────────
export async function registrarCliente(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const corpo = await lerCorpo(req);
    const { email, senha, nome_completo, cpf, rg, cnh } = corpo;

    if (!email || !senha || !nome_completo || !cpf) {
      responder(res, 400, { erro: 'Campos obrigatórios: email, senha, nome_completo, cpf.' });
      return;
    }

    const resultado = await criarCliente({ email, senha, nomeCompleto: nome_completo, cpf, rg, cnh });
    responder(res, 201, resultado);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// POST /usuarios/gerentes
// Body: { email, senha, nome_completo, filial_id? }
// ──────────────────────────────────────────────
export async function registrarGerente(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const corpo = await lerCorpo(req);
    const { email, senha, nome_completo, filial_id } = corpo;

    if (!email || !senha || !nome_completo) {
      responder(res, 400, { erro: 'Campos obrigatórios: email, senha, nome_completo.' });
      return;
    }

    const resultado = await criarGerente({ email, senha, nomeCompleto: nome_completo, filialId: filial_id });
    responder(res, 201, resultado);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// GET /usuarios/clientes
// Acesso: GERENTE, ADMIN
// ──────────────────────────────────────────────
export async function listarTodosClientes(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const clientes = await listarClientes();
    responder(res, 200, clientes);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// GET /usuarios/clientes/:id
// Acesso: GERENTE, ADMIN
// ──────────────────────────────────────────────
export async function buscarCliente(req: IncomingMessage, res: ServerResponse, clienteId: string): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const cliente = await buscarClientePorId(clienteId);
    if (!cliente) { responder(res, 404, { erro: 'Cliente não encontrado.' }); return; }

    responder(res, 200, cliente);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// GET /usuarios/clientes/me
// Acesso: CLIENTE (retorna apenas os próprios dados)
// ──────────────────────────────────────────────
export async function buscarMeuPerfil(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'CLIENTE');

    const perfil = await buscarMeuPerfilCliente(caller.usuarioId);
    if (!perfil) { responder(res, 404, { erro: 'Perfil não encontrado.' }); return; }

    responder(res, 200, perfil);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// PUT /usuarios/clientes/:id
// Acesso: GERENTE, ADMIN
// Body: { nome_completo?, rg?, cnh? }
// ──────────────────────────────────────────────
export async function editarCliente(req: IncomingMessage, res: ServerResponse, clienteId: string): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const corpo = await lerCorpo(req);
    const { nome_completo, rg, cnh } = corpo;

    const clienteAtualizado = await atualizarCliente(clienteId, { nomeCompleto: nome_completo, rg, cnh });
    if (!clienteAtualizado) { responder(res, 400, { erro: 'Nenhum campo válido para atualizar.' }); return; }

    responder(res, 200, clienteAtualizado);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// PUT /usuarios/clientes/me
// Acesso: CLIENTE (edita apenas os próprios dados)
// Body: { nome_completo?, rg?, cnh? }
// ──────────────────────────────────────────────
export async function editarMeuPerfil(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'CLIENTE');

    const corpo = await lerCorpo(req);
    const { nome_completo, rg, cnh } = corpo;

    const atualizado = await atualizarMeuPerfilCliente(caller.usuarioId, { nomeCompleto: nome_completo, rg, cnh });
    if (!atualizado) { responder(res, 400, { erro: 'Nenhum campo válido para atualizar.' }); return; }

    responder(res, 200, atualizado);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// PATCH /usuarios/:id/senha
// Acesso: o próprio usuário (ownership check)
// Body: { nova_senha }
// ──────────────────────────────────────────────
export async function trocarSenha(req: IncomingMessage, res: ServerResponse, usuarioId: string): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireOwnership(caller, usuarioId, 'ADMIN');

    const { nova_senha } = await lerCorpo(req);
    if (!nova_senha) { responder(res, 400, { erro: 'Campo obrigatório: nova_senha.' }); return; }

    await alterarSenha(usuarioId, nova_senha);
    responder(res, 200, { mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    await tratarErro(res, err);
  }
}

// ──────────────────────────────────────────────
// DELETE /usuarios/:id
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function deletarUsuario(req: IncomingMessage, res: ServerResponse, usuarioId: string): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'ADMIN');

    await desativarUsuario(usuarioId);
    responder(res, 200, { mensagem: 'Usuário desativado com sucesso.' });
  } catch (err) {
    await tratarErro(res, err);
  }
}
