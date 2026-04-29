import { IncomingMessage, ServerResponse } from 'http';
import {
    listarTabelasPreco,
    buscarTabelaPrecoPorId,
    criarTabelaPreco,
    atualizarTabelaPreco,
    deletarTabelaPreco,
} from '../services/tabelaPreco.service.js';
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
        : 500;
    return { status, mensagem };
}

// ──────────────────────────────────────────────
// GET /tabelas-preco
// Query params opcionais: filial_id, tipo_carro_id
// Acesso: GERENTE (filtra pela sua filial automaticamente se não ADMIN), ADMIN
// ──────────────────────────────────────────────
export async function listarTabelas(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const tipoCarroIdParam = url.searchParams.get('tipo_carro_id');
        const tipoCarroId = tipoCarroIdParam ? Number(tipoCarroIdParam) : undefined;

        if (tipoCarroIdParam && (isNaN(tipoCarroId!) || tipoCarroId! <= 0)) {
            responder(res, 400, { erro: 'Parâmetro inválido: tipo_carro_id deve ser inteiro positivo.' });
            return;
        }

        // GERENTE vinculado a filial: restringe automaticamente à sua filial
        const filialId = caller.tipo === 'GERENTE' && caller.filialId
            ? caller.filialId
            : url.searchParams.get('filial_id') ?? undefined;

        const tabelas = await listarTabelasPreco(filialId, tipoCarroId);
        responder(res, 200, tabelas);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// GET /tabelas-preco/:id
// Acesso: GERENTE, ADMIN
// ──────────────────────────────────────────────
export async function buscarTabela(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const tabela = await buscarTabelaPrecoPorId(id);
        if (!tabela) { responder(res, 404, { erro: 'Tabela de preço não encontrada.' }); return; }

        // Gerente vinculado: só pode ver tabelas da sua filial
        if (caller.tipo === 'GERENTE' && caller.filialId && tabela.filial_id !== caller.filialId) {
            responder(res, 403, { erro: 'Sem permissão: esta tabela pertence a outra filial.' });
            return;
        }

        responder(res, 200, tabela);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// POST /tabelas-preco
// Body: { tipo_carro_id, filial_id, data_inicio, data_fim, valor_diaria }
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function registrarTabela(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const corpo = await lerCorpo(req);
        const tabela = await criarTabelaPreco(corpo);
        responder(res, 201, tabela);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// PUT /tabelas-preco/:id
// Body: { data_inicio?, data_fim?, valor_diaria? }
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function editarTabela(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const corpo = await lerCorpo(req);
        const tabelaAtualizada = await atualizarTabelaPreco(id, corpo);
        if (!tabelaAtualizada) { responder(res, 404, { erro: 'Tabela de preço não encontrada.' }); return; }

        responder(res, 200, tabelaAtualizada);
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}

// ──────────────────────────────────────────────
// DELETE /tabelas-preco/:id
// Acesso: ADMIN
// ──────────────────────────────────────────────
export async function removerTabela(req: IncomingMessage, res: ServerResponse, idStr: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'ADMIN');

        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) {
            responder(res, 400, { erro: 'ID inválido.' });
            return;
        }

        const sucesso = await deletarTabelaPreco(id);
        if (!sucesso) { responder(res, 404, { erro: 'Tabela de preço não encontrada.' }); return; }

        responder(res, 200, { mensagem: 'Tabela de preço removida com sucesso.' });
    } catch (err) {
        const { status, mensagem } = mapearErro(err);
        responder(res, status, { erro: mensagem });
    }
}
