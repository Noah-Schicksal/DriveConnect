// ──────────────────────────────────────────────
// TabelaPreco — Entity (validação pura)
// ──────────────────────────────────────────────

export interface TabelaPrecoInput {
    tipo_carro_id: number;
    filial_id: string;
    data_inicio: string; // ISO date 'YYYY-MM-DD'
    data_fim: string;    // ISO date 'YYYY-MM-DD'
    valor_diaria: number;
}

export interface TabelaPrecoUpdateInput {
    data_inicio?: string;
    data_fim?: string;
    valor_diaria?: number;
}

export interface TabelaPrecoSafe {
    id: number;
    tipo_carro_id: number;
    tipo_carro_nome?: string;
    filial_id: string;
    filial_nome?: string;
    data_inicio: string;
    data_fim: string;
    valor_diaria: number;
}

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

function validarData(valor: unknown, campo: string): string {
    if (!valor || typeof valor !== 'string' || !REGEX_DATA.test(valor)) {
        throw new Error(`Campo inválido: ${campo} deve estar no formato YYYY-MM-DD.`);
    }
    const data = new Date(valor);
    if (isNaN(data.getTime())) {
        throw new Error(`Campo inválido: ${campo} não é uma data válida.`);
    }
    return valor;
}

export class TabelaPreco {
    static validate(input: unknown): TabelaPrecoInput {
        if (!input || typeof input !== 'object') {
            throw new Error('Corpo da requisição inválido.');
        }

        const { tipo_carro_id, filial_id, data_inicio, data_fim, valor_diaria } = input as Record<string, unknown>;

        if (tipo_carro_id === undefined || tipo_carro_id === null) {
            throw new Error('Campo obrigatório ausente: tipo_carro_id.');
        }
        const tipoId = Number(tipo_carro_id);
        if (!Number.isInteger(tipoId) || tipoId <= 0) {
            throw new Error('Campo inválido: tipo_carro_id deve ser um inteiro positivo.');
        }

        if (!filial_id || typeof filial_id !== 'string' || filial_id.trim() === '') {
            throw new Error('Campo obrigatório ausente: filial_id.');
        }

        const inicio = validarData(data_inicio, 'data_inicio');
        const fim = validarData(data_fim, 'data_fim');

        if (new Date(inicio) >= new Date(fim)) {
            throw new Error('Campo inválido: data_inicio deve ser anterior a data_fim.');
        }

        if (valor_diaria === undefined || valor_diaria === null) {
            throw new Error('Campo obrigatório ausente: valor_diaria.');
        }
        const valor = Number(valor_diaria);
        if (isNaN(valor) || valor <= 0) {
            throw new Error('Campo inválido: valor_diaria deve ser um número positivo.');
        }

        return {
            tipo_carro_id: tipoId,
            filial_id: filial_id.trim(),
            data_inicio: inicio,
            data_fim: fim,
            valor_diaria: valor,
        };
    }

    static validatePartial(input: unknown): TabelaPrecoUpdateInput {
        if (!input || typeof input !== 'object') {
            throw new Error('Corpo da requisição inválido.');
        }

        const { data_inicio, data_fim, valor_diaria } = input as Record<string, unknown>;
        const resultado: TabelaPrecoUpdateInput = {};

        if (data_inicio !== undefined) resultado.data_inicio = validarData(data_inicio, 'data_inicio');
        if (data_fim !== undefined)    resultado.data_fim    = validarData(data_fim, 'data_fim');

        if (resultado.data_inicio && resultado.data_fim) {
            if (new Date(resultado.data_inicio) >= new Date(resultado.data_fim)) {
                throw new Error('Campo inválido: data_inicio deve ser anterior a data_fim.');
            }
        }

        if (valor_diaria !== undefined) {
            const valor = Number(valor_diaria);
            if (isNaN(valor) || valor <= 0) {
                throw new Error('Campo inválido: valor_diaria deve ser um número positivo.');
            }
            resultado.valor_diaria = valor;
        }

        if (Object.keys(resultado).length === 0) {
            throw new Error('Nenhum campo válido para atualizar.');
        }

        return resultado;
    }
}
