import { IncomingMessage, ServerResponse } from 'http';
import {
    listarReservas,
    buscarReservaPorId,
    cancelarReserva,
} from '../services/reservaConsulta.service.js';
import { requireCaller, requireTipo } from '../middlewares/auth.js';

// ──────────────────────────────────────────────
// Utilitários locais
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// GET /reservas
// Query params opcionais: status, cliente_id
// Acesso: GERENTE (só filial própria) | ADMIN (todas)
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// GET /reservas/:id
// Acesso: GERENTE (só filial própria) | ADMIN
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// POST /reservas/:id/cancelar
// Cancela uma reserva RESERVADA ou PENDENTE_PAGAMENTO.
// Libera o veículo automaticamente se estava RESERVADA.
// Acesso: CLIENTE (própria), GERENTE (só filial própria) | ADMIN
// ──────────────────────────────────────────────
export async function cancelarReservaHandler(req: IncomingMessage, res: ServerResponse, reservaId: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        // Sem requireTipo aqui, pois todos os perfis podem acessar (regras validadas no service)

        await cancelarReserva(reservaId, caller);
        responder(res, 200, { mensagem: 'Reserva cancelada com sucesso.' });
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}
