# SteerCo Daily Refresh na Nuvem — Implementation Plan

> **For agentic workers:** implemente task-a-task. Steps usam checkbox (`- [ ]`).

**Goal:** Publicar o dashboard `/steerco/` 1x/dia via GitHub Actions em runner de nuvem, sem depender do Mac da Julia.

**Architecture:** Um workflow `daily_refresh.yml` em `ubuntu-latest` que espelha o `scripts/run_daily.sh`: gera dados do Databricks (`--no-slack`) → build do app React → commit/push em `main`, republicando o GitHub Pages. `generate_report.py` usa só stdlib (sem `pip install`).

**Tech Stack:** GitHub Actions, Python 3.11 (stdlib), Node 20 + Vite.

## Global Constraints
- Escopo: **só** o dashboard. Sem Slack, Confluence, Apps Script, scanner, mirror chrisbelem.
- Dados vêm só do Databricks (host `*.cloud.databricks.com`, token) — sem VPN/Projac API.
- Publish = commit `docs/` + `steerco/public/data.json` em `main` (Pages source `main /docs`).
- Idempotente: sem mudança nos dados → no-op.

---

### Task 1: Criar o workflow `daily_refresh.yml`

**Files:**
- Create: `.github/workflows/daily_refresh.yml`

**Interfaces:**
- Consumes: `secrets.DATABRICKS_HOST`, `secrets.DATABRICKS_TOKEN`, `secrets.DATABRICKS_WAREHOUSE_ID`; scripts `scripts/generate_report.py`, `steerco/` (vite build → `docs/steerco/`).
- Produces: commits `chore: daily data refresh <data>` em `main`.

- [ ] **Step 1: Criar o arquivo** com o conteúdo exato:

```yaml
name: Daily SteerCo refresh

on:
  schedule:
    - cron: '0 11 * * *'   # 11:00 UTC = 08:00 BRT, 1x/dia
  workflow_dispatch: {}

jobs:
  refresh:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Gerar dados (Databricks, sem Slack)
        env:
          DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
          DATABRICKS_TOKEN: ${{ secrets.DATABRICKS_TOKEN }}
          DATABRICKS_WAREHOUSE_ID: ${{ secrets.DATABRICKS_WAREHOUSE_ID }}
        run: python scripts/generate_report.py --no-slack

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build SteerCo
        run: |
          cd steerco
          npm ci
          npm run build

      - name: Commit e push
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/ steerco/public/data.json
          if git diff --cached --quiet; then
            echo "Sem mudanças — nada a publicar."
          else
            git commit -m "chore: daily data refresh $(date +'%Y-%m-%d')"
            git push
          fi
```

- [ ] **Step 2: Validar YAML** localmente
  Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/daily_refresh.yml')); print('YAML ok')"`
  Expected: `YAML ok`

- [ ] **Step 3: Commit + push** (precisa estar no remoto pro Actions enxergar)

```bash
git add .github/workflows/daily_refresh.yml
git commit -m "feat: workflow de refresh diário do SteerCo (GitHub Actions)"
git push origin main
```

---

### Task 2: Aposentar o workflow self-hosted dormente

**Files:**
- Rename: `.github/workflows/generate_report.yml` → `.github/workflows/generate_report.yml.disabled`

- [ ] **Step 1: Renomear** (impede execução, preserva histórico)

```bash
git mv .github/workflows/generate_report.yml .github/workflows/generate_report.yml.disabled
git commit -m "chore: desativa workflow self-hosted dormente (nunca ativado)"
git push origin main
```

---

### Task 3: Passos manuais da Julia (UI do GitHub) — pré-viagem

> Não são passos de código; são o gate de validação. Sem eles o workflow falha.

- [ ] **Secrets:** `Settings → Secrets and variables → Actions → New repository secret`, criar os 3 com os valores do `~/issue-management-report/.env`:
  - `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID`
- [ ] **Pages:** `Settings → Pages` — confirmar source = `Deploy from a branch`, branch `main`, pasta `/docs`.
- [ ] **Permissão de push do Actions:** `Settings → Actions → General → Workflow permissions` = **Read and write permissions**.
- [ ] **Teste manual:** aba `Actions → Daily SteerCo refresh → Run workflow`. Aguardar verde.
- [ ] **Conferir publish:** commit `chore: daily data refresh ...` no `main` + abrir
  `https://juliapsantanna.github.io/issue-management-report/steerco/` e checar dado fresco.

---

### Task 4: Desligar o launchd do Mac (evita publishers concorrentes)

- [ ] **Step 1: Desligar** (fazer só depois do teste manual passar)

```bash
launchctl bootout gui/$(id -u)/com.julia.issue-management-report
```

- [ ] **Step 2: Confirmar que saiu**
  Run: `launchctl list | grep issue-management-report || echo "launchd desligado"`
  Expected: `launchd desligado`

Reativar depois das ferias:
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.julia.issue-management-report.plist`

## Self-Review
- Cobertura do spec: workflow (Task 1), aposentar dormente (Task 2), secrets+Pages+perms+teste (Task 3), launchd (Task 4). ✅
- Sem placeholders. ✅
- Sem `pip install` (só stdlib) — confirmado. ✅
- Risco de allowlist de IP no Databricks: exposto no teste manual da Task 3 (falha = fallback self-hosted, fora de escopo).
