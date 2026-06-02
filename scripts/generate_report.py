#!/usr/bin/env python3
"""
Issue Management Report Generator
===================================
Busca dados diretamente do Databricks, aplica toda a lógica de
enriquecimento e gera o dashboard HTML final.

Uso:
    python scripts/generate_report.py

Credenciais em .env (raiz do projeto):
    DATABRICKS_HOST=https://nubank-e2-general.cloud.databricks.com
    DATABRICKS_TOKEN=dapi...
    DATABRICKS_WAREHOUSE_ID=3f3791356e419544

Config em data/config/:
    - people_mapping.csv    (mapeamento pessoa -> BU + BA)

Output:
    - output/dashboard.html
"""

import os
import sys
import re
import csv
import io
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, date

# ─── Caminhos ─────────────────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR   = os.path.join(BASE_DIR, 'data', 'config')
TEMPLATE_DIR = os.path.join(BASE_DIR, 'template')
OUTPUT_DIR   = os.path.join(BASE_DIR, 'docs')       # GitHub Pages serve de /docs
ENV_PATH     = os.path.join(BASE_DIR, '.env')
SLACK_USER_CACHE_PATH    = os.path.join(CONFIG_DIR, 'slack_user_ids.json')
SLACK_NAME_OVERRIDE_PATH = os.path.join(CONFIG_DIR, 'slack_user_ids_by_name.json')

# ─── Configurações editáveis ───────────────────────────────────────────────────
BCO_NAMES         = ['Ingrid Sgulmar']
ALERT_WINDOW_DAYS = 14
NPF_BASE_URL      = 'https://nubank.atlassian.net/browse/'
PROJAC_BASE_URL   = 'https://backoffice.ist.nubank.world/projac/#/im/issues/'
DASHBOARD_URL     = 'https://im-pending-actions-2093534396923660.aws.databricksapps.com/'
SLACK_USER_CACHE  = None  # populated below — points to data/config/slack_user_ids.json

# Issues e APs para excluir manualmente do report (ex: status desatualizado no Databricks)
EXCLUDED_ISSUES = {'I012319'}
EXCLUDED_APS    = {'AP015815'}

# Normalização de Business Area — nomes alternativos → nome canônico
BA_ALIASES = {
    'CPX':                        'Common Product Experience',
    'Common product experience':  'Common Product Experience',
    'common product experience':  'Common Product Experience',
    'Unsecured Loans':            'Unsecured Lending',
    'unsecured loans':            'Unsecured Lending',
    'Lending PJ':                 'PJ Lending',
    'lending pj':                 'PJ Lending',
    'Lending Foundations':        'Lending Foundations Platforms',
    'lending foundations':        'Lending Foundations Platforms',
}

# ─── SQL Queries ──────────────────────────────────────────────────────────────

QUERY_ISSUES = """
SELECT
  i.code,
  i.key,
  i.status,
  i.summary,
  i.countries,
  i.reporter_name,
  i.squad_reporter,
  i.created_at,
  i.updated_at,
  i.due_date_at,
  i.completed_at,
  i.responsible_email,
  i.accountable_email,
  macroprocess.process_journey_macroprocess__name,
  i.overall_risk_rating,
  i.origin,
  i.subcategory,
  i.residual_risk_level,
  i.responsible_name,
  i.accountable_name,
  i.business_units,
  i.npf_keys,
  i.description,
  CONCAT('{projac_base}', i.code) AS projac_link
FROM ist__dataset.projac_issues i
LEFT JOIN etl.ist__contract.malhacao__process_journey_macroprocesses macroprocess
  ON i.macroprocess_id = macroprocess.process_journey_macroprocess__id
""".format(projac_base=PROJAC_BASE_URL)

QUERY_APS = """
WITH
  action_plan_status_history AS (
    SELECT key, to_status AS last_status, timestamp
    FROM etl.br__dataset.jira_issues_status_history
    UNION ALL
    SELECT code AS key, status AS last_status, NULL AS timestamp
    FROM ist__dataset.projac_action_plans
  ),
  ranked_action_plan_status AS (
    SELECT key, last_status,
      ROW_NUMBER() OVER (PARTITION BY key ORDER BY timestamp DESC NULLS LAST) AS rn
    FROM action_plan_status_history
  ),
  latest_action_plan_status AS (
    SELECT key, last_status
    FROM ranked_action_plan_status
    WHERE rn = 1
  )
SELECT
  b.code      AS ap_code,
  CONCAT('{projac_base}', a.code, '/action-plan/', b.code) AS ap_link_projac,
  b.status    AS ap_status,
  b.countries AS ap_country,
  CONCAT('{projac_base}', a.code)                          AS issue_link_projac,
  a.status    AS issue_status,
  a.summary   AS issue_summary,
  a.due_date_at   AS issue_due_date_at,
  a.subcategory   AS issue_subcategory,
  b.summary       AS ap_summary,
  b.created_at    AS ap_created_at,
  b.due_date_at   AS ap_due_date_at,
  c.last_status   AS ap_last_status,
  b.business_unit AS ap_business_unit,
  b.assignee_names AS ap_assignee_name,
  a.code          AS issue_code_raw,
  a.origin        AS issue_origin,
  a.reporter_name AS issue_reporter_name,
  a.overall_risk_rating AS issue_risk_rating,
  a.npf_keys      AS issue_npf_keys_raw
FROM ist__dataset.projac_issues a
LEFT JOIN ist__dataset.projac_action_plans b
  ON (a.key = b.issue_key OR a.id = b.issue_id)
LEFT JOIN latest_action_plan_status c ON b.code = c.key
WHERE b.code IS NOT NULL
""".format(projac_base=PROJAC_BASE_URL)

