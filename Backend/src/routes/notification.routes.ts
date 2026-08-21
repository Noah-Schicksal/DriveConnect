import { IncomingMessage, ServerResponse } from 'http';
import { requireCaller } from '../middlewares/auth.js';
import { deleteFcmToken, saveFcmToken } from '../services/fcm.service.js';

function lerCorpo(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (chunk) => (dados += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(dados || '{}')); }
      catch { reject(new Error('JSON inválido no corpo da requisição.')); }
    });
    req.on('error', reject);
  });
}

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

async function tratarErro(res: ServerResponse, err: unknown): Promise<void> {
  const mensagem = err instanceof Error ? err.message : 'Erro interno.';
  const status = mensagem.includes('inválid') || mensagem.includes('obrigat') ? 400
    : mensagem.includes('Não autorizado') ? 401
    : mensagem.includes('Sem permissão') ? 403
    : 500;
  responder(res, status, { erro: mensagem });
}

// POST /notificacoes/token
// Body: { token, plataforma?, deviceId? }
export async function registrarTokenFcm(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    const { token, plataforma, deviceId } = await lerCorpo(req);

    if (!token) {
      responder(res, 400, { erro: 'Campo obrigatório: token.' });
      return;
    }

    await saveFcmToken({
      usuarioId: caller.usuarioId,
      token,
      plataforma,
      deviceId,
    });

    responder(res, 200, { ok: true });
  } catch (err) {
    await tratarErro(res, err);
  }
}

// DELETE /notificacoes/token
// Body: { token }
export async function removerTokenFcm(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const caller = requireCaller(req);
    const { token } = await lerCorpo(req);

    if (!token) {
      responder(res, 400, { erro: 'Campo obrigatório: token.' });
      return;
    }

    await deleteFcmToken({ usuarioId: caller.usuarioId, token });
    responder(res, 200, { ok: true });
  } catch (err) {
    await tratarErro(res, err);
  }
}
