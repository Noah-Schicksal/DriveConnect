import type { IncomingMessage, ServerResponse } from 'http';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Enforça HTTPS em produção.
 *
 * Duas estratégias, controladas por env:
 *   1. HTTPS_BEHIND_PROXY=true  → checa X-Forwarded-Proto (reverse proxy / cloud)
 *   2. Padrão                   → checa req.socket.encrypted (servidor HTTPS nativo)
 *
 * Em desenvolvimento (NODE_ENV !== 'production') o middleware é no-op.
 *
 * Retorna true se a requisição foi respondida (redirect emitido) — o chamador
 * deve interromper o processamento nesse caso.
 */
export function enforceHttps(req: IncomingMessage, res: ServerResponse): boolean {
  if (isDev) return false;

  const behindProxy = process.env.HTTPS_BEHIND_PROXY === 'true';

  const isSecure = behindProxy
    ? req.headers['x-forwarded-proto'] === 'https'
    : (req.socket as { encrypted?: boolean }).encrypted === true;

  if (isSecure) return false;

  // Monta URL de redirecionamento
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const url  = req.url ?? '/';
  const redirectUrl = `https://${host}${url}`;

  res.writeHead(301, {
    Location: redirectUrl,
    'Content-Type': 'text/plain',
  });
  res.end(`Redirecionando para ${redirectUrl}`);

  return true;
}
