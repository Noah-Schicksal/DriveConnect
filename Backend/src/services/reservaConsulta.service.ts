import { query } from '../db/index.js';
import type { Caller } from '../middlewares/auth.js';

// ──────────────────────────────────────────────
// Interfaces de retorno seguro
// ──────────────────────────────────────────────

export interface ReservaResumo {
    id: string;
    clienteId: string;
    clienteNome: string;
    veiculoId: string;
    veiculoPlaca: string;
    modeloNome: string;
    filialRetiradaId: string;
    filialRetiradaNome: string | null;
    filialDevolucaoId: string;
    filialDevolucaoNome: string | null;
    dataInicio: Date;
    dataFim: Date;
    dataRetiradaReal: Date | null;
    dataDevolucaoReal: Date | null;
    valorTotal: number | null;
    valorAdicional: number | null;
    status: string;
    metodoPagamento: string | null;
    pagamentoEm: Date | null;
    planoSeguroNome: string | null;
    valorSeguro: number | null;
    criadoEm: Date;
}

// ──────────────────────────────────────────────
// PRIVADAS — lógica real
// ──────────────────────────────────────────────

/**
 * Monta a cláusula WHERE de acordo com o perfil do caller:
 * - ADMIN: vê todas as reservas
 * - GERENTE com filial: vê reservas da sua filial (retirada ou devolução)
 * - GERENTE global (filialId = null): vê todas
 */
function _filtrosCaller(caller: Caller): { where: string; valores: unknown[] } {
    if (caller.tipo === 'ADMIN') {
        return { where: '', valores: [] };
    }
    if (caller.tipo === 'GERENTE' && caller.filialId !== null) {
        return {
            where: 'AND (r.filial_retirada_id = $1 OR r.filial_devolucao_id = $1)',
            valores: [caller.filialId],
        };
    }
    // GERENTE global
    return { where: '', valores: [] };
}

const SQL_SELECT_RESERVA = `
    SELECT
        r.id,
        r.cliente_id,
        c.nome_completo AS cliente_nome,
        r.veiculo_id,
        v.placa AS veiculo_placa,
        m.nome || ' ' || m.marca AS modelo_nome,
        r.filial_retirada_id,
        fr.nome AS filial_retirada_nome,
        r.filial_devolucao_id,
        fd.nome AS filial_devolucao_nome,
        r.data_inicio,
        r.data_fim,
        r.data_retirada_real,
        r.data_devolucao_real,
        r.valor_total,
        r.valor_adicional,
        r.status,
        r.metodo_pagamento,
        r.pagamento_em,
        ps.nome AS plano_seguro_nome,
        r.valor_seguro,
        r.criado_em
    FROM reserva r
    JOIN cliente c ON c.id = r.cliente_id
    JOIN veiculo v ON v.id = r.veiculo_id
    JOIN modelo m ON m.id = v.modelo_id
    JOIN filial fr ON fr.id = r.filial_retirada_id
    JOIN filial fd ON fd.id = r.filial_devolucao_id
    LEFT JOIN plano_seguro ps ON ps.id = r.plano_seguro_id
    WHERE r.deletado_em IS NULL
`;

function _mapearLinha(row: Record<string, unknown>): ReservaResumo {
    return {
        id: row.id as string,
        clienteId: row.cliente_id as string,
        clienteNome: row.cliente_nome as string,
        veiculoId: row.veiculo_id as string,
        veiculoPlaca: row.veiculo_placa as string,
        modeloNome: row.modelo_nome as string,
        filialRetiradaId: row.filial_retirada_id as string,
        filialRetiradaNome: row.filial_retirada_nome as string | null,
        filialDevolucaoId: row.filial_devolucao_id as string,
        filialDevolucaoNome: row.filial_devolucao_nome as string | null,
        dataInicio: row.data_inicio as Date,
        dataFim: row.data_fim as Date,
        dataRetiradaReal: row.data_retirada_real as Date | null,
        dataDevolucaoReal: row.data_devolucao_real as Date | null,
        valorTotal: row.valor_total !== null ? Number(row.valor_total) : null,
        valorAdicional: row.valor_adicional !== null ? Number(row.valor_adicional) : null,
        status: row.status as string,
        metodoPagamento: row.metodo_pagamento as string | null,
        pagamentoEm: row.pagamento_em as Date | null,
        planoSeguroNome: row.plano_seguro_nome as string | null,
        valorSeguro: row.valor_seguro !== null ? Number(row.valor_seguro) : null,
        criadoEm: row.criado_em as Date,
    };
}

