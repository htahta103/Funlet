# Auto Sync Scheduled Jobs - Database Review & Plan Validation

**Review Date:** 2025-01-XX  
**Project:** Funlet (jjkduivjlzazcvdeeqde)  
**Reviewer:** AI Assistant via Supabase MCP

## Current Database State

### ✅ Existing Tables

#### `auto_syncs` Table
- **Status:** EXISTS ✅
- **Schema:** Matches plan requirements
- **Key Fields:**
  - `id` (uuid, PK)
  - `organizer_id` (uuid, FK to profiles)
  - `crew_id` (uuid, FK to crews)
  - `status` (enum: 'running', 'paused', 'stopped', 'completed') ✅
  - `response_goal` (enum: 'everyone', 'critical_mass')
  - `timezone` (text)
  - `calendar_connected` (boolean)
  - `created_at`, `started_at`, `paused_at`, `completed_at`, `stopped_at`
  - `last_reminder_sent_at` ✅
  - `metadata` (jsonb)
- **Indexes:**
  - Primary key on `id` ✅
  - `idx_auto_syncs_organizer_status` (organizer_id, status) ✅
  - `idx_auto_syncs_status` (status) ✅
  - `idx_auto_syncs_crew_id` (crew_id) ✅
- **RLS:** Enabled ✅
  - Users can only SELECT/INSERT/UPDATE/DELETE their own auto_syncs
- **Foreign Keys:** Properly configured ✅

#### `google_calendar_tokens` Table
- **Status:** EXISTS ✅
- **Schema:** Matches plan requirements
- **Key Fields:**
  - `user_id` (uuid, unique, FK to auth.users)
  - `access_token` (text)
  - `refresh_token` (text, nullable)
  - `expires_at` (timestamptz, nullable)
  - `scope` (text, nullable)
- **RLS:** Enabled ✅
  - Users can only view/insert/update their own tokens

#### Related Tables
- `auto_sync_options` ✅ EXISTS
- `auto_sync_responses` ✅ EXISTS
- `auto_sync_messages` ✅ EXISTS
- `profiles` ✅ EXISTS
- `contacts` ✅ EXISTS
- `crews` ✅ EXISTS

### ❌ Missing Components

#### `job_queue` Table
- **Status:** DOES NOT EXIST ❌
- **Action Required:** Create table with migration
- **Required Schema:**
  ```sql
  CREATE TABLE job_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id uuid NOT NULL REFERENCES auto_syncs(id) ON DELETE CASCADE,
    job_type text NOT NULL CHECK (job_type IN ('reminder_24h', 'pause_check_48h')),
    scheduled_at timestamptz NOT NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'skipped')),
    created_at timestamptz DEFAULT now(),
    processed_at timestamptz,
    error_message text,
    UNIQUE(sync_id, job_type, scheduled_at)
  );
  ```

#### Database Triggers
- **Status:** NO TRIGGERS ON auto_syncs ❌
- **Action Required:** Create trigger function and trigger
- **Required:**
  - Function: `schedule_first_reminder()`
  - Trigger: `on_auto_sync_created` (AFTER INSERT)

#### pg_cron Jobs
- **Status:** NO CRON JOBS FOR AUTO_SYNC ❌
- **Action Required:** Create cron job to process jobs
- **Note:** pg_cron extension is INSTALLED (v1.6) ✅

