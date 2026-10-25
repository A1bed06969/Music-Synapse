#!/usr/bin/env python3
"""OpenStreetMap(Overpass API)から、ライブハウスとレコードショップを集めて livehouse / recordshop に入れる。
  ライブハウス: amenity=music_venue(+日本は、名前に「ライブハウス」「Live House」を含むもの)
  レコードショップ: shop=music
国ごとに1本ずつ(Overpassの負荷を抑えるため、間隔を空けて順番に)。取得結果は .cache/osm/ に残し、何度実行しても重複しない(OSMのIDで見分ける)。
データは ODbL(© OpenStreetMap contributors)。画面には出典を出す。
実行: python3 scripts/collect-osm-venues-shops.py [--countries=JP,US,...] [--dry-run]"""
import json, os, subprocess, sys, time, urllib.parse, urllib.request
ROOT = os.path.join(os.path.dirname(__file__), '..')
CACHE = os.path.join(ROOT, '.cache', 'osm'); os.makedirs(CACHE, exist_ok=True)
UA = 'music-synapse/1.0 (local research; a1bed069star@gmail.com)'
DRY = '--dry-run' in sys.argv
arg = next((a for a in sys.argv if a.startswith('--countries=')), None)

def psql(sql, inp=None):
    return subprocess.check_output(['docker', 'exec', '-i', 'supabase_db_music-synapse', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', *(['-c', sql] if inp is None else [])], input=inp.encode() if inp else None).decode()

if arg:
    countries = arg.split('=')[1].split(',')
else:
    rows = psql("select upper(origin_country_code) from artist where origin_country_code is not null and origin_country_code<>'' group by 1 order by count(*) desc").split()
    countries = list(dict.fromkeys(['JP'] + rows))

last = [0.0]
def overpass(query):
    for attempt in range(1, 6):
        w = last[0] + 8 - time.time()
        if w > 0: time.sleep(w)
        last[0] = time.time()
        try:
            # システムのPythonはOverpassとのTLS接続に失敗することがあるため、curlで取得する
            out = subprocess.run(['curl', '-s', '-m', '220', '-A', UA, '--data-urlencode', 'data=' + query, 'https://overpass-api.de/api/interpreter'], capture_output=True, check=True).stdout
            return json.loads(out)
        except Exception as e:
            print('  失敗', attempt, str(e)[:80], flush=True)
            time.sleep(30 * attempt)
    return None

def q(cc, kind):
    area = f'area["ISO3166-1"="{cc}"]->.a;'
    if kind == 'shop':
        body = 'nwr["shop"="music"](area.a);'
    else:
        body = 'nwr["amenity"="music_venue"](area.a);'
        if cc == 'JP': body += 'nwr["name"~"ライブハウス|Live ?House|LIVE ?HOUSE"]["amenity"!="music_venue"](area.a);'
    return f'[out:json][timeout:180];{area}({body});out tags center;'

def lit(v):
    if v is None or v == '': return 'NULL'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

def addr(t, cc):
    """住所を、国の書き方の順に組み立てる(日本: 〒・都道府県・市区町村・町名・番地・建物名・階 / ほか: 番地 通り, 市, 郵便番号)"""
    if cc == 'JP':
        parts = [t.get('addr:postcode'), t.get('addr:province') or t.get('addr:state'), t.get('addr:city'), t.get('addr:suburb'), t.get('addr:quarter'), t.get('addr:neighbourhood'),
                 t.get('addr:block_number'), t.get('addr:housenumber'), t.get('addr:place'), t.get('addr:floor')]
        s = ' '.join(p for p in parts if p)
    else:
        street = ' '.join(p for p in [t.get('addr:housenumber'), t.get('addr:street')] if p)
        parts = [street, t.get('addr:suburb'), t.get('addr:city'), t.get('addr:state') or t.get('addr:province'), t.get('addr:postcode')]
        s = ', '.join(p for p in parts if p)
    return s or t.get('addr:full')

def shop_name(t, cc):
    """ブランド名だけのもの(タワーレコードなど)に、OpenStreetMapの支店名(branch)を足して「タワーレコード なんばパークス店」の形にする"""
    name = t.get('name:ja') if cc == 'JP' and t.get('name:ja') else (t.get('name') or t.get('name:en'))
    branch = (t.get('branch:ja') if cc == 'JP' else None) or t.get('branch')
    if name and branch and branch not in name:
        return f'{name} {branch}'
    return name

total = {'livehouse': 0, 'recordshop': 0}
for cc in countries:
    for kind, table in (('venue', 'livehouse'), ('shop', 'recordshop')):
        f = os.path.join(CACHE, f'{cc}-{kind}.json')
        if os.path.exists(f): data = json.load(open(f))
        else:
            data = overpass(q(cc, kind))
            if data is None: continue
            json.dump(data, open(f, 'w'), ensure_ascii=False)
        rows = []
        for e in data.get('elements', []):
            t = e.get('tags') or {}
            name = shop_name(t, cc)
            lat = e.get('lat') or (e.get('center') or {}).get('lat'); lon = e.get('lon') or (e.get('center') or {}).get('lon')
            if not name or lat is None or lon is None: continue
            rows.append((f"{e['type']}/{e['id']}", name, addr(t, cc), t.get('addr:city'), t.get('addr:state') or t.get('addr:province'), cc, lat, lon, t.get('opening_hours'), t.get('website') or t.get('contact:website') or t.get('url'), t.get('contact:instagram'), t.get('contact:twitter')))
        print(f'{cc} {table}: {len(rows)}件', flush=True)
        total[table] += len(rows)
        if DRY or not rows: continue
        sql = ['begin;']
        for r in rows:
            osm, name, ad, city, st, c, la, lo, hours, url, ig, tw = r
            if table == 'livehouse':
                sql.append(f"insert into livehouse (osm_id,name,address,city,prefecture_or_state,country,latitude,longitude,hours,url,source) values ({lit(osm)},{lit(name)},{lit(ad)},{lit(city)},{lit(st)},{lit(c)},{la},{lo},{lit(hours)},{lit(url)},'OpenStreetMap') on conflict (osm_id) where osm_id is not null do update set name=excluded.name, address=coalesce(excluded.address, livehouse.address), hours=excluded.hours, url=excluded.url;")
            else:
                sql.append(f"insert into recordshop (osm_id,name,address,city,prefecture_or_state,country,latitude,longitude,hours,official_site_url,sns_instagram_url,sns_x_url,source) values ({lit(osm)},{lit(name)},{lit(ad)},{lit(city)},{lit(st)},{lit(c)},{la},{lo},{lit(hours)},{lit(url)},{lit(ig)},{lit(tw)},'OpenStreetMap') on conflict (osm_id) where osm_id is not null do update set name=excluded.name, address=coalesce(excluded.address, recordshop.address), hours=excluded.hours, official_site_url=excluded.official_site_url;")
        sql.append('commit;')
        psql(None, '\n'.join(sql))
print('=== 終了', total, flush=True)
