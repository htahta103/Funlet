#!/bin/bash
# Test script for Auto Sync job queue implementation
# This script tests the job queue system with a sample auto_sync

set -e

SUPABASE_URL="${SUPABASE_URL:-https://jjkduivjlzazcvdeeqde.supabase.co}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY}}"

if [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required"
  exit 1
fi

echo "Testing Auto Sync Job Queue Implementation"
echo "=========================================="
echo ""

# Test 1: Check if job_queue table exists
echo "Test 1: Checking if job_queue table exists..."
RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_name = '\''job_queue'\'') as exists;"}' || echo '{"exists": false}')

if echo "$RESPONSE" | grep -q '"exists":true'; then
  echo "✅ job_queue table exists"
else
  echo "❌ job_queue table does not exist"
  exit 1
fi

# Test 2: Check if trigger exists
echo ""
echo "Test 2: Checking if trigger exists..."
TRIGGER_CHECK=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '\''on_auto_sync_created'\'') as exists;"}' || echo '{"exists": false}')

if echo "$TRIGGER_CHECK" | grep -q '"exists":true'; then
  echo "✅ Trigger on_auto_sync_created exists"
else
  echo "❌ Trigger on_auto_sync_created does not exist"
  exit 1
fi

# Test 3: Check if cron job exists
echo ""
echo "Test 3: Checking if cron job exists..."
CRON_CHECK=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '\''process-auto-sync-jobs'\'') as exists;"}' || echo '{"exists": false}')

if echo "$CRON_CHECK" | grep -q '"exists":true'; then
  echo "✅ Cron job process-auto-sync-jobs exists"
else
  echo "⚠️  Cron job process-auto-sync-jobs does not exist (may need to be created manually)"
fi

# Test 4: Check if Edge Function exists
echo ""
echo "Test 4: Checking if Edge Function exists..."
FUNC_CHECK=$(curl -s -X GET "${SUPABASE_URL}/functions/v1/process-auto-sync-jobs" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -w "\n%{http_code}" -o /dev/null 2>&1 | tail -1)

if [ "$FUNC_CHECK" = "200" ] || [ "$FUNC_CHECK" = "405" ] || [ "$FUNC_CHECK" = "404" ]; then
  if [ "$FUNC_CHECK" = "404" ]; then
    echo "⚠️  Edge Function not found (may need to be deployed)"
  else
    echo "✅ Edge Function process-auto-sync-jobs is accessible"
  fi
else
  echo "⚠️  Edge Function check returned: $FUNC_CHECK"
fi

echo ""
echo "=========================================="
echo "Basic checks completed!"
echo ""
echo "Next steps:"
echo "1. Create a test auto_sync with status='running'"
echo "2. Verify a reminder job was scheduled in job_queue"
echo "3. Wait 5 minutes (DEMO timing) and verify reminder was sent"
echo "4. Verify pause check job was scheduled"
echo "5. Wait 10 minutes and verify auto_sync was paused"
echo ""
echo "To test manually:"
echo "1. INSERT INTO auto_syncs (organizer_id, crew_id, event_name, status, response_goal, timezone, started_at)"
echo "   VALUES ('[user-id]', '[crew-id]', 'Test Event', 'running', 'everyone', 'America/Los_Angeles', now());"
echo "2. SELECT * FROM job_queue WHERE sync_id = '[new-sync-id]';"
echo "3. Call Edge Function: curl -X POST ${SUPABASE_URL}/functions/v1/process-auto-sync-jobs -H 'Authorization: Bearer ${SERVICE_ROLE_KEY}'"

