import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

Deno.serve(async (req)=>{
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
    const postmarkToken = Deno.env.get("POSTMARK_API_KEY");
    const fromEmail = Deno.env.get("POSTMARK_FROM_EMAIL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!postmarkToken) {
      return new Response(JSON.stringify({
        error: "Missing POSTMARK_API_KEY environment variable"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (!fromEmail) {
      return new Response(JSON.stringify({
        error: "Missing POSTMARK_FROM_EMAIL environment variable"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

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

    const email = body?.email;
    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({
        error: "'email' is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({
        error: "Invalid email format"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Generate password reset link using Supabase Auth
    const { data: resetData, error: resetError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${Deno.env.get('SITE_URL') || 'https://funlet.ai'}/reset-password`
      }
    });

    if (resetError || !resetData) {
      return new Response(JSON.stringify({
        error: "User not found or failed to generate reset link"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const supabaseResetLink = resetData.properties?.action_link;
    if (!supabaseResetLink) {
      return new Response(JSON.stringify({
        error: "Failed to generate reset link"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Extract token from Supabase auth link
    const url = new URL(supabaseResetLink);
    const token = url.searchParams.get('token');
    
    if (!token) {
      return new Response(JSON.stringify({
        error: "Failed to extract token from reset link"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Create custom reset password URL with token
    const resetLink = `https://www.funlet.ai/reset_password_trail?token=${token}`;

    // Log the reset link for testing purposes
    console.log("=== PASSWORD RESET LINK ===");
    console.log("Email:", email);
    console.log("Supabase Auth Link:", supabaseResetLink);
    console.log("Extracted Token:", token);
    console.log("Custom Reset Link:", resetLink);
    console.log("=== END RESET LINK ===");

    const subject = "Reset your Funlet password";
    const textBody = `Hi there,\n\nYou requested a password reset for your Funlet account. Click the link below to create a new password:\n\n${resetLink}\n\nThis link expires in 24 hours. If you didn't request this reset, you can safely ignore this email.\n\nNeed help? Reply to this email or contact support@funlet.ai\n\nThanks,\nThe Funlet Team`;
    
    const htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
          <!-- Funlet Logo -->
          <div style="text-align: center; margin-bottom: 40px;">
            <img src="https://cdn.weweb.io/designs/c5443708-06df-4852-bea4-33a82c04ee60/sections/Funlet__Logo_100.png?_wwcv=1756176528435" 
                 alt="Funlet Logo" 
                 style="max-width: 200px; height: auto; display: block; margin: 0 auto;" />
          </div>
          
          <!-- Main Content -->
          <div style="background-color: #ffffff; padding: 0; margin-bottom: 30px;">
            <p style="font-size: 16px; color: #374151; margin-bottom: 25px; line-height: 1.6;">
              Hi there,
            </p>
            
            <p style="font-size: 16px; color: #374151; margin-bottom: 25px; line-height: 1.6;">
              You requested a password reset for your Funlet account. Click the link below to create a new password:
            </p>
            
            <!-- Reset Password Button -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="${resetLink}" 
                 style="display: inline-block; background-color: #F46C3B; color: white; text-decoration: none; padding: 15px 35px; border-radius: 8px; font-weight: bold; font-size: 16px; letter-spacing: 0.5px;">
                Reset Password
              </a>
            </div>
            
            <p style="font-size: 14px; color: #6b7280; margin-bottom: 25px; line-height: 1.6;">
              This link expires in <strong>24 hours</strong>. If you didn't request this reset, you can safely ignore this email.
            </p>
            
            <p style="font-size: 14px; color: #6b7280; margin-bottom: 25px; line-height: 1.6;">
              Need help? Reply to this email or contact <a href="mailto:support@funlet.ai" style="color: #F46C3B; text-decoration: none;">support@funlet.ai</a>
            </p>
            
            <p style="font-size: 14px; color: #374151; margin-bottom: 0; line-height: 1.6;">
              Thanks,<br>
              The Funlet Team
            </p>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="font-size: 12px; color: #9ca3af; margin: 0;">
              © 2024 Funlet. All rights reserved.
            </p>
          </div>
        </body>
      </html>
    `;

    // Skip email sending for testing - just log the link
    console.log("=== SKIPPING EMAIL SEND FOR TESTING ===");
    console.log("Would send email to:", email);
    console.log("Subject:", subject);
    
    // Uncomment the following block when Postmark is configured properly
    /*
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": postmarkToken
      },
      body: JSON.stringify({
        From: fromEmail,
        To: email,
        Subject: subject,
        TextBody: textBody,
        HtmlBody: htmlBody,
        MessageStream: "outbound"
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({
        error: "Failed to send email via Postmark",
        details: errText
      }), {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    */

    return new Response(JSON.stringify({
      success: true,
      message: "Password reset link sent to your email",
      expires_in: "1 hour",
      reset_link: resetLink  // Include link in response for testing
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
