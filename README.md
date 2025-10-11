# Funlet Supabase Project

This is the local development environment for the Funlet Supabase project. All edge functions have been downloaded and are ready for local development.

## Project Information

- **Project ID**: `jjkduivjlzazcvdeeqde`
- **Organization**: `wwsirmjhlypfznswjqne`
- **Region**: `us-west-1`
- **Status**: `ACTIVE_HEALTHY`

## Edge Functions

The following edge functions have been downloaded and are available locally:

### 1. `send-invitations`
- **Purpose**: Sends SMS invitations to crew members for events
- **JWT Verification**: Disabled
- **Dependencies**: Twilio for SMS sending
- **Key Features**:
  - Generates unique invitation codes
  - Formats phone numbers for Twilio
  - Auto-RSVPs the organizer
  - Sends SMS with event details and RSVP link

### 2. `send-group-message`
- **Purpose**: Sends group SMS messages to multiple recipients
- **JWT Verification**: Enabled
- **Dependencies**: Twilio for SMS sending
- **Key Features**:
  - Sends messages to multiple phone numbers
  - Logs SMS attempts to database
  - Handles invalid phone number formats

### 3. `get-rsvp-data`
- **Purpose**: Retrieves RSVP data for a specific invitation code
- **JWT Verification**: Enabled
- **Key Features**:
  - Fetches invitation, contact, and event data
  - Returns structured response with host information
  - Handles CORS for WeWeb integration

### 4. `create-checkout-session`
- **Purpose**: Creates Stripe checkout sessions for subscriptions
- **JWT Verification**: Enabled
- **Dependencies**: Stripe for payment processing
- **Key Features**:
  - Creates subscription checkout sessions
  - Handles metadata for user tracking
  - Supports success/cancel URL configuration

### 5. `create-user-contact`
- **Purpose**: Creates contact records for users
- **JWT Verification**: Enabled
- **Key Features**:
  - Creates contacts with user_id, first_name, and phone_number
  - Comprehensive error handling and logging
  - Enhanced CORS support

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Supabase CLI (if not already installed)

```bash
npm install -g supabase
```

### 3. Link to Your Supabase Project

```bash
supabase link --project-ref jjkduivjlzazcvdeeqde
```

### 4. Set Up Environment Variables

Create a `.env.local` file with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=https://jjkduivjlzazcvdeeqde.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Twilio Configuration (for SMS functions)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# Stripe Configuration (for checkout function)
STRIPE_SECRET_KEY=your_stripe_secret_key
```

### 5. Start Local Development

```bash
# Start Supabase services locally
npm run supabase:start

# Serve edge functions locally
npm run supabase:functions:serve
```

## Development Workflow

### Testing Edge Functions Locally

1. **Start the local Supabase stack**:
   ```bash
   npm run supabase:start
   ```

2. **Serve edge functions**:
   ```bash
   npm run supabase:functions:serve
   ```

3. **Test functions** using curl or your preferred HTTP client:
   ```bash
   # Example: Test send-invitations
   curl -X POST http://localhost:54321/functions/v1/send-invitations \
     -H "Content-Type: application/json" \
     -d '{"event_id": "123", "selected_member_ids": ["456"], "inviting_user_id": "789"}'
   ```

### Deploying Changes

1. **Deploy a specific function**:
   ```bash
   supabase functions deploy send-invitations
   ```

2. **Deploy all functions**:
   ```bash
   npm run supabase:functions:deploy
   ```

### Database Operations

- **Pull latest schema**: `npm run supabase:db:pull`
- **Push local changes**: `npm run supabase:db:push`
- **Reset database**: `npm run supabase:db:reset`

## Project Structure

```
funlet/
├── supabase/
│   ├── config.toml                 # Supabase configuration
│   └── functions/
│       ├── send-invitations/       # SMS invitation function
│       ├── send-group-message/     # Group SMS function
│       ├── get-rsvp-data/          # RSVP data retrieval
│       ├── create-checkout-session/ # Stripe checkout
│       └── create-user-contact/    # Contact creation
├── package.json                    # Node.js dependencies
└── README.md                      # This file
```

## API Endpoints

When running locally, your edge functions will be available at:
- `http://localhost:54321/functions/v1/send-invitations`
- `http://localhost:54321/functions/v1/send-group-message`
- `http://localhost:54321/functions/v1/get-rsvp-data`
- `http://localhost:54321/functions/v1/create-checkout-session`
- `http://localhost:54321/functions/v1/create-user-contact`

## Troubleshooting

### Common Issues

1. **Port conflicts**: Make sure ports 54321-54329 are available
2. **Environment variables**: Ensure all required env vars are set
3. **Database connection**: Check that your Supabase project is accessible

### Getting Help

- Check Supabase logs: `supabase logs`
- View function logs: `supabase functions logs <function-name>`
- Access Supabase Studio: `http://localhost:54323`

## Next Steps

1. Set up your environment variables
2. Start the local development environment
3. Test the edge functions
4. Make your modifications
5. Deploy changes when ready

Happy coding! 🚀