async function _listarReservas(
    caller: Caller,
    status?: string,
    clienteId?: string,
): Promise<ReservaResumo[]> {
    const { where, valores } = _filtrosCaller(caller);
    const extras: string[] = [];
    let idx = valores.length + 1;

    if (status) {
        extras.push(`AND r.status = $${idx++}`);
        valores.push(status);
    }
    if (clienteId) {
        extras.push(`AND r.cliente_id = $${idx++}`);
        valores.push(clienteId);
    }

    const sql = `${SQL_SELECT_RESERVA} ${where} ${extras.join(' ')} ORDER BY r.criado_em DESC`;
    const resultado = await query(sql, valores);
    return resultado.rows.map(_mapearLinha);
}

async function _buscarReservaPorId(id: string, caller: Caller): Promise<ReservaResumo | null> {
    const { where, valores } = _filtrosCaller(caller);
    const idIdx = valores.length + 1;

    const sql = `${SQL_SELECT_RESERVA} ${where} AND r.id = $${idIdx}`;
    const resultado = await query(sql, [...valores, id]);
    return resultado.rows[0] ? _mapearLinha(resultado.rows[0]) : null;
}

/**
 * Cancela uma reserva.
 * - Somente RESERVADA ou PENDENTE_PAGAMENTO podem ser canceladas.
 * - Gerente só pode cancelar reservas da sua filial.
 * - O veículo retorna para DISPONIVEL se a reserva estava RESERVADA.
 */
async function _cancelarReserva(reservaId: string, caller: Caller): Promise<void> {
    // Carrega a reserva sem filtro de filial para dar erro correto
    const reservaRes = await query(
        `SELECT r.id, r.status, r.veiculo_id, r.cliente_id, c.usuario_id AS cliente_usuario_id,
                r.filial_retirada_id, r.filial_devolucao_id
         FROM reserva r
         JOIN cliente c ON c.id = r.cliente_id
         WHERE r.id = $1 AND r.deletado_em IS NULL`,
        [reservaId],
    );

    const reserva = reservaRes.rows[0];
    if (!reserva) throw new Error('Reserva não encontrada.');

    // Enforce para clientes (só podem cancelar as próprias reservas)
    if (caller.tipo === 'CLIENTE') {
        if (reserva.cliente_usuario_id !== caller.usuarioId) {
            throw new Error('Sem permissão: esta reserva não pertence a você.');
        }
    }

    // Enforce de filial para gerentes
    if (
        caller.tipo === 'GERENTE' &&
        caller.filialId !== null &&
        reserva.filial_retirada_id !== caller.filialId &&
        reserva.filial_devolucao_id !== caller.filialId
    ) {
        throw new Error('Sem permissão: esta reserva não pertence à sua filial.');
    }

    const statusCancelavel = ['PENDENTE_PAGAMENTO', 'RESERVADA'];
    if (!statusCancelavel.includes(reserva.status)) {
        throw new Error(
            `Não é possível cancelar: reserva está com status "${reserva.status}". ` +
            `Somente reservas PENDENTE_PAGAMENTO ou RESERVADA podem ser canceladas.`,
        );
    }

    // Se estava RESERVADA, libera o veículo
    if (reserva.status === 'RESERVADA') {
        await query(
            `UPDATE veiculo SET status = 'DISPONIVEL' WHERE id = $1`,
            [reserva.veiculo_id],
        );
    }

    await query(
        `UPDATE reserva SET status = 'CANCELADA' WHERE id = $1`,
        [reservaId],
    );
}

// ──────────────────────────────────────────────
// PÚBLICAS — wrappers finos (Wrapper Pattern)
// ──────────────────────────────────────────────

export async function listarReservas(
    caller: Caller,
    status?: string,
    clienteId?: string,
): Promise<ReservaResumo[]> {
    return _listarReservas(caller, status, clienteId);
}

export async function buscarReservaPorId(id: string, caller: Caller): Promise<ReservaResumo | null> {
    return _buscarReservaPorId(id, caller);
}

export async function cancelarReserva(reservaId: string, caller: Caller): Promise<void> {
    return _cancelarReserva(reservaId, caller);
}
