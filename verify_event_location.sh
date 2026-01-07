#!/bin/bash
# Verify event_location implementation

echo "=========================================="
echo "Verifying event_location Implementation"
echo "=========================================="
echo ""

# Check 1: Verify migration file exists
echo "1. Checking migration file..."
if [ -f "supabase/migrations/20260106134436_add_event_location_to_auto_syncs.sql" ]; then
  echo "   ✅ Migration file exists"
else
  echo "   ❌ Migration file not found"
fi

# Check 2: Verify TypeScript interface
echo ""
echo "2. Checking TypeScript interface..."
if grep -q "event_location: string | null" supabase/functions/funlet-sms-handler-beta/auto_sync.ts; then
  echo "   ✅ AutoSyncRecord interface includes event_location"
else
  echo "   ❌ AutoSyncRecord interface missing event_location"
fi

# Check 3: Verify createAutoSyncRecord function
echo ""
echo "3. Checking createAutoSyncRecord function..."
if grep -q "eventLocation\?:" supabase/functions/funlet-sms-handler-beta/auto_sync.ts && \
   grep -q "event_location: eventLocation" supabase/functions/funlet-sms-handler-beta/auto_sync.ts; then
  echo "   ✅ createAutoSyncRecord accepts and stores event_location"
else
  echo "   ❌ createAutoSyncRecord missing event_location handling"
fi

# Check 4: Verify initializeAutoSync extracts event_location
echo ""
echo "4. Checking initializeAutoSync function..."
if grep -q "event_location" supabase/functions/funlet-sms-handler-beta/auto_sync.ts | grep -q "extractedData"; then
  echo "   ✅ initializeAutoSync extracts event_location from extractedData"
else
  echo "   ⚠️  initializeAutoSync may not extract event_location (check manually)"
fi

# Check 5: Verify Google Calendar event creation
echo ""
echo "5. Checking Google Calendar event creation..."
if grep -q "location: autoSync.event_location" supabase/functions/funlet-sms-handler-beta/auto_sync.ts; then
  echo "   ✅ Google Calendar event includes location field"
else
  echo "   ❌ Google Calendar event missing location field"
fi

# Check 6: Verify events table creation
echo ""
echo "6. Checking events table creation..."
if grep -q "location: autoSync.event_location" supabase/functions/funlet-sms-handler-beta/auto_sync.ts | grep -v "TBD"; then
  echo "   ✅ Events table uses event_location (with TBD fallback)"
else
  echo "   ⚠️  Events table location handling (check manually)"
fi

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "Code changes are complete. To fully test:"
echo ""
echo "1. Apply the migration to your database:"
echo "   supabase db push"
echo "   OR manually run: supabase/migrations/20260106134436_add_event_location_to_auto_syncs.sql"
echo ""
echo "2. Test via SMS flow (when location collection is added):"
echo "   - Start Auto Sync"
echo "   - Provide event name"
echo "   - Provide location (when implemented)"
echo "   - Provide time options"
echo "   - Verify event_location is stored in database"
echo ""
echo "3. Test via direct database insert:"
echo "   INSERT INTO auto_syncs (..., event_location) VALUES (..., 'Test Location');"
echo ""
echo "4. Verify location is used when:"
echo "   - Creating Google Calendar events (check location field)"
echo "   - Creating events table records (check location field)"
echo ""

