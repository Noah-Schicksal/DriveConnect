import { query } from '../db/index.js';
import type { Veiculo } from '../entities/Veiculo.js';

export async function criarVeiculo(dados: Veiculo): Promise<Veiculo> {
    const q = `
    INSERT INTO veiculo (modelo_id, filial_id, placa, ano, cor, status, imagem_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *;
  `;
    const values = [
        dados.modelo_id,
        dados.filial_id,
        dados.placa,
        dados.ano,
        dados.cor,
        dados.status,
        dados.imagem_url
    ];
    const result = await query(q, values);
    return result.rows[0];
}

export async function listarVeiculos(filialId?: string): Promise<any[]> {
    let q = `
    SELECT v.*, m.nome as modelo_nome, m.marca as modelo_marca,
           (SELECT filename FROM veiculo_imagem WHERE veiculo_id = v.id ORDER BY is_principal DESC, ordem ASC LIMIT 1) as capa_url
    FROM veiculo v
    LEFT JOIN modelo m ON v.modelo_id = m.id
    WHERE v.deletado_em IS NULL
  `;
    const values = [];
    if (filialId) {
        q += ` AND v.filial_id = $1`;
        values.push(filialId);
    }
    const result = await query(q, values);
    return result.rows;
}

export async function buscarVeiculoPorId(id: string): Promise<any | null> {
    const q = `SELECT * FROM veiculo WHERE id = $1 AND deletado_em IS NULL`;
    const result = await query(q, [id]);
    const veiculo = result.rows[0];
    if (!veiculo) return null;

    const qImagens = `SELECT * FROM veiculo_imagem WHERE veiculo_id = $1 ORDER BY is_principal DESC, ordem ASC`;
    const imagens = await query(qImagens, [id]);
    veiculo.imagens = imagens.rows;

    return veiculo;
}

export async function adicionarImagemVeiculo(veiculoId: string, filename: string, isPrincipal: boolean = false): Promise<void> {
    if (isPrincipal) {
        await query(`UPDATE veiculo_imagem SET is_principal = FALSE WHERE veiculo_id = $1`, [veiculoId]);
    }
    await query(`
        INSERT INTO veiculo_imagem (veiculo_id, filename, is_principal)
        VALUES ($1, $2, $3)
    `, [veiculoId, filename, isPrincipal]);
}

export async function atualizarVeiculo(id: string, dados: Partial<Veiculo>): Promise<Veiculo | null> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    for (const [key, value] of Object.entries(dados)) {
        if (value !== undefined && key !== 'id') {
            setClauses.push(`${key} = $${paramIdx}`);
            values.push(value);
            paramIdx++;
        }
    }

    if (setClauses.length === 0) return null;

    values.push(id);
    const q = `
    UPDATE veiculo 
    SET ${setClauses.join(', ')} 
    WHERE id = $${paramIdx} AND deletado_em IS NULL 
    RETURNING *;
  `;

    const result = await query(q, values);
    return result.rows[0] || null;
}

export async function deletarVeiculo(id: string): Promise<boolean> {
    const q = `UPDATE veiculo SET deletado_em = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id`;
    const result = await query(q, [id]);
    return (result.rowCount ?? 0) > 0;
}
