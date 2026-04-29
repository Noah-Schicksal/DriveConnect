import { IncomingMessage, ServerResponse } from 'http';
import {
    listarTiposCarro,
    buscarTipoCarroPorId,
    criarTipoCarro,
    atualizarTipoCarro,
    deletarTipoCarro,
} from '../services/tipoCarro.service.js';
import { requireCaller, requireTipo } from '../middlewares/auth.js';

// ──────────────────────────────────────────────
// Utilitários locais
// ──────────────────────────────────────────────

function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
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
        : mensagem.includes('Não é possível remover') ? 409
        : 500;
    return { status, mensagem };
}

// ──────────────────────────────────────────────
// GET /tipos-carro
// Acesso: GERENTE, ADMIN — lista todos os tipos
// ──────────────────────────────────────────────
export async function listarTipos(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const tipos = await listarTiposCarro();
        responder(res, 200, tipos);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// GET /tipos-carro/:id
// Acesso: GERENTE, ADMIN
// ──────────────────────────────────────────────
export async function buscarTipo(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const tipo = await buscarTipoCarroPorId(id);
        if (!tipo) { responder(res, 404, { erro: 'Tipo de carro não encontrado.' }); return; }

        responder(res, 200, tipo);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// POST /tipos-carro
// Body: { nome, preco_base_diaria }
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function registrarTipo(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const corpo = await lerCorpo(req);
        const tipo = await criarTipoCarro(corpo);

        responder(res, 201, tipo);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// PUT /tipos-carro/:id
// Body: { nome?, preco_base_diaria? }
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function editarTipo(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const corpo = await lerCorpo(req);
        const tipoAtualizado = await atualizarTipoCarro(id, corpo);

        if (!tipoAtualizado) { responder(res, 404, { erro: 'Tipo de carro não encontrado.' }); return; }

        responder(res, 200, tipoAtualizado);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// DELETE /tipos-carro/:id
// Acesso: ADMIN
// Rejeita se houver modelos vinculados (guard no service)
// ──────────────────────────────────────────────
export async function removerTipo(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const sucesso = await deletarTipoCarro(id);
        if (!sucesso) { responder(res, 404, { erro: 'Tipo de carro não encontrado.' }); return; }

        responder(res, 200, { mensagem: 'Tipo de carro removido com sucesso.' });
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}
