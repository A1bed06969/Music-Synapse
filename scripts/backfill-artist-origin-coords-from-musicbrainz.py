#!/usr/bin/env python3
"""座標のないアーティスト(MusicBrainzのIDあり)の出身地の座標を、MusicBrainz → Wikidata の順にたどって埋める。
  1. MusicBrainzのアーティストから、出身の街(begin-area。無ければ area)とその種類・IDを取る(1件/秒)
  2. その街(area)のWikidataのIDを、MusicBrainzのurl-relsから取る(街ごとに1回)
  3. WikidataのSPARQLで、街の座標(P625)をまとめて取る
  4. 街(City/Municipality/District)の座標だけ、artist.origin_latitude/longitude に入れる(既に座標のある人は触らない)。国・州の中心は入れない
都市(place)への紐づけは、毎日の自動実行(run-origin-places-daily.sh)か、手で実行すると反映される。
取得結果は .cache/mb-origin/ に残り、何度でも続きから再開できる。
実行: python3 scripts/backfill-artist-origin-coords-from-musicbrainz.py [--limit=N] [--dry-run]"""
import json, os, subprocess, sys, time
ROOT = os.path.join(os.path.dirname(__file__), '..')
C = os.path.join(ROOT, '.cache', 'mb-origin'); os.makedirs(C, exist_ok=True)
UA = 'music-synapse/1.0 (local research; a1bed069star@gmail.com)'
LIMIT = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--limit=')), '0'))
DRY = '--dry-run' in sys.argv
CITY_TYPES = {'City', 'Municipality', 'District', 'Island', 'Borough', 'County'}  # 郡(County)は広いので下で除く

def psql(sql):
    return subprocess.check_output(['docker', 'exec', '-i', 'supabase_db_music-synapse', 'psql', '-U', 'postgres', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1'], input=sql.encode()).decode()

last = [0.0]
def mb(path):
    for attempt in range(1, 7):
        w = last[0] + 1.3 - time.time()
        if w > 0: time.sleep(w)
        last[0] = time.time()
        r = subprocess.run(['curl', '-s', '-m', '40', '-A', UA, f'https://musicbrainz.org/ws/2/{path}'], capture_output=True)
        try:
            d = json.loads(r.stdout)
            if 'error' in d and ('rate' in d['error'].lower() or 'overload' in d['error'].lower()): raise ValueError('rate')
            return d
        except Exception:
            time.sleep(10 * attempt)
    return None

def load(name):
    f = os.path.join(C, name)
    return json.load(open(f)) if os.path.exists(f) else {}
def save(name, obj): json.dump(obj, open(os.path.join(C, name), 'w'), ensure_ascii=False)

# --- 1. アーティスト → 出身の街 ---
artists = [r.split('\t') for r in psql("select id, musicbrainz_id from artist where musicbrainz_id is not null and origin_latitude is null order by id").strip().split('\n') if r]
art = load('artists.json')
todo = [a for a in artists if a[1] not in art]
print(f'対象 {len(artists)}組 / 取得済み {len(artists) - len(todo)} / これから {len(todo)}', flush=True)
n = 0
for aid, mbid in todo:
    if LIMIT and n >= LIMIT: break
    d = mb(f'artist/{mbid}?fmt=json')
    n += 1
    if d is None: continue
    ba = d.get('begin-area') or {}
    ar = d.get('area') or {}
    pick = ba if ba.get('id') else ar
    art[mbid] = {'country': (d.get('country') or (ar.get('iso-3166-1-codes') or [None])[0]), 'area_id': pick.get('id'), 'area_name': pick.get('name'), 'area_type': pick.get('type')}
    if n % 100 == 0:
        save('artists.json', art); print(f'  [1] {n}/{len(todo)}', flush=True)
save('artists.json', art)

# --- 2. 街 → Wikidata ID ---
areas = load('areas.json')
need = sorted({v['area_id'] for v in art.values() if v.get('area_id') and v['area_id'] not in areas and (v.get('area_type') in CITY_TYPES or v.get('area_type') is None)})
print(f'街 {len(need)}か所のWikidata IDを引く', flush=True)
for i, aid in enumerate(need):
    if LIMIT and i >= LIMIT: break
    d = mb(f'area/{aid}?inc=url-rels&fmt=json')
    if d is None: continue
    qid = None
    for r in d.get('relations', []):
        u = r.get('url', {}).get('resource', '')
        if 'wikidata.org/wiki/Q' in u: qid = u.rsplit('/', 1)[1]
    areas[aid] = {'qid': qid, 'type': d.get('type'), 'name': d.get('name')}
    if i % 100 == 0:
        save('areas.json', areas); print(f'  [2] {i}/{len(need)}', flush=True)
save('areas.json', areas)

# --- 3. Wikidata → 座標 ---
coords = load('coords.json')
qids = sorted({a['qid'] for a in areas.values() if a.get('qid') and a['qid'] not in coords and a.get('type') in CITY_TYPES})
print(f'座標を引く {len(qids)}か所', flush=True)
for i in range(0, len(qids), 80):
    chunk = qids[i:i + 80]
    q = 'SELECT ?i ?c WHERE { VALUES ?i { ' + ' '.join('wd:' + x for x in chunk) + ' } ?i wdt:P625 ?c }'
    out = subprocess.run(['curl', '-s', '-m', '90', '-G', 'https://query.wikidata.org/sparql', '--data-urlencode', 'query=' + q, '-H', 'Accept: application/sparql-results+json', '-A', UA], capture_output=True).stdout
    try: res = json.loads(out)
    except Exception: time.sleep(20); continue
    for b in res['results']['bindings']:
        qid = b['i']['value'].rsplit('/', 1)[1]
        w = b['c']['value']  # Point(lng lat)
        lng, lat = w[w.index('(') + 1:-1].split()
        coords[qid] = [float(lat), float(lng)]
    for x in chunk: coords.setdefault(x, None)
    time.sleep(2)
save('coords.json', coords)

# --- 4. artist に反映 ---
upd = []
for aid, mbid in artists:
    v = art.get(mbid)
    if not v or not v.get('area_id'): continue
    a = areas.get(v['area_id'])
    if not a or a.get('type') not in CITY_TYPES or not a.get('qid'): continue
    c = coords.get(a['qid'])
    if not c: continue
    upd.append((aid, c[0], c[1], (v.get('country') or '').lower() or None))
print(f'座標を入れる: {len(upd)}組', flush=True)
if DRY or not upd: sys.exit(0)
sql = ['begin;']
for aid, la, lo, cc in upd:
    cc_sql = f"'{cc}'" if cc else 'NULL'
    sql.append(f"update artist set origin_latitude={la}, origin_longitude={lo}, origin_country_code=coalesce(origin_country_code,{cc_sql}) where id='{aid}' and origin_latitude is null;")
sql.append('commit;')
subprocess.run(['docker', 'exec', '-i', 'supabase_db_music-synapse', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input='\n'.join(sql).encode(), check=True, capture_output=True)
print('=== 反映完了', len(upd), flush=True)
