import { IncomingMessage, ServerResponse } from 'http';
import { query } from '../db/index.js';
import {
  buscarVeiculoDisponivelPorFilial,
  calcularValorTotal,
  verificarDisponibilidadeRetirada,
  criarReservaPendente,
  estenderReserva,
  atualizarReservaPendente,
} from '../services/reserva.service.js';
import { requireCaller, requireTipo } from '../middlewares/auth.js';
import { atualizarStatusVeiculoPorReservaE_Notificar } from '../services/veiculo.service.js';

function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (chunk) => (dados += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(dados || '{}')); }
      catch { reject(new Error('JSON inválido.')); }
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
  const status = mensagem.includes('inválid') || mensagem.includes('obrigatório') || mensagem.includes('ausente') ? 400
    : mensagem.includes('não encontrad') ? 404
      : mensagem.includes('disponível') || mensagem.includes('conflito') ? 409
        : mensagem.includes('Não autorizado') ? 401
          : mensagem.includes('Sem permissão') ? 403
            : 500;
  return { status, mensagem };
}

// GET /reservas/disponibilidade
// Query params: modelo_id, filial_id, data_inicio, data_fim
// Verifica se há unidades disponíveis e retorna o preço
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

  const veiculoId = await buscarVeiculoDisponivelPorFilial(modeloId, filialId, inicio, fim);
  const disponivel = veiculoId !== null;

  let precoTotal: number | null = null;
  if (disponivel) {
    precoTotal = await calcularValorTotal(modeloId, filialId, inicio, fim);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ disponivel, preco_total: precoTotal, veiculo_id: veiculoId }));
}

// POST /reservas
// Body: { veiculo_id, filial_retirada_id, filial_devolucao_id, data_inicio, data_fim, plano_seguro_id }
// Acesso: CLIENTE
export async function registrarReserva(req: IncomingMessage, res: ServerResponse) {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'CLIENTE', 'GERENTE', 'ADMIN');

    const corpo = await lerCorpo(req) as Record<string, string>;

    const {
      veiculo_id,
      filial_retirada_id,
      filial_devolucao_id,
      data_inicio,
      data_fim,
      plano_seguro_id,
      metodo_pagamento,
      cliente_id
    } = corpo;

    if (!veiculo_id || !filial_retirada_id || !filial_devolucao_id || !data_inicio || !data_fim) {
      responder(res, 400, { erro: 'Parâmetros obrigatórios ausentes.' });
      return;
    }

    // Busca dados complementares do cliente
    let queryCliente: string;
    let paramsCliente: any[];

    if (caller.tipo === 'CLIENTE') {
      queryCliente = `
        SELECT c.id, c.nome_completo, u.email, c.telefone 
        FROM cliente c
        JOIN usuario u ON u.id = c.usuario_id
        WHERE c.usuario_id = $1
      `;
      paramsCliente = [caller.usuarioId];
    } else {
      if (!cliente_id) {
        responder(res, 400, { erro: 'cliente_id é obrigatório para reservas criadas por gerentes.' });
        return;
      }
      queryCliente = `
        SELECT c.id, c.nome_completo, u.email, c.telefone 
        FROM cliente c
        JOIN usuario u ON u.id = c.usuario_id
        WHERE c.id = $1
      `;
      paramsCliente = [cliente_id];

      // Se for gerente, validar se a filial de retirada pertence a ele (opcional)
      if (caller.tipo === 'GERENTE' && caller.filialId && caller.filialId !== filial_retirada_id) {
        responder(res, 403, { erro: 'Gerente só pode criar reserva para sua própria filial.' });
        return;
      }
    }

    const clienteResult = await query(queryCliente, paramsCliente);
    if (!clienteResult.rows[0]) throw new Error('Cliente não encontrado.');
    const cliente = clienteResult.rows[0];
    const finalClienteId = cliente.id;

    const veiculoResult = await query(`
      SELECT v.modelo_id, m.nome || ' ' || m.marca AS descricao_modelo
      FROM veiculo v
      JOIN modelo m ON m.id = v.modelo_id
      WHERE v.id = $1
    `, [veiculo_id]);
    if (!veiculoResult.rows[0]) throw new Error('Veículo não encontrado.');
    const veiculo = veiculoResult.rows[0];

    // Calcula valor aluguel
    const valorAluguel = await calcularValorTotal(
      veiculo.modelo_id,
      filial_retirada_id,
      new Date(data_inicio),
      new Date(data_fim)
    );

    // Cria a reserva chamando o service que integra com InfinitePay
    const paramsReserva: any = {
      clienteId: finalClienteId,
      veiculoId: veiculo_id,
      filialRetiradaId: filial_retirada_id,
      filialDevolucaoId: filial_devolucao_id,
      dataInicio: new Date(data_inicio),
      dataFim: new Date(data_fim),
      valorAluguel,
      nomeCliente: cliente.nome_completo,
      emailCliente: cliente.email,
      descricaoModelo: veiculo.descricao_modelo,
    };

    if (cliente.telefone) paramsReserva.telefoneCliente = cliente.telefone;
    if (plano_seguro_id) paramsReserva.planoSeguroId = plano_seguro_id;
    if (metodo_pagamento) paramsReserva.metodoPagamento = metodo_pagamento;

    const reserva = await criarReservaPendente({
      ...paramsReserva,
      origem: caller.tipo === 'CLIENTE' ? 'APP' : 'GERENTE_APP',
    });

    responder(res, 201, reserva);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// POST /reservas/:id/estender
