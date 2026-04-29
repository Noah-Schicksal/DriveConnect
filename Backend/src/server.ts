import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';

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
  editarCliente,
  trocarSenha,
  deletarUsuario,
} from './routes/usuario.routes.js';

// Rotas de veículos
import {
  registrarVeiculo,
  listar,
  buscar,
  atualizar,
  deletar,
} from './routes/veiculo.routes.js';

const PORT = Number(process.env.PORT) || 3000;

// ──────────────────────────────────────────────
// Roteamento central (method + pathname)
// ──────────────────────────────────────────────
async function roteador(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // ── Usuários / Auth ──────────────────────────
  if (method === 'POST' && path === '/usuarios/login') return login(req, res);
  if (method === 'POST' && path === '/usuarios/clientes') return registrarCliente(req, res);
  if (method === 'POST' && path === '/usuarios/gerentes') return registrarGerente(req, res);
  if (method === 'GET' && path === '/usuarios/clientes') return listarTodosClientes(req, res);

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
  if (method === 'GET' && path === '/seguros') return listarSeguros(req, res);
  if (method === 'POST' && path === '/seguros') return criarSeguro(req, res);

  const matchSeguro = path.match(/^\/seguros\/([^/]+)$/);
  if (matchSeguro) {
    const planoId = matchSeguro[1];
    if (planoId !== undefined) {
      if (method === 'PUT') return atualizarSeguro(req, res, planoId);
      if (method === 'DELETE') return desativarSeguro(req, res, planoId);
    }
  }

  // ── Veículos ──────────────────────────────────
  if (method === 'POST' && path === '/veiculos') return registrarVeiculo(req, res);
  if (method === 'GET' && path === '/veiculos') return listar(req, res);

  const matchVeiculo = path.match(/^\/veiculos\/([^/]+)$/);
  if (matchVeiculo) {
    const veiculoId = matchVeiculo[1];
    if (veiculoId !== undefined) {
      if (method === 'GET') return buscar(req, res, veiculoId);
      if (method === 'PUT') return atualizar(req, res, veiculoId);
      if (method === 'DELETE') return deletar(req, res, veiculoId);
    }
  }

  // ── Servidor de Arquivos Estáticos (Uploads) ────
  if (method === 'GET' && path.startsWith('/uploads/')) {
    const filePath = require('path').join(process.cwd(), path);
    const fs = require('fs');
    if (fs.existsSync(filePath)) {
      const ext = require('path').extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
      return;
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
