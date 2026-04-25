import { IncomingMessage, ServerResponse } from 'http';
import { query } from '../db/index.js';
import {
  buscarVeiculoDisponivel,
  calcularValorTotal,
  criarReservaPendente,
  confirmarReserva,
} from '../services/reserva.service.js';

// ──────────────────────────────────────────────
// POST /pagamento/iniciar
// Recebe modelo, datas e dados do cliente, cria
// reserva pendente e devolve o link de checkout.
// ──────────────────────────────────────────────
export async function iniciarPagamento(req: IncomingMessage, res: ServerResponse) {
  const corpo = await lerCorpo(req);

  const {
    modelo_id,
    filial_retirada_id,
    filial_devolucao_id,
    data_inicio,
    data_fim,
    cliente_id,
    plano_seguro_id,  // opcional: se omitido usa o plano básico da locadora
  } = corpo;

  if (!modelo_id || !filial_retirada_id || !data_inicio || !data_fim || !cliente_id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Campos obrigatórios faltando.' }));
    return;
  }

  const inicio = new Date(data_inicio);
  const fim = new Date(data_fim);

  // Busca unidade física disponível (Garantia A)
  const veiculoId = await buscarVeiculoDisponivel(modelo_id, inicio, fim);

  if (!veiculoId) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Nenhum veículo disponível para o período solicitado.' }));
    return;
  }

  // Busca dados do cliente, modelo e franquia da filial
  const [dadosCliente, dadosModelo, dadosFilial] = await Promise.all([
    query('SELECT c.nome_completo, u.email FROM cliente c JOIN usuario u ON u.id = c.usuario_id WHERE c.id = $1', [cliente_id]),
    query('SELECT m.nome, m.marca FROM modelo m WHERE m.id = $1', [modelo_id]),
    query('SELECT franquia_id FROM filial WHERE id = $1', [filial_retirada_id]),
  ]);

  if (!dadosCliente.rows[0] || !dadosModelo.rows[0] || !dadosFilial.rows[0]) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Cliente, modelo ou filial não encontrado.' }));
    return;
  }

  const valorAluguel = await calcularValorTotal(modelo_id, filial_retirada_id, inicio, fim);
  const franquiaId: string = dadosFilial.rows[0].franquia_id;

  const reservaCriada = await criarReservaPendente({
    clienteId: cliente_id,
    veiculoId,
    franquiaId,
    filialRetiradaId: filial_retirada_id,
    filialDevolucaoId: filial_devolucao_id ?? filial_retirada_id,
    dataInicio: inicio,
    dataFim: fim,
    valorAluguel,
    nomeCliente: dadosCliente.rows[0].nome_completo,
    emailCliente: dadosCliente.rows[0].email,
    descricaoModelo: `${dadosModelo.rows[0].marca} ${dadosModelo.rows[0].nome}`,
    planoSeguroId: plano_seguro_id,
  });

  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    reserva_id: reservaCriada.reservaId,
    link_pagamento: reservaCriada.linkPagamento,
    valor_aluguel: valorAluguel,
    valor_seguro: reservaCriada.valorSeguro,
    plano_seguro: reservaCriada.planoSeguro,
    valor_total: reservaCriada.valorTotal,
  }));
}

// ──────────────────────────────────────────────
// POST /pagamento/webhook
// Recebe notificação da InfinitePay e confirma
// a reserva automaticamente.
// ──────────────────────────────────────────────
export async function receberWebhook(req: IncomingMessage, res: ServerResponse) {
  const corpo = await lerCorpo(req);

  const { order_nsu, transaction_nsu, invoice_slug, capture_method, receipt_url } = corpo;

  if (!order_nsu || !transaction_nsu) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Payload inválido.' }));
    return;
  }

  await confirmarReserva({ order_nsu, transaction_nsu, invoice_slug, capture_method, receipt_url });

  // InfinitePay exige resposta rápida (< 1 segundo)
  res.writeHead(200);
  res.end();
}

// ──────────────────────────────────────────────
// GET /pagamento/status/:reservaId
// Fallback: polling manual do status de pagamento
// ──────────────────────────────────────────────
export async function statusPagamento(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  const resultado = await query(
    'SELECT status, infinitepay_nsu, infinitepay_slug, metodo_pagamento, comprovante_url, pagamento_em FROM reserva WHERE id = $1',
    [reservaId],
  );

  if (!resultado.rows[0]) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Reserva não encontrada.' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(resultado.rows[0]));
}

// ──────────────────────────────────────────────
// Utilitário: lê o corpo JSON da requisição
// ──────────────────────────────────────────────
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
