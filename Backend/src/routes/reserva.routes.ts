import { IncomingMessage, ServerResponse } from 'http';
import { query } from '../db/index.js';
import {
  buscarVeiculoDisponivel,
  calcularValorTotal,
  verificarDisponibilidadeRetirada,
} from '../services/reserva.service.js';

// ──────────────────────────────────────────────
// GET /reservas/disponibilidade
// Query params: modelo_id, filial_id, data_inicio, data_fim
// Verifica se há unidades disponíveis e retorna o preço
// ──────────────────────────────────────────────
export async function checarDisponibilidade(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const modeloId = Number(url.searchParams.get('modelo_id'));
  const filialId = url.searchParams.get('filial_id') ?? '';
  const dataInicio = url.searchParams.get('data_inicio');
  const dataFim = url.searchParams.get('data_fim');

  if (!modeloId || !filialId || !dataInicio || !dataFim) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Parâmetros obrigatórios: modelo_id, filial_id, data_inicio, data_fim.' }));
    return;
  }

  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);

  const veiculoId = await buscarVeiculoDisponivel(modeloId, inicio, fim);
  const disponivel = veiculoId !== null;

  let precoTotal: number | null = null;
  if (disponivel) {
    precoTotal = await calcularValorTotal(modeloId, filialId, inicio, fim);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ disponivel, preco_total: precoTotal }));
}

// ──────────────────────────────────────────────
// POST /reservas/:id/retirada
// Garantia B: verifica em tempo real se o veículo
// está pronto para ser entregue ao cliente.
// ──────────────────────────────────────────────
export async function confirmarRetirada(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  const { liberado, motivo } = await verificarDisponibilidadeRetirada(reservaId);

  if (!liberado) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ liberado: false, motivo }));
    return;
  }

  // Atualiza veículo para ALUGADO e reserva para ATIVA
  await query(
    `UPDATE veiculo SET status = 'ALUGADO'
     WHERE id = (SELECT veiculo_id FROM reserva WHERE id = $1)`,
    [reservaId],
  );

  await query(
    `UPDATE reserva SET status = 'ATIVA', data_retirada_real = NOW() WHERE id = $1`,
    [reservaId],
  );

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ liberado: true, mensagem: 'Retirada confirmada. Veículo marcado como ALUGADO.' }));
}

// ──────────────────────────────────────────────
// POST /reservas/:id/devolucao
// Registra a devolução do veículo, finalizando a reserva
// ──────────────────────────────────────────────
export async function confirmarDevolucao(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  const reserva = await query('SELECT veiculo_id, status FROM reserva WHERE id = $1', [reservaId]);

  if (!reserva.rows[0]) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Reserva não encontrada.' }));
    return;
  }

  if (reserva.rows[0].status !== 'ATIVA') {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Só é possível registrar devolução de reservas ATIVAS.' }));
    return;
  }

  await query(
    `UPDATE veiculo SET status = 'DISPONIVEL' WHERE id = $1`,
    [reserva.rows[0].veiculo_id],
  );

  await query(
    `UPDATE reserva SET status = 'FINALIZADA', data_devolucao_real = NOW() WHERE id = $1`,
    [reservaId],
  );

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ mensagem: 'Devolução registrada. Veículo marcado como DISPONIVEL.' }));
}
