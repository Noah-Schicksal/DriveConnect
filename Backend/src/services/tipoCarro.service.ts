import { query } from '../db/index.js';
import { TipoCarro, type TipoCarroInput, type TipoCarroSafe, type TipoCarroUpdateInput } from '../entities/TipoCarro.js';

// ──────────────────────────────────────────────
// PRIVADAS — lógica real
// ──────────────────────────────────────────────

async function _listarTiposCarro(): Promise<TipoCarroSafe[]> {
    const resultado = await query(
        `SELECT id, nome, preco_base_diaria FROM tipo_carro ORDER BY nome ASC`,
        [],
    );
    return resultado.rows;
}

async function _buscarTipoCarroPorId(id: number): Promise<TipoCarroSafe | null> {
    const resultado = await query(
        `SELECT id, nome, preco_base_diaria FROM tipo_carro WHERE id = $1`,
        [id],
    );
    return resultado.rows[0] ?? null;
}

async function _criarTipoCarro(dados: TipoCarroInput): Promise<TipoCarroSafe> {
    const resultado = await query(
        `INSERT INTO tipo_carro (nome, preco_base_diaria)
         VALUES ($1, $2)
         RETURNING id, nome, preco_base_diaria`,
        [dados.nome, dados.preco_base_diaria],
    );
    return resultado.rows[0];
}

async function _atualizarTipoCarro(id: number, dados: TipoCarroUpdateInput): Promise<TipoCarroSafe | null> {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let idx = 1;

    if (dados.nome !== undefined) {
        campos.push(`nome = $${idx++}`);
        valores.push(dados.nome);
    }
    if (dados.preco_base_diaria !== undefined) {
        campos.push(`preco_base_diaria = $${idx++}`);
        valores.push(dados.preco_base_diaria);
    }

    if (campos.length === 0) return null;

    valores.push(id);
    const resultado = await query(
        `UPDATE tipo_carro SET ${campos.join(', ')}
         WHERE id = $${idx}
         RETURNING id, nome, preco_base_diaria`,
        valores,
    );
    return resultado.rows[0] ?? null;
}

async function _deletarTipoCarro(id: number): Promise<boolean> {
    // Verifica se há modelos vinculados antes de deletar
    const dependentes = await query(
        `SELECT id FROM modelo WHERE tipo_carro_id = $1 LIMIT 1`,
        [id],
    );
    if ((dependentes.rowCount ?? 0) > 0) {
        throw new Error('Não é possível remover: existem modelos vinculados a este tipo de carro.');
    }

    const resultado = await query(
        `DELETE FROM tipo_carro WHERE id = $1 RETURNING id`,
        [id],
    );
    return (resultado.rowCount ?? 0) > 0;
}

// ──────────────────────────────────────────────
// PÚBLICAS — wrappers finos (Wrapper Pattern)
// ──────────────────────────────────────────────

export async function listarTiposCarro(): Promise<TipoCarroSafe[]> {
    return _listarTiposCarro();
}

export async function buscarTipoCarroPorId(id: number): Promise<TipoCarroSafe | null> {
    return _buscarTipoCarroPorId(id);
}

export async function criarTipoCarro(input: unknown): Promise<TipoCarroSafe> {
    const dados = TipoCarro.validate(input);
    return _criarTipoCarro(dados);
}

export async function atualizarTipoCarro(id: number, input: unknown): Promise<TipoCarroSafe | null> {
    const dados = TipoCarro.validatePartial(input);
    return _atualizarTipoCarro(id, dados);
}

export async function deletarTipoCarro(id: number): Promise<boolean> {
    return _deletarTipoCarro(id);
}
