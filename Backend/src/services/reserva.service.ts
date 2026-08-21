import 'dotenv/config';
import { query } from '../db/index.js';
import { gerarLinkPagamento } from './payment.service.js';
import { buscarPlanoBasico, buscarPlanoPorId, calcularValorSeguro } from './seguro.service.js';
import { notifyPagamentoConfirmado, notifyReservaExpirada, notifyReservaPendente, notifyVeiculoStatusAlteradoBulkAllManagers } from './fcm.service.js';
import type { Caller } from '../middlewares/auth.js';

const EXPIRACAO_MINUTOS = Number(process.env.PAGAMENTO_EXPIRACAO_MINUTOS) || 15;

// DISPONIBILIDADE
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
  // Normaliza para "dia cheio": muitos fluxos passam apenas YYYY-MM-DD.
  // Usar recorte por DATE evita problemas de fuso (JS Date cria em UTC).
  const inicioDia = new Date(Date.UTC(dataInicio.getUTCFullYear(), dataInicio.getUTCMonth(), dataInicio.getUTCDate(), 12, 0, 0));
  const fimDiaExclusive = new Date(Date.UTC(dataFim.getUTCFullYear(), dataFim.getUTCMonth(), dataFim.getUTCDate() + 1, 12, 0, 0));

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

  const resultado = await query(sql, [modeloId, inicioDia, fimDiaExclusive]);
  return resultado.rows[0]?.id ?? null;
}

/**
 * Busca a primeira unidade física disponível de um modelo em uma filial específica.
 */
export async function buscarVeiculoDisponivelPorFilial(
  modeloId: number,
  filialId: string,
  dataInicio: Date,
  dataFim: Date,
): Promise<string | null> {
  // Normaliza para "dia cheio" e evita bugs de timezone (Date(YYYY-MM-DD) é UTC).
  const inicioDia = new Date(Date.UTC(dataInicio.getUTCFullYear(), dataInicio.getUTCMonth(), dataInicio.getUTCDate(), 12, 0, 0));
  const fimDiaExclusive = new Date(Date.UTC(dataFim.getUTCFullYear(), dataFim.getUTCMonth(), dataFim.getUTCDate() + 1, 12, 0, 0));

  const sql = `
    SELECT v.id
    FROM veiculo v
    WHERE v.modelo_id = $1
      AND v.filial_id = $2
      AND v.status IN ('DISPONIVEL', 'ALUGADO')
      AND v.deletado_em IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM reserva r
        WHERE r.veiculo_id = v.id
          AND r.status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA')
          AND r.data_inicio < $4
          AND r.data_fim > $3
          AND r.deletado_em IS NULL
      )
    LIMIT 1;
  `;

  const resultado = await query(sql, [modeloId, filialId, inicioDia, fimDiaExclusive]);
  return resultado.rows[0]?.id ?? null;
}

/**
 * Busca uma unidade física disponível de um modelo em uma filial específica
 * sem considerar as datas (apenas verifica status do veículo).
 * Uso: quando o agente deve apenas checar se existe veículo disponível fisicamente.
 */
export async function buscarVeiculoFisicoDisponivelSemData(
  modeloId: number,
  filialId: string,
): Promise<string | null> {
  const sql = `
    SELECT v.id
    FROM veiculo v
    WHERE v.modelo_id = $1
      AND v.filial_id = $2
      AND v.status = 'DISPONIVEL'
      AND v.deletado_em IS NULL
    LIMIT 1;
  `;

  const resultado = await query(sql, [modeloId, filialId]);
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

// CRIAÇÃO E CONFIRMAÇÃO DE RESERVA
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
  metodoPagamento?: string;  // opcional: se 'DINHEIRO', pula InfinitePay
  origem?: string;
}

export interface ReservaCriada {
  reservaId: string;
  linkPagamento?: string;
  valorTotal: number;
  valorSeguro: number;
  planoSeguro: string;
  status: string;
}

/**
 * Cria uma reserva em status PENDENTE_PAGAMENTO e gera o link de pagamento.
 * Se o método for 'DINHEIRO', cria já como RESERVADA.
 */
