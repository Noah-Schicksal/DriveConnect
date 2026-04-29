import { query } from '../db/index.js';
import { TabelaPreco, type TabelaPrecoInput, type TabelaPrecoSafe, type TabelaPrecoUpdateInput } from '../entities/TabelaPreco.js';

// ──────────────────────────────────────────────
// PRIVADAS — lógica real
// ──────────────────────────────────────────────

async function _listarTabelasPreco(filialId?: string, tipoCarroId?: number): Promise<TabelaPrecoSafe[]> {
    const condicoes: string[] = [];
    const valores: unknown[] = [];
    let idx = 1;

    if (filialId) {
        condicoes.push(`tp.filial_id = $${idx++}`);
        valores.push(filialId);
    }
    if (tipoCarroId !== undefined) {
        condicoes.push(`tp.tipo_carro_id = $${idx++}`);
        valores.push(tipoCarroId);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const resultado = await query(
        `SELECT tp.id, tp.tipo_carro_id, tc.nome AS tipo_carro_nome,
                tp.filial_id, f.nome AS filial_nome,
                tp.data_inicio, tp.data_fim, tp.valor_diaria
         FROM tabela_preco tp
         LEFT JOIN tipo_carro tc ON tc.id = tp.tipo_carro_id
         LEFT JOIN filial f ON f.id = tp.filial_id
         ${where}
         ORDER BY tp.data_inicio DESC`,
        valores,
    );
    return resultado.rows;
}

async function _buscarTabelaPrecoPorId(id: number): Promise<TabelaPrecoSafe | null> {
    const resultado = await query(
        `SELECT tp.id, tp.tipo_carro_id, tc.nome AS tipo_carro_nome,
                tp.filial_id, f.nome AS filial_nome,
                tp.data_inicio, tp.data_fim, tp.valor_diaria
         FROM tabela_preco tp
         LEFT JOIN tipo_carro tc ON tc.id = tp.tipo_carro_id
         LEFT JOIN filial f ON f.id = tp.filial_id
         WHERE tp.id = $1`,
        [id],
    );
    return resultado.rows[0] ?? null;
}

async function _criarTabelaPreco(dados: TabelaPrecoInput): Promise<TabelaPrecoSafe> {
    // Verifica FK: tipo_carro e filial devem existir
    const [tipoCheck, filialCheck] = await Promise.all([
        query(`SELECT id FROM tipo_carro WHERE id = $1`, [dados.tipo_carro_id]),
        query(`SELECT id FROM filial WHERE id = $1 AND deletado_em IS NULL`, [dados.filial_id]),
    ]);

    if ((tipoCheck.rowCount ?? 0) === 0) {
        throw new Error('Tipo de carro não encontrado: tipo_carro_id inválido.');
    }
    if ((filialCheck.rowCount ?? 0) === 0) {
        throw new Error('Filial não encontrada: filial_id inválido.');
    }

    const resultado = await query(
        `INSERT INTO tabela_preco (tipo_carro_id, filial_id, data_inicio, data_fim, valor_diaria)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [dados.tipo_carro_id, dados.filial_id, dados.data_inicio, dados.data_fim, dados.valor_diaria],
    );
    return _buscarTabelaPrecoPorId(resultado.rows[0].id) as Promise<TabelaPrecoSafe>;
}

async function _atualizarTabelaPreco(id: number, dados: TabelaPrecoUpdateInput): Promise<TabelaPrecoSafe | null> {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let idx = 1;

    if (dados.data_inicio !== undefined) { campos.push(`data_inicio = $${idx++}`); valores.push(dados.data_inicio); }
    if (dados.data_fim    !== undefined) { campos.push(`data_fim = $${idx++}`);    valores.push(dados.data_fim); }
    if (dados.valor_diaria !== undefined) { campos.push(`valor_diaria = $${idx++}`); valores.push(dados.valor_diaria); }

    if (campos.length === 0) return null;

    valores.push(id);
    const resultado = await query(
        `UPDATE tabela_preco SET ${campos.join(', ')} WHERE id = $${idx} RETURNING id`,
        valores,
    );
    if ((resultado.rowCount ?? 0) === 0) return null;
    return _buscarTabelaPrecoPorId(id);
}

async function _deletarTabelaPreco(id: number): Promise<boolean> {
    const resultado = await query(
        `DELETE FROM tabela_preco WHERE id = $1 RETURNING id`,
        [id],
    );
    return (resultado.rowCount ?? 0) > 0;
}

// ──────────────────────────────────────────────
// PÚBLICAS — wrappers finos (Wrapper Pattern)
// ──────────────────────────────────────────────

export async function listarTabelasPreco(filialId?: string, tipoCarroId?: number): Promise<TabelaPrecoSafe[]> {
    return _listarTabelasPreco(filialId, tipoCarroId);
}

export async function buscarTabelaPrecoPorId(id: number): Promise<TabelaPrecoSafe | null> {
    return _buscarTabelaPrecoPorId(id);
}

export async function criarTabelaPreco(input: unknown): Promise<TabelaPrecoSafe> {
    const dados = TabelaPreco.validate(input);
    return _criarTabelaPreco(dados);
}

export async function atualizarTabelaPreco(id: number, input: unknown): Promise<TabelaPrecoSafe | null> {
    const dados = TabelaPreco.validatePartial(input);
    return _atualizarTabelaPreco(id, dados);
}

export async function deletarTabelaPreco(id: number): Promise<boolean> {
    return _deletarTabelaPreco(id);
}
