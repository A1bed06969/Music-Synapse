#!/usr/bin/env python3
"""出身地の座標を「都市」(place)にまとめ、アーティストを紐づける(Music Planet Tour)。
入力は scripts/collect-origin-reverse-geocode.py が集めた逆引きの結果(.cache/nominatim-reverse.jsonl)。

都市の決め方(同じ地点を zoom=10:市区 と zoom=8:都市圏・都道府県 の2つで引いてある):
  1. zoom=8 が city(Greater London、Paris、Berlin など、区に分かれた大都市) → それを都市とする
  2. 東京23区(zoom=10 の日本語名が「〜区」で、zoom=8 が東京都) → 東京
  3. zoom=10 が区・地区(Brooklyn、Manhattan など) → その住所の city(New York)。名前だけなので、Nominatimで前引きして日本語名などを補う
  4. zoom=10 が city/town/village/municipality/county → それを都市とする
  5. 州・国の中心の座標(都市が決まらない、または緯度経度がどちらも整数ちょうど) → 紐づけない
何度実行しても安全(既存の都市はそのまま使い、artist.origin_place_id を上書きする)。
実行: python3 scripts/build-origin-places.py [--dry-run]"""
import json, os, subprocess, sys, time, urllib.parse, urllib.request
DRY = '--dry-run' in sys.argv
ROOT = os.path.join(os.path.dirname(__file__), '..')
CACHE = os.path.join(ROOT, '.cache', 'nominatim-reverse.jsonl')
FWD_CACHE = os.path.join(ROOT, '.cache', 'nominatim-forward.json')
UA = 'music-synapse/1.0 (local research; a1bed069star@gmail.com)'
DISTRICT = {'city_district', 'suburb', 'borough', 'quarter', 'neighbourhood', 'district'}
CITYLIKE = {'city', 'town', 'village', 'municipality', 'county'}
# 都市圏としての名前を、ふだん呼ぶ名前に直す
RENAME = {'Greater London': ('London', 'ロンドン'), 'City of London': ('London', 'ロンドン'), 'Tokyo': ('Tokyo', '東京'), 'Berlin': ('Berlin', 'ベルリン')}

def psql(sql):
    return subprocess.check_output(['docker', 'exec', '-i', 'supabase_db_music-synapse', 'psql', '-U', 'postgres', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'], input=sql.encode()).decode()

def obj_place(res):
    nd = res.get('namedetails') or {}
    addr = res.get('address') or {}
    name = res.get('name') or nd.get('name:en') or nd.get('name')
    name_ja = nd.get('name:ja')
    if name in RENAME: name, name_ja = RENAME[name][0], RENAME[name][1] or name_ja
    return {'name': name, 'name_ja': name_ja, 'cc': addr.get('country_code'), 'admin': addr.get('state') or addr.get('province'),
            'lat': float(res['lat']), 'lng': float(res['lon']), 'osm_type': res.get('osm_type'), 'osm_id': res.get('osm_id'),
            'qid': (res.get('extratags') or {}).get('wikidata')}

fwd = json.load(open(FWD_CACHE)) if os.path.exists(FWD_CACHE) else {}
last = [0.0]
def forward(name, cc):
    key = f'{cc}:{name}'
    if key not in fwd:
        w = last[0] + 1.1 - time.time()
        if w > 0: time.sleep(w)
        last[0] = time.time()
        q = urllib.parse.urlencode({'q': name, 'countrycodes': cc, 'format': 'jsonv2', 'namedetails': 1, 'extratags': 1, 'addressdetails': 1, 'limit': 1, 'accept-language': 'en'})
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(f'https://nominatim.openstreetmap.org/search?{q}', headers={'User-Agent': UA}), timeout=30))
        except Exception:
            r = []
        fwd[key] = r[0] if r else None
        json.dump(fwd, open(FWD_CACHE, 'w'), ensure_ascii=False)
    return fwd[key]

points = {}
for line in open(CACHE):
    r = json.loads(line)
    points.setdefault((r['lat'], r['lng']), {})[r['zoom']] = r['res']

