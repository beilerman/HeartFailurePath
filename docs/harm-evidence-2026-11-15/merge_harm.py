import json, copy
base='docs/harm-evidence-2026-11-15/'
f=json.load(open(base+'resolved-foundational.json')); a=json.load(open(base+'resolved-adjunct.json'))
rows=f['rows']+a['rows']; mult=f['multipliers']+a['multipliers']
log=[]
# R7: ACEi and ARB are sibling classes for step 5
acei_sync=[r for r in rows if r['drug_class']=='ACEi' and not r['drugs'] and r['effect']=='syncope'][0]
for r in rows:
    if r['drug_class']=='ARB' and r['effect']=='syncope' and r.get('upper_bound'):
        old=r['one_year_excess_pct']
        r.update(one_year_excess_pct=acei_sync['one_year_excess_pct'], level='siblingProxy', upper_bound=False,
                 source=acei_sync['source'], population=acei_sync['population'], control_type=acei_sync['control_type'],
                 quote=acei_sync['quote'], verification=acei_sync['verification'], definition_used=acei_sync['definition_used'],
                 notes='Ruling R7 (2026-11-15): ACE inhibitors and ARBs are sibling classes, so step 5 applies before the step-6 upper bound. Takes the ACE-inhibitor class syncope figure. Replaced an upper bound of %s.'%old)
        r['preference_step']=5
        log.append(f"ARB syncope: upper bound {old} -> ACEi sibling {r['one_year_excess_pct']}")
# R8: loop hypokalemia step-4 figure measured below the HF dose range for a dose-related harm does not qualify
for r in rows:
    if r['drug_class']=='Loop Diuretic' and r['effect']=='hypokalemia':
        log.append(f"loop hypokalemia row before: drugs={r['drugs']} rate={r['one_year_excess_pct']} level={r['level']} src={r['source'].get('trial')}")
        r['_r8']=True

# Controller correction: eplerenone gynecomastia is measured, not an upper bound
for r in rows:
    if r['drug_class']=='MRA' and 'Eplerenone' in r['drugs'] and r['effect']=='gynecomastia':
        old=r['one_year_excess_pct']
        r.update(one_year_excess_pct=0, level='extrapolated', upper_bound=False, control_type='placebo', population='EPHESUS: men with left ventricular dysfunction after myocardial infarction (another population; step 4)',
            source={'trial':'EPHESUS, as reported in a 2026 open-access review','citation':'Eplerenone Revisited: A Balanced Reappraisal of Its Role in Hypertension, Heart Failure, and Cardiorenal Disease (2026), Europe PMC PMC13629649','pmid':'42617196'},
            verification='verified_fulltext (secondary source)',
            quote='in EPHESUS, gynecomastia occurred in approximately 0.5% of men receiving eplerenone, and the incidences of gynecomastia and impotence were not greater than those observed with placebo.',
            definition_used='Gynecomastia in men reported as an adverse event',
            notes='Controller correction at merge (2026-11-15): the checker had set an upper bound of %s (the spironolactone RALES rate). A measured placebo-controlled figure exists: about 0.5%% of men on eplerenone, not greater than placebo, so the excess is recorded as 0 (the placebo percentage is not given in the source read). Cross-check: the EMPHASIS-HF registry record (NCT00232180) lists no gynecomastia term above its 2%% reporting threshold in either arm.'%old)
        r['preference_step']=4; r['population_sex']='male'
        log.append(f"eplerenone gynecomastia: upper bound {old} -> measured 0 (EPHESUS, not greater than placebo)")
