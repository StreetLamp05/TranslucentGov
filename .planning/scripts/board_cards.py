"""Add pushed issues to the board in .planning/project-fields.json and set Status=Refinement, Area, Size, Spec §.

Usage: board_cards.py <repo-root> [plan-file, default .planning/M0-issues.json].

Needs the `project` token scope. Idempotent via manifest `itemId` / `fieldsSet`.
"""
import json, subprocess, sys, os

ROOT = sys.argv[1]
plan = json.load(open(os.path.join(ROOT, sys.argv[2] if len(sys.argv) > 2 else ".planning/M0-issues.json")))
mpath = os.path.join(ROOT, ".planning/manifest.json")
manifest = json.load(open(mpath))
gen = manifest["generated"]
pf = json.load(open(os.path.join(ROOT, ".planning/project-fields.json")))
P, F = pf["project"], pf["fields"]


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}\n{r.stderr.strip()}")
    return r.stdout.strip()


def save():
    with open(mpath, "w") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def edit(item_id, field, *, option=None, text=None):
    args = ["project", "item-edit", "--id", item_id, "--project-id", P["id"], "--field-id", F[field]["id"]]
    args += ["--single-select-option-id", F[field]["options"][option]] if option else ["--text", text]
    gh(*args)


items = []
for f in plan["features"]:
    items.append((f, None))
    items += [(s, s["size"]) for s in f["stories"]]

for item, size in items:
    rec = gen[item["tempId"]]
    if not rec.get("itemId"):
        out = gh("project", "item-add", str(P["number"]), "--owner", P["owner"], "--url", rec["url"], "--format", "json")
        rec["itemId"] = json.loads(out)["id"]
        save()
    if not rec.get("fieldsSet"):
        edit(rec["itemId"], "Status", option="Refinement")
        edit(rec["itemId"], "Area", option=item["area"])
        if size:
            edit(rec["itemId"], "Size", option=size)
        edit(rec["itemId"], "Spec §", text=item["specSection"])
        rec["fieldsSet"] = True
        save()
    print(f"  {item['tempId']} #{rec['issueNumber']} on board", flush=True)
print("board done")
