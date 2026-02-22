from pathlib import Path
lines = Path('constants.ts').read_text().splitlines()
points = []
for idx,line in enumerate(lines,1):
    if 'points:' in line:
        points.append((idx,line.strip()))
for p in points:
    print(p[0], p[1])
