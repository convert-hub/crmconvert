## Objetivo
Conceder acesso de **SaaS Admin** ao usuário `diegolucasrabelo@gmail.com` (ID `412e8c50-20d3-4af8-9517-94696af75f74`).

Hoje ele não está na tabela `saas_admins`, então não consegue acessar a área `/admin` (gestão global de tenants, usuários e APIs).

## O que será feito

Uma única migração SQL inserindo o registro:

```sql
INSERT INTO public.saas_admins (user_id)
VALUES ('412e8c50-20d3-4af8-9517-94696af75f74')
ON CONFLICT (user_id) DO NOTHING;
```

O `ON CONFLICT` garante idempotência — se já existir, não dá erro.

## Efeitos práticos

- Ao fazer login, o `AuthContext` detecta `isSaasAdmin = true`.
- O usuário passa a ver a rota `/admin` (Dashboard, Tenants, Users, APIs).
- Pode impersonar qualquer tenant via o seletor de tenant.
- Bypass automático de RLS em várias políticas que usam `is_saas_admin()`.

## Não muda nada para outros usuários

A operação afeta apenas esse `user_id`. Nenhum outro membership, tenant ou política é alterado.

## Após sua aprovação
Aplico a migração e confirmo que ele aparece na tabela `saas_admins`. Ele precisará deslogar e logar novamente para o acesso refletir.