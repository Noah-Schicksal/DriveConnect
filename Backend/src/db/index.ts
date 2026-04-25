import { Pool } from 'pg';

// Utiliza a variável de ambiente DATABASE_URL, ex: postgresql://user:pass@localhost:5432/dbname
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Função utilitária para executar queries simples.
 */
export const query = (text: string, params?: any[]) => pool.query(text, params);

/**
 * Retorna um client do pool para transações que exigem a mesma conexão (BEGIN, COMMIT, ROLLBACK).
 * Lembre-se de sempre chamar client.release() após o uso.
 */
export const getClient = () => pool.connect();
