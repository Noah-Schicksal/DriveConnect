// ──────────────────────────────────────────────
// TipoCarro — Entity (validação pura, sem acesso ao banco)
// ──────────────────────────────────────────────

export interface TipoCarroInput {
    nome: string;
    preco_base_diaria: number;
}

export interface TipoCarroUpdateInput {
    nome?: string;
    preco_base_diaria?: number;
}

export interface TipoCarroSafe {
    id: number;
    nome: string;
    preco_base_diaria: number;
}

export class TipoCarro {
    static validate(input: unknown): TipoCarroInput {
        if (!input || typeof input !== 'object') {
            throw new Error('Corpo da requisição inválido.');
        }

        const { nome, preco_base_diaria } = input as Record<string, unknown>;

        if (!nome || typeof nome !== 'string' || nome.trim().length < 2) {
            throw new Error('Campo obrigatório inválido: nome deve ter ao menos 2 caracteres.');
        }

        if (preco_base_diaria === undefined || preco_base_diaria === null) {
            throw new Error('Campo obrigatório ausente: preco_base_diaria.');
        }

        const preco = Number(preco_base_diaria);
        if (isNaN(preco) || preco <= 0) {
            throw new Error('Campo inválido: preco_base_diaria deve ser um número positivo.');
        }

        return {
            nome: (nome as string).trim(),
            preco_base_diaria: preco,
        };
    }

    static validatePartial(input: unknown): TipoCarroUpdateInput {
        if (!input || typeof input !== 'object') {
            throw new Error('Corpo da requisição inválido.');
        }

        const { nome, preco_base_diaria } = input as Record<string, unknown>;
        const resultado: TipoCarroUpdateInput = {};

        if (nome !== undefined) {
            if (typeof nome !== 'string' || nome.trim().length < 2) {
                throw new Error('Campo inválido: nome deve ter ao menos 2 caracteres.');
            }
            resultado.nome = nome.trim();
        }

        if (preco_base_diaria !== undefined) {
            const preco = Number(preco_base_diaria);
            if (isNaN(preco) || preco <= 0) {
                throw new Error('Campo inválido: preco_base_diaria deve ser um número positivo.');
            }
            resultado.preco_base_diaria = preco;
        }

        if (Object.keys(resultado).length === 0) {
            throw new Error('Nenhum campo válido para atualizar.');
        }

        return resultado;
    }
}
