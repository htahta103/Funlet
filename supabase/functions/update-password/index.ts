import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({
        error: "Invalid JSON body"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const token = body?.token;
    const newPassword = body?.new_password;

    if (!token || !newPassword) {
      return new Response(JSON.stringify({
        error: "'token' and 'new_password' are required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Validate password strength
    if (newPassword.length < 6) {
      return new Response(JSON.stringify({
        error: "Password must be at least 6 characters long"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Log the token for debugging
    console.log("=== PASSWORD UPDATE REQUEST ===");
    console.log("Token:", token);
    console.log("Password length:", newPassword.length);
    console.log("=== END PASSWORD UPDATE REQUEST ===");

    // Verify the recovery token and get user info
    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: 'recovery'
    });

    if (verifyError || !verifyData.user) {
      console.error("Token verification failed:", verifyError);
      return new Response(JSON.stringify({
        error: "Invalid or expired reset token"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    console.log("Token verified successfully for user:", verifyData.user.email);

    // Update the user's password using admin client
    const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
      verifyData.user.id,
      {
        password: newPassword
      }
    );

    if (updateError) {
      console.error("Password update failed:", updateError);
      return new Response(JSON.stringify({
        error: "Failed to update password",
        details: updateError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    console.log("Password updated successfully for user:", verifyData.user.email);

    return new Response(JSON.stringify({
      success: true,
      message: "Password updated successfully",
      user: {
        id: verifyData.user.id,
        email: verifyData.user.email
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Unexpected error:", message);
    return new Response(JSON.stringify({
      error: `Internal server error: ${message}`
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
