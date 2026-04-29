import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { enforceHttps } from './middlewares/https.js';


// Rotas de reserva (disponibilidade, retirada, devolução, criação)
import {
  checarDisponibilidade,
  registrarReserva,
  confirmarRetirada,
  confirmarDevolucao,
} from './routes/reserva.routes.js';

// Rotas de reserva (consulta e cancelamento)
import {
  listarTodasReservas,
  detalharReserva,
  cancelarReservaHandler,
} from './routes/reservaConsulta.routes.js';

// Rotas de seguro
import {
  listarSeguros,
  criarSeguro,
  atualizarSeguro,
  desativarSeguro,
} from './routes/seguro.routes.js';

// Rotas de tabela de preço
import {
  listarTabelas,
  buscarTabela,
  registrarTabela,
  editarTabela,
  removerTabela,
} from './routes/tabelaPreco.routes.js';

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
  registrarFilial,
  editarFilial,
  desativarFilialHandler,
  listarTodosGerentes,
  buscarMeuPerfilDeGerente,
} from './routes/filial.routes.js';

// Rotas de tipos de carro
import {
  listarTipos,
  buscarTipo,
  registrarTipo,
  editarTipo,
  removerTipo,
} from './routes/tipoCarro.routes.js';

// Rotas de modelos
import {
  listar as listarModelos,
  listarDisponiveis as listarModelosDisponiveis,
  buscar as buscarModelo,
  registrar as registrarModelo,
  editar as editarModelo,
  remover as removerModelo,
} from './routes/modelo.routes.js';

// Rotas de veículos
import {
  registrarVeiculo,
  listar,
  buscar,
  atualizar,
  deletar,
} from './routes/veiculo.routes.js';

// Rotas de WhatsApp
import { receiveWebhook as receiveWebhookWhatsApp, verifyWebhook as verifyWebhookWhatsApp } from './routes/whatsapp.routes.js';

const PORT = Number(process.env.PORT) || 3000;

// ──────────────────────────────────────────────
// Roteamento central (method + pathname)
// ──────────────────────────────────────────────
async function roteador(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // HTTPS enforcement — redireciona HTTP → HTTPS em produção
  if (enforceHttps(req, res)) return;

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // ── Healthcheck ───────────────────────────────
  if (method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }

  // ── WhatsApp webhook ──────────────────────────
  if (path === '/whatsapp/webhook') {
    if (method === 'GET') return verifyWebhookWhatsApp(req, res);
    if (method === 'POST') return receiveWebhookWhatsApp(req, res);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Método não permitido.' }));
    return;
  }

  // ── Usuários / Auth ──────────────────────────
  if (method === 'POST' && path === '/usuarios/login') return login(req, res);
  if (method === 'POST' && path === '/usuarios/clientes') return registrarCliente(req, res);
  if (method === 'POST' && path === '/usuarios/gerentes') return registrarGerente(req, res);
  if (method === 'GET' && path === '/usuarios/clientes') return listarTodosClientes(req, res);

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
  if (method === 'POST' && path === '/filiais')     return registrarFilial(req, res);
  if (method === 'GET'  && path === '/gerentes')    return listarTodosGerentes(req, res);
  if (method === 'GET'  && path === '/gerentes/me') return buscarMeuPerfilDeGerente(req, res);

  const matchFilial = path.match(/^\/filiais\/([^/]+)$/);
  if (matchFilial) {
    const filialId = matchFilial[1];
    if (filialId !== undefined) {
      if (method === 'GET')    return detalharFilial(req, res, filialId);
      if (method === 'PUT')    return editarFilial(req, res, filialId);
      if (method === 'DELETE') return desativarFilialHandler(req, res, filialId);
    }
  }

  // ── Tipos de Carro ────────────────────────────
  if (method === 'GET'  && path === '/tipos-carro') return listarTipos(req, res);
  if (method === 'POST' && path === '/tipos-carro') return registrarTipo(req, res);

  const matchTipo = path.match(/^\/tipos-carro\/([^/]+)$/);
  if (matchTipo) {
    const tipoId = matchTipo[1];
    if (tipoId !== undefined) {
      if (method === 'GET')    return buscarTipo(req, res, tipoId);
      if (method === 'PUT')    return editarTipo(req, res, tipoId);
      if (method === 'DELETE') return removerTipo(req, res, tipoId);
    }
  }

  // ── Modelos ───────────────────────────────────
  if (method === 'GET'  && path === '/modelos/disponiveis') return listarModelosDisponiveis(req, res);
  if (method === 'GET'  && path === '/modelos') return listarModelos(req, res);
  if (method === 'POST' && path === '/modelos') return registrarModelo(req, res);

  const matchModelo = path.match(/^\/modelos\/([^/]+)$/);
  if (matchModelo) {
    const modeloId = matchModelo[1];
    if (modeloId !== undefined) {
      if (method === 'GET')    return buscarModelo(req, res, modeloId);
      if (method === 'PUT')    return editarModelo(req, res, modeloId);
      if (method === 'DELETE') return removerModelo(req, res, modeloId);
    }
  }

  // ── Reservas ─────────────────────────────────
  if (method === 'GET'  && path === '/reservas/disponibilidade') return checarDisponibilidade(req, res);
  if (method === 'POST' && path === '/reservas') return registrarReserva(req, res);
  if (method === 'GET'  && path === '/reservas') return listarTodasReservas(req, res);

  // Rotas com sufixo fixo devem vir ANTES do regex /:id
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

  const matchCancelar = path.match(/^\/reservas\/([^/]+)\/cancelar$/);
  if (matchCancelar && method === 'POST') {
    const reservaId = matchCancelar[1];
    if (reservaId !== undefined) return cancelarReservaHandler(req, res, reservaId);
  }

  const matchReserva = path.match(/^\/reservas\/([^/]+)$/);
  if (matchReserva && method === 'GET') {
    const reservaId = matchReserva[1];
    if (reservaId !== undefined) return detalharReserva(req, res, reservaId);
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

  // ── Tabelas de Preço ──────────────────────────
  if (method === 'GET'  && path === '/tabelas-preco') return listarTabelas(req, res);
  if (method === 'POST' && path === '/tabelas-preco') return registrarTabela(req, res);

  const matchTabela = path.match(/^\/tabelas-preco\/([^/]+)$/);
  if (matchTabela) {
    const tabelaId = matchTabela[1];
    if (tabelaId !== undefined) {
      if (method === 'GET')    return buscarTabela(req, res, tabelaId);
      if (method === 'PUT')    return editarTabela(req, res, tabelaId);
      if (method === 'DELETE') return removerTabela(req, res, tabelaId);
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