export async function criarReservaPendente(
  params: CriarReservaParams,
): Promise<ReservaCriada> {
  const expiraEm = params.metodoPagamento === 'DINHEIRO' ? null : new Date(Date.now() + EXPIRACAO_MINUTOS * 60 * 1000);
  const statusInicial = params.metodoPagamento === 'DINHEIRO' ? 'RESERVADA' : 'PENDENTE_PAGAMENTO';

  // Resolve o plano de seguro: usa o escolhido pelo cliente ou o plano básico global
  const isUuid = params.planoSeguroId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(params.planoSeguroId);
  const plano = isUuid
    ? await buscarPlanoPorId(params.planoSeguroId!)
    : null;

  const planoFinal = plano ?? await buscarPlanoBasico();
  const valorSeguro = calcularValorSeguro(planoFinal.percentual, params.valorAluguel);
  const valorTotal = params.valorAluguel + valorSeguro;

  // Cria a reserva com seguro incluído
  const sqlInsert = `
    INSERT INTO reserva (
      cliente_id, veiculo_id, filial_retirada_id, filial_devolucao_id,
      data_inicio, data_fim, valor_total, status, expira_em,
      plano_seguro_id, valor_seguro, metodo_pagamento
    )
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    WHERE NOT EXISTS (
      SELECT 1 FROM reserva r
      WHERE r.veiculo_id = $2
        AND (
          r.status IN ('RESERVADA', 'ATIVA')
          OR (r.status = 'PENDENTE_PAGAMENTO' AND r.expira_em > NOW())
        )
        AND r.data_inicio <= $6
        AND r.data_fim >= $5
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
    statusInicial,
    expiraEm,
    planoFinal.id,
    valorSeguro,
    params.metodoPagamento ?? 'INFINITEPAY'
  ]);

  if (resultado.rowCount === 0) {
    throw new Error('O veículo selecionado não está disponível para o período solicitado (conflito de datas).');
  }

  const reservaId: string = resultado.rows[0].id;

  // Se for dinheiro, não gera link nem NSU
  if (params.metodoPagamento === 'DINHEIRO') {
    void notifyReservaPendente({
      reservaId,
      filialId: params.filialRetiradaId,
      clienteId: params.clienteId,
      clienteNome: params.nomeCliente,
      modelo: params.descricaoModelo,
      dataInicio: params.dataInicio,
      dataFim: params.dataFim,
      origem: params.origem ?? 'APP',
    }).catch((err) => {
      console.error('[Reserva] Falha ao notificar reserva pendente:', err);
    });

    return {
      reservaId,
      valorTotal,
      valorSeguro,
      planoSeguro: planoFinal.nome,
      status: statusInicial
    };
  }

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
    [link_pagamento, reservaId, slug ?? null, reservaId],
  );

  void notifyReservaPendente({
    reservaId,
    filialId: params.filialRetiradaId,
    clienteId: params.clienteId,
    clienteNome: params.nomeCliente,
    modelo: params.descricaoModelo,
    dataInicio: params.dataInicio,
    dataFim: params.dataFim,
    origem: params.origem ?? 'APP',
  }).catch((err) => {
    console.error('[Reserva] Falha ao notificar reserva pendente:', err);
  });

  return { reservaId, linkPagamento: link_pagamento, valorTotal, valorSeguro, planoSeguro: planoFinal.nome, status: statusInicial };
}

/**
 * Atualiza uma reserva que ainda esteja com status PENDENTE_PAGAMENTO.
 * Permite alterar veículo e datas. Recalcula o valor total.
 */
export async function atualizarReservaPendente(
  reservaId: string,
  params: {
    veiculoId?: string;
    dataInicio?: Date;
    dataFim?: Date;
  },
  caller: any
): Promise<any> {
  const result = await query(
    `SELECT r.*, c.nome_completo, u.email, c.telefone, v.modelo_id, m.nome as modelo_nome, m.marca as modelo_marca
     FROM reserva r
     JOIN cliente c ON c.id = r.cliente_id
     JOIN usuario u ON u.id = c.usuario_id
     JOIN veiculo v ON v.id = r.veiculo_id
     JOIN modelo m ON m.id = v.modelo_id
     WHERE r.id = $1 AND r.deletado_em IS NULL`,
    [reservaId]
  );

  const reserva = result.rows[0];
  if (!reserva) throw new Error('Reserva não encontrada.');

  if (reserva.status !== 'PENDENTE_PAGAMENTO') {
    throw new Error('Apenas reservas com status PENDENTE_PAGAMENTO podem ser editadas.');
  }

  // Se o caller for gerente, validar filial se necessário
  if (caller.tipo === 'GERENTE' && caller.filialId && reserva.filial_retirada_id !== caller.filialId) {
    throw new Error('Sem permissão para editar reserva de outra filial.');
  }

  const novoVeiculoId = params.veiculoId ?? reserva.veiculo_id;
  const novaDataInicio = params.dataInicio ?? new Date(reserva.data_inicio);
  const novaDataFim = params.dataFim ?? new Date(reserva.data_fim);

  // Se mudou algo crucial, verifica disponibilidade
  if (
    novoVeiculoId !== reserva.veiculo_id ||
    novaDataInicio.getTime() !== new Date(reserva.data_inicio).getTime() ||
    novaDataFim.getTime() !== new Date(reserva.data_fim).getTime()
  ) {
    // Verifica se o novo veículo (ou o mesmo com novas datas) está disponível
    // IMPORTANTE: precisamos ignorar a PRÓPRIA reserva na checagem de conflito
    const conflito = await query(`
      SELECT 1 FROM reserva
      WHERE veiculo_id = $1
        AND id != $2
        AND deletado_em IS NULL
        AND status IN ('RESERVADA', 'ATIVA', 'PENDENTE_PAGAMENTO')
        AND (status != 'PENDENTE_PAGAMENTO' OR expira_em > NOW())
        AND data_inicio <= $3
        AND data_fim >= $4
    `, [novoVeiculoId, reservaId, novaDataFim, novaDataInicio]);

    if (conflito.rowCount && conflito.rowCount > 0) {
      throw new Error('O veículo/período solicitado possui conflito com outra reserva.');
    }
  }

  // Recalcula valor total
  let novoModeloId = reserva.modelo_id;
  let descricaoModelo = `${reserva.modelo_marca} ${reserva.modelo_nome}`;

  if (novoVeiculoId !== reserva.veiculo_id) {
    const vResult = await query(
      'SELECT v.modelo_id, m.nome, m.marca FROM veiculo v JOIN modelo m ON m.id = v.modelo_id WHERE v.id = $1',
      [novoVeiculoId]
    );
    if (!vResult.rows[0]) throw new Error('Novo veículo não encontrado.');
    novoModeloId = vResult.rows[0].modelo_id;
    descricaoModelo = `${vResult.rows[0].marca} ${vResult.rows[0].nome}`;
  }

  const novoValorAluguel = await calcularValorTotal(
    novoModeloId,
    reserva.filial_retirada_id,
    novaDataInicio,
    novaDataFim
  );

  // Busca plano de seguro para recalcular total
  let plano = reserva.plano_seguro_id
    ? await buscarPlanoPorId(reserva.plano_seguro_id)
    : await buscarPlanoBasico();

  if (!plano) plano = await buscarPlanoBasico();
  if (!plano) throw new Error('Falha ao obter plano de seguro.');

  const novoValorSeguro = calcularValorSeguro(plano.percentual, novoValorAluguel);
  const novoValorTotal = novoValorAluguel + novoValorSeguro;

  // Atualiza banco
  await query(
    `UPDATE reserva 
     SET veiculo_id = $1, data_inicio = $2, data_fim = $3, valor_total = $4, valor_seguro = $5
     WHERE id = $6`,
    [novoVeiculoId, novaDataInicio, novaDataFim, novoValorTotal, novoValorSeguro, reservaId]
  );

  // Se mudou o valor ou os dados, é preferível regenerar o link de pagamento
  // (Opcional, mas recomendado pelo usuário)
  const { link_pagamento, slug } = await gerarLinkPagamento({
    orderNsu: reservaId,
    itens: [
      {
        quantity: 1,
        price: Math.round(novoValorAluguel * 100),
        description: descricaoModelo,
      },
      ...(novoValorSeguro > 0 ? [{
        quantity: 1,
        price: Math.round(novoValorSeguro * 100),
        description: `Seguro ${plano.nome}`,
      }] : []),
    ],
    cliente: {
      name: reserva.nome_completo,
      email: reserva.email,
      ...(reserva.telefone ? { phone_number: reserva.telefone } : {}),
    },
  });

  await query(
    `UPDATE reserva SET link_pagamento = $1, infinitepay_order_nsu = $2, infinitepay_slug = $3 WHERE id = $4`,
    [link_pagamento, reservaId, slug ?? null, reservaId],
  );

  return {
    reservaId,
    linkPagamento: link_pagamento,
    valorTotal: novoValorTotal,
    valorSeguro: novoValorSeguro
  };
}

interface DadosWebhook {
  order_nsu: string;
  transaction_nsu: string;
  invoice_slug?: string;
  capture_method: string;
  receipt_url: string;
}

/**
 * Confirma uma reserva após receber o webhook de pagamento aprovado.
 * Muda o status de PENDENTE_PAGAMENTO para RESERVADA.
 */
export async function confirmarReserva(dados: DadosWebhook): Promise<'confirmed' | 'already_confirmed' | 'not_found'> {
  const existente = await query(
    `SELECT status FROM reserva WHERE id = $1 AND deletado_em IS NULL`,
    [dados.order_nsu],
  );

  const current = existente.rows[0]?.status as string | undefined;
  if (!current) return 'not_found';
  if (current !== 'PENDENTE_PAGAMENTO') return 'already_confirmed';

  const sql = `
    UPDATE reserva
    SET
      status = 'RESERVADA',
      infinitepay_nsu = $1,
      metodo_pagamento = $2,
      comprovante_url = $3,
      infinitepay_slug = COALESCE($5, infinitepay_slug),
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
    dados.invoice_slug ?? null,
  ]);

  const detalhes = await query(
    `SELECT r.id, r.cliente_id, r.filial_retirada_id, r.data_inicio, r.data_fim,
            c.nome_completo AS cliente_nome,
            m.nome || ' ' || m.marca AS modelo
     FROM reserva r
     JOIN cliente c ON c.id = r.cliente_id
     JOIN veiculo v ON v.id = r.veiculo_id
     JOIN modelo m ON m.id = v.modelo_id
     WHERE r.id = $1`,
    [dados.order_nsu],
  );

  const row = detalhes.rows[0];
  if (row) {
    const params: {
      reservaId: string;
      filialId: string;
      clienteId: string;
      clienteNome?: string;
      modelo?: string;
      dataInicio?: Date;
      dataFim?: Date;
      origem?: string;
    } = {
      reservaId: row.id,
      filialId: row.filial_retirada_id,
      clienteId: row.cliente_id,
      origem: 'INFINITEPAY',
    };
    if (row.cliente_nome) params.clienteNome = row.cliente_nome;
    if (row.modelo) params.modelo = row.modelo;
    if (row.data_inicio) params.dataInicio = new Date(row.data_inicio);
    if (row.data_fim) params.dataFim = new Date(row.data_fim);

    void notifyPagamentoConfirmado(params).catch((err) => {
      console.error('[Reserva] Falha ao notificar pagamento confirmado:', err);
    });
  }

  return 'confirmed';
}

