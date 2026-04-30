import 'dotenv/config';
import { query } from '../db/index.js';
import { gerarLinkPagamento } from './payment.service.js';
import { buscarPlanoBasico, buscarPlanoPorId, calcularValorSeguro } from './seguro.service.js';
import type { Caller } from '../middlewares/auth.js';

const EXPIRACAO_MINUTOS = Number(process.env.PAGAMENTO_EXPIRACAO_MINUTOS) || 15;

// ──────────────────────────────────────────────
// DISPONIBILIDADE
// ──────────────────────────────────────────────

/**
 * Busca a primeira unidade física disponível de um modelo para o período.
 * Garante (A): nenhum veículo pode ter reservas conflitantes ativas.
 * Status considerados conflitantes: PENDENTE_PAGAMENTO, RESERVADA, ATIVA.
 */
export async function buscarVeiculoDisponivel(
  modeloId: number,
  dataInicio: Date,
  dataFim: Date,
): Promise<string | null> {
  const sql = `
    SELECT v.id
    FROM veiculo v
    WHERE v.modelo_id = $1
      AND v.status IN ('DISPONIVEL', 'ALUGADO')
      AND v.deletado_em IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM reserva r
        WHERE r.veiculo_id = v.id
          AND r.status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA')
          AND r.data_inicio < $3
          AND r.data_fim > $2
          AND r.deletado_em IS NULL
      )
    LIMIT 1;
  `;

  const resultado = await query(sql, [modeloId, dataInicio, dataFim]);
  return resultado.rows[0]?.id ?? null;
}

/**
 * Calcula o valor total da reserva com base na tabela de preço dinâmico.
 * Fallback para preco_base_diaria do tipo_carro quando não há registro específico.
 */
