#!/usr/bin/env python3
"""bounce企画のメインビジュアル: 各年から偏りなく選んだジャケットを敷き詰め、左に題字を重ねる。
実行: python3 scripts/make-bounce-collage.py  → public/images/curation/bounce-opus.jpg"""
import subprocess, random, re, io, urllib.request
from PIL import Image, ImageDraw, ImageFont
RID = 'MS_RNK_w1vl0uio'
sql = f"select extract(year from e.period_date)::int, a.jacket_url from ranking_entry e join album a on a.id=e.album_id where e.ranking_id='{RID}' and a.jacket_url is not null"
out = subprocess.check_output(['docker','exec','supabase_db_music-synapse','psql','-U','postgres','-At','-F','|','-c',sql]).decode()
by = {}
for line in out.strip().split('\n'):
    y, u = line.split('|', 1); by.setdefault(int(y), []).append(u)
random.seed(7)
COLS, ROWS, T = 16, 8, 100
need = COLS * ROWS
years = sorted(by)
picks = []
pools = {y: random.sample(v, len(v)) for y, v in by.items()}
while len(picks) < need and any(pools.values()):
    for y in years:
        if pools[y] and len(picks) < need: picks.append(pools[y].pop())
random.shuffle(picks)
def get(u):
    u = re.sub(r'\d+x\d+(bb)?\.(jpg|png)$', r'200x200bb.\2', u)
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'Mozilla/5.0'}), timeout=20) as r:
            return Image.open(io.BytesIO(r.read())).convert('RGB').resize((T, T))
    except Exception: return None
canvas = Image.new('RGB', (COLS*T, ROWS*T), (14,14,18)); n = 0
for i, u in enumerate(picks):
    im = get(u)
    if im: canvas.paste(im, ((i % COLS)*T, (i // COLS)*T)); n += 1
# 左から暗いグラデーションで題字を読めるように
ov = Image.new('RGBA', canvas.size, (0,0,0,0)); od = ImageDraw.Draw(ov)
for x in range(canvas.width):
    a = max(70, int(250 * max(0, 1 - x/ 1250)**0.9)); od.line([(x,0),(x,canvas.height)], fill=(10,10,14,a))
canvas = Image.alpha_composite(canvas.convert('RGBA'), ov).convert('RGB'); d = ImageDraw.Draw(canvas)
HB='/System/Library/Fonts/Helvetica.ttc'; hira='/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc'
big = next((i for i in range(6) if ImageFont.truetype(HB,10,index=i).getname()[1]=='Bold'), 1)
F = lambda p,s,i=0: ImageFont.truetype(p,s,index=i)
d.text((90,110),"bounce",font=F(HB,64,big),fill=(255,74,46))
d.text((90,205),"OPUS",font=F(HB,190,big),fill=(245,245,240))
d.text((90,385),"OF THE YEAR",font=F(HB,104,big),fill=(245,245,240))
d.text((94,540),"bounceが選ぶ100枚",font=F(hira,62),fill=(245,245,240))
d.rectangle([94,640,330,646],fill=(255,74,46))
d.text((94,668),"2001 – 2025  /  TOWER RECORDS",font=F(HB,34,0),fill=(200,200,206))
canvas.save('public/images/curation/bounce-opus.jpg', quality=90)
print('tiles', n, 'years', len(years))
