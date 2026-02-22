from pathlib import Path
lines = Path('constants.ts').read_text().splitlines()
meds=[]
current=None
for idx,line in enumerate(lines,1):
    if line.strip().startswith('name:'):
        current={'name':line.split('name:')[1].strip().strip("',"),'start':idx,'doses':[],'chf':None,'hema':None,'special':[]}
        meds.append(current)
    if current and line.strip().startswith('available_doses:'):
        depth=0
        j=idx
        while j<=len(lines):
            l=lines[j-1]
            if '[' in l:
                depth+=l.count('[')
            if ']' in l:
                depth-=l.count(']')
            if depth>0 and 'strength:' in l:
                current['doses'].append((j,l.strip()))
            j+=1
            if depth<=0 and j>idx:
                break
    if current and current['chf'] is None and 'chf_effects' in line:
        current['chf']=idx
    if current and current['hema'] is None and 'hemodynamic_effects' in line:
        current['hema']=idx
print('meds count', len(meds))
for med in meds:
    print(med['name'], med['doses'][0][0] if med['doses'] else None, med['chf'], med['hema'])
