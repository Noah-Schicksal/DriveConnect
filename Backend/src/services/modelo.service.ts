import { query } from '../db/index.js';
import { Modelo, type ModeloInput, type ModeloSafe, type ModeloUpdateInput } from '../entities/Modelo.js';

// ──────────────────────────────────────────────
// PRIVADAS — lógica real
// ──────────────────────────────────────────────

async function _listarModelos(tipoCarroId?: number): Promise<ModeloSafe[]> {
    let sql = `
        SELECT m.id, m.nome, m.marca, m.tipo_carro_id,
               tc.nome AS tipo_carro_nome
        FROM modelo m
        LEFT JOIN tipo_carro tc ON tc.id = m.tipo_carro_id
    `;
    const valores: unknown[] = [];

    if (tipoCarroId !== undefined) {
        sql += ` WHERE m.tipo_carro_id = $1`;
        valores.push(tipoCarroId);
    }

    sql += ` ORDER BY m.marca ASC, m.nome ASC`;
    const resultado = await query(sql, valores);
    return resultado.rows;
}

async function _listarModelosDisponiveis(
    dataInicio: Date,
    dataFim: Date,
    filialId?: string
): Promise<ModeloSafe[]> {
    let sql = `
        SELECT DISTINCT m.id, m.nome, m.marca, m.tipo_carro_id, tc.nome AS tipo_carro_nome
        FROM modelo m
        LEFT JOIN tipo_carro tc ON tc.id = m.tipo_carro_id
        JOIN veiculo v ON v.modelo_id = m.id
        WHERE v.status IN ('DISPONIVEL', 'ALUGADO')
          AND v.deletado_em IS NULL
    `;
    const valores: unknown[] = [dataInicio, dataFim];
    
    if (filialId) {
        sql += ` AND v.filial_id = $3`;
        valores.push(filialId);
    }
    
    sql += `
        AND NOT EXISTS (
            SELECT 1 FROM reserva r
            WHERE r.veiculo_id = v.id
              AND r.status IN ('PENDENTE_PAGAMENTO', 'RESERVADA', 'ATIVA')
              AND r.data_inicio < $2
              AND r.data_fim > $1
              AND r.deletado_em IS NULL
        )
        ORDER BY m.marca ASC, m.nome ASC
    `;
    
    const resultado = await query(sql, valores);
    return resultado.rows;
}

async function _buscarModeloPorId(id: number): Promise<ModeloSafe | null> {
    const resultado = await query(
        `SELECT m.id, m.nome, m.marca, m.tipo_carro_id,
                tc.nome AS tipo_carro_nome
         FROM modelo m
         LEFT JOIN tipo_carro tc ON tc.id = m.tipo_carro_id
         WHERE m.id = $1`,
        [id],
    );
    return resultado.rows[0] ?? null;
}

async function _criarModelo(dados: ModeloInput): Promise<ModeloSafe> {
    // Valida que o tipo_carro_id existe
    const tipoExiste = await query(
        `SELECT id FROM tipo_carro WHERE id = $1`,
        [dados.tipo_carro_id],
    );
    if ((tipoExiste.rowCount ?? 0) === 0) {
        throw new Error('Tipo de carro não encontrado: tipo_carro_id inválido.');
    }

    const resultado = await query(
        `INSERT INTO modelo (nome, marca, tipo_carro_id)
         VALUES ($1, $2, $3)
         RETURNING id, nome, marca, tipo_carro_id`,
        [dados.nome, dados.marca, dados.tipo_carro_id],
    );
    return resultado.rows[0];
}

async function _atualizarModelo(id: number, dados: ModeloUpdateInput): Promise<ModeloSafe | null> {
    const campos: string[] = [];
    const valores: unknown[] = [];
    let idx = 1;

    if (dados.nome !== undefined) {
        campos.push(`nome = $${idx++}`);
        valores.push(dados.nome);
    }
    if (dados.marca !== undefined) {
        campos.push(`marca = $${idx++}`);
        valores.push(dados.marca);
    }
    if (dados.tipo_carro_id !== undefined) {
        // Valida que o novo tipo_carro_id existe
        const tipoExiste = await query(
            `SELECT id FROM tipo_carro WHERE id = $1`,
            [dados.tipo_carro_id],
        );
        if ((tipoExiste.rowCount ?? 0) === 0) {
            throw new Error('Tipo de carro não encontrado: tipo_carro_id inválido.');
        }
        campos.push(`tipo_carro_id = $${idx++}`);
        valores.push(dados.tipo_carro_id);
    }

    if (campos.length === 0) return null;

    valores.push(id);
    const resultado = await query(
        `UPDATE modelo SET ${campos.join(', ')}
         WHERE id = $${idx}
         RETURNING id, nome, marca, tipo_carro_id`,
        valores,
    );
    return resultado.rows[0] ?? null;
}

async function _deletarModelo(id: number): Promise<boolean> {
    // Verifica se há veículos vinculados antes de deletar
    const dependentes = await query(
        `SELECT id FROM veiculo WHERE modelo_id = $1 AND deletado_em IS NULL LIMIT 1`,
        [id],
    );
    if ((dependentes.rowCount ?? 0) > 0) {
        throw new Error('Não é possível remover: existem veículos ativos vinculados a este modelo.');
    }

    const resultado = await query(
        `DELETE FROM modelo WHERE id = $1 RETURNING id`,
        [id],
    );
    return (resultado.rowCount ?? 0) > 0;
}

// ──────────────────────────────────────────────
// PÚBLICAS — wrappers finos (Wrapper Pattern)
// ──────────────────────────────────────────────

export async function listarModelos(tipoCarroId?: number): Promise<ModeloSafe[]> {
    return _listarModelos(tipoCarroId);
}

export async function listarModelosDisponiveis(
    dataInicio: Date,
    dataFim: Date,
    filialId?: string
): Promise<ModeloSafe[]> {
    return _listarModelosDisponiveis(dataInicio, dataFim, filialId);
}

export async function buscarModeloPorId(id: number): Promise<ModeloSafe | null> {
    return _buscarModeloPorId(id);
}

export async function criarModelo(input: unknown): Promise<ModeloSafe> {
    const dados = Modelo.validate(input);
    return _criarModelo(dados);
}

export async function atualizarModelo(id: number, input: unknown): Promise<ModeloSafe | null> {
    const dados = Modelo.validatePartial(input);
    return _atualizarModelo(id, dados);
}

export async function deletarModelo(id: number): Promise<boolean> {
    return _deletarModelo(id);
}
