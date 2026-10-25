#!/usr/bin/env python3
"""OpenStreetMapに住所の無い店・ライブハウスの住所を、座標からNominatim(逆引き)で補う。
座標から引いた「その地点の住所」なので、建物名までは分からず、番地までの概算になることがある(source に 'OpenStreetMap+座標から補完' と残す)。
1秒に1件以下。取得結果は .cache/osm-addr/ に残し、続きから再開できる。
実行: python3 scripts/enrich-osm-addresses.py [--countries=JP,US] [--limit=N]"""
import json, os, subprocess, sys, time
ROOT = os.path.join(os.path.dirname(__file__), '..')
CACHE = os.path.join(ROOT, '.cache', 'osm-addr'); os.makedirs(CACHE, exist_ok=True)
UA = 'music-synapse/1.0 (local research; a1bed069star@gmail.com)'
arg = next((a for a in sys.argv if a.startswith('--countries=')), None)
countries = arg.split('=')[1].split(',') if arg else ['JP']
limit = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--limit=')), '0'))

def psql(sql):
    return subprocess.check_output(['docker', 'exec', '-i', 'supabase_db_music-synapse', 'psql', '-U', 'postgres', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1'], input=sql.encode()).decode()
def lit(v):
    return 'NULL' if v is None or v == '' else "'" + str(v).replace("'", "''") + "'"

def format_addr(a, cc):
    if cc == 'JP':
        parts = [a.get('postcode'), a.get('province') or a.get('state'), a.get('city') or a.get('town') or a.get('village'), a.get('city_district') or a.get('suburb'), a.get('quarter'), a.get('neighbourhood'), a.get('road'), a.get('house_number')]
        return ' '.join(p for p in parts if p)
    street = ' '.join(p for p in [a.get('house_number'), a.get('road')] if p)
    parts = [street, a.get('suburb'), a.get('city') or a.get('town') or a.get('village'), a.get('state'), a.get('postcode')]
    return ', '.join(p for p in parts if p)

last = 0.0
done = 0
for table in ('recordshop', 'livehouse'):
    for cc in countries:
        rows = [r.split('\t') for r in psql(f"select id, latitude, longitude from {table} where country='{cc}' and (address is null or address='') and source='OpenStreetMap' order by id").strip().split('\n') if r]
        print(f'{table} {cc}: 補う対象 {len(rows)}件', flush=True)
        for id_, la, lo in rows:
            if limit and done >= limit: sys.exit(0)
            f = os.path.join(CACHE, f'{table}-{id_}.json')
            if os.path.exists(f): res = json.load(open(f))
            else:
                w = last + 1.1 - time.time()
                if w > 0: time.sleep(w)
                last = time.time()
                lang = 'ja' if cc == 'JP' else 'en'
                url = f'https://nominatim.openstreetmap.org/reverse?lat={la}&lon={lo}&zoom=18&format=jsonv2&addressdetails=1&accept-language={lang}'
                out = subprocess.run(['curl', '-s', '-m', '30', '-A', UA, url], capture_output=True).stdout
                try: res = json.loads(out)
                except Exception: continue
                json.dump(res, open(f, 'w'), ensure_ascii=False)
            a = res.get('address') or {}
            text = format_addr(a, cc)
            if not text: continue
            city = a.get('city') or a.get('town') or a.get('village') or a.get('city_district')
            psql(f"update {table} set address={lit(text)}, city=coalesce(city,{lit(city)}), source='OpenStreetMap+座標から補完' where id='{id_}';")
            done += 1
            if done % 50 == 0: print(f'  {done}件', flush=True)
print('=== 終了', done, flush=True)
