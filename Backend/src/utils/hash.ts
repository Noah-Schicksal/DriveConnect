import * as argon2 from 'argon2';

// Configurações lidas do .env com fallback seguro
const memoryCost = Number(process.env.ARGON2_MEMORY_COST) || 8192;
const timeCost = Number(process.env.ARGON2_TIME_COST) || 2;
const parallelism = Number(process.env.ARGON2_PARALLELISM) || 1;

/**
 * Criptografa uma senha usando o algoritmo Argon2id.
 * 
 * @param senha - A senha em texto plano.
 * @returns O hash gerado pela senha.
 */
export async function gerarHash(senha: string): Promise<string> {
  return await argon2.hash(senha, {
    type: argon2.argon2id,
    memoryCost,
    timeCost,
    parallelism,
  });
}

/**
 * Verifica se a senha em texto plano bate com o hash armazenado.
 * 
 * @param hash - O hash gerado previamente.
 * @param senha - A senha em texto plano fornecida no login.
 * @returns true se as senhas coincidirem, false caso contrário.
 */
export async function verificarHash(hash: string, senha: string): Promise<boolean> {
  return await argon2.verify(hash, senha);
}
