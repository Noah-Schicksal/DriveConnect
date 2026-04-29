import { IncomingMessage, ServerResponse } from 'http';
import {
    listarModelos,
    listarModelosDisponiveis,
    buscarModeloPorId,
    criarModelo,
    atualizarModelo,
    deletarModelo,
} from '../services/modelo.service.js';
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
// GET /modelos/disponiveis
// Query param: ?data_inicio=Y-m-d&data_fim=Y-m-d&filial_id=X
// Acesso: Público / CLIENTE
// ──────────────────────────────────────────────
export async function listarDisponiveis(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const dataInicio = url.searchParams.get('data_inicio');
        const dataFim = url.searchParams.get('data_fim');
        const filialId = url.searchParams.get('filial_id') ?? undefined;

        if (!dataInicio || !dataFim) {
            responder(res, 400, { erro: 'Parâmetros data_inicio e data_fim são obrigatórios.' });
            return;
        }

        const modelos = await listarModelosDisponiveis(new Date(dataInicio), new Date(dataFim), filialId);
        responder(res, 200, modelos);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// GET /modelos
// Query param opcional: ?tipo_carro_id=N
// Acesso: GERENTE, ADMIN
// ──────────────────────────────────────────────
export async function listar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const tipoCarroIdParam = url.searchParams.get('tipo_carro_id');
        const tipoCarroId = tipoCarroIdParam ? Number(tipoCarroIdParam) : undefined;

        if (tipoCarroIdParam !== null && (isNaN(tipoCarroId!) || tipoCarroId! <= 0)) {
            responder(res, 400, { erro: 'Parâmetro inválido: tipo_carro_id deve ser um inteiro positivo.' });
            return;
        }

        const modelos = await listarModelos(tipoCarroId);
        responder(res, 200, modelos);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// GET /modelos/:id
// Acesso: GERENTE, ADMIN
// ──────────────────────────────────────────────
export async function buscar(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const modelo = await buscarModeloPorId(id);
        if (!modelo) { responder(res, 404, { erro: 'Modelo não encontrado.' }); return; }

        responder(res, 200, modelo);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// POST /modelos
// Body: { nome, marca, tipo_carro_id }
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function registrar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const corpo = await lerCorpo(req);
        const modelo = await criarModelo(corpo);

        responder(res, 201, modelo);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// PUT /modelos/:id
// Body: { nome?, marca?, tipo_carro_id? }
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function editar(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const corpo = await lerCorpo(req);
        const modeloAtualizado = await atualizarModelo(id, corpo);

        if (!modeloAtualizado) { responder(res, 404, { erro: 'Modelo não encontrado.' }); return; }

        responder(res, 200, modeloAtualizado);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// DELETE /modelos/:id
// Acesso: ADMIN
// Rejeita se houver veículos ativos vinculados (guard no service)
// ──────────────────────────────────────────────
export async function remover(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const sucesso = await deletarModelo(id);
        if (!sucesso) { responder(res, 404, { erro: 'Modelo não encontrado.' }); return; }

        responder(res, 200, { mensagem: 'Modelo removido com sucesso.' });
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}
