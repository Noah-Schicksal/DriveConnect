# Context: CRUD API

> Last updated: 2026-04-28T16:33:00-03:00
> Version: 1

## Purpose
Rastreamento das implementações de CRUD realizadas no backend DriveConnect via skill crud-api.

## Architecture / How It Works

- **Camadas**: Entity (validação) → Service (lógica + DB) → Routes (HTTP handler) → server.ts (roteador central)
- **Nota**: O projeto usa vanilla Node.js HTTP (`createServer`), **sem Express**. Não há middleware chain via `use()` — as rotas são registradas manualmente via regex no `server.ts`.
- **DB**: PostgreSQL com `pg` pool direto (sem multi-tenant/withTenant). Funções `query()` e `getClient()` de `src/db/index.ts`.
- **Auth (atual)**: Headers simples `X-Usuario-Id`, `X-Tipo`, `X-Filial-Id`. Guards tipados em `src/middlewares/auth.ts`. **Trocar por JWT quando implementar autenticação completa.**
- **Padrão de naming**: funções em português (camelCase). Entidades com classe TypeScript pura (sem ORM).
- **Soft delete**: `deletado_em TIMESTAMP` em todas as entidades. Queries sempre filtram `WHERE deletado_em IS NULL`.

## Regras de Autorização Implementadas

| Endpoint | CLIENTE | GERENTE | ADMIN |
|----------|---------|---------|-------|
| `GET /usuarios/clientes` | ❌ | ✅ | ✅ |
| `GET /usuarios/clientes/:id` | ❌ | ✅ | ✅ |
| `GET /usuarios/clientes/me` | ✅ (próprio) | ❌ | ❌ |
| `PUT /usuarios/clientes/:id` | ❌ | ✅ | ✅ |
| `PUT /usuarios/clientes/me` | ✅ (próprio) | ❌ | ❌ |
| `PATCH /usuarios/:id/senha` | ✅ (ownership) | ❌ | ✅ |
| `DELETE /usuarios/:id` | ❌ | ❌ | ✅ |
| `GET /filiais` | ❌ | ✅ (todas) | ✅ |
| `GET /filiais/:id` | ❌ | ✅ (todas) | ✅ |
| `PUT /filiais/:id` | ❌ | ✅ (só a própria) | ✅ |
| `GET /gerentes` | ❌ | ❌ | ✅ |
| `GET /gerentes/me` | ❌ | ✅ (próprio) | ❌ |

## Affected Project Files

| File | Criado/Modificado | Responsabilidade |
|------|:-----------------:|-----------------|
| `Backend/src/entities/Usuario.ts` | Criado | Validação de email, senha, tipo |
| `Backend/src/entities/Cliente.ts` | Criado | Validação de CPF, nome, regra de habilitação |
| `Backend/src/entities/Gerente.ts` | Criado | Regra de escopo global vs filial |
| `Backend/src/middlewares/auth.ts` | Criado | Extração do caller, guards requireCaller/requireTipo/requireOwnership |
| `Backend/src/services/usuario.service.ts` | Criado | Auth argon2id, CRUD cliente/gerente, soft-delete em transação |
| `Backend/src/services/filial.service.ts` | Criado | Leitura/escrita de filiais com enforcement de ownership, leitura de gerentes |
| `Backend/src/routes/usuario.routes.ts` | Criado | Handlers HTTP para usuários/clientes |
| `Backend/src/routes/filial.routes.ts` | Criado | Handlers HTTP para filiais e gerentes |
| `Backend/src/server.ts` | Criado | Roteador central vanilla HTTP |
| `Backend/src/utils/hash.ts` | Pré-existente | gerarHash / verificarHash argon2id |
| `Backend/src/db/index.ts` | Pré-existente | query() e getClient() |

## Code Reference

### `src/middlewares/auth.ts` — `requireOwnership(caller, donoId, ...privilegiados)`

```typescript
export function requireOwnership(caller: Caller, donoId: string, ...tiposPrivilegiados: TipoUsuario[]): void {
  if (tiposPrivilegiados.includes(caller.tipo)) return;
  if (caller.usuarioId === donoId) return;
  throw new Error('Sem permissão: você só pode acessar seus próprios dados.');
}
```

**How it works:** Gerentes/ADMINs passam se incluídos em `tiposPrivilegiados`. Clientes só passam se `caller.usuarioId === donoId`.

### `src/services/filial.service.ts` — `_atualizarFilial(filialId, caller, params)`

```typescript
if (caller.tipo === 'GERENTE' && caller.filialId !== filialId) {
  throw new Error('Sem permissão: você só pode alterar dados da sua própria filial.');
}
```

**How it works:** O enforcement acontece no service, não só no HTTP layer. Mesmo que o guard HTTP seja burlado, o service rejeita.

### `src/services/usuario.service.ts` — `buscarMeuPerfilCliente(usuarioId)`

Busca por `usuario_id` em vez de `cliente.id` — impede que um cliente acesse dados de outro mesmo que tente passar um `clienteId` alheio na URL `/me`.

## Key Design Decisions

1. **Headers simples em vez de JWT (por ora):** O projeto não tem sistema de sessão implementado. Os headers `X-Usuario-Id` / `X-Tipo` / `X-Filial-Id` são um placeholder deliberado — toda a lógica de guard está isolada em `auth.ts`, então substituir por JWT exige mudança em apenas um arquivo.

2. **Enforcement duplo (service + route):** A regra de filial própria é validada no service (`filial.service.ts`), não só no guard HTTP. Isso garante que a regra de negócio nunca vaze, independente de como o serviço for chamado (ex: testes, scripts internos).

3. **`/clientes/me` registrado ANTES de `/clientes/:id`:** No roteador, a rota estática `me` precisa ser testada antes do regex `[^/]+` para não ser capturada erroneamente. Comentado no `server.ts`.

4. **Sem Express / sem framework de rotas:** O projeto usa `createServer` vanilla. Rotas são declaradas via `if` + regex no `server.ts`. Manutenível para o tamanho atual; migrar para Express ou Fastify se crescer muito.

5. **Gerente global (filialId = null):** Um gerente com `filial_id = NULL` tem acesso de leitura a todas as filiais, mas ao tentar editar qualquer filial via `PUT /filiais/:id`, o check `caller.filialId !== filialId` falha (null !== uuid). Necessita de tratamento especial se quiser gerentes globais com permissão de escrita — decisão de negócio pendente.

## Changelog

### v1 — 2026-04-28
- Criadas entidades `Usuario`, `Cliente`, `Gerente` com regras de negócio encapsuladas
- Implementado `usuario.service.ts`: auth argon2id, CRUD completo, soft-delete transacional
- Criado `middlewares/auth.ts`: extração de caller por header, guards `requireCaller`, `requireTipo`, `requireOwnership`
- Criado `filial.service.ts`: leitura pública para gerentes, escrita restrita à filial própria
- Criado `filial.routes.ts`: endpoints de filial e gerente com guards aplicados
- Adicionados endpoints `/clientes/me` (GET + PUT) restritos ao próprio cliente
- Guards aplicados em todos os endpoints existentes de usuários
- Registradas novas rotas no `server.ts`
- Gerado este arquivo de contexto
