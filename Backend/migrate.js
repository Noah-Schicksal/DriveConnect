import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});

async function run() {
    try {
        console.log('Running migration...');
        await pool.query(`
            ALTER TABLE usuario 
            ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
            ADD COLUMN IF NOT EXISTS reset_token_expira_em TIMESTAMP;
        `);
        console.log('✅ Colunas de reset adicionadas na usuario.');
    } catch (e) {}

    try {
        await pool.query(`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS valor_adicional DECIMAL(10,2) DEFAULT 0.00;`);
        console.log('✅ Coluna valor_adicional adicionada na reserva.');
    } catch (e) {}

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS veiculo_imagem (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                veiculo_id UUID NOT NULL REFERENCES veiculo(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL,
                is_principal BOOLEAN DEFAULT FALSE,
                ordem INT DEFAULT 0,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_veiculo_imagem_veiculo ON veiculo_imagem(veiculo_id);
        `);
        console.log('✅ Tabela veiculo_imagem verificada/criada.');
    } catch (e) {
        console.error('Erro ao criar veiculo_imagem', e);
    } finally {
        await pool.end();
    }
}
run();
