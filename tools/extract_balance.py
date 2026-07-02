#!/usr/bin/env python3
"""Regenerate src/sim/units_data.js from bulwark-balance.xlsx (Units sheet).

Usage: python3 tools/extract_balance.py path/to/bulwark-balance.xlsx
Keeps the game data-driven from the canonical workbook (GDD §18).
"""
import zipfile, re, sys, json
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
M = NS['m']

def read_sheet(z, sheets, ss, name):
    rows = []
    for row in ET.fromstring(z.read(sheets[name])).iter('{%s}row' % M):
        cells = {}
        for c in row.findall('m:c', NS):
            v = c.find('m:v', NS)
            if v is None:
                continue
            col = 0
            for ch in re.match(r'([A-Z]+)', c.get('r')).group(1):
                col = col * 26 + ord(ch) - 64
            cells[col - 1] = ss[int(v.text)] if c.get('t') == 's' else v.text
        if cells:
            rows.append([cells.get(i, '') for i in range(max(cells) + 1)])
    return rows

def num(x):
    try:
        f = float(x)
        return int(f) if f == int(f) else round(f, 6)
    except (TypeError, ValueError):
        return x

def main(path, out):
    z = zipfile.ZipFile(path)
    ss = [''.join(t.text or '' for t in si.iter('{%s}t' % M))
          for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    relmap = {r.get('Id'): r.get('Target') for r in rels}
    sheets = {}
    for sh in wb.find('m:sheets', NS):
        tgt = relmap[sh.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
        sheets[sh.get('name')] = tgt if tgt.startswith('xl/') else 'xl/' + tgt

    hdr, *rows = read_sheet(z, sheets, ss, 'Units')
    units = []
    for r in rows:
        if not r or not r[0]:
            continue
        d = dict(zip(hdr, r))
        units.append({
            'id': d['UnitID'], 'faction': d['Faction'], 'shape': d['Shape'], 'role': d['Role'],
            'domain': d['Domain'], 'armor': d['Armor Class'], 'dmgType': d['Damage Type'],
            'canTarget': d['Can Target'], 'targets': d['Targets'], 'aoe': num(d['AoE r']),
            'status': d['Status'], 'radarDetect': d['Radar-Detect'] == 'Yes',
            'seesGround': d['Sees Ground'] == 'Yes',
            'hp': [num(d['HP T1']), num(d['HP T2']), num(d['HP T3'])],
            'dps': [num(d['DPS T1']), num(d['DPS T2']), num(d['DPS T3'])],
            'range': num(d['Range']), 'speed': num(d['Speed']), 'vision': num(d['Vision']),
            'power': num(d['Power']),
            'cost': [num(d['Cost T1']), num(d['Cost T2']), num(d['Cost T3'])],
        })
    js = ('// AUTO-GENERATED from bulwark-balance.xlsx (Units sheet, %d rows). '
          'Canonical stat source (GDD §18: no hardcoded balance).\n'
          '// Regenerate with tools/extract_balance.py — do not hand-edit.\n'
          'export const UNITS_ALL = %s;\n') % (len(units), json.dumps(units, separators=(',', ':')))
    with open(out, 'w') as f:
        f.write(js)
    print('wrote %s (%d units)' % (out, len(units)))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'bulwark-balance.xlsx', 'src/sim/units_data.js')
