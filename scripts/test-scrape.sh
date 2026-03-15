#!/bin/bash
set -e

DB="betaplanes-db"
FLAG="--remote"
URL="https://betaplanes.acd.workers.dev"

echo "=== Step 1: Clear all data from remote tables ==="
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM track_points;"
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM flights;"
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM scrape_cache;"
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM scrape_logs;"

echo ""
echo "=== Step 2: Verify tables are empty ==="
npx wrangler d1 execute $DB $FLAG --command="SELECT 'flights' as tbl, COUNT(*) as cnt FROM flights UNION ALL SELECT 'track_points', COUNT(*) FROM track_points UNION ALL SELECT 'scrape_cache', COUNT(*) FROM scrape_cache;"

echo ""
echo "=== Step 3: Run first scrape (this takes a few minutes) ==="
SCRAPE1=$(curl -s --max-time 300 -X POST "$URL/api/scrape")
if [ -z "$SCRAPE1" ]; then
  echo "Scrape request timed out or returned empty. Checking logs..."
  sleep 10
  curl -s "$URL/api/scrape/logs" | python3 -c "
import sys, json
logs = json.loads(sys.stdin.read())
if logs:
    print(logs[0].get('log_text', 'No log text'))
else:
    print('No logs found')
"
else
  echo "$SCRAPE1" | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
    for l in d.get('logs', []):
        print(l)
except json.JSONDecodeError:
    print('Response was not JSON:')
    print(raw[:500])
"
fi

echo ""
echo "=== Step 4: Verify first scrape results ==="
npx wrangler d1 execute $DB $FLAG --command="SELECT tail_number, COUNT(*) as flights FROM flights GROUP BY tail_number ORDER BY tail_number;"
npx wrangler d1 execute $DB $FLAG --command="SELECT f.tail_number, COUNT(tp.id) as track_points FROM track_points tp JOIN flights f ON tp.flight_id = f.id GROUP BY f.tail_number ORDER BY f.tail_number;"

echo ""
echo "=== Step 5: Delete N521SS data and last 2 N556LU flights ==="
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM track_points WHERE flight_id IN (SELECT id FROM flights WHERE tail_number = 'N521SS');"
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM flights WHERE tail_number = 'N521SS';"
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM scrape_cache WHERE cache_key LIKE '%N521SS%';"

# Delete track points for last 2 N556LU flights, then the flights themselves
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM track_points WHERE flight_id IN (SELECT id FROM flights WHERE tail_number = 'N556LU' ORDER BY departure_time DESC LIMIT 2);"
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM flights WHERE id IN (SELECT id FROM flights WHERE tail_number = 'N556LU' ORDER BY departure_time DESC LIMIT 2);"
npx wrangler d1 execute $DB $FLAG --command="DELETE FROM scrape_cache WHERE cache_key LIKE '%N556LU%';"

echo ""
echo "=== Step 6: Verify deletions ==="
npx wrangler d1 execute $DB $FLAG --command="SELECT tail_number, COUNT(*) as flights FROM flights GROUP BY tail_number ORDER BY tail_number;"

echo ""
echo "=== Step 7: Run second scrape ==="
SCRAPE2=$(curl -s --max-time 300 -X POST "$URL/api/scrape")
if [ -z "$SCRAPE2" ]; then
  echo "Scrape request timed out or returned empty. Checking logs..."
  sleep 10
  curl -s "$URL/api/scrape/logs" | python3 -c "
import sys, json
logs = json.loads(sys.stdin.read())
if logs:
    print(logs[0].get('log_text', 'No log text'))
else:
    print('No logs found')
"
else
  echo "$SCRAPE2" | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
    for l in d.get('logs', []):
        print(l)
except json.JSONDecodeError:
    print('Response was not JSON:')
    print(raw[:500])
"
fi

echo ""
echo "=== Step 8: Verify second scrape restored data ==="
npx wrangler d1 execute $DB $FLAG --command="SELECT tail_number, COUNT(*) as flights FROM flights GROUP BY tail_number ORDER BY tail_number;"
npx wrangler d1 execute $DB $FLAG --command="SELECT f.tail_number, COUNT(tp.id) as track_points FROM track_points tp JOIN flights f ON tp.flight_id = f.id GROUP BY f.tail_number ORDER BY f.tail_number;"

echo ""
echo "=== Done ==="
