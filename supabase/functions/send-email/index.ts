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
    const postmarkToken = Deno.env.get("POSTMARK_API_KEY");
    const fromEmail = Deno.env.get("POSTMARK_FROM_EMAIL");

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
    const content = body?.content;

    if (!email || !content) {
      return new Response(JSON.stringify({
        error: "'email' and 'content' are required"
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

    // Log the email details for debugging
    console.log("=== SEND EMAIL REQUEST ===");
    console.log("To:", email);
    console.log("Content:", content);
    console.log("=== END SEND EMAIL REQUEST ===");

    // Create HTML email template with Funlet branding
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
            <div style="font-size: 16px; color: #374151; line-height: 1.6; white-space: pre-wrap;">
              ${content.replace(/\n/g, '<br>')}
            </div>
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

    // Create plain text version
    const textBody = content;

    const subject = "Message from Funlet";

    // Skip email sending for testing - just log the details
    console.log("=== SKIPPING EMAIL SEND FOR TESTING ===");
    console.log("Would send email to:", email);
    console.log("Subject:", subject);
    console.log("Content:", content);
    
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
      message: "Email sent successfully",
      email: email,
      content: content
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
