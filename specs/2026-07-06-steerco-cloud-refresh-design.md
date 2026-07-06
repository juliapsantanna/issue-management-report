# SteerCo dashboard — refresh diário na nuvem (GitHub Actions)

**Data:** 2026-07-06
**Autora:** Julia Santanna
**Status:** aprovado (aguardando review do spec)

## Problema

O dashboard publicado em
`https://juliapsantanna.github.io/issue-management-report/steerco/`
é atualizado por um job `launchd` (`com.julia.issue-management-report`) que roda
**no Mac da Julia**. Ele só executa quando a máquina está ligada, acordada e na
VPN — prova disso é o gap de 04–05/07 (fim de semana, Mac fechado). Durante as
ferias da Julia (~2 semanas) o Mac fica desligado e a página **congela**, mas a
Ingri precisa dela atualizada.

## Objetivo

Manter **apenas o dashboard `/steerco/`** atualizado automaticamente enquanto a
Julia está fora, sem depender de nenhuma máquina dela, via um workflow do
GitHub Actions em runner hospedado pelo GitHub.

## Escopo

**Dentro:**
- Refresh diário dos dados (Databricks) → build do app React SteerCo → publish no
  GitHub Pages.
- Espelha exatamente o `scripts/run_daily.sh` (que já é o driver diário atual),
  rodando em `ubuntu-latest`.

**Fora (explicitamente não incluído):**
- Post semanal no Slack e `slack_issue_scanner.py` (continuam sendo tarefa do
  `run_weekly.sh`/Mac — não fazem parte deste objetivo).
- Confluence e Apps Script/clasp (estão só no workflow dormente e nunca foram
  ativados; não entram).
- Mirror para o repo `chrisbelem` (legado; precisa de chave SSH que o runner de
  nuvem não tem).

## Viabilidade (por que runner de nuvem funciona)

`scripts/generate_report.py` busca os dados **somente do Databricks**
(`ist__dataset.projac_issues` / `projac_action_plans`, via SQL warehouse API no
host `*.cloud.databricks.com`, auth por token). O Projac aparece apenas como
**string de URL** para montar links — **não** há chamada à API interna do Projac.
Logo, todas as dependências de rede do escopo são endpoints de nuvem
alcançáveis por um runner hospedado pelo GitHub. Não há dependência de VPN.

## Arquitetura

Um único workflow: `.github/workflows/daily_refresh.yml`.

```
gatilho (cron 1x/dia + workflow_dispatch)
   │
   ├─ checkout
   ├─ setup Python 3.11
   ├─ python scripts/generate_report.py --no-slack     # gera docs/index.html + steerco/public/data.json
   ├─ setup Node 20
   ├─ cd steerco && npm ci && npm run build             # vite build → ../docs/steerco/
   └─ commit docs/ + steerco/public/data.json → push origin main
                                                          → GitHub Pages republica
```

### Gatilho
- `schedule: cron '0 11 * * *'` — 11:00 UTC = **08:00 BRT**, uma vez por dia.
- `workflow_dispatch` — para rodar manualmente (validação e sob demanda).

### Passos (espelham `run_daily.sh`)
1. `actions/checkout@v4`
2. `actions/setup-python@v5` com `python-version: '3.11'`
3. `python scripts/generate_report.py --no-slack`
   - env: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID`
     vindos de `secrets.*`.
4. `actions/setup-node@v4` com `node-version: '20'`
5. `cd steerco && npm ci && npm run build`
6. Commit + push:
   - identidade `github-actions[bot]`.
   - `git add docs/ steerco/public/data.json`
   - se `git diff --cached --quiet` → no-op (idempotente); senão commita
     `chore: daily data refresh <data>` e `git push`.
   - `permissions: contents: write` no job (usa o `GITHUB_TOKEN` default).

### Secrets (cadastro manual pela UI do GitHub, uma vez)
`Settings → Secrets and variables → Actions → New repository secret`:
- `DATABRICKS_HOST`
- `DATABRICKS_TOKEN`
- `DATABRICKS_WAREHOUSE_ID`

Valores = os mesmos do `.env` local (`~/issue-management-report/.env`).

## Mudanças de configuração fora do workflow
- **Desligar o launchd** antes das ferias:
  `launchctl bootout gui/$(id -u)/com.julia.issue-management-report`
  (evita dois publishers concorrentes quando o Mac voltar a ligar). Reativável
  depois com `launchctl bootstrap`.
- **Aposentar** o `.github/workflows/generate_report.yml` dormente
  (`runs-on: self-hosted`, nunca rodou) — renomear para `.disabled` ou remover,
  para não confundir.

## Riscos e mitigações
1. **Allowlist de IP no Databricks** (risco principal): se o workspace só aceitar
   IPs corporativos, o runner de nuvem não conecta. **Mitigação:** rodar 1x
   manual (`workflow_dispatch`) **antes das ferias** e confirmar publish. Se
   falhar por conexão → fallback para runner self-hosted num host sempre-ligado
   (fora deste escopo; decisão separada).
2. **Fonte do GitHub Pages:** assume-se `main` / pasta `/docs`. **Checkpoint:**
   confirmar em `Settings → Pages` antes de confiar no republish automático.
3. **Token do Databricks expira:** confirmado durável e cobre as ~2 semanas.
   Se as ferias esticarem, gerar token de maior validade e atualizar o secret.
4. **Delay/skip do cron do GitHub:** crons agendados podem atrasar sob carga.
   Aceitável para atualização 1x/dia; `workflow_dispatch` sempre disponível como
   fallback manual.

## Validação (antes de sair de ferias)
- [ ] 3 secrets cadastrados no repo.
- [ ] `Settings → Pages` confirmado como `main /docs`.
- [ ] Run manual via `workflow_dispatch` conclui verde.
- [ ] Commit `chore: daily data refresh ...` aparece no `main`.
- [ ] `https://juliapsantanna.github.io/issue-management-report/steerco/` mostra
      dado fresco (checar timestamp/números).
- [ ] launchd do Mac desligado.

## Rollback
Reverter é trivial: remover/desabilitar `daily_refresh.yml` e reativar o launchd
(`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.julia.issue-management-report.plist`).
Nenhuma mudança destrutiva em dados ou no site.