assign = {}  # (lat,lng) -> place dict
stats = {}
for pt, v in points.items():
    z10, z8 = v.get(10) or {}, v.get(8) or {}
    a10 = z10.get('address') or {}
    t10, t8 = z10.get('addresstype'), z8.get('addresstype')
    ja10 = (z10.get('namedetails') or {}).get('name:ja') or ''
    place, rule = None, None
    if t8 == 'city':
        place, rule = obj_place(z8), '1'
    elif a10.get('country_code') == 'jp' and z8.get('name') == 'Tokyo' and ja10.endswith('区'):
        place, rule = obj_place(z8), '2'
    elif t10 in DISTRICT and (a10.get('city') or a10.get('town')):
        cname = a10.get('city') or a10.get('town')
        f = forward(cname, a10.get('country_code'))
        if f and (f.get('addresstype') in CITYLIKE | {'city'}):
            place, rule = obj_place(f), '3'
        else:
            place = {'name': cname, 'name_ja': None, 'cc': a10.get('country_code'), 'admin': a10.get('state'), 'lat': pt[0], 'lng': pt[1], 'osm_type': None, 'osm_id': None, 'qid': None}
            rule = '3x'
    elif t10 in CITYLIKE:
        place, rule = obj_place(z10), '4'
    stats[rule] = stats.get(rule, 0) + 1
    if place and place['cc'] and place['name']:
        assign[pt] = place
print('rules', stats, 'assigned points', len(assign))

# 都市ごとにまとめる
places = {}
for pt, p in assign.items():
    key = (p['osm_type'], p['osm_id']) if p['osm_id'] else (p['cc'], p['name'])
    places.setdefault(key, p)
print('places', len(places))
if DRY:
    import collections
    cnt = collections.Counter()
    for pt, p in assign.items(): cnt[(p['name'], p['name_ja'], p['cc'])] += 1
    for k, n in cnt.most_common(40): print(n, k)
    sys.exit(0)

def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

sql = ['BEGIN;', 'CREATE TEMP TABLE pt_map (lat numeric, lng numeric, osm_type text, osm_id bigint, cc text, name text);']
for key, p in places.items():
    cols = f"{lit(p['name'])},{lit(p['name_ja'])},{lit(p['cc'])},{lit(p['admin'])},{lit(p['lat'])},{lit(p['lng'])},{lit(p['osm_type'])},{lit(p['osm_id'])},{lit(p['qid'])}"
    conflict = "(osm_type, osm_id) WHERE osm_id IS NOT NULL" if p['osm_id'] else "(country_code, name) WHERE osm_id IS NULL"
    sql.append(f"INSERT INTO place (name,name_ja,country_code,admin_name,latitude,longitude,osm_type,osm_id,wikidata_qid) VALUES ({cols}) ON CONFLICT {conflict} DO UPDATE SET name_ja = COALESCE(place.name_ja, EXCLUDED.name_ja), wikidata_qid = COALESCE(place.wikidata_qid, EXCLUDED.wikidata_qid);")
for pt, p in assign.items():
    sql.append(f"INSERT INTO pt_map VALUES ({pt[0]},{pt[1]},{lit(p['osm_type'])},{lit(p['osm_id'])},{lit(p['cc'])},{lit(p['name'])});")
sql.append("""UPDATE artist a SET origin_place_id = pl.id
FROM pt_map m JOIN place pl ON (m.osm_id IS NOT NULL AND pl.osm_type = m.osm_type AND pl.osm_id = m.osm_id) OR (m.osm_id IS NULL AND pl.osm_id IS NULL AND pl.country_code = m.cc AND pl.name = m.name)
WHERE a.origin_latitude IS NOT NULL AND round(a.origin_latitude::numeric, 2) = m.lat AND round(a.origin_longitude::numeric, 2) = m.lng
  AND NOT (a.origin_latitude = trunc(a.origin_latitude) AND a.origin_longitude = trunc(a.origin_longitude))
  AND a.origin_place_id IS DISTINCT FROM pl.id;""")
# 整数ちょうどの座標(35,136 など)は、国・州の中心として入った値で、都市ではないので紐づけない
sql.append("UPDATE artist SET origin_place_id = NULL WHERE origin_place_id IS NOT NULL AND origin_latitude = trunc(origin_latitude) AND origin_longitude = trunc(origin_longitude);")
sql.append("DELETE FROM place p WHERE NOT EXISTS (SELECT 1 FROM artist a WHERE a.origin_place_id = p.id);")
sql.append('COMMIT;')
sql.append("SELECT count(*) FROM place; SELECT count(*) FROM artist WHERE origin_place_id IS NOT NULL;")
print(psql('\n'.join(sql)))