// Estende uma reserva ativa ou reservada para uma nova data_fim.
// Acesso: CLIENTE, GERENTE, ADMIN
export async function estenderReservaHandler(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  try {
    const caller = requireCaller(req);
    const corpo = await lerCorpo(req) as Record<string, string>;
    const { nova_data_fim } = corpo;

    if (!nova_data_fim) {
      responder(res, 400, { erro: 'Parâmetro obrigatório: nova_data_fim.' });
      return;
    }

    await estenderReserva(reservaId, new Date(nova_data_fim), caller);
    responder(res, 200, { mensagem: 'Reserva estendida com sucesso.' });
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// POST /reservas/:id/retirada
// Garantia B: verifica em tempo real se o veículo
// está pronto para ser entregue ao cliente.
export async function confirmarRetirada(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const { liberado, motivo } = await verificarDisponibilidadeRetirada(reservaId);

    if (!liberado) {
      responder(res, 409, { liberado: false, motivo });
      return;
    }

    // Atualiza veículo para ALUGADO (com notificação FCM) e reserva para ATIVA
    await atualizarStatusVeiculoPorReservaE_Notificar({
      reservaId,
      novoStatus: 'ALUGADO',
      origem: 'RESERVA_RETIRADA',
    });

    await query(
      `UPDATE reserva SET status = 'ATIVA', data_retirada_real = NOW() WHERE id = $1`,
      [reservaId],
    );

    responder(res, 200, { liberado: true, mensagem: 'Retirada confirmada. Veículo marcado como ALUGADO.' });
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// POST /reservas/:id/devolucao
// Registra a devolução do veículo, finalizando a reserva
export async function confirmarDevolucao(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    const reserva = await query('SELECT veiculo_id, status FROM reserva WHERE id = $1', [reservaId]);

    if (!reserva.rows[0]) {
      responder(res, 404, { erro: 'Reserva não encontrada.' });
      return;
    }

    if (reserva.rows[0].status !== 'ATIVA') {
      responder(res, 409, { erro: 'Só é possível registrar devolução de reservas ATIVAS.' });
      return;
    }

    await atualizarStatusVeiculoPorReservaE_Notificar({
      reservaId,
      novoStatus: 'DISPONIVEL',
      origem: 'RESERVA_DEVOLUCAO',
    });

    await query(
      `UPDATE reserva SET status = 'FINALIZADA', data_devolucao_real = NOW() WHERE id = $1`,
      [reservaId],
    );

    responder(res, 200, { mensagem: 'Devolução registrada. Veículo marcado como DISPONIVEL.' });
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}
// POST /reservas/:id/confirmar-pagamento
// Permite que um gerente ou admin confirme manualmente o pagamento
// (ex: recebimento em dinheiro ou via link externo)
// Acesso: GERENTE, ADMIN (via JWT)
export async function manualConfirmarPagamento(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  try {
    const caller = requireCaller(req);
    requireTipo(caller, 'GERENTE', 'ADMIN');

    await query(
      `UPDATE reserva SET status = 'RESERVADA', pagamento_em = NOW() WHERE id = $1 AND status = 'PENDENTE_PAGAMENTO'`,
      [reservaId]
    );

    responder(res, 200, { mensagem: 'Pagamento confirmado manualmente. Reserva agora está RESERVADA.' });
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}

// PATCH /reservas/:id
// Atualiza uma reserva pendente (veículo e datas)
// Acesso: CLIENTE (própria), GERENTE (filial própria) | ADMIN
export async function atualizarReservaHandler(req: IncomingMessage, res: ServerResponse, reservaId: string) {
  try {
    const caller = requireCaller(req);
    const corpo = await lerCorpo(req) as Record<string, string>;

    const params: {
      veiculoId?: string;
      dataInicio?: Date;
      dataFim?: Date;
    } = {};

    if (corpo.veiculo_id) params.veiculoId = corpo.veiculo_id;
    if (corpo.data_inicio) params.dataInicio = new Date(corpo.data_inicio);
    if (corpo.data_fim) params.dataFim = new Date(corpo.data_fim);

    const resultado = await atualizarReservaPendente(reservaId, params, caller);
    responder(res, 200, resultado);
  } catch (err) {
    const { status, mensagem } = mapearErro(err);
    responder(res, status, { erro: mensagem });
  }
}
