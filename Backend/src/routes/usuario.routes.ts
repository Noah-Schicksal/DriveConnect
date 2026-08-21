import { IncomingMessage, ServerResponse } from 'http';
import {
  autenticarUsuario,
  criarCliente,
  criarGerente,
  listarClientes,
  listarUsuariosSistema,
  buscarClientePorId,
  atualizarCliente,
  alterarSenha,
  desativarUsuario,
  buscarMeuPerfilCliente,
  atualizarMeuPerfilCliente,
  esqueciSenha,
  redefinirSenhaComToken,
  atualizarFotoPerfil,
  atualizarPreferenciasUsuario,
  buscarUsuarioPorId,
} from '../services/usuario.service.js';
import { processarUpload } from '../services/storage.service.js';
import { requireCaller, requireTipo, requireOwnership, gerarToken } from '../middlewares/auth.js';


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

// POST /usuarios/esqueci-senha
// Body: { email }
export async function solicitarRecuperacaoSenha(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { email } = await lerCorpo(req);
    if (!email) {
      responder(res, 400, { erro: 'Campo obrigatório: email.' });
      return;
    }

    const token = await esqueciSenha(email);
    if (token) {
      responder(res, 200, { mensagem: 'Instruções enviadas para o e-mail.', token_debug: token });
    } else {
      responder(res, 200, { mensagem: 'Instruções enviadas para o e-mail.' });
    }
  } catch (err) {
    await tratarErro(res, err);
  }
}

// POST /usuarios/redefinir-senha
// Body: { token, nova_senha }
export async function redefinirSenhaToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { token, nova_senha } = await lerCorpo(req);
    if (!token || !nova_senha) {
      responder(res, 400, { erro: 'Campos obrigatórios: token, nova_senha.' });
      return;
    }

    await redefinirSenhaComToken(token, nova_senha);
    responder(res, 200, { mensagem: 'Senha redefinida com sucesso. Faça login.' });
  } catch (err) {
    await tratarErro(res, err);
  }
}

// POST /usuarios/login
// Body: { email, senha }
export async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { email, senha } = await lerCorpo(req);

    if (!email || !senha) {
      responder(res, 400, { erro: 'Campos obrigatórios: email, senha.' });
      return;
    }

    const usuario = await autenticarUsuario({ email, senha });
    const token = gerarToken({
      id: usuario.id,
      email: usuario.email,
      tipo: usuario.tipo,
      filialId: usuario.filialId,
    });

    responder(res, 200, { token, ...usuario });
  } catch (err) {
    await tratarErro(res, err);
  }
}

// POST /usuarios/clientes
// Body: { email, senha, nome_completo, cpf, rg?, cnh? }
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

// POST /usuarios/gerentes
// Body: { email, senha, nome_completo, filial_id? }
export async function registrarGerente(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'ADMIN');

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

// GET /usuarios
// Acesso: ADMIN
export async function listarTodosUsuariosSistema(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'ADMIN');

    const usuarios = await listarUsuariosSistema();
    responder(res, 200, usuarios);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// GET /usuarios/clientes
// Acesso: GERENTE, ADMIN
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

// GET /usuarios/clientes/:id
// Acesso: GERENTE, ADMIN
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

// GET /usuarios/clientes/me
// Acesso: CLIENTE (retorna apenas os próprios dados)
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

// PUT /usuarios/clientes/:id
// Acesso: GERENTE, ADMIN
// Body: { nome_completo?, rg?, cnh? }
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

// PUT /usuarios/clientes/me
// Acesso: CLIENTE (edita apenas os próprios dados)
// Body: { nome_completo?, rg?, cnh? }
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

// DELETE /usuarios/clientes/me
// Acesso: CLIENTE (desativa a própria conta e o perfil de cliente)
export async function desativarMinhaContaCliente(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'CLIENTE');

    await desativarUsuario(caller.usuarioId);
    responder(res, 200, { mensagem: 'Conta desativada com sucesso.' });
  } catch (err) {
    await tratarErro(res, err);
  }
}

// PATCH /usuarios/:id/senha
// Acesso: o próprio usuário (ownership check)
// Body: { nova_senha }
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

// DELETE /usuarios/:id
// Acesso: ADMIN
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

// POST /usuarios/me/foto
// Acesso: logado
export async function atualizarFotoPerfilHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    const { caminhoImagem } = await processarUpload(req, 'perfil');

    if (!caminhoImagem) {
      responder(res, 400, { erro: 'Nenhuma imagem enviada.' });
      return;
    }

    await atualizarFotoPerfil(caller.usuarioId, caminhoImagem);
    responder(res, 200, { mensagem: 'Foto atualizada!', imagem_url: caminhoImagem });
  } catch (err) {
    await tratarErro(res, err);
  }
}

// PATCH /usuarios/me/preferencias
// Acesso: logado
export async function atualizarPreferenciasHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    const corpo = await lerCorpo(req);

    if (!corpo || Object.keys(corpo).length === 0) {
      responder(res, 400, { erro: 'Nenhuma preferência enviada.' });
      return;
    }

    await atualizarPreferenciasUsuario(caller.usuarioId, corpo);
    responder(res, 200, { mensagem: 'Preferências atualizadas!' });
  } catch (err) {
    await tratarErro(res, err);
  }
}


// GET /usuarios/me/foto
// Acesso: logado (serve a própria imagem binária)
export async function baixarMinhaFotoHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    const usuario = await buscarUsuarioPorId(caller.usuarioId);

    if (!usuario?.imagemUrl) {
      responder(res, 404, { erro: 'O usuário não possui foto de perfil configurada.' });
      return;
    }

    const { lerArquivoSeguro } = await import('../services/storage.service.js');
    const stream = lerArquivoSeguro(usuario.imagemUrl, 'perfil');

    const ext = usuario.imagemUrl.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=86400'
    });
    stream.pipe(res);
  } catch (err) {
    await tratarErro(res, err);
  }
}

// DELETE /usuarios/me/foto
// Acesso: logado
export async function removerFotoPerfilHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    await atualizarFotoPerfil(caller.usuarioId, null as any); // cast para aceitar null no banco
    responder(res, 200, { mensagem: 'Foto removida com sucesso.' });
  } catch (err) {
    await tratarErro(res, err);
  }
}
