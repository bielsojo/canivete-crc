# Canivete CRC

Todas as ferramentas do CRC num só site, com um login só (Supabase):

| Ferramenta | Origem | Dados |
|---|---|---|
| Backlog de chamados | `BACKLOG/index.html` (aba 1) | CSV do GLPI, guardado só no navegador (IndexedDB) |
| Equipamentos | `BACKLOG/index.html` (aba 2) | planilha XLSX/CSV, guardada só no navegador |
| Gerador de laudos | `BACKLOG/index.html` (aba 3, v1.7) | estado do laudo e PDFs, só no navegador |
| Formulários | `Construtor_Formularios/` | localStorage do navegador |
| Licenças Office + Usuários | `Controle de licenças/publicar-github/` | Supabase (RLS + RPCs + Vault) |

## Rodar localmente

```bash
npm install
```

```bash
npm run dev
```

Antes, copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` (só a chave **anon public**).

Em `npm run dev` existe `window.__caniveteDemo()` no console, que abre o shell sem login para testar a interface (não existe no build publicado).

## Estrutura

- `src/core/` — shell (login, menu, rotas, Ctrl+K), Supabase, IndexedDB, tema, gráficos e componentes de interface.
- `src/modules/<ferramenta>/` — uma pasta por ferramenta; cada uma exporta `{ mount(el, ctx, sub), update?(sub), unmount?() }`.
- `src/modules/registry.js` — itens do menu e qual módulo cada um abre.
- `public/tools/formularios/` — o construtor de formulários roda isolado num iframe.

## Publicar (GitHub Pages)

O workflow `.github/workflows/deploy.yml` publica a cada push na `main`. No repositório, crie as variáveis
`VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` em *Settings > Secrets and variables > Actions > Variables* e ative
*Settings > Pages > Source: GitHub Actions*.

As Edge Functions (`usuarios`, `microsoft365`) aceitam a origem `https://bielsojo.github.io`, que vale para qualquer repositório do mesmo usuário.

## Nunca versionar

`.env`, CSV/XLSX de dados, `.sql` de importação e o protótipo antigo `controle-licencas.html` (tem senhas em texto puro). O `.gitignore` já cobre esses arquivos.
