#!/bin/bash
# Refresh diário do dashboard (data-only, sem Slack/scanner).
# Roda via launchd: com.julia.issue-management-report.plist
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=================================================="
echo "[run_daily] $(date '+%Y-%m-%d %H:%M:%S') — iniciando refresh diário..."

# 1. Regenera dados a partir do Databricks/Projac (sem enviar Slack)
if ! /opt/homebrew/bin/python3 scripts/generate_report.py --no-slack; then
  echo "[run_daily] FALHA na geração — provável VPN desconectada ou token Databricks expirado. Abortando sem publicar."
  exit 1
fi

# 2. Build do app React (SteerCo) -> docs/steerco/
cd steerco && /opt/homebrew/bin/npm run build && cd ..

# 3. Commit (pula se nada mudou) e publica
git add docs/ steerco/public/data.json apps_script/
if git diff --cached --quiet; then
  echo "[run_daily] Sem mudanças nos dados — nada a publicar."
else
  git commit -m "chore: daily data refresh $(date +'%Y-%m-%d')"
  git push origin main
  # Espelho no repo antigo da Chris enquanto ele existir (não falha o job se sumir)
  git push git@github.com:chrisbelem/issue-management-report.git HEAD:main \
    || echo "[run_daily] mirror chrisbelem falhou (repo pode ter sido removido) — ok, seguindo."
fi

echo "[run_daily] Concluído $(date '+%H:%M:%S')."