export async function calcularValorTotal(
  modeloId: number,
  filialId: string,
  dataInicio: Date,
  dataFim: Date,
): Promise<number> {
  const numeroDias = Math.ceil(
    (dataFim.getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Verifica tabela de preço dinâmico para o período e filial
  const sqlDinamico = `
    SELECT tp.valor_diaria
    FROM tabela_preco tp
    JOIN modelo m ON m.tipo_carro_id = tp.tipo_carro_id
    WHERE m.id = $1
      AND tp.filial_id = $2
      AND tp.data_inicio <= $3
      AND tp.data_fim >= $4
    LIMIT 1;
  `;

  const resultadoDinamico = await query(sqlDinamico, [
    modeloId,
    filialId,
    dataInicio,
    dataFim,
  ]);

  if (resultadoDinamico.rows[0]) {
    return Number(resultadoDinamico.rows[0].valor_diaria) * numeroDias;
  }

  // Fallback: preço base do tipo de carro
  const sqlBase = `
    SELECT tc.preco_base_diaria
    FROM tipo_carro tc
    JOIN modelo m ON m.tipo_carro_id = tc.id
    WHERE m.id = $1;
  `;

  const resultadoBase = await query(sqlBase, [modeloId]);
  const precoDiaria = Number(resultadoBase.rows[0]?.preco_base_diaria ?? 0);

  return precoDiaria * numeroDias;
}

// ──────────────────────────────────────────────
// CRIAÇÃO E CONFIRMAÇÃO DE RESERVA
// ──────────────────────────────────────────────

interface CriarReservaParams {
  clienteId: string;
  veiculoId: string;
  filialRetiradaId: string;
  filialDevolucaoId: string;
  dataInicio: Date;
  dataFim: Date;
  valorAluguel: number;      // valor do aluguel puro (sem seguro)
  nomeCliente: string;
  emailCliente: string;
  telefoneCliente?: string;
  descricaoModelo: string;
  planoSeguroId?: string;    // opcional: se não informado, usa o plano básico da empresa
}

export interface ReservaCriada {
  reservaId: string;
  linkPagamento: string;
  valorTotal: number;
  valorSeguro: number;
  planoSeguro: string;
}

/**
 * Cria uma reserva em status PENDENTE_PAGAMENTO e gera o link de pagamento.
 * O veículo fica bloqueado por EXPIRACAO_MINUTOS para esse cliente.
 */
export async function criarReservaPendente(
  params: CriarReservaParams,
): Promise<ReservaCriada> {
  const expiraEm = new Date(Date.now() + EXPIRACAO_MINUTOS * 60 * 1000);

  // Resolve o plano de seguro: usa o escolhido pelo cliente ou o plano básico global
  const plano = params.planoSeguroId
    ? await buscarPlanoPorId(params.planoSeguroId)
    : null;

  const planoFinal = plano ?? await buscarPlanoBasico();
  const valorSeguro = calcularValorSeguro(planoFinal.percentual, params.valorAluguel);
  const valorTotal = params.valorAluguel + valorSeguro;

  // Cria a reserva pendente com seguro incluído, garantindo atomicamente a não-sobreposição
  const sqlInsert = `
    INSERT INTO reserva (
      cliente_id, veiculo_id, filial_retirada_id, filial_devolucao_id,
      data_inicio, data_fim, valor_total, status, expira_em,
      plano_seguro_id, valor_seguro
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, 'PENDENTE_PAGAMENTO', $8, $9, $10
    WHERE NOT EXISTS (
      SELECT 1 FROM reserva r
      WHERE r.veiculo_id = $2
        AND r.status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA')
        AND r.data_inicio < $6
        AND r.data_fim > $5
        AND r.deletado_em IS NULL
    )
    RETURNING id;
  `;

  const resultado = await query(sqlInsert, [
    params.clienteId,
    params.veiculoId,
    params.filialRetiradaId,
    params.filialDevolucaoId,
    params.dataInicio,
    params.dataFim,
    valorTotal,
    expiraEm,
    planoFinal.id,
    valorSeguro,
  ]);

  if (resultado.rowCount === 0) {
    throw new Error('O veículo selecionado não está disponível para o período solicitado (conflito de datas).');
  }

  const reservaId: string = resultado.rows[0].id;

  // Gera o link na InfinitePay com itens discriminados (aluguel + seguro)
  const { link_pagamento, slug } = await gerarLinkPagamento({
    orderNsu: reservaId,
    itens: [
      {
        quantity: 1,
        price: Math.round(params.valorAluguel * 100), // centavos
        description: params.descricaoModelo,
      },
      ...(valorSeguro > 0 ? [{
        quantity: 1,
        price: Math.round(valorSeguro * 100), // centavos
        description: `Seguro ${planoFinal.nome}`,
      }] : []),
    ],
    cliente: {
      name: params.nomeCliente,
      email: params.emailCliente,
      ...(params.telefoneCliente ? { phone_number: params.telefoneCliente } : {}),
    },
  });

  await query(
    `UPDATE reserva SET link_pagamento = $1, infinitepay_order_nsu = $2, infinitepay_slug = $3 WHERE id = $4`,
    [link_pagamento, reservaId, slug, reservaId],
  );

  return { reservaId, linkPagamento: link_pagamento, valorTotal, valorSeguro, planoSeguro: planoFinal.nome };
}

interface DadosWebhook {
  order_nsu: string;
  transaction_nsu: string;
  invoice_slug: string;
  capture_method: string;
  receipt_url: string;
}

/**
 * Confirma uma reserva após receber o webhook de pagamento aprovado.
 * Muda o status de PENDENTE_PAGAMENTO para RESERVADA.
 */
export async function confirmarReserva(dados: DadosWebhook): Promise<void> {
  const sql = `
    UPDATE reserva
    SET
      status = 'RESERVADA',
      infinitepay_nsu = $1,
      metodo_pagamento = $2,
      comprovante_url = $3,
      pagamento_em = NOW()
    WHERE id = $4
      AND status = 'PENDENTE_PAGAMENTO'
      AND deletado_em IS NULL;
  `;

  await query(sql, [
    dados.transaction_nsu,
    dados.capture_method,
    dados.receipt_url,
    dados.order_nsu, // order_nsu = reserva.id
  ]);
}

// ──────────────────────────────────────────────
// ESTENDER RESERVA
// ──────────────────────────────────────────────

/**
 * Estende uma reserva para uma nova data_fim.
 */
export async function estenderReserva(
  reservaId: string,
  novaDataFim: Date,
  caller: Caller
): Promise<void> {
  const reservaRes = await query(
    `SELECT r.*, v.modelo_id, c.usuario_id AS cliente_usuario_id
     FROM reserva r
     JOIN veiculo v ON v.id = r.veiculo_id
     JOIN cliente c ON c.id = r.cliente_id
     WHERE r.id = $1 AND r.deletado_em IS NULL`,
    [reservaId]
  );
  
  const reserva = reservaRes.rows[0];
  if (!reserva) throw new Error('Reserva não encontrada.');

  // Enforce para clientes
  if (caller.tipo === 'CLIENTE' && reserva.cliente_usuario_id !== caller.usuarioId) {
    throw new Error('Sem permissão: esta reserva não pertence a você.');
  }

  // Enforce para gerentes
  if (
    caller.tipo === 'GERENTE' &&
    caller.filialId !== null &&
    reserva.filial_retirada_id !== caller.filialId &&
    reserva.filial_devolucao_id !== caller.filialId
  ) {
    throw new Error('Sem permissão: esta reserva não pertence à sua filial.');
  }

  if (reserva.status !== 'ATIVA' && reserva.status !== 'RESERVADA') {
    throw new Error('Apenas reservas ativas ou confirmadas podem ser estendidas.');
  }

  if (novaDataFim <= new Date(reserva.data_fim)) {
    throw new Error('A nova data final deve ser posterior à data final atual.');
  }

  // Verifica se o veículo está disponível para o NOVO período sem contar a própria reserva
  const conflitoRes = await query(
    `SELECT 1 FROM reserva
     WHERE veiculo_id = $1
       AND status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA')
       AND data_inicio < $3
       AND data_fim > $2
       AND id != $4
       AND deletado_em IS NULL
     LIMIT 1`,
    [reserva.veiculo_id, reserva.data_inicio, novaDataFim, reserva.id]
  );

  if ((conflitoRes.rowCount ?? 0) > 0) {
    throw new Error('O veículo não está disponível para o período estendido (já existe outra reserva em conflito).');
  }

  // Calcula apenas o valor dos dias adicionais
  const valorBaseDiasExtras = await calcularValorTotal(
    reserva.modelo_id,
    reserva.filial_retirada_id,
    new Date(reserva.data_fim), // começa a cobrar a partir do fim original
    novaDataFim
  );

  const planoFinal = reserva.plano_seguro_id 
    ? await buscarPlanoPorId(reserva.plano_seguro_id)
    : await buscarPlanoBasico();
    
  // Verifica se o plano existe
  if (!planoFinal) throw new Error('Plano de seguro original não encontrado.');

  const seguroDiasExtras = calcularValorSeguro(planoFinal.percentual, valorBaseDiasExtras);
  const custoExtraTotal = valorBaseDiasExtras + seguroDiasExtras;

  // Atualiza a data fim e acumula a dívida no valor_adicional (mantendo valor_total original intacto)
  await query(
    `UPDATE reserva 
     SET data_fim = $1, valor_adicional = COALESCE(valor_adicional, 0) + $2
     WHERE id = $3`,
    [novaDataFim, custoExtraTotal, reserva.id]
  );
}

// ──────────────────────────────────────────────
// GARANTIA B: VERIFICAÇÃO DE RETIRADA
// ──────────────────────────────────────────────

export interface StatusRetirada {
  liberado: boolean;
  motivo?: string;
}

/**
 * Verifica em tempo real se o veículo de uma reserva está pronto para retirada.
 * Garantia B: chamada pelo gerente no momento de entregar as chaves.
 */
export async function verificarDisponibilidadeRetirada(
  reservaId: string,
): Promise<StatusRetirada> {
  const sql = `
    SELECT r.status AS reserva_status, v.status AS veiculo_status
    FROM reserva r
    JOIN veiculo v ON v.id = r.veiculo_id
    WHERE r.id = $1
      AND r.deletado_em IS NULL;
  `;

  const resultado = await query(sql, [reservaId]);

  if (!resultado.rows[0]) {
    return { liberado: false, motivo: 'Reserva não encontrada.' };
  }

  const { reserva_status, veiculo_status } = resultado.rows[0];

  if (reserva_status !== 'RESERVADA') {
    return { liberado: false, motivo: `Status da reserva inválido para retirada: ${reserva_status}` };
  }

  if (veiculo_status !== 'DISPONIVEL') {
    return { liberado: false, motivo: `Veículo não está disponível: ${veiculo_status}` };
  }

  return { liberado: true };
}

// ──────────────────────────────────────────────
// JOB: EXPIRAÇÃO DE RESERVAS PENDENTES
// ──────────────────────────────────────────────

/**
 * Expira reservas PENDENTE_PAGAMENTO cujo tempo limite foi ultrapassado.
 * Deve ser chamada periodicamente (ex: a cada 5 minutos via setInterval ou cron).
 */
export async function expirarReservasPendentes(): Promise<number> {
  const sql = `
    UPDATE reserva
    SET status = 'EXPIRADA'
    WHERE status = 'PENDENTE_PAGAMENTO'
      AND expira_em < NOW()
      AND deletado_em IS NULL
    RETURNING id;
  `;

  const resultado = await query(sql);
  return resultado.rowCount ?? 0;
}