# ─── Carregar .env ─────────────────────────────────────────────────────────────

def load_env(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

load_env(ENV_PATH)

DATABRICKS_HOST         = os.environ.get('DATABRICKS_HOST', '').rstrip('/')
DATABRICKS_TOKEN        = os.environ.get('DATABRICKS_TOKEN', '')
DATABRICKS_WAREHOUSE_ID = os.environ.get('DATABRICKS_WAREHOUSE_ID', '')

# ─── Databricks API ────────────────────────────────────────────────────────────

def _db_request(path, method='GET', payload=None):
    url  = f"{DATABRICKS_HOST}{path}"
    data = json.dumps(payload).encode() if payload else None
    req  = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', f'Bearer {DATABRICKS_TOKEN}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"Databricks API error {e.code}: {body}")

def db_run_query(sql):
    """Executa SQL no Databricks e retorna list[dict]."""
    # Timestamp comment forces Databricks to bypass result cache
    sql = f"-- run:{datetime.now().isoformat()}\n" + sql
    result = _db_request('/api/2.0/sql/statements', 'POST', {
        'warehouse_id': DATABRICKS_WAREHOUSE_ID,
        'statement':    sql,
        'wait_timeout': '50s',
        'disposition':  'INLINE',
        'format':       'JSON_ARRAY',
    })

    # Poll se ainda rodando
    statement_id = result.get('statement_id')
    while result.get('status', {}).get('state') in ('PENDING', 'RUNNING'):
        print('  -> Aguardando Databricks...')
        time.sleep(4)
        result = _db_request(f'/api/2.0/sql/statements/{statement_id}')

    state = result.get('status', {}).get('state')
    if state != 'SUCCEEDED':
        err = result.get('status', {}).get('error', {})
        raise RuntimeError(f"Query falhou ({state}): {err.get('message', '')}")

    schema  = result.get('manifest', {}).get('schema', {})
    columns = [c['name'] for c in schema.get('columns', [])]
    rows    = result.get('result', {}).get('data_array', []) or []

    # Paginar se necessário
    next_chunk = result.get('result', {}).get('next_chunk_index')
    while next_chunk is not None:
        chunk      = _db_request(f'/api/2.0/sql/statements/{statement_id}/result/chunks/{next_chunk}')
        rows      += chunk.get('data_array', []) or []
        next_chunk = chunk.get('next_chunk_index')

    print(f'  -> {len(rows)} linhas')
    return [dict(zip(columns, [str(v) if v is not None else '' for v in row])) for row in rows]

# ─── Utilitários ───────────────────────────────────────────────────────────────

def parse_date(val):
    if not val or str(val).strip() in ('', 'null', 'None', 'nan'):
        return None
    val = str(val).strip()[:10]
    try:
        return datetime.strptime(val, '%Y-%m-%d').date()
    except:
        return None

def safe(val):
    if val is None:
        return ''
    s = str(val).strip()
    return '' if s in ('nan', 'None', 'null') else s

def first_name_from_list(val):
    if not val:
        return ''
    cleaned = re.sub(r'[\[\]"\'\\]', '', str(val))
    names   = [n.strip() for n in cleaned.split(',') if n.strip()]
    return names[0] if names else ''

def parse_npf_keys(val):
    """
    Extrai o primeiro NP&F key de strings como '["PNPF-1234"]' ou 'PNPF-1234'.
    Retorna '' se vazio.
    """
    if not val or str(val).strip() in ('', '[]', 'null', 'None'):
        return ''
    cleaned = re.sub(r'[\[\]"\'\\]', '', str(val))
    keys    = [k.strip() for k in cleaned.split(',') if k.strip()]
    return keys[0] if keys else ''

def to_csv_string(rows, fieldnames):
    out    = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fieldnames, extrasaction='ignore',
                            quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return out.getvalue()

# ─── Mapeamento de pessoas ─────────────────────────────────────────────────────

def normalize_ba(ba):
    """Normaliza aliases de Business Area para o nome canônico."""
    return BA_ALIASES.get(ba, ba)

def build_people_mapping(people_rows):
    mapping = {}
    for row in people_rows:
        name = safe(row.get('name', ''))
        bu   = safe(row.get('bu', 'TBD'))
        ba   = safe(row.get('ba', 'TBD'))
        if name:
            mapping[name.lower()] = {'bu': bu, 'ba': ba}
    return mapping

def lookup_person(name, people_map):
    if not name:
        return 'TBD', 'TBD'
    key = name.strip().lower()
    if key in people_map:
        m = people_map[key]
        return m['bu'], m['ba']
    # Tenta match por primeiro + último nome
    parts_n = key.split()
    for k, v in people_map.items():
        parts_k = k.split()
        if parts_k and parts_n and parts_k[0] == parts_n[0] and parts_k[-1] == parts_n[-1]:
            return v['bu'], v['ba']
    return 'TBD', 'TBD'

