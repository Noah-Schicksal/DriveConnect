import { query } from '../db/index.js';
import type { Caller } from '../middlewares/auth.js';
import { atualizarStatusVeiculoE_Notificar } from './veiculo.service.js';

// Interfaces de retorno seguro
export interface ReservaResumo {
    id: string;
    cliente_id: string;
    cliente_nome: string;
    veiculo_id: string;
    veiculo_placa: string;
    modelo_nome: string;
    filial_retirada_id: string;
    filial_retirada_nome: string | null;
    filial_devolucao_id: string;
    filial_devolucao_nome: string | null;
    data_inicio: Date;
    data_fim: Date;
    data_retirada_real: Date | null;
    data_devolucao_real: Date | null;
    valor_total: number | null;
    valor_adicional: number | null;
    status: string;
    metodo_pagamento: string | null;
    pagamento_em: Date | null;
    plano_seguro_nome: string | null;
    valor_seguro: number | null;
    criado_em: Date;

    // Campos aninhados para o Frontend
    cliente?: {
        id: string;
        usuario_id?: string;
        nome_completo: string;
        cpf?: string;
        criado_em?: string;
    };
    veiculo?: {
        id: string;
        placa: string;
        ano?: number;
        cor?: string;
        status?: string;
        imagem_url?: string | null;
        capa_url?: string | null;
        filial_id?: string;
        modelo_id?: number;
        criado_em?: string;
        deletado_em?: string | null;
        preco_diaria?: number | null;
        modelo?: {
            id?: number;
            nome: string;
            marca?: string;
        };
    };
}

export interface ReservaCanceladaInfo {
    reservaId: string;
    clienteId: string;
    filialId: string;
    clienteNome?: string;
    modelo?: string;
    dataInicio?: Date;
    dataFim?: Date;
}

// PRIVADAS — lógica real
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
        c.usuario_id AS cliente_usuario_id,
        c.nome_completo AS cliente_nome,
        c.cpf AS cliente_cpf,
        c.criado_em AS cliente_criado_em,
        r.veiculo_id,
        v.placa AS veiculo_placa,
        v.ano AS veiculo_ano,
        v.cor AS veiculo_cor,
        v.status AS veiculo_status,
        v.imagem_url AS veiculo_imagem_url,
        v.criado_em AS veiculo_criado_em,
        v.deletado_em AS veiculo_deletado_em,
        v.preco_diaria AS veiculo_preco_diaria,
        v.filial_id AS veiculo_filial_id,
        m.id AS modelo_id,
        m.nome AS modelo_nome_raw,
        m.marca AS modelo_marca_raw,
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
        cliente_id: row.cliente_id as string,
        cliente_nome: row.cliente_nome as string,
        veiculo_id: row.veiculo_id as string,
        veiculo_placa: row.veiculo_placa as string,
        modelo_nome: row.modelo_nome as string,
        filial_retirada_id: row.filial_retirada_id as string,
        filial_retirada_nome: row.filial_retirada_nome as string | null,
        filial_devolucao_id: row.filial_devolucao_id as string,
        filial_devolucao_nome: row.filial_devolucao_nome as string | null,
        data_inicio: row.data_inicio as Date,
        data_fim: row.data_fim as Date,
        data_retirada_real: row.data_retirada_real as Date | null,
        data_devolucao_real: row.data_devolucao_real as Date | null,
        valor_total: row.valor_total !== null ? Number(row.valor_total) : null,
        valor_adicional: row.valor_adicional !== null ? Number(row.valor_adicional) : null,
        status: row.status as string,
        metodo_pagamento: row.metodo_pagamento as string | null,
        pagamento_em: row.pagamento_em as Date | null,
        plano_seguro_nome: row.plano_seguro_nome as string | null,
        valor_seguro: row.valor_seguro !== null ? Number(row.valor_seguro) : null,
        criado_em: row.criado_em as Date,

        // Objetos aninhados para o Frontend (Reserva model expects these)
        cliente: {
            id: row.cliente_id as string,
            usuario_id: row.cliente_usuario_id as string,
            nome_completo: row.cliente_nome as string,
            cpf: row.cliente_cpf as string,
            criado_em: row.cliente_criado_em ? new Date(row.cliente_criado_em as any).toISOString() : new Date().toISOString(),
        },
        veiculo: {
            id: row.veiculo_id as string,
            placa: row.veiculo_placa as string,
            ano: row.veiculo_ano as number,
            cor: row.veiculo_cor as string,
            status: row.veiculo_status as string,
            imagem_url: row.veiculo_imagem_url as string,
            capa_url: null, // Campo não existe no banco, mas mantido como null para o modelo Frontend
            filial_id: row.veiculo_filial_id as string,
            modelo_id: row.modelo_id as number,
            criado_em: row.veiculo_criado_em
                ? new Date(row.veiculo_criado_em as string | Date).toISOString()
                : new Date().toISOString(),
            deletado_em: row.veiculo_deletado_em
                ? new Date(row.veiculo_deletado_em as string | Date).toISOString()
                : null,
            preco_diaria: row.veiculo_preco_diaria != null ? Number(row.veiculo_preco_diaria) : null,
            modelo: {
                id: row.modelo_id as number,
                nome: row.modelo_nome_raw as string,
                marca: row.modelo_marca_raw as string,
            }
        }
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
async function _cancelarReserva(reservaId: string, caller: Caller): Promise<ReservaCanceladaInfo> {
    // Carrega a reserva sem filtro de filial para dar erro correto
    const reservaRes = await query(
        `SELECT r.id, r.status, r.veiculo_id, r.cliente_id, c.usuario_id AS cliente_usuario_id,
                c.nome_completo AS cliente_nome,
                r.filial_retirada_id, r.filial_devolucao_id,
                r.data_inicio, r.data_fim,
                m.nome || ' ' || m.marca AS modelo
         FROM reserva r
         JOIN cliente c ON c.id = r.cliente_id
         JOIN veiculo v ON v.id = r.veiculo_id
         JOIN modelo m ON m.id = v.modelo_id
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

    // Libera o veículo
    await atualizarStatusVeiculoE_Notificar({
        veiculoId: reserva.veiculo_id,
        novoStatus: 'DISPONIVEL',
        origem: 'RESERVA_CANCELAMENTO',
    });

    await query(
        `UPDATE reserva SET status = 'CANCELADA' WHERE id = $1`,
        [reservaId],
    );

    const info: ReservaCanceladaInfo = {
        reservaId: reserva.id,
        clienteId: reserva.cliente_id,
        filialId: reserva.filial_retirada_id,
    };
    if (reserva.cliente_nome) info.clienteNome = reserva.cliente_nome;
    if (reserva.modelo) info.modelo = reserva.modelo;
    if (reserva.data_inicio) info.dataInicio = reserva.data_inicio;
    if (reserva.data_fim) info.dataFim = reserva.data_fim;

    return info;
}

// PÚBLICAS — wrappers finos (Wrapper Pattern)
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

export async function cancelarReserva(reservaId: string, caller: Caller): Promise<ReservaCanceladaInfo> {
    return _cancelarReserva(reservaId, caller);
}
