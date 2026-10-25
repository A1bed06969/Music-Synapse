#!/usr/bin/env python3
"""出身地の座標(小数2桁に丸めた地点)を、OpenStreetMap Nominatimで逆引きして、都市の情報を集める。
同じ地点を2つの粒度(zoom=10: 市区, zoom=8: 都市圏・都道府県)で引き、結果をそのまま保存する。
都市へのまとめ方は、集めた結果を見てから決める(.cache/nominatim-reverse.jsonl)。
Nominatimの利用規約に合わせ、1秒に1件以下・連絡先つきのUser-Agentで呼ぶ。続きから再開できる。
実行: python3 scripts/collect-origin-reverse-geocode.py"""
import json, os, subprocess, time, urllib.request
UA = 'music-synapse/1.0 (local research; a1bed069star@gmail.com)'
OUT = os.path.join(os.path.dirname(__file__), '..', '.cache', 'nominatim-reverse.jsonl')
sql = "select distinct round(origin_latitude::numeric,2), round(origin_longitude::numeric,2) from artist where origin_latitude is not null"
pts = [tuple(map(float, l.split('|'))) for l in subprocess.check_output(['docker','exec','supabase_db_music-synapse','psql','-U','postgres','-At','-c',sql]).decode().split()]
done = set()
if os.path.exists(OUT):
    for l in open(OUT):
        r = json.loads(l); done.add((r['lat'], r['lng'], r['zoom']))
print(f'地点 {len(pts)} / 取得済み {len(done)}', flush=True)
last = 0
with open(OUT, 'a') as f:
    for i, (la, lo) in enumerate(pts):
        for z in (10, 8):
            if (la, lo, z) in done: continue
            u = f'https://nominatim.openstreetmap.org/reverse?lat={la}&lon={lo}&zoom={z}&format=jsonv2&namedetails=1&extratags=1&addressdetails=1&accept-language=en'
            for attempt in range(5):
                w = last + 1.1 - time.time()
                if w > 0: time.sleep(w)
                last = time.time()
                try:
                    d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=30)); break
                except Exception as e:
                    time.sleep(30 * (attempt + 1)); d = None
            if d is None: continue
            f.write(json.dumps({'lat': la, 'lng': lo, 'zoom': z, 'res': d}, ensure_ascii=False) + '\n'); f.flush()
        if i % 100 == 0: print(f'[{i}/{len(pts)}]', flush=True)
print('=== 終了', flush=True)
