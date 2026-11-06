#!/usr/bin/env python3
"""Carga un CSV de recorridos (formato del cargador de Recorridos) a telematica_points.

Uso:  SLUG=lukon-selome [DEVS=equipo1,equipo2] python3 scripts/telematica-importar-csv.py <carpeta> <archivo.csv>...
- Lee la service role de .env.local (correr desde fishflow-web/).
- Upsert ignorando duplicados (vehicle_id, ts, event_code); bitácora en telematica_imports.
- Decodifica acentos HTML del domicilio (&iacute; → í).
- NO recalcula el resumen diario: después llamar telematica_refresh_daily_stats(client, desde, hasta).
- DEVS filtra equipos para partir cargas grandes en varias corridas cortas.
- MERGE=1 actualiza los puntos que ya existían (misma unidad, hora y evento) en vez de ignorarlos:
  para reemplazar datos de un formato más pobre (p. ej. el export "Rango" sin velocidad ni ignición).
"""
import csv, datetime, html, json, os, sys, time, urllib.request

env = {}
for l in open('.env.local', encoding='utf-8'):
    if '=' in l and not l.startswith('#'):
        k, v = l.strip().split('=', 1); env[k] = v.strip().strip('"')
U, K = env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']

def _req(method, path, body=None, prefer=None):
    h = {'apikey': K, 'Authorization': 'Bearer ' + K, 'Content-Type': 'application/json'}
    if prefer: h['Prefer'] = prefer
    r = urllib.request.Request(U + '/rest/v1/' + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=90) as x:
        t = x.read(); return json.loads(t) if t else None

def req(method, path, body=None, prefer=None, tries=5):
    for i in range(tries):
        try: return _req(method, path, body, prefer)
        except Exception:
            if i == tries - 1: raise
            time.sleep(5)

def num(s):
    try: return float(str(s).replace(',', '.'))
    except Exception: return None

def i(s):
    n = num(s); return None if n is None else int(round(n))

slug = os.environ['SLUG']
only = set(filter(None, os.environ.get('DEVS', '').split(',')))
cl = req('GET', f'clients?slug=eq.{slug}&select=id')[0]['id']
veh = {v['device_id']: v['id'] for v in req('GET', f'telematica_vehicles?client_id=eq.{cl}&select=id,device_id')}
folder = os.path.expanduser(sys.argv[1])
for fn in sys.argv[2:]:
    rows = csv.reader(open(os.path.join(folder, fn), encoding='utf-8-sig'))
    h = next(rows); c = {n: h.index(n) for n in h}
    by = {}
    for r in rows:
        dev = r[c['Nombre']]
        if only and dev not in only: continue
        try: ts = datetime.datetime.strptime(r[c['Fecha-Hora']], '%Y-%m-%d_%H:%M:%S').strftime('%Y-%m-%dT%H:%M:%S-06:00')
        except Exception: continue
        la, lo = (r[c['Latitud-Longitud']].split(',') + [None])[:2]; la, lo = num(la), num(lo)
        if la is None or lo is None or (la == 0 and lo == 0): continue
        sats = i(r[c['Sat']]); ign = i(r[c['Ign']])
        by.setdefault(dev, []).append(dict(ts=ts, lat=la, lon=lo, speed_kmh=i(r[c['Vel (km/h)']]), heading=i(r[c['Dir']]),
            event_code=i(r[c['Tipo dato - evento']]), ignition=None if ign is None else ign == 1, odometer_m=i(r[c['Odómetro']]),
            sats=sats if sats is not None and sats >= 0 else None, gsm_signal=i(r[c['Sen']]), batt_gps_pct=i(r[c['Bat GPS']]),
            batt_vehicle_v=num(r[c['Bat Activo']]), address=html.unescape(r[c['Domicilio']]).strip() or None))
    for dev, pts in by.items():
        if dev not in veh: print('SIN UNIDAD EN LA FLOTILLA:', dev); continue
        vid = veh[dev]; pts.sort(key=lambda p: p['ts'])
        imp = req('POST', 'telematica_imports', {'client_id': cl, 'vehicle_id': vid, 'filename': fn, 'created_by': 'script telematica-importar-csv'}, 'return=representation')[0]['id']
        ins = 0
        for k in range(0, len(pts), 500):
            res = 'merge-duplicates' if os.environ.get('MERGE') == '1' else 'ignore-duplicates'
            out = req('POST', 'telematica_points?on_conflict=vehicle_id,ts,event_code', [dict(p, client_id=cl, vehicle_id=vid) for p in pts[k:k + 500]], f'resolution={res},return=representation')
            ins += len(out or [])
        req('PATCH', f'telematica_imports?id=eq.{imp}', {'rows_read': len(pts), 'rows_inserted': ins, 'ts_min': pts[0]['ts'], 'ts_max': pts[-1]['ts']})
        print(fn, dev, 'leidos', len(pts), 'insertados', ins, pts[0]['ts'], '->', pts[-1]['ts'], flush=True)