def read_people_mapping():
    path = os.path.join(CONFIG_DIR, 'people_mapping.csv')
    if not os.path.exists(path):
        print(f'AVISO: {path} não encontrado. BU/BA ficará TBD.')
        return {}
    rows = []
    with open(path, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            rows.append(dict(row))
    return build_people_mapping(rows)

def enrich_people_map_from_org(people_map, issues_rows, ap_rows):
    """
    Busca Business Area (level 6) e BU para TODOS os funcionários ativos do Mantiqueira.
    Constrói mapeamento por email e por unique_name para cobrir 100% dos assignees
    de issues e APs, independente de BU. Atualiza people_map in-place.

    Retorna name_to_email (dict lowercase name → email) construído com dados
    de issues (responsible/accountable) + Mantiqueira (todos funcionários ativos).
    """
    # 1. Coleta todos os nomes que aparecem no dado (issues + APs)
    all_names = set()
    name_to_email = {}
    for row in issues_rows:
        for nk, ek in (('responsible_name', 'responsible_email'),
                       ('accountable_name', 'accountable_email')):
            n = safe(row.get(nk, ''))
            e = safe(row.get(ek, ''))
            if n:
                all_names.add(n)
                if e:
                    name_to_email[n.lower()] = e
        for f in ('reporter_name',):
            n = safe(row.get(f, ''))
            if n:
                all_names.add(n)
    for row in ap_rows:
        for n in re.sub(r'[\[\]"\'\\]', '', safe(row.get('ap_assignee_name', ''))).split(','):
            n = n.strip()
            if n:
                all_names.add(n)

    missing_names = {n for n in all_names if n.lower() not in people_map}
    if not missing_names:
        return name_to_email

    # 2. Busca org_level_6 de TODOS os funcionários ativos do Mantiqueira de uma vez
    #    (não filtra por email — cobre assignees de qualquer BU)
    print(f'[generate_report] Buscando Business Area (Mantiqueira level 6) para {len(missing_names)} pessoas...')
    try:
        org_rows = db_run_query(
            """
            SELECT i.ident__email,
                   i.ident__unique_name,
                   o.org_level_6  AS business_area_name,
                   o.org_level_5  AS business_unit_name
            FROM etl.ist__contract.mantiqueira__idents i
            JOIN etl.br__series_contract.mantiqueira_group_org_chart_levels o
              ON array_contains(o.group__members, i.ident__id)
             AND o.reference_date = (
                   SELECT MAX(reference_date)
                   FROM etl.br__series_contract.mantiqueira_group_org_chart_levels
                 )
            WHERE i.ident__status = 'ident_status__active'
              AND i.ident__type   = 'ident_type__employee'
              AND o.org_level_6   IS NOT NULL
            """
        )
    except Exception as e:
        print(f'  AVISO: falha ao buscar Mantiqueira: {e}')
        return name_to_email

    # 3. Constrói lookup por email e por unique_name (ex: "jessica.paul")
    email_to_org    = {}
    uname_to_org    = {}
    uname_to_email  = {}
    for row in org_rows:
        email = safe(row.get('ident__email', ''))
        uname = safe(row.get('ident__unique_name', ''))
        bu    = normalize_ba(safe(row.get('business_unit_name', '')) or 'TBD')
        ba    = normalize_ba(safe(row.get('business_area_name', '')) or 'TBD')
        if email:
            email_to_org[email.lower()] = {'bu': bu, 'ba': ba}
        if uname:
            uname_to_org[uname.lower()] = {'bu': bu, 'ba': ba}
            if email:
                uname_to_email[uname.lower()] = email

    # 4. Para cada nome faltante, tenta email direto → unique_name derivado → fallback
    found = 0
    for name in missing_names:
        org = None
        # Tenta pelo email já conhecido
        email = name_to_email.get(name.lower(), '')
        if email:
            org = email_to_org.get(email.lower())
        # Tenta derivar unique_name a partir do display_name ("Jessica Paul" → "jessica.paul")
        if not org:
            derived = name.lower().replace(' ', '.')
            org = uname_to_org.get(derived)
        if org:
            people_map[name.lower()] = org
            found += 1

    # 5. Para TODOS os nomes (não só missing), tenta preencher name_to_email via unique_name
    for name in all_names:
        if name.lower() in name_to_email:
            continue
        derived = name.lower().replace(' ', '.')
        email   = uname_to_email.get(derived)
        if email:
            name_to_email[name.lower()] = email

    print(f'  -> {found}/{len(missing_names)} pessoas enriquecidas via Mantiqueira (org_level_6)')
    return name_to_email

# ─── Lógica de AP ─────────────────────────────────────────────────────────────

STATUS_PRIORITY = {
    'Late': 0,
    'Pending Approval (late)': 1,
    'Pending Validation (late)': 2,
    'In Validation': 3,
    'Pending Approval': 4,
    'Pending Validation': 5,
    'On Track': 6,
}

def build_ap_index(ap_rows):
    """Índice {issue_code: [ap_row, ...]} usando os últimos 7 chars da issue_link_projac."""
    index = {}
    for row in ap_rows:
        link = safe(row.get('issue_link_projac', ''))
        code = link[-7:] if len(link) >= 7 else link.split('/')[-1]
        if code:
            index.setdefault(code, []).append(row)
    return index

def best_ap(ap_list):
    def priority(row):
        status  = safe(row.get('ap_status', ''))
        p       = STATUS_PRIORITY.get(status, 99)
        due     = parse_date(row.get('ap_due_date_at', ''))
        due_ord = due.toordinal() if due else 99999
        return (p, due_ord)
    return min(ap_list, key=priority)

def get_bco_name():
    return BCO_NAMES[0]

def compute_action_issue(ap_status, ap_due_date_str, ap_assignee_raw,
                         origin, responsible_name, reporter_name, today):
    ap_status = safe(ap_status)
    assignee  = first_name_from_list(ap_assignee_raw) or safe(ap_assignee_raw)

    if not ap_status or ap_status in ('#N/A', 'TBD', 'nan', ''):
        return 'Create AP', safe(responsible_name)

    if ap_status == 'Late':
        return 'AP Late: Replan/Complete AP', assignee

    if ap_status in ('Pending Approval', 'Pending Approval (late)'):
        action = 'Complete AP Pending Approval'
        if safe(origin) == 'Self-Identified':
            return action, get_bco_name()
        return action, safe(reporter_name)

    if ap_status in ('Pending Validation', 'Pending Validation (late)', 'In Validation'):
        action = 'Complete AP Pending Validation'
        if safe(origin) == 'Self-Identified':
            return action, get_bco_name()
        return action, safe(reporter_name)

    if ap_status == 'On Track':
        due = parse_date(ap_due_date_str)
        if due and (due - today).days <= ALERT_WINDOW_DAYS:
            return 'AP will overdue < 2 weeks', assignee
        return 'AP On Track: Complete Before Due Date', assignee

    return '-', '-'

def compute_action_ap(ap_status, issue_origin, issue_reporter,
                      ap_assignee_raw, ap_due_date_str, today):
    ap_status = safe(ap_status)
    assignee  = first_name_from_list(ap_assignee_raw) or safe(ap_assignee_raw)

    if ap_status == 'In Validation':
        action = 'Complete AP Pending Validation'
        if safe(issue_origin) == 'Self-Identified':
            return action, get_bco_name()
        return action, safe(issue_reporter)

    if ap_status == 'Late':
        return 'AP Late: Replan/Complete AP', assignee

    if ap_status in ('Pending Approval', 'Pending Approval (late)'):
        action = 'Complete AP Pending Approval'
        if safe(issue_origin) == 'Self-Identified':
            return action, get_bco_name()
        return action, safe(issue_reporter)

    if ap_status in ('Pending Validation', 'Pending Validation (late)'):
        action = 'Complete AP Pending Validation'
        if safe(issue_origin) == 'Self-Identified':
            return action, get_bco_name()
        return action, safe(issue_reporter)

    if ap_status == 'On Track':
        due = parse_date(ap_due_date_str)
        if due and (due - today).days <= ALERT_WINDOW_DAYS:
            return 'AP will overdue < 2 weeks', assignee
        return 'AP On Track: Complete Before Due Date', assignee

    return '-', '-'

# ─── TTR ──────────────────────────────────────────────────────────────────────

def compute_ttr(issues_rows):
    """
    Calcula Time to Remediate para issues fechadas (Done/Completed) dos últimos
    6 meses com rating High ou Very High, para Global Lending.
    Retorna dict com avg_days_high, avg_days_very_high e monthly breakdown.
    """
    from datetime import date as _date, timedelta as _td
    CLOSED = {'Done', 'Completed'}
    HVH    = {'High', 'Very High'}
    GL_MACROPROCESSES = {'Global Lending', 'Secured Loans', 'Lending'}
    cutoff = _date.today() - _td(days=183)  # ~6 meses

    records = []
    for row in issues_rows:
        status  = safe(row.get('status', ''))
        rating  = safe(row.get('overall_risk_rating', ''))
        if status not in CLOSED or rating not in HVH:
            continue
        macroprocess   = safe(row.get('process_journey_macroprocess__name', ''))
        business_units = safe(row.get('business_units', ''))
        if macroprocess not in GL_MACROPROCESSES and 'Global Lending' not in business_units:
            continue
        try:
            completed = _date.fromisoformat(str(row.get('completed_at', ''))[:10])
            created   = _date.fromisoformat(str(row.get('created_at', ''))[:10])
        except (ValueError, TypeError):
            continue
        if completed < cutoff:
            continue
        days = (completed - created).days
        month = completed.strftime('%Y-%m')
        records.append({'rating': rating, 'days': days, 'month': month})

    if not records:
        return {'avg_high': None, 'avg_very_high': None, 'monthly': []}

    high_days = [r['days'] for r in records if r['rating'] == 'High']
    vh_days   = [r['days'] for r in records if r['rating'] == 'Very High']

    # Breakdown mensal: avg TTR por mês (H e VH combinados)
    from collections import defaultdict
    monthly = defaultdict(list)
    for r in records:
        monthly[r['month']].append(r['days'])
    monthly_list = sorted(
        [{'month': m, 'avg_days': round(sum(v)/len(v), 1), 'count': len(v)}
         for m, v in monthly.items()],
        key=lambda x: x['month']
    )

    return {
        'avg_high':      round(sum(high_days)/len(high_days), 1) if high_days else None,
        'count_high':    len(high_days),
        'avg_very_high': round(sum(vh_days)/len(vh_days), 1) if vh_days else None,
        'count_very_high': len(vh_days),
        'monthly':       monthly_list,
    }

# ─── Pipeline principal ────────────────────────────────────────────────────────

def run():
    today = datetime.today().date()
    print(f'[generate_report] Data de referência: {today}')

    # Validar credenciais
    if not DATABRICKS_HOST or not DATABRICKS_TOKEN or not DATABRICKS_WAREHOUSE_ID:
        print('ERRO: Credenciais do Databricks não configuradas.')
        print('  Crie o arquivo .env na raiz com:')
        print('    DATABRICKS_HOST=https://...')
        print('    DATABRICKS_TOKEN=dapi...')
        print('    DATABRICKS_WAREHOUSE_ID=...')
        sys.exit(1)

    people_map = read_people_mapping()

    # ── 1. Buscar Issues ──────────────────────────────────────────────────────
    print('[generate_report] Buscando Issues no Databricks...')
    issues_rows = db_run_query(QUERY_ISSUES)

    # ── 2. Buscar Action Plans ────────────────────────────────────────────────
    print('[generate_report] Buscando Action Plans no Databricks...')
    ap_rows = db_run_query(QUERY_APS)

    # Filtra APs com status terminal antes de indexar
    TERMINAL_AP_STATUSES = {'Cancelled', 'Done', 'Completed', 'Not Approved'}
    ap_rows = [r for r in ap_rows if safe(r.get('ap_status', '')) not in TERMINAL_AP_STATUSES]

    ap_index = build_ap_index(ap_rows)

    # ── 3. Auto-enriquecer mapeamento de pessoas via org structure ────────────
    name_to_email = enrich_people_map_from_org(people_map, issues_rows, ap_rows) or {}

    # ── 3b. Calcular TTR (Time to Remediate) para issues fechadas H/VH ──────────
    ttr_data = compute_ttr(issues_rows)

    # ── 4. Enriquecer Issues ──────────────────────────────────────────────────
    print('[generate_report] Enriquecendo Issues...')
    tbd_people = set()

    ISSUES_FIELDS = [
        'Type', 'code', 'NP&F+', 'projac_link', 'key', 'status', 'summary', 'description',
        'countries', 'reporter_name', 'squad_reporter', 'created_at', 'updated_at',
        'due_date_at', 'completed_at', 'responsible_email', 'accountable_email',
        'process_journey_macroprocess__name', 'overall_risk_rating', 'origin',
        'subcategory', 'residual_risk_level', 'responsible_name', 'accountable_name',
        'business_units', 'Action', 'Action Owner', 'Action Owner Email',
        'Action Pending From', 'Business Area',
    ]

    TERMINAL_ISSUE_STATUSES = {'Risk Accepted', 'Cancelled', 'Done', 'Completed'}

    # Filtro Global Lending aplicado no output (queries trazem tudo para enriquecer Mantiqueira)
    GL_MACROPROCESSES = {'Global Lending', 'Secured Loans', 'Lending'}
    GL_AP_BUS         = {'Global Lending', 'Secured Loans'}

    issues_output = []
    for row in issues_rows:
        # Exclui issues com status terminal
        issue_status = safe(row.get('status', ''))
        if issue_status in TERMINAL_ISSUE_STATUSES:
            continue

        # Filtra para Global Lending no output — usa business_units (Treatment field)
        business_units = safe(row.get('business_units', ''))
        if 'Global Lending' not in business_units:
            continue

        code = safe(row.get('code', ''))

        # Exclusão manual
        if code in EXCLUDED_ISSUES:
            continue

        # Type + NP&F+ (usando npf_keys direto da tabela)
        npf_key  = parse_npf_keys(row.get('npf_keys', ''))
        if npf_key:
            issue_type = 'Potential Issue'
            npf_link   = NPF_BASE_URL + npf_key
        else:
            issue_type = 'Issue'
            npf_link   = '-'

        origin   = safe(row.get('origin', ''))
        reporter = safe(row.get('reporter_name', ''))

        # Prioridade: status do issue determina a ação antes de consultar APs
        if issue_status == 'TBD':
            action       = 'Create AP'
            action_owner = safe(row.get('responsible_name', ''))
        elif issue_status in ('In Validation', 'Pending Validation', 'Pending Validation (late)'):
            action = 'Complete AP Pending Validation'
            if origin == 'Self-Identified':
                action_owner = get_bco_name()
            else:
                action_owner = reporter
        elif issue_status in ('Pending Approval', 'Pending Approval (late)'):
            action = 'Complete AP Pending Approval'
            if origin == 'Self-Identified':
                action_owner = get_bco_name()
            else:
                action_owner = reporter
        else:
            # AP mais urgente
            ap_list = ap_index.get(code, [])
            if ap_list:
                best        = best_ap(ap_list)
                ap_status   = safe(best.get('ap_status', ''))
                ap_assignee = safe(best.get('ap_assignee_name', ''))
                ap_due      = safe(best.get('ap_due_date_at', ''))
            else:
                ap_status, ap_assignee, ap_due = '', '', ''

            action, action_owner = compute_action_issue(
                ap_status, ap_due, ap_assignee,
                origin,
                safe(row.get('responsible_name', '')),
                reporter,
                today,
            )

        primary_owner = first_name_from_list(action_owner) or action_owner
        # BA always comes from the Issue Responsible
        responsible = safe(row.get('responsible_name', ''))
        bu, ba = lookup_person(responsible, people_map)
        if bu == 'TBD' and responsible not in ('-', ''):
            tbd_people.add(responsible)

        out = {k: safe(row.get(k, '')) for k in ISSUES_FIELDS}
        out['Type']                = issue_type
        out['NP&F+']               = npf_link
        out['Action']              = action
        out['Action Owner']        = action_owner
        out['Action Owner Email']  = name_to_email.get(primary_owner.lower(), '')
        out['Action Pending From'] = bu
        out['Business Area']       = normalize_ba(ba)
        issues_output.append(out)

    # ── 5. Enriquecer Action Plans ─────────────────────────────────────────────
    print('[generate_report] Enriquecendo Action Plans...')

    APS_FIELDS = [
        'ap_code', 'ap_link_projac', 'ap_status', 'ap_country', 'issue_link_projac',
        'Issue Code', 'Type', 'issue rating', 'issue_status', 'issue_summary',
        'issue_due_date_at', 'issue_subcategory', 'ap_summary', 'ap_created_at',
        'ap_due_date_at', 'ap_business_unit', 'ap_assignee_name',
        'Action', 'Action Owner', 'Action Owner Email',
        'Action Pending From', 'Business Area',
    ]

    issues_by_code = {safe(r.get('code', '')): r for r in issues_rows}

    aps_output = []
    for row in ap_rows:  # ap_rows já foi filtrado acima (sem Cancelled/Done)
        # Filtra para Global Lending no output
        ap_bu = safe(row.get('ap_business_unit', ''))
        if ap_bu not in GL_AP_BUS:
            continue

        # Exclusão manual
        if safe(row.get('ap_code', '')) in EXCLUDED_APS:
            continue

        issue_link = safe(row.get('issue_link_projac', ''))
        issue_code = issue_link[-7:] if len(issue_link) >= 7 else issue_link.split('/')[-1]

        # Usa campos do issue direto da query (resolve o problema de issues em outras BUs)
        issue_origin   = safe(row.get('issue_origin', ''))
        issue_reporter = safe(row.get('issue_reporter_name', ''))
        issue_rating   = safe(row.get('issue_risk_rating', ''))
        issue_code_raw = safe(row.get('issue_code_raw', ''))

        # Fallback para issues_by_code se campos vieram vazios
        if not issue_origin or not issue_reporter:
            parent = issues_by_code.get(issue_code_raw or issue_code, {})
            issue_origin   = issue_origin   or safe(parent.get('origin', ''))
            issue_reporter = issue_reporter or safe(parent.get('reporter_name', ''))
            issue_rating   = issue_rating   or safe(parent.get('overall_risk_rating', ''))

        npf_key    = parse_npf_keys(row.get('issue_npf_keys_raw', ''))
        issue_type = 'Potential Issue' if npf_key else 'Issue'

        issue_code_col = issue_code_raw or (f"I{issue_link[-6:]}" if issue_link else issue_code)

        ap_status   = safe(row.get('ap_status', ''))
        ap_assignee = safe(row.get('ap_assignee_name', ''))
        ap_due      = safe(row.get('ap_due_date_at', ''))

        action, action_owner = compute_action_ap(
            ap_status, issue_origin, issue_reporter, ap_assignee, ap_due, today
        )

        primary_owner = first_name_from_list(action_owner) or action_owner
        bu, ba = lookup_person(primary_owner, people_map)
        # Fallback: ap_assignee_name (já é o primary, mas tenta reporter como último recurso)
        if bu == 'TBD':
            reporter_fb = safe(row.get('issue_reporter_name', ''))
            if reporter_fb:
                bu, ba = lookup_person(reporter_fb, people_map)
        if bu == 'TBD' and primary_owner not in ('-', ''):
            tbd_people.add(primary_owner)

        out = {k: safe(row.get(k, '')) for k in APS_FIELDS}
        out['Issue Code']          = issue_code_col
        out['Type']                = issue_type
        out['issue rating']        = issue_rating
        out['Action']              = action
        out['Action Owner']        = action_owner
        out['Action Owner Email']  = name_to_email.get(primary_owner.lower(), '')
        out['Action Pending From'] = bu
        out['Business Area']       = normalize_ba(ba)
        aps_output.append(out)

    # ── 6. Alertas de mapeamento incompleto ────────────────────────────────────
    if tbd_people:
        print(f'\nAVISO: {len(tbd_people)} pessoa(s) sem BU/BA no mapeamento:')
        for p in sorted(tbd_people):
            print(f'  -> {p}')
        print(f'  Adicione em: data/config/people_mapping.csv\n')

    # ── 7. Excluir itens sem Business Area resolvida ───────────────────────────
    before_i = len(issues_output)
    before_a = len(aps_output)
    issues_output = [r for r in issues_output if r.get('Business Area', 'TBD') != 'TBD']
    aps_output    = [r for r in aps_output    if r.get('Business Area', 'TBD') != 'TBD']
    if before_i - len(issues_output) or before_a - len(aps_output):
        print(f'  Issues excluídos (BA=TBD): {before_i - len(issues_output)}')
        print(f'  APs excluídos    (BA=TBD): {before_a - len(aps_output)}')

    # ── 8. Gerar strings CSV ───────────────────────────────────────────────────
    issues_csv_str = to_csv_string(issues_output, ISSUES_FIELDS)
    aps_csv_str    = to_csv_string(aps_output, APS_FIELDS)

    # ── 9. Injetar no template HTML ────────────────────────────────────────────
    template_path = os.path.join(TEMPLATE_DIR, 'dashboard_template.html')
    if not os.path.exists(template_path):
        print(f'ERRO: template não encontrado: {template_path}')
        sys.exit(1)

    with open(template_path, 'r', encoding='utf-8') as f:
        html = f.read()

    # Escapa backticks para não quebrar o template literal JS
    html = html.replace('%%ISSUES_CSV%%', issues_csv_str.replace('`', '\\`'))
    html = html.replace('%%APS_CSV%%',    aps_csv_str.replace('`', '\\`'))
    html = html.replace('%%GENERATED_AT%%', datetime.now().strftime('%Y-%m-%d %H:%M'))

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_path = os.path.join(OUTPUT_DIR, 'index.html')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    # Gera apps_script/index.html para deploy no Google Apps Script
    _write_apps_script(html)

    # Gera data.json para o app React (SteerCo)
    _write_steerco_data(issues_csv_str, aps_csv_str, ttr_data, datetime.now().strftime('%Y-%m-%d %H:%M'))

    # Envia para o Slack (pode pular com --no-slack)
    generated_at_str = datetime.now().strftime('%Y-%m-%d %H:%M')
    if '--no-slack' not in sys.argv:
        send_to_slack(output_path, generated_at_str, issues_output, aps_output)
    else:
        print('  [--no-slack] Envio para o Slack ignorado.')

    print(f'\n✓ Dashboard gerado: {output_path}')
    print(f'  Issues processados : {len(issues_output)}')
    print(f'  APs processados    : {len(aps_output)}')
    print(f'\nAbra o arquivo no navegador:')
    print(f'  open {output_path}')

def _write_apps_script(html):
    """Copia o HTML gerado para apps_script/index.html para deploy no Apps Script."""
    apps_dir = os.path.join(BASE_DIR, 'apps_script')
    os.makedirs(apps_dir, exist_ok=True)
    index_path = os.path.join(apps_dir, 'index.html')
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'  apps_script/index.html atualizado: {len(html.encode()) // 1024} KB')

