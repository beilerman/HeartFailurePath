from pathlib import Path
lines = Path('constants.ts').read_text().splitlines()
meds = []
current = None
for idx, line in enumerate(lines, 1):
    stripped = line.strip()
    if stripped.startswith('name:'):
        current = {'name': stripped.split('name:')[1].strip().strip("',"), 'start': idx}
        meds.append(current)
    if current and stripped.startswith('available_doses:'):
        doses = []
        depth = 0
        j = idx
        while j <= len(lines):
            l = lines[j-1]
            if '[' in l:
                depth += l.count('[')
            if ']' in l:
                depth -= l.count(']')
            if depth > 0 and 'strength:' in l:
                doses.append((j, l.strip()))
            j += 1
            if depth <= 0 and j > idx:
                break
        current['doses'] = doses
        current['doses_end'] = j-1
for med in meds:
    print(med['name'])
    for line_no, entry in med.get('doses', []):
        print(f" {line_no}: {entry}")
    print()
