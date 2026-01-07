// Script to upload oauth-redirect.html to Supabase Storage with correct Content-Type
// Run with: deno run --allow-net --allow-read upload-oauth-html.js

const SUPABASE_URL = 'https://jjkduivjlzazcvdeeqde.supabase.co';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.log('Set it with: export SUPABASE_SERVICE_ROLE_KEY=your_key');
  Deno.exit(1);
}

const BUCKET_NAME = 'oauth-callback';
const FILE_NAME = 'oauth-redirect.html';
const FILE_PATH = './supabase/storage/oauth-callback/oauth-redirect.html';

async function uploadFile() {
  try {
    // Read the HTML file
    console.log('📖 Reading HTML file...');
    const fileContent = await Deno.readTextFile(FILE_PATH);
    console.log(`✅ File read: ${fileContent.length} bytes`);

    // Convert to Blob with correct Content-Type
    const blob = new Blob([fileContent], { type: 'text/html' });
    
    // Upload to Supabase Storage
    console.log(`📤 Uploading to ${BUCKET_NAME}/${FILE_NAME}...`);
    const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET_NAME}/${FILE_NAME}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'text/html',
        'x-upsert': 'true', // Replace existing file
      },
      body: blob,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Upload failed:', response.status, response.statusText);
      console.error('Error details:', errorText);
      Deno.exit(1);
    }

    const result = await response.json();
    console.log('✅ Upload successful!');
    console.log('📋 Result:', result);
    
    // Verify the upload
    console.log('\n🔍 Verifying upload...');
    const verifyUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${FILE_NAME}`;
    const verifyResponse = await fetch(verifyUrl, { method: 'HEAD' });
    
    const contentType = verifyResponse.headers.get('content-type');
    console.log(`Content-Type: ${contentType}`);
    
    if (contentType && contentType.includes('text/html')) {
      console.log('✅ Content-Type is correct!');
    } else {
      console.warn('⚠️  Content-Type might be incorrect:', contentType);
    }
    
    console.log(`\n🌐 File URL: ${verifyUrl}`);
    console.log('✅ Upload complete!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    Deno.exit(1);
  }
}

uploadFile();