// ESTENDER RESERVA
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

// GARANTIA B: VERIFICAÇÃO DE RETIRADA
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

// JOB: EXPIRAÇÃO DE RESERVAS PENDENTES
/**
 * Expira reservas PENDENTE_PAGAMENTO cujo tempo limite foi ultrapassado.
 * Deve ser chamada periodicamente (ex: a cada 5 minutos via setInterval ou cron).
 */
export async function expirarReservasPendentes(): Promise<number> {
  // Busca as reservas que vão expirar para liberar os veículos
  const expirandoRes = await query(`
    SELECT veiculo_id FROM reserva 
    WHERE status = 'PENDENTE_PAGAMENTO' AND expira_em < NOW() AND deletado_em IS NULL
  `);

  if (expirandoRes.rowCount && expirandoRes.rowCount > 0) {
    const veiculoIds = expirandoRes.rows.map(r => r.veiculo_id);
    await query(`
      UPDATE veiculo SET status = 'DISPONIVEL' 
      WHERE id = ANY($1)
    `, [veiculoIds]);

    try {
      const placasRes = await query(
        `SELECT placa FROM veiculo WHERE id = ANY($1) ORDER BY placa ASC LIMIT 6`,
        [veiculoIds],
      );
      const placas = (placasRes.rows || []).map((r: any) => String(r.placa || '')).filter(Boolean);
      void notifyVeiculoStatusAlteradoBulkAllManagers({
        statusNovo: 'DISPONIVEL',
        quantidade: veiculoIds.length,
        placas,
        origem: 'JOB_EXPIRACAO',
        motivo: 'Expiração de pagamento pendente',
      }).catch((err) => {
        console.error('[Reserva] Falha ao notificar mudança de status dos veículos (expiração):', err);
      });
    } catch (err) {
      console.error('[Reserva] Falha ao listar placas para notificação de expiração:', err);
    }
  }

  const sql = `
    UPDATE reserva
    SET status = 'EXPIRADA'
    WHERE status = 'PENDENTE_PAGAMENTO'
      AND expira_em < NOW()
      AND deletado_em IS NULL
    RETURNING id, cliente_id, filial_retirada_id, data_inicio, data_fim;
  `;

  const resultado = await query(sql);
  const rows = resultado.rows ?? [];

  await Promise.all(rows.map(async (row) => {
    const detalhes = await query(
      `SELECT c.nome_completo AS cliente_nome,
              m.nome || ' ' || m.marca AS modelo
       FROM reserva r
       JOIN cliente c ON c.id = r.cliente_id
       JOIN veiculo v ON v.id = r.veiculo_id
       JOIN modelo m ON m.id = v.modelo_id
       WHERE r.id = $1`,
      [row.id],
    );

    const info = detalhes.rows[0] ?? {};
    const params: {
      reservaId: string;
      filialId: string;
      clienteId: string;
      clienteNome?: string;
      modelo?: string;
      dataInicio?: Date;
      dataFim?: Date;
      origem?: string;
    } = {
      reservaId: row.id,
      filialId: row.filial_retirada_id,
      clienteId: row.cliente_id,
      origem: 'SISTEMA',
    };
    if (info.cliente_nome) params.clienteNome = info.cliente_nome;
    if (info.modelo) params.modelo = info.modelo;
    if (row.data_inicio) params.dataInicio = new Date(row.data_inicio);
    if (row.data_fim) params.dataFim = new Date(row.data_fim);

    await notifyReservaExpirada(params);
  }));

  return resultado.rowCount ?? 0;
}