def _write_steerco_data(issues_csv, aps_csv, ttr_data, generated_at):
    """Gera steerco/public/data.json para o app React."""
    steerco_public = os.path.join(BASE_DIR, 'steerco', 'public')
    os.makedirs(steerco_public, exist_ok=True)
    data = {
        'generated_at': generated_at,
        'issues_csv':   issues_csv,
        'aps_csv':      aps_csv,
        'ttr':          ttr_data,
    }
    path = os.path.join(steerco_public, 'data.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f'  steerco/public/data.json gerado: {len(json.dumps(data).encode()) // 1024} KB')

def _slack_post(token, channel, text, thread_ts=None):
    """Posta uma mensagem de texto no canal Slack (opcionalmente em thread)."""
    body = {'channel': channel, 'text': text}
    if thread_ts:
        body['thread_ts'] = thread_ts
    payload = json.dumps(body).encode()
    req = urllib.request.Request('https://slack.com/api/chat.postMessage',
                                 data=payload, method='POST')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _load_slack_user_cache():
    if not os.path.exists(SLACK_USER_CACHE_PATH):
        return {}
    try:
        with open(SLACK_USER_CACHE_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save_slack_user_cache(cache):
    os.makedirs(os.path.dirname(SLACK_USER_CACHE_PATH), exist_ok=True)
    with open(SLACK_USER_CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2, sort_keys=True)


def _slack_lookup_by_email(token, email):
    """Busca user_id do Slack pelo email. Retorna '' se não achou."""
    import urllib.parse
    url = 'https://slack.com/api/users.lookupByEmail?' + urllib.parse.urlencode({'email': email})
    req = urllib.request.Request(url, method='GET')
    req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.loads(r.read())
    except Exception:
        return ''
    if resp.get('ok'):
        return safe(resp.get('user', {}).get('id', ''))
    return ''


def resolve_slack_user_ids(emails, token):
    """Resolve Slack user IDs para um conjunto de emails. Usa cache em data/config/slack_user_ids.json."""
    cache  = _load_slack_user_cache()
    unique = {e.lower() for e in emails if e}
    missing = sorted(unique - set(cache.keys()))
    if not missing:
        return cache
    if not token:
        return cache
    print(f'[generate_report] Resolvendo {len(missing)} novo(s) Slack user ID(s)...')
    new = 0
    for email in missing:
        uid = _slack_lookup_by_email(token, email)
        cache[email] = uid  # '' marca como "buscado e não achou" pra não tentar de novo
        if uid:
            new += 1
    _save_slack_user_cache(cache)
    print(f'  -> {new}/{len(missing)} resolvidos (cache salvo)')
    return cache


def _load_slack_name_overrides():
    if not os.path.exists(SLACK_NAME_OVERRIDE_PATH):
        return {}
    try:
        with open(SLACK_NAME_OVERRIDE_PATH, encoding='utf-8') as f:
            data = json.load(f)
        # Remove campos de comentário (chaves começando com _)
        return {k.lower(): v for k, v in data.items() if v and not k.startswith('_')}
    except Exception:
        return {}


def _slack_mention(name, email, slack_cache, name_overrides=None):
    """Retorna <@USER_ID|Nome> se temos user_id; tenta email, depois nome (override). Senão só o nome."""
    if email and slack_cache.get(email.lower()):
        return f'<@{slack_cache[email.lower()]}|{name}>'
    if name_overrides and name and name_overrides.get(name.lower()):
        return f'<@{name_overrides[name.lower()]}|{name}>'
    return name


def _build_late_section(issues_output, aps_output, slack_cache, name_overrides=None):
    """
    Seção 1 do reply: itens já late (AP Late: Replan/Complete AP).
    Formato simples, uma linha por item com @mention do owner.
    """
    late_items = []  # [(label, code, link, name, email), ...]

    for row in issues_output:
        if row.get('Action') != 'AP Late: Replan/Complete AP':
            continue
        code  = safe(row.get('code', ''))
        link  = safe(row.get('projac_link', ''))
        label = 'Potential Issue' if row.get('Type') == 'Potential Issue' else 'Issue'
        owner = safe(row.get('Action Owner', ''))
        email = safe(row.get('Action Owner Email', ''))
        full  = first_name_from_list(owner) or owner
        late_items.append((label, code, link, full, email))

    for row in aps_output:
        if row.get('Action') != 'AP Late: Replan/Complete AP':
            continue
        code  = safe(row.get('ap_code', ''))
        link  = safe(row.get('ap_link_projac', ''))
        owner = safe(row.get('Action Owner', ''))
        email = safe(row.get('Action Owner Email', ''))
        full  = first_name_from_list(owner) or owner
        late_items.append(('AP', code, link, full, email))

    lines = ['*Late Issues & APs —*']
    if not late_items:
        lines.append('No late items this week! :clap:')
        return '\n'.join(lines)

    for label, code, link, name, email in late_items:
        item_link = f'<{link}|{code}>' if link else code
        mention   = _slack_mention(name, email, slack_cache, name_overrides) if name else ''
        suffix    = f' — {mention}' if mention else ''
        lines.append(f'• {label} {item_link}{suffix}')
    return '\n'.join(lines)


def _build_action_sections(issues_output, aps_output, slack_cache, name_overrides=None):
    """
    Retorna lista de seções de ações pendentes (uma por tipo de ação),
    cada uma já formatada como bloco de texto pronto para postar.
    Retorna [] se não houver nenhuma ação pendente.
    """
    from collections import defaultdict

    # "AP On Track: Complete Before Due Date" é intencionalmente omitido do post
    # semanal — muito ruidoso, não acionável. Continua disponível no dashboard.
    ACTION_ORDER = [
        'Create AP',
        'Complete AP Pending Approval',
        'Complete AP Pending Validation',
        'AP will overdue < 2 weeks',
    ]

    # action → { owner_key: {'name': str, 'email': str, 'items': [(code, link), ...]} }
    actions = defaultdict(dict)

    for row in list(issues_output) + list(aps_output):
        action = safe(row.get('Action', ''))
        owner  = safe(row.get('Action Owner', ''))
        email  = safe(row.get('Action Owner Email', ''))
        if not action or action == '-' or not owner or owner == '-':
            continue
        if action not in ACTION_ORDER:
            continue
        full      = first_name_from_list(owner) or owner
        owner_key = full.lower()

        if 'ap_code' in row and safe(row.get('ap_code', '')) not in ('-', ''):
            code = safe(row.get('ap_code', ''))
            link = safe(row.get('ap_link_projac', ''))
        else:
            code = safe(row.get('code', ''))
            link = safe(row.get('projac_link', ''))

        entry = actions[action].setdefault(owner_key, {'name': full, 'email': email, 'items': []})
        if code and code != '-':
            item = (code, link) if link and link != '-' else (code, '')
            if item not in entry['items']:
                entry['items'].append(item)

    sections = []
    for action in ACTION_ORDER:
        if action not in actions:
            continue
        lines = [f'*{action}*']
        for owner_data in actions[action].values():
            mention = _slack_mention(owner_data['name'], owner_data['email'], slack_cache, name_overrides)
            items   = owner_data['items']
            if items:
                links_str = ', '.join(
                    f'<{lnk}|{cd}>' if lnk else cd
                    for cd, lnk in items
                )
                lines.append(f'• {mention} — {links_str}')
            else:
                lines.append(f'• {mention}')
        sections.append('\n'.join(lines))
    return sections


def _collect_action_owner_emails(issues_output, aps_output):
    """Coleta todos os emails distintos de Action Owner para resolver Slack IDs em batch."""
    emails = set()
    for row in list(issues_output) + list(aps_output):
        e = safe(row.get('Action Owner Email', ''))
        if e:
            emails.add(e.lower())
    return emails


def send_to_slack(html_path, generated_at, issues_output=None, aps_output=None):
    """Envia o dashboard HTML para o canal Slack configurado."""
    token   = os.environ.get('SLACK_TOKEN', '')
    channel = os.environ.get('SLACK_CHANNEL', '')
    if not token or not channel:
        print('  AVISO: SLACK_TOKEN ou SLACK_CHANNEL não configurados. Pulando envio.')
        return

    if issues_output is None or aps_output is None:
        print('  AVISO: issues_output/aps_output vazios. Pulando envio.')
        return

    # 1. Resolve Slack user IDs em batch (com cache local) + overrides por nome
    emails          = _collect_action_owner_emails(issues_output, aps_output)
    slack_cache     = resolve_slack_user_ids(emails, token)
    name_overrides  = _load_slack_name_overrides()
    if name_overrides:
        print(f'  -> {len(name_overrides)} override(s) por nome carregado(s)')

    # 2. Monta título: "Issues/Action Plans As of - Jun 2nd"
    try:
        gen_dt = datetime.strptime(generated_at, '%Y-%m-%d %H:%M')
    except ValueError:
        gen_dt = datetime.now()

    def _day_suffix(d):
        if 10 <= d % 100 <= 20:
            return 'th'
        return {1: 'st', 2: 'nd', 3: 'rd'}.get(d % 10, 'th')

    title_date = gen_dt.strftime('%b ') + f'{gen_dt.day}{_day_suffix(gen_dt.day)}'
    parent_text = f'`Issues/Action Plans As of - {title_date}`'

    # 3. Posta parent message
    resp_parent = _slack_post(token, channel, parent_text)
    if not resp_parent.get('ok'):
        print(f'  ERRO Slack (parent): {resp_parent.get("error")}')
        return
    thread_ts = resp_parent.get('ts')
    print(f'  ✓ Parent enviado (canal {channel}, ts={thread_ts})')

    # 4. Posta uma reply por seção (evita quebra automática em mensagens grandes)
    late_section    = _build_late_section(issues_output, aps_output, slack_cache, name_overrides)
    action_sections = _build_action_sections(issues_output, aps_output, slack_cache, name_overrides)

    replies = [late_section] + action_sections + [f'<{DASHBOARD_URL}|Dashboard Issue>']

    for idx, text in enumerate(replies, 1):
        resp = _slack_post(token, channel, text, thread_ts=thread_ts)
        if resp.get('ok'):
            print(f'  ✓ Reply {idx}/{len(replies)} enviado')
        else:
            print(f'  ERRO Slack (reply {idx}): {resp.get("error")}')

if __name__ == '__main__':
    run()
