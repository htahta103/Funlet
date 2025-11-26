# Funlet Project Rules

## Project Context
- **Project**: Funlet SMS Handler
- **Main Function**: `funlet-sms-handler-v2`
- **Database**: Supabase (PostgreSQL)
- **Location**: `/Users/andy/Funlet`

## Testing & Deployment Rules

### 1. Deployment
- **Command**: `cd /Users/andy/Funlet && supabase functions deploy funlet-sms-handler-v2`
- **No JWT required** - use service role key
- **Always deploy** after making changes before testing

### 2. Testing Commands
- **Base URL**: `https://jjkduivjlzazcvdeeqde.supabase.co/functions/v1/funlet-sms-handler-v2`
- **Auth Token**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqa2R1aXZqbHphemN2ZGVlcWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyNTUxOTgsImV4cCI6MjA2NzgzMTE5OH0.wo23Zti6Nz4knoN8aluS-wNb6AAVmXtaz-DSEKZaTrs`
- **Test Phone**: `+18777804236`
- **Test User ID**: `5736b75d-ca02-48c3-9ccf-3c457cc831ed`

### 3. MCP Supabase Usage
- **Project ID**: `jjkduivjlzazcvdeeqde`
- **Always use MCP tools** for database operations
- **Check conversation state** after each test
- **Verify database constraints** (especially `invited_by` field)

### 4. Common Test Scenarios
- **Invite More People**: `"Invite More People [Event Name]"`
- **Add Members**: `"Add Members"`
- **Send Invites**: `"Send Invites"`
- **Check RSVPs**: `"Check RSVPs [Event Name]"`

### 5. Key Database Tables
- `conversation_state` - Track user workflow state
- `events` - Event information
- `invitations` - Event invitations (requires `invited_by`)
- `contacts` - User contacts (unique per user)
- `crew_members` - Crew membership
- `crews` - Crew information

### 6. Debugging Workflow
1. Deploy function
2. Test with curl command
3. Check conversation state with MCP
4. Verify database state
5. Fix issues and redeploy
6. Re-test until working

### 7. Common Issues
- **Missing `invited_by`**: Add `invited_by: userId` to invitations
- **Wrong crew context**: Use conversation state, not most recent event
- **Duplicate contacts**: Check existing contacts first
- **Missing `crew_id`**: Ensure stored in conversation state

### 8. File Locations
- **Main handler**: `supabase/functions/funlet-sms-handler-v2/index.ts`
- **Config**: `supabase/config.toml`
- **Working directory**: `/Users/andy/Funlet`

These rules should be applied automatically in future threads for this project.
