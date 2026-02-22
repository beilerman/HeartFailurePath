from pathlib import Path
text = Path('constants.ts').read_text().splitlines()
for idx,line in enumerate(text,1):
    if "name:" in line and line.strip().startswith("name:"):
        name = line.split("name:",1)[1].strip().strip("',")
        print(f"{idx}: {name}")
