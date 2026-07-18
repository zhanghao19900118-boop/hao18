import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GAMES_URL = "https://worldcup26.ir/get/games"
STADIUMS_URL = "https://worldcup26.ir/get/stadiums"


def download_json(url):
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "WorldCupLab/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


games = download_json(GAMES_URL).get("games", [])
stadiums_payload = download_json(STADIUMS_URL).get("stadiums", [])
stadiums = {str(item["id"]): item.get("fifa_name") or item.get("name_en") for item in stadiums_payload}

if len(games) != 104:
    raise SystemExit(f"Expected 104 matches, received {len(games)}; existing data was not overwritten")

updated_at = datetime.now(timezone.utc).date().isoformat()
rows = []
for item in sorted(games, key=lambda match: int(match["id"])):
    raw_date, time = item["local_date"].split(" ")
    month, day, year = raw_date.split("/")
    finished = str(item.get("finished", "FALSE")).upper() == "TRUE"
    home = item.get("home_team_name_en") or item.get("home_team_label") or "待定"
    away = item.get("away_team_name_en") or item.get("away_team_label") or "待定"
    rows.append({
        "id": f"wc26-{item['id']}",
        "group": item.get("group", "世界杯"),
        "date": f"{year}-{month}-{day}",
        "time": time,
        "home": home,
        "away": away,
        "score": f"{item.get('home_score', '0')}–{item.get('away_score', '0')}" if finished else "—",
        "status": "已结束" if finished else "未开始",
        "venue": stadiums.get(str(item.get("stadium_id")), "待定"),
        "source": "worldcup26.ir public World Cup 2026 API",
        "last_updated": updated_at,
    })

finished_count = sum(item["status"] == "已结束" for item in rows)
if finished_count < 100:
    raise SystemExit(f"Only {finished_count} finished matches received; existing data was not overwritten")

output = Path("data/matches.json")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Updated {len(rows)} matches ({finished_count} finished)")
