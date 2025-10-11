#!/usr/bin/env node

/**
 * Clear Conversation State Script
 * This script clears the conversation_state table for testing the streamlined INVITE_MORE_PEOPLE workflow
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = 'https://jjkduivjlzazcvdeeqde.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key-here';

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearConversationState() {
  try {
    console.log('🧹 Clearing conversation_state table...');
    
    // Clear all conversation state records
    const { data, error } = await supabase
      .from('conversation_state')
      .delete()
      .neq('id', 0); // Delete all records (id is never 0)
    
    if (error) {
      console.error('❌ Error clearing conversation state:', error);
      return;
    }
    
    console.log('✅ Successfully cleared conversation_state table');
    console.log('📊 Deleted records:', data?.length || 'unknown');
    
    // Verify the table is empty
    const { data: remainingRecords, error: checkError } = await supabase
      .from('conversation_state')
      .select('id')
      .limit(1);
    
    if (checkError) {
      console.error('❌ Error checking remaining records:', checkError);
      return;
    }
    
    if (remainingRecords && remainingRecords.length === 0) {
      console.log('✅ Conversation state table is now empty');
    } else {
      console.log('⚠️  Some records may still remain');
    }
    
    console.log('\n🎯 Ready to test the streamlined INVITE_MORE_PEOPLE workflow!');
    console.log('📱 Try sending "invite more people" to test the new flow');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the script
clearConversationState();
