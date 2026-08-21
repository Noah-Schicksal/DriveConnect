import { IncomingMessage, ServerResponse } from 'http';
import {
    criarVeiculo,
    listarVeiculos,
    buscarVeiculoPorId,
    atualizarVeiculo,
    deletarVeiculo,
    listarItens,
    atualizarStatusVeiculoE_Notificar,
    listarVeiculosDisponiveis
} from '../services/veiculo.service.js';
import { processarUpload } from '../services/storage.service.js';
import { requireCaller, requireTipo } from '../middlewares/auth.js';

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
            : mensagem.includes('Não autorizado') || mensagem.includes('identidade ausente') ? 401
                : mensagem.includes('Sem permissão') ? 403
                    : 500;
    responder(res, status, { erro: mensagem });
}

// POST /veiculos
// Body (multipart/form-data): modelo_id, filial_id, placa, ano, cor, status, imagem (file único)
export async function registrarVeiculo(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        let campos: Record<string, any> = {};
        let caminhosImagens: string[] = [];

        if (isMultipart(req)) {
            const uploadResult = await processarUpload(req);
            campos = uploadResult.campos;
            caminhosImagens = uploadResult.caminhosImagens;
        } else {
            campos = await lerCorpoJson(req);
        }

        const {
            modelo_id,
            filial_id,
            placa,
            ano,
            cor,
            status,
            preco_diaria,
            itens_ids
        } = campos;

        if (!modelo_id || !filial_id || !placa || !ano || !status) {
            responder(res, 400, { erro: 'Campos obrigatórios: modelo_id, filial_id, placa, ano, status.' });
            return;
        }

        const imagemPrincipal: string | null = caminhosImagens.length > 0 ? (caminhosImagens[0] ?? null) : null;

        const novoVeiculo = await criarVeiculo({
            modelo_id: Number(modelo_id),
            filial_id,
            placa,
            ano: Number(ano),
            cor,
            status,
            imagem_url: imagemPrincipal || null, // Capa oficial no registro
            preco_diaria: preco_diaria ? Number(preco_diaria) : null,
            itens_ids: Array.isArray(itens_ids) ? itens_ids : (itens_ids ? [itens_ids] : []),
        });

        if (imagemPrincipal) {
            const { substituirImagemVeiculo } = await import('../services/veiculo.service.js');
            await substituirImagemVeiculo(novoVeiculo.id!, imagemPrincipal);
        }

        responder(res, 201, novoVeiculo);
    } catch (err) {
        await tratarErro(res, err);
    }
}

// GET /veiculos
export async function listar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN', 'CLIENTE');

        // Para simplificar a rota pura do Node sem urlSearchParams parser manual completo
        // Poderíamos parsear req.url para extrar filialId se fôssemos usar searchParams.
        // get filialId opcional
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const filialId = url.searchParams.get('filialId') || undefined;

        let statusFilter = undefined;
        if (caller.tipo === 'CLIENTE') {
            statusFilter = 'DISPONIVEL';
        }

        const veiculos = await listarVeiculos(filialId, statusFilter);
        responder(res, 200, veiculos);
    } catch (err) {
        await tratarErro(res, err);
    }
}

// GET /veiculos/:id3
export async function buscar(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN', 'CLIENTE');

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

// PUT /veiculos/:id
// Body: multipart ou Json parcial
export async function atualizar(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        let campos: Record<string, any> = {};
        let caminhosImagens: string[] = [];

        if (isMultipart(req)) {
            const uploadResult = await processarUpload(req);
            campos = uploadResult.campos;
            caminhosImagens = uploadResult.caminhosImagens;
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

        // Se enviou novas imagens no PUT, a primeira vira a capa por padrão nesta rota simplificada
        if (caminhosImagens.length > 0) {
            dadosParaAtualizar.imagem_url = caminhosImagens[0];
        }

        if (Object.keys(dadosParaAtualizar).length > 0) {
            await atualizarVeiculo(id, dadosParaAtualizar);
        }

        // Se estiver alterando status, usamos o helper que notifica todos os gerentes/admin.
        if (typeof dadosParaAtualizar.status === 'string' && dadosParaAtualizar.status) {
            const novoStatus = String(dadosParaAtualizar.status);
            delete dadosParaAtualizar.status;
            if (Object.keys(dadosParaAtualizar).length > 0) {
                await atualizarVeiculo(id, dadosParaAtualizar);
            }
            await atualizarStatusVeiculoE_Notificar({
                veiculoId: id,
                novoStatus,
                origem: 'VEICULO_ROUTE',
            });
        }

        const veiculoAtualizado = await buscarVeiculoPorId(id);

        if (!veiculoAtualizado) {
            responder(res, 404, { erro: 'Veículo não encontrado ou nenhum campo válido enviado.' });
            return;
        }

        if (caminhosImagens.length > 0) {
            const { substituirImagemVeiculo } = await import('../services/veiculo.service.js');
            await substituirImagemVeiculo(id, caminhosImagens[0]!);
        }

        responder(res, 200, veiculoAtualizado);
    } catch (err) {
        await tratarErro(res, err);
    }
}

export async function adicionarImagem(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        if (!isMultipart(req)) {
            responder(res, 400, { erro: 'Requisição deve ser multipart/form-data.' });
            return;
        }

        const uploadResult = await processarUpload(req);
        const { caminhosImagens, campos } = uploadResult;

        if (caminhosImagens.length === 0) {
            responder(res, 400, { erro: 'Nenhuma imagem enviada.' });
            return;
        }

        const { substituirImagemVeiculo, atualizarVeiculo } = await import('../services/veiculo.service.js');

        // Nesta rota, processamos apenas a primeira imagem para manter compatibilidade com o comportamento esperado
        const caminhoImagem = caminhosImagens[0];
        if (!caminhoImagem) {
            responder(res, 400, { erro: 'Imagem inválida.' });
            return;
        }
        await substituirImagemVeiculo(id, caminhoImagem);
        await atualizarVeiculo(id, { imagem_url: caminhoImagem });

        responder(res, 201, { mensagem: 'Imagem adicionada com sucesso.', filename: caminhoImagem });
    } catch (err) {
        await tratarErro(res, err);
    }
}

// DELETE /veiculos/:id
export async function deletar(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

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

export async function listarOpcionais(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN');

        const itens = await listarItens();
        responder(res, 200, itens);
    } catch (err) {
        await tratarErro(res, err);
    }
}

export async function listarReservasVeiculoHandler(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN', 'CLIENTE');

        const { listarReservasDoVeiculo } = await import('../services/veiculo.service.js');
        const reservas = await listarReservasDoVeiculo(id);
        responder(res, 200, reservas);
    } catch (err) {
        await tratarErro(res, err);
    }
}

export async function listarDisponiveis(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const caller = requireCaller(req);
        requireTipo(caller, 'GERENTE', 'ADMIN', 'CLIENTE');

        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const filialId = url.searchParams.get('filialId');
        const dataInicio = url.searchParams.get('data_inicio');
        const dataFim = url.searchParams.get('data_fim');

        if (!filialId || !dataInicio || !dataFim) {
            responder(res, 400, { erro: 'Parâmetros obrigatórios: filialId, data_inicio, data_fim.' });
            return;
        }

        const veiculos = await listarVeiculosDisponiveis(filialId, new Date(dataInicio), new Date(dataFim));
        responder(res, 200, veiculos);
    } catch (err) {
        await tratarErro(res, err);
    }
}
