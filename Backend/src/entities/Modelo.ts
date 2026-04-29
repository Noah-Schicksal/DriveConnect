// ──────────────────────────────────────────────
// Modelo — Entity (validação pura, sem acesso ao banco)
// ──────────────────────────────────────────────

export interface ModeloInput {
    nome: string;
    marca: string;
    tipo_carro_id: number;
}

export interface ModeloUpdateInput {
    nome?: string;
    marca?: string;
    tipo_carro_id?: number;
}

export interface ModeloSafe {
    id: number;
    nome: string;
    marca: string;
    tipo_carro_id: number;
}

export class Modelo {
    static validate(input: unknown): ModeloInput {
        if (!input || typeof input !== 'object') {
            throw new Error('Corpo da requisição inválido.');
        }

        const { nome, marca, tipo_carro_id } = input as Record<string, unknown>;

        if (!nome || typeof nome !== 'string' || nome.trim().length < 2) {
            throw new Error('Campo obrigatório inválido: nome deve ter ao menos 2 caracteres.');
        }

        if (!marca || typeof marca !== 'string' || marca.trim().length < 2) {
            throw new Error('Campo obrigatório inválido: marca deve ter ao menos 2 caracteres.');
        }

        if (tipo_carro_id === undefined || tipo_carro_id === null) {
            throw new Error('Campo obrigatório ausente: tipo_carro_id.');
        }

        const tipoId = Number(tipo_carro_id);
        if (!Number.isInteger(tipoId) || tipoId <= 0) {
            throw new Error('Campo inválido: tipo_carro_id deve ser um inteiro positivo.');
        }

        return {
            nome: (nome as string).trim(),
            marca: (marca as string).trim(),
            tipo_carro_id: tipoId,
        };
    }

    static validatePartial(input: unknown): ModeloUpdateInput {
        if (!input || typeof input !== 'object') {
            throw new Error('Corpo da requisição inválido.');
        }

        const { nome, marca, tipo_carro_id } = input as Record<string, unknown>;
        const resultado: ModeloUpdateInput = {};

        if (nome !== undefined) {
            if (typeof nome !== 'string' || nome.trim().length < 2) {
                throw new Error('Campo inválido: nome deve ter ao menos 2 caracteres.');
            }
            resultado.nome = nome.trim();
        }

        if (marca !== undefined) {
            if (typeof marca !== 'string' || marca.trim().length < 2) {
                throw new Error('Campo inválido: marca deve ter ao menos 2 caracteres.');
            }
            resultado.marca = marca.trim();
        }

        if (tipo_carro_id !== undefined) {
            const tipoId = Number(tipo_carro_id);
            if (!Number.isInteger(tipoId) || tipoId <= 0) {
                throw new Error('Campo inválido: tipo_carro_id deve ser um inteiro positivo.');
            }
            resultado.tipo_carro_id = tipoId;
        }

        if (Object.keys(resultado).length === 0) {
            throw new Error('Nenhum campo válido para atualizar.');
        }

        return resultado;
    }
}
