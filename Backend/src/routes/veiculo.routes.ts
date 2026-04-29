import { IncomingMessage, ServerResponse } from 'http';
import {
    criarVeiculo,
    listarVeiculos,
    buscarVeiculoPorId,
    atualizarVeiculo,
    deletarVeiculo
} from '../services/veiculo.service.js';
import { processarUpload } from '../services/storage.service.js';

function isMultipart(req: IncomingMessage) {
    return req.headers['content-type']?.includes('multipart/form-data');
}

function lerCorpoJson(req: IncomingMessage): Promise<Record<string, any>> {
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

async function tratarErro(res: ServerResponse, err: unknown): Promise<void> {
    const mensagem = err instanceof Error ? err.message : 'Erro interno.';
    const status = mensagem.includes('inválid') || mensagem.includes('obrigatório') ? 400
        : mensagem.includes('não encontrad') ? 404
            : 500;
    responder(res, status, { erro: mensagem });
}

// ──────────────────────────────────────────────
// POST /veiculos
// Body (multipart/form-data): modelo_id, filial_id, placa, ano, cor, status, imagem (file)
// ──────────────────────────────────────────────
export async function registrarVeiculo(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        let campos: Record<string, any> = {};
        let caminhoImagem: string | null = null;

        if (isMultipart(req)) {
            const uploadResult = await processarUpload(req);
            campos = uploadResult.campos;
            caminhoImagem = uploadResult.caminhoImagem;
        } else {
            campos = await lerCorpoJson(req);
        }

        const { modelo_id, filial_id, placa, ano, cor, status } = campos;

        if (!modelo_id || !filial_id || !placa || !ano || !status) {
            responder(res, 400, { erro: 'Campos obrigatórios: modelo_id, filial_id, placa, ano, status.' });
            return;
        }

        const novoVeiculo = await criarVeiculo({
            modelo_id: Number(modelo_id),
            filial_id,
            placa,
            ano: Number(ano),
            cor,
            status,
            imagem_url: caminhoImagem,
        });

        responder(res, 201, novoVeiculo);
    } catch (err) {
        await tratarErro(res, err);
    }
}

// ──────────────────────────────────────────────
// GET /veiculos
// ──────────────────────────────────────────────
export async function listar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        // Para simplificar a rota pura do Node sem urlSearchParams parser manual completo
        // Poderíamos parsear req.url para extrar filialId se fôssemos usar searchParams.
        // get filialId opcional
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const filialId = url.searchParams.get('filialId') || undefined;

        const veiculos = await listarVeiculos(filialId);
        responder(res, 200, veiculos);
    } catch (err) {
        await tratarErro(res, err);
    }
}

// ──────────────────────────────────────────────
// GET /veiculos/:id
// ──────────────────────────────────────────────
export async function buscar(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        const veiculo = await buscarVeiculoPorId(id);
        if (!veiculo) {
            responder(res, 404, { erro: 'Veículo não encontrado.' });
            return;
        }
        responder(res, 200, veiculo);
    } catch (err) {
        await tratarErro(res, err);
    }
}

// ──────────────────────────────────────────────
// PUT /veiculos/:id
// Body: multipart ou Json parcial
// ──────────────────────────────────────────────
export async function atualizar(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        let campos: Record<string, any> = {};
        let caminhoImagem: string | null = null;

        if (isMultipart(req)) {
            const uploadResult = await processarUpload(req);
            campos = uploadResult.campos;
            caminhoImagem = uploadResult.caminhoImagem;
        } else {
            campos = await lerCorpoJson(req);
        }

        // Só incluir para atualizar os que tem chaves correspondentes
        const { modelo_id, filial_id, placa, ano, cor, status } = campos;
        const dadosParaAtualizar: any = {};

        if (modelo_id) dadosParaAtualizar.modelo_id = Number(modelo_id);
        if (filial_id) dadosParaAtualizar.filial_id = filial_id;
        if (placa) dadosParaAtualizar.placa = placa;
        if (ano) dadosParaAtualizar.ano = Number(ano);
        if (cor) dadosParaAtualizar.cor = cor;
        if (status) dadosParaAtualizar.status = status;
        if (caminhoImagem) dadosParaAtualizar.imagem_url = caminhoImagem;

        const veiculoAtualizado = await atualizarVeiculo(id, dadosParaAtualizar);

        if (!veiculoAtualizado) {
            responder(res, 404, { erro: 'Veículo não encontrado ou nenhum campo válido enviado.' });
            return;
        }

        responder(res, 200, veiculoAtualizado);
    } catch (err) {
        await tratarErro(res, err);
    }
}

// ──────────────────────────────────────────────
// DELETE /veiculos/:id
// ──────────────────────────────────────────────
export async function deletar(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        const sucesso = await deletarVeiculo(id);
        if (!sucesso) {
            responder(res, 404, { erro: 'Veículo não encontrado.' });
            return;
        }
        responder(res, 200, { mensagem: 'Veículo deletado com sucesso.' });
    } catch (err) {
        await tratarErro(res, err);
    }
}