#### RLS Policies for `job_queue`
- **Status:** WILL NEED POLICIES (table doesn't exist yet)
- **Action Required:** Add RLS policies after table creation
- **Recommended:**
  - Service role can do everything (for Edge Function)
  - Users can view jobs for their own auto_syncs (read-only)

## Plan Validation

### ✅ Plan Matches Database State

1. **auto_syncs table structure** - Plan correctly assumes existing table ✅
2. **Status enum values** - Plan matches actual enum ('running', 'paused', 'stopped', 'completed') ✅
3. **Foreign key relationships** - Plan correctly references auto_syncs(id) ✅
4. **pg_cron extension** - Plan assumes extension exists, which is correct ✅

### ⚠️ Plan Adjustments Needed

1. **RLS Policies for job_queue**
   - Plan doesn't explicitly mention RLS policies
   - **Recommendation:** Add RLS policies section to plan
   - Service role needs full access
   - Users may need read access for their own syncs

2. **Status Check Constraint**
   - Plan includes 'processing' status in CHECK constraint
   - This is correct for atomic status updates

3. **Partial Unique Index**
   - Plan correctly includes partial unique index
   - This is critical for duplicate prevention ✅

4. **Trigger Timing**
   - Plan uses AFTER INSERT trigger
   - This is correct ✅
   - Trigger condition: `WHEN (NEW.status = 'running')` ✅

## Implementation Checklist

### Phase 1: Database Schema ✅ READY
- [ ] Create `job_queue` table migration
- [ ] Add partial unique index for duplicate prevention
- [ ] Add other indexes (fetch, sync, cleanup)
- [ ] Create trigger function `schedule_first_reminder()`
- [ ] Create trigger `on_auto_sync_created`
- [ ] Add RLS policies for `job_queue`
- [ ] Test trigger with sample auto_sync insert

### Phase 2: Edge Function ✅ READY
- [ ] Create `process-auto-sync-jobs` Edge Function
- [ ] Implement job fetching logic
- [ ] Implement atomic status updates
- [ ] Implement reminder sending logic
- [ ] Implement pause check logic
- [ ] Add error handling

### Phase 3: pg_cron Setup ✅ READY
- [ ] Create SQL function `process_auto_sync_jobs()` (optional, if using SQL approach)
- [ ] Schedule cron job to run every minute
- [ ] Test cron job execution
- [ ] Monitor job processing

### Phase 4: Testing ✅ READY
- [ ] Test job creation on auto_sync insert
- [ ] Test reminder job processing (5m demo timing)
- [ ] Test pause check job processing (10m demo timing)
- [ ] Test early completion (skip jobs)
- [ ] Test duplicate prevention
- [ ] Test concurrent processing

## Security Considerations

### RLS Policies Needed for `job_queue`

```sql
-- Enable RLS
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for Edge Function)
CREATE POLICY "Service role full access"
ON job_queue
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Users can view jobs for their own auto_syncs (read-only)
CREATE POLICY "Users can view their own sync jobs"
ON job_queue
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM auto_syncs
    WHERE auto_syncs.id = job_queue.sync_id
    AND auto_syncs.organizer_id = auth.uid()
  )
);
```

**Note:** Users should NOT be able to INSERT/UPDATE/DELETE jobs directly - only service role can.

## Potential Issues & Recommendations

### 1. RLS Policy for Service Role
- **Issue:** Edge Functions use service role, but RLS might block access
- **Solution:** Ensure service role has explicit policy or bypass RLS
- **Recommendation:** Use service role key in Edge Function (bypasses RLS)

### 2. Trigger Performance
- **Issue:** Trigger fires on every INSERT
- **Mitigation:** Trigger has `WHEN (NEW.status = 'running')` condition ✅
- **Recommendation:** Monitor trigger performance with many concurrent inserts

### 3. Cron Job Execution
- **Issue:** Cron job runs every minute, might process same job twice
- **Mitigation:** Atomic status update prevents this ✅
- **Recommendation:** Monitor for stuck jobs

### 4. Partial Unique Index
- **Issue:** Index only works for pending jobs
- **Mitigation:** Application-level checks also prevent duplicates ✅
- **Recommendation:** Test duplicate prevention thoroughly

## Final Validation

### ✅ Ready to Implement
- Database schema is well-defined
- Plan accounts for existing infrastructure
- Duplicate prevention is comprehensive
- Security considerations are addressed

### ⚠️ Before Implementation
1. Add RLS policies section to plan
2. Verify service role access pattern
3. Test trigger with sample data
4. Document cleanup strategy

### 📝 Notes
- Demo timings (5m/10m) are correctly set in plan
- Production timings (24h/48h) need to be updated before production
- Cleanup period (3 days) is reasonable
- All indexes are properly designed

## Conclusion

**Plan Status:** ✅ **APPROVED WITH MINOR ADDITIONS**

The plan is comprehensive and correctly accounts for the existing database state. The main additions needed are:
1. RLS policies for `job_queue` table
2. Service role access pattern documentation

All other aspects of the plan are ready for implementation.

