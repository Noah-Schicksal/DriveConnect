import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { enforceHttps } from './middlewares/https.js';


// Rotas de reserva
import {
  checarDisponibilidade,
  confirmarRetirada,
  confirmarDevolucao,
} from './routes/reserva.routes.js';

// Rotas de seguro
import {
  listarSeguros,
  criarSeguro,
  atualizarSeguro,
  desativarSeguro,
} from './routes/seguro.routes.js';

// Rotas de usuário
import {
  login,
  registrarCliente,
  registrarGerente,
  listarTodosClientes,
  buscarCliente,
  buscarMeuPerfil,
  editarCliente,
  editarMeuPerfil,
  trocarSenha,
  deletarUsuario,
} from './routes/usuario.routes.js';

// Rotas de filial / gerente
import {
  listarTodasFiliais,
  detalharFilial,
  editarFilial,
  listarTodosGerentes,
  buscarMeuPerfilDeGerente,
} from './routes/filial.routes.js';


const PORT = Number(process.env.PORT) || 3000;

// ──────────────────────────────────────────────
// Roteamento central (method + pathname)
// ──────────────────────────────────────────────
async function roteador(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // HTTPS enforcement — redireciona HTTP → HTTPS em produção
  if (enforceHttps(req, res)) return;

  const url    = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path   = url.pathname;
  const method = req.method ?? 'GET';

  // ── Usuários / Auth ──────────────────────────
  if (method === 'POST' && path === '/usuarios/login')     return login(req, res);
  if (method === 'POST' && path === '/usuarios/clientes')  return registrarCliente(req, res);
  if (method === 'POST' && path === '/usuarios/gerentes')  return registrarGerente(req, res);
  if (method === 'GET'  && path === '/usuarios/clientes')  return listarTodosClientes(req, res);

  // /clientes/me deve vir ANTES de /clientes/:id para não ser capturado pelo regex
  if (method === 'GET'  && path === '/usuarios/clientes/me') return buscarMeuPerfil(req, res);
  if (method === 'PUT'  && path === '/usuarios/clientes/me') return editarMeuPerfil(req, res);

  const matchCliente = path.match(/^\/usuarios\/clientes\/([^/]+)$/);
  if (matchCliente) {
    const clienteId = matchCliente[1];
    if (clienteId !== undefined) {
      if (method === 'GET') return buscarCliente(req, res, clienteId);
      if (method === 'PUT') return editarCliente(req, res, clienteId);
    }
  }

  const matchSenha = path.match(/^\/usuarios\/([^/]+)\/senha$/);
  if (matchSenha && method === 'PATCH') {
    const usuarioId = matchSenha[1];
    if (usuarioId !== undefined) return trocarSenha(req, res, usuarioId);
  }

  const matchUsuario = path.match(/^\/usuarios\/([^/]+)$/);
  if (matchUsuario && method === 'DELETE') {
    const usuarioId = matchUsuario[1];
    if (usuarioId !== undefined) return deletarUsuario(req, res, usuarioId);
  }

  // ── Filiais / Gerentes ────────────────────────
  if (method === 'GET'  && path === '/filiais')     return listarTodasFiliais(req, res);
  if (method === 'GET'  && path === '/gerentes')    return listarTodosGerentes(req, res);
  if (method === 'GET'  && path === '/gerentes/me') return buscarMeuPerfilDeGerente(req, res);

  const matchFilial = path.match(/^\/filiais\/([^/]+)$/);
  if (matchFilial) {
    const filialId = matchFilial[1];
    if (filialId !== undefined) {
      if (method === 'GET') return detalharFilial(req, res, filialId);
      if (method === 'PUT') return editarFilial(req, res, filialId);
    }
  }

  // ── Reservas ─────────────────────────────────
  if (method === 'GET' && path === '/reservas/disponibilidade') return checarDisponibilidade(req, res);

  const matchRetirada = path.match(/^\/reservas\/([^/]+)\/retirada$/);
  if (matchRetirada && method === 'POST') {
    const reservaId = matchRetirada[1];
    if (reservaId !== undefined) return confirmarRetirada(req, res, reservaId);
  }

  const matchDevolucao = path.match(/^\/reservas\/([^/]+)\/devolucao$/);
  if (matchDevolucao && method === 'POST') {
    const reservaId = matchDevolucao[1];
    if (reservaId !== undefined) return confirmarDevolucao(req, res, reservaId);
  }

  // ── Seguros ───────────────────────────────────
  if (method === 'GET'  && path === '/seguros') return listarSeguros(req, res);
  if (method === 'POST' && path === '/seguros') return criarSeguro(req, res);

  const matchSeguro = path.match(/^\/seguros\/([^/]+)$/);
  if (matchSeguro) {
    const planoId = matchSeguro[1];
    if (planoId !== undefined) {
      if (method === 'PUT')    return atualizarSeguro(req, res, planoId);
      if (method === 'DELETE') return desativarSeguro(req, res, planoId);
    }
  }

  // ── 404 ───────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ erro: 'Rota não encontrada.' }));
}

const server = createServer(async (req, res) => {
  try {
    await roteador(req, res);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro interno do servidor.';
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: mensagem }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ DriveConnect API rodando na porta ${PORT}`);
});
