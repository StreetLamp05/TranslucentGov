"""Push a .planning/<milestone>-issues.json to GitHub: issues, sub-issue links, blocked_by links, manifest.

Usage: push_cards.py <repo-root> [plan-file, default .planning/M0-issues.json]. The repo comes from the plan's
"repo" key (default StreetLamp05/GovTok, for the original M0 plan).

Idempotent: anything already in .planning/manifest.json (keyed by tempId) is skipped.
Project-board steps live in a separate script (needs the `project` token scope).
"""
import json, subprocess, sys, time, tempfile, os

ROOT = sys.argv[1]
PLAN = os.path.join(ROOT, sys.argv[2] if len(sys.argv) > 2 else ".planning/M0-issues.json")
MANIFEST = os.path.join(ROOT, ".planning/manifest.json")
BATCH, PAUSE = 20, 20


def gh(*args, input_json=None):
    cmd = ["gh", *args]
    r = subprocess.run(cmd, capture_output=True, text=True, input=json.dumps(input_json) if input_json is not None else None)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{r.stderr.strip()}")
    return r.stdout.strip()


plan = json.load(open(PLAN))
REPO = plan.get("repo", "StreetLamp05/GovTok")
manifest = json.load(open(MANIFEST))
gen = manifest.setdefault("generated", {})
milestone = plan["milestone"]


def save():
    with open(MANIFEST, "w") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


created = 0


def create(item, label):
    global created
    tid = item["tempId"]
    if tid in gen:
        return gen[tid]
    if created and created % BATCH == 0:
        print(f"  pause {PAUSE}s (secondary rate limit)", flush=True)
        time.sleep(PAUSE)
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as fh:
        fh.write(item["body"] + f"\n\nSpec §: {item['specSection']}")
        path = fh.name
    url = gh("issue", "create", "-R", REPO, "--title", item["title"], "--body-file", path,
             "--label", label, "--milestone", milestone)
    os.unlink(path)
    number = int(url.rstrip("/").split("/")[-1])
    node = json.loads(gh("api", f"repos/{REPO}/issues/{number}"))
    gen[tid] = {"specSection": item["specSection"], "issueNumber": number, "issueId": node["id"],
                "url": url, "title": item["title"]}
    save()
    created += 1
    print(f"  {tid} → #{number}", flush=True)
    return gen[tid]


# 1. features, then stories (sub-issue link right after each story)
for f in plan["features"]:
    fe = create(f, "feature")
    for s in f["stories"]:
        st = create(s, "user-story")
        if not st.get("parentLinked"):
            try:
                gh("api", "-X", "POST", f"repos/{REPO}/issues/{fe['issueNumber']}/sub_issues",
                   "-F", f"sub_issue_id={st['issueId']}")
            except RuntimeError as e:
                if "already" not in str(e).lower():
                    raise
            st["parentLinked"] = True
            save()

# 2. blocked_by links
for f in plan["features"]:
    for s in f["stories"]:
        st = gen[s["tempId"]]
        done = set(st.get("blockedByLinked", []))
        for dep in s["blockedBy"]:
            if dep in done:
                continue
            try:
                gh("api", "-X", "POST", f"repos/{REPO}/issues/{st['issueNumber']}/dependencies/blocked_by",
                   "-F", f"issue_id={gen[dep]['issueId']}")
            except RuntimeError as e:
                if "already" not in str(e).lower():
                    raise
            done.add(dep)
            st["blockedByLinked"] = sorted(done, key=lambda x: int(x[2:]))
            save()
        print(f"  {s['tempId']} blocked_by {s['blockedBy'] or '-'}", flush=True)

print(f"done: {created} created this run, {len(gen)} in manifest")