# R7 sibling pass: an upper-bound row takes its sibling class's measured figure first (step 5 before step 6)
SIB={'Loop Diuretic':'Thiazide-like Diuretic','Thiazide-like Diuretic':'Loop Diuretic','ARB':'ACEi','ACEi':'ARB','nsMRA':'MRA','MRA':'nsMRA','GLP-1 RA':'GLP-1/GIP RA','GLP-1/GIP RA':'GLP-1 RA'}
for r in rows:
    if (r.get('upper_bound') or r.get('_r8')) and r['drug_class'] in SIB:
        c=[x for x in rows if x['drug_class']==SIB[r['drug_class']] and x['effect']==r['effect'] and not x.get('upper_bound') and not x.get('_r8')]
        if c:
            m=max(c,key=lambda x:x['one_year_excess_pct'])
            old=r['one_year_excess_pct']
            r['notes']=f"Ruling R7 (2026-11-15): sibling class before upper bound. Takes the {m['drug_class']} figure ({', '.join(m['drugs']) or 'class row'}, {m['source'].get('trial')}): {m['one_year_excess_pct']}; was {old}. "+r.get('notes','')
            r.update(one_year_excess_pct=m['one_year_excess_pct'], level='siblingProxy', upper_bound=False, source=m['source'], quote=m['quote'], population=m['population'], control_type=m['control_type'], verification=m['verification'], definition_used=m['definition_used'])
            r['preference_step']=5; r.pop('_r8',None)
            log.append(f"sibling: {r['drug_class']} {r['drugs'] or 'CLASS'} {r['effect']}: {old} -> {m['one_year_excess_pct']} from {m['drug_class']} {m['source'].get('trial')}")
# step 6 consistency: every upper-bound row = largest placebo-controlled measured excess of that effect across the merged table
def measured_max(effect):
    c=[r for r in rows if r['effect']==effect and not r.get('upper_bound') and not r.get('_r8') and r.get('control_type')=='placebo']
    if not c: return None
    return max(c,key=lambda r:r['one_year_excess_pct'])
for r in rows:
    if r.get('_r8'):
        m=measured_max('hypokalemia')
        old=r['one_year_excess_pct']
        r['notes']=("Ruling R8 (2026-11-15): the step-4 figure (%s, torsemide hypertension label, below placebo) was measured at doses below the heart-failure range and the same label states hypokalemia is dose-related at heart-failure doses, so it does not qualify; step 6 applies. "%old)+f"Upper bound = largest placebo-controlled excess of hypokalemia in the table: {m['one_year_excess_pct']} ({m['drug_class']}, {m['source'].get('trial')}). Earlier note: "+r.get('notes','')
        r.update(one_year_excess_pct=m['one_year_excess_pct'], level='extrapolated', upper_bound=True); r['preference_step']=6
        log.append(f"loop hypokalemia: {old} -> upper bound {m['one_year_excess_pct']} from {m['drug_class']} {m['source'].get('trial')}")
        del r['_r8']
for r in rows:
    if r.get('upper_bound'):
        m=measured_max(r['effect'])
        if m and m['one_year_excess_pct']>r['one_year_excess_pct']+1e-9:
            log.append(f"UB {r['drug_class']} {r['drugs'] or 'CLASS'} {r['effect']}: {r['one_year_excess_pct']} -> {m['one_year_excess_pct']} ({m['drug_class']} {m['source'].get('trial')})")
            r['notes']=f"Step-6 value reset at merge to the largest placebo-controlled excess across both tables: {m['one_year_excess_pct']} ({m['drug_class']}, {m['source'].get('trial')}); was {r['one_year_excess_pct']}. "+r.get('notes','')
            r['one_year_excess_pct']=m['one_year_excess_pct']
        elif not m: log.append(f"UB {r['drug_class']} {r['effect']}: no measured placebo-controlled row found; kept {r['one_year_excess_pct']}")
out={"schemaVersion":1,"preparedAt":"2026-11-15",
 "method":"Scale and rules: data/harmDefinitions.json. Collected, then independently re-read and resolved (docs/harm-evidence-2026-11-15/). One row per drug or class and harm. Rates are one-year excess over control in percent, not floored.",
 "rows":rows,"multipliers":mult,
 "multipliers_not_representable":f.get('multipliers_not_representable',[])+a.get('multipliers_not_representable',[]),
 "listed_not_scored":f.get('listed_not_scored',[])+a.get('listed_not_scored',[])}
json.dump(out,open('data/harmEvidence.json','w'),indent=1,ensure_ascii=False)
print(len(rows),'rows',len(mult),'multipliers'); print('\n'.join(log))
from collections import Counter
print(Counter(r['level']+('/UB' if r.get('upper_bound') else '') for r in rows if r['layer'] in('harmRow','symptomFigure')))
