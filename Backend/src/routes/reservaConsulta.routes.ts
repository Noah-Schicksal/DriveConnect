import { IncomingMessage, ServerResponse } from 'http';
import {
    listarReservas,
    buscarReservaPorId,
    cancelarReserva,
} from '../services/reservaConsulta.service.js';
import { notifyReservaCancelada } from '../services/fcm.service.js';
import { requireCaller, requireTipo } from '../middlewares/auth.js';

// Utilitários locais
function responder(res: ServerResponse, status: number, corpo: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(corpo));
}

function mapearErro(err: unknown): { status: number; mensagem: string } {
    const mensagem = err instanceof Error ? err.message : 'Erro interno.';
    const status = mensagem.includes('inválid') || mensagem.includes('obrigatório') || mensagem.includes('ausente') ? 400
        : mensagem.includes('não encontrad') ? 404
        : mensagem.includes('Não autorizado') ? 401
        : mensagem.includes('Sem permissão') ? 403
        : mensagem.includes('Não é possível cancelar') ? 409
        : 500;
    return { status, mensagem };
}

// GET /reservas
// Query params opcionais: status, cliente_id
// Acesso: GERENTE (só filial própria) | ADMIN (todas)
export async function listarTodasReservas(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const status = url.searchParams.get('status') ?? undefined;
        const clienteId = url.searchParams.get('cliente_id') ?? undefined;

        // Valida status se informado
        const statusValidos = ['PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA', 'FINALIZADA', 'CANCELADA', 'EXPIRADA'];
        if (status && !statusValidos.includes(status)) {
            responder(res, 400, {
                erro: `Status inválido. Valores aceitos: ${statusValidos.join(', ')}.`,
            });
            return;
        }

        const reservas = await listarReservas(caller, status, clienteId);
        responder(res, 200, reservas);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// GET /reservas/minhas
// Lista as reservas do próprio cliente logado.
// Acesso: CLIENTE
export async function listarMinhasReservas(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'CLIENTE');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const status = url.searchParams.get('status') ?? undefined;

        const { query } = await import('../db/index.js');

        // Busca o cliente vinculado ao usuário
        const clienteResult = await query(
            'SELECT id FROM cliente WHERE usuario_id = $1 AND deletado_em IS NULL',
            [caller.usuarioId]
        );
        
        if (!clienteResult.rows[0]) {
            responder(res, 404, { erro: 'Perfil de cliente não encontrado.' });
            return;
        }
        
        const clienteId = clienteResult.rows[0].id;

        let sql = `
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
                r.criado_em,
                json_build_object(
                    'id', v.id,
                    'placa', v.placa,
                    'ano', v.ano,
                    'cor', v.cor,
                    'status', v.status,
                    'capa_url', (SELECT filename FROM veiculo_imagem WHERE veiculo_id = v.id ORDER BY is_principal DESC, ordem ASC LIMIT 1),
                    'modelo', json_build_object(
                        'id', m.id,
                        'nome', m.nome,
                        'marca', m.marca
                    )
                ) as veiculo
            FROM reserva r
            JOIN cliente c ON c.id = r.cliente_id
            JOIN veiculo v ON v.id = r.veiculo_id
            JOIN modelo m ON m.id = v.modelo_id
            JOIN filial fr ON fr.id = r.filial_retirada_id
            JOIN filial fd ON fd.id = r.filial_devolucao_id
            LEFT JOIN plano_seguro ps ON ps.id = r.plano_seguro_id
            WHERE r.deletado_em IS NULL
            AND r.cliente_id = $1
        `;

        const values: any[] = [clienteId];
        
        const statusValidos = ['PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA', 'FINALIZADA', 'CANCELADA', 'EXPIRADA'];
        if (status && statusValidos.includes(status)) {
            sql += ` AND r.status = $2`;
            values.push(status);
        }
        
        sql += ` ORDER BY r.criado_em DESC`;
        
        const resultado = await query(sql, values);
        responder(res, 200, resultado.rows);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}


// GET /reservas/:id
// Acesso: GERENTE (só filial própria) | ADMIN
export async function detalharReserva(req: IncomingMessage, res: ServerResponse, reservaId: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const reserva = await buscarReservaPorId(reservaId, caller);
        if (!reserva) {
            responder(res, 404, { erro: 'Reserva não encontrada.' });
            return;
        }

        responder(res, 200, reserva);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// POST /reservas/:id/cancelar
// Cancela uma reserva RESERVADA ou PENDENTE_PAGAMENTO.
// Libera o veículo automaticamente se estava RESERVADA.
// Acesso: CLIENTE (própria), GERENTE (só filial própria) | ADMIN
export async function cancelarReservaHandler(req: IncomingMessage, res: ServerResponse, reservaId: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        // Sem requireTipo aqui, pois todos os perfis podem acessar (regras validadas no service)

        const cancelamento = await cancelarReserva(reservaId, caller);
        void notifyReservaCancelada({
            reservaId: cancelamento.reservaId,
            filialId: cancelamento.filialId,
            clienteId: cancelamento.clienteId,
            clienteNome: cancelamento.clienteNome,
            modelo: cancelamento.modelo,
            dataInicio: cancelamento.dataInicio,
            dataFim: cancelamento.dataFim,
            origem: caller.tipo,
        }).catch((err) => {
            console.error('[Reservas] Falha ao notificar cancelamento:', err);
        });
        responder(res, 200, { mensagem: 'Reserva cancelada com sucesso.' });
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}
