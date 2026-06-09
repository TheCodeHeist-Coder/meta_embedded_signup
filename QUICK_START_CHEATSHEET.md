# Quick Start Reference & Cheat Sheet
## Embedded Signup Implementation - Quick Reference

**Official Docs:** 
- [Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Business App Users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)

---

## 30-Second Setup

### Frontend (React Component)
```jsx
import React, { useEffect } from 'react';

export default function WhatsAppSignup() {
  useEffect(() => {
    // Load Facebook SDK
    window.fbAsyncInit = () => {
      FB.init({
        appId: 'YOUR_APP_ID',
        version: 'v25.0'
      });
    };

    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    document.body.appendChild(script);

    // Listen for completion
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'WA_EMBEDDED_SIGNUP' && e.data?.event === 'FINISH') {
        console.log('Signup complete:', e.data.data);
        sendToServer(e.data.data);
      }
    });
  }, []);

  const launch = () => {
    FB.login((res) => {
      if (res.authResponse) {
        sendAuthCode(res.authResponse.code);
      }
    }, {
      config_id: 'YOUR_CONFIG_ID',
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: 'whatsapp_business_app_onboarding',
        sessionInfoVersion: '3'
      }
    });
  };

  return (
    <button onClick={launch}>Launch WhatsApp Signup</button>
  );
}
```

### Backend (Node.js)
```javascript
const express = require('express');
const axios = require('axios');
const app = express();

// Exchange code for token (⚠️ 30 second TTL!)
app.post('/api/auth/exchange-code', async (req, res) => {
  try {
    const { code } = req.body;

    const token = await axios.post(
      'https://graph.facebook.com/v25.0/oauth/access_token',
      {
        client_id: process.env.APP_ID,
        client_secret: process.env.APP_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code
      }
    );

    // Save to database
    await db.saveBusiness({
      wabaId: token.data.user_id,
      accessToken: token.data.access_token
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook receiver
app.post('/webhook', async (req, res) => {
  const { entry } = req.body;

  entry.forEach(e => {
    e.changes.forEach(change => {
      // Process: messages, account_update, history, etc.
      processWebhook(change);
    });
  });

  res.status(200).send('ok');
});

app.listen(3000);
```

---

## Complete Implementation Checklist

### Phase 1: Setup (Facebook App)
- [ ] Create Facebook App
- [ ] Add WhatsApp product
- [ ] Get App ID from dashboard

### Phase 2: Configuration
- [ ] Go to Facebook Login for Business > Settings
- [ ] Enable required toggles:
  - [ ] Client OAuth login
  - [ ] Web OAuth login
  - [ ] Enforce HTTPS
  - [ ] Embedded Browser OAuth Login
  - [ ] Use Strict Mode for redirect URIs
  - [ ] Login with the JavaScript SDK
- [ ] Add domain to "Allowed domains" (https://yourdomain.com)
- [ ] Add domain to "Valid OAuth redirect URIs"

### Phase 3: Configuration Creation
- [ ] Go to Facebook Login for Business > Configurations
- [ ] Click "Create from template"
- [ ] Select "WhatsApp Embedded Signup Configuration With 60 Expiration Token"
- [ ] Copy Configuration ID (you'll need this)

### Phase 4: Frontend Setup
- [ ] Load Facebook SDK asynchronously
- [ ] Initialize SDK with App ID
- [ ] Set up message event listener
- [ ] Set up response callback
- [ ] Create launch function with correct extras
- [ ] Add coexistence toggle (optional)

### Phase 5: Backend Setup
- [ ] Create `/api/auth/exchange-code` endpoint
- [ ] Implement token exchange (⚠️ 30 second window!)
- [ ] Create `/webhook` endpoint
- [ ] Subscribe to webhook fields in dashboard
- [ ] Implement webhook handlers

### Phase 6: Synchronization
- [ ] Create endpoint to initiate sync
- [ ] Implement contacts sync handler
- [ ] Implement history sync handler
- [ ] Create message echo handler
- [ ] Create account update handler

### Phase 7: Testing
- [ ] Test in development with HTTPS
- [ ] Test coexistence mode toggle
- [ ] Test webhook delivery
- [ ] Test with real business account
- [ ] Verify message sync

### Phase 8: Production
- [ ] Move all credentials to environment variables
- [ ] Enable CORS properly
- [ ] Set up error tracking
- [ ] Set up monitoring
- [ ] Set up backups
- [ ] Document for team

---

## Key Code Snippets

### Standard Mode Config
```javascript
{
  config_id: "YOUR_CONFIG_ID",
  response_type: "code",
  override_default_response_type: true,
  extras: { setup: {} }
}
```

### Coexistence Mode Config
```javascript
{
  config_id: "YOUR_CONFIG_ID",
  response_type: "code",
  override_default_response_type: true,
  extras: {
    setup: {},
    featureType: "whatsapp_business_app_onboarding",
    sessionInfoVersion: "3"
  }
}
```

### Handle Session Completion
```javascript
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'WA_EMBEDDED_SIGNUP') return;
  
  if (event.data.event === 'FINISH' || event.data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
    // Success!
    const { phone_number_id, waba_id } = event.data.data;
  }
  
  if (event.data.event === 'CANCEL') {
    // User abandoned or error
    if (event.data.data?.error_code) {
      console.error('Error:', event.data.data.error_message);
    }
  }
});
```

### Exchange Authorization Code (URGENT!)
```javascript
// Must do this within 30 seconds!
const fbLoginCallback = (response) => {
  if (response.authResponse) {
    const code = response.authResponse.code;
    fetch('/api/auth/exchange-code', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
  }
};
```

### Process Webhook Events
```javascript
app.post('/webhook', express.json(), (req, res) => {
  const { entry } = req.body;

  entry.forEach(event => {
    event.changes?.forEach(({ field, value }) => {
      switch(field) {
        case 'account_update':
          // Business connected/disconnected
          console.log(value.event);
          break;
        case 'messages':
          // Incoming customer messages
          console.log(value.messages);
          break;
        case 'history':
          // Chat history sync
          console.log(value.history);
          break;
        case 'smb_app_state_sync':
          // Contact sync
          console.log(value.state_sync);
          break;
        case 'smb_message_echoes':
          // Messages from WhatsApp Business App
          console.log(value.message_echoes);
          break;
      }
    });
  });

  res.status(200).send('ok');
});
```

### Initiate Synchronization
```javascript
async function startSync(phoneNumberId, accessToken) {
  // Sync contacts
  await axios.post(
    `https://graph.facebook.com/v25.0/${phoneNumberId}/smb_app_data`,
    {
      messaging_product: 'whatsapp',
      sync_type: 'smb_app_state_sync'
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // Sync message history
  await axios.post(
    `https://graph.facebook.com/v25.0/${phoneNumberId}/smb_app_data`,
    {
      messaging_product: 'whatsapp',
      sync_type: 'history'
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}
```

---

## Common Configuration Values

| Name | What It Is | Example | Where to Find |
|------|-----------|---------|---------------|
| App ID | Identifies your application | 2140782060178223 | App Dashboard top |
| App Secret | Signs requests (keep secret!) | abc123def456 | App Settings > Basic |
| Config ID | Links signup flow to permissions | 1731129688347511 | Facebook Login > Configurations |
| WABA ID | WhatsApp Business Account ID | 524126980791429 | In signup response |
| Phone Number ID | Business phone number identifier | 106540352242922 | In signup response |
| Business ID | Business portfolio ID | 2729063490586005 | In signup response |

---

## Environment Variables Template

```bash
# Facebook API
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_CONFIG_ID=your_config_id
REDIRECT_URI=https://yourdomain.com/callback

# Webhook
WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token

# Database
DATABASE_URL=postgresql://user:pass@localhost/dbname

# Server
NODE_ENV=production
PORT=3000
DOMAIN=yourdomain.com

# Security
ENCRYPTION_KEY=your_encryption_key_here
JWT_SECRET=your_jwt_secret_here

# Monitoring (Optional)
SENTRY_DSN=https://xxx@sentry.io/12345
GA_TRACKING_ID=UA-XXXXX-XX
```

---

## API Endpoints Summary

### Frontend Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/exchange-code` | Exchange auth code for token |
| POST | `/api/signup/complete` | Handle signup completion |
| GET | `/api/business/:wabaId/status` | Check coexistence status |

### Backend Webhooks
| Field | Purpose | Key Data |
|-------|---------|----------|
| `account_update` | Account status changes | event, phone_number, disconnection_info |
| `messages` | Incoming customer messages | messages[], contacts[] |
| `message_status` | Delivery status updates | statuses[] |
| `history` | Chat history sync | threads[], metadata |
| `smb_app_state_sync` | Contact sync (coexistence) | state_sync[] |
| `smb_message_echoes` | Messages from WhatsApp Business App | message_echoes[] |

---

## Troubleshooting Flowchart

```
Issue?
├─ "Code expired" → Exchange code within 30 seconds
├─ "SDK not loading" → Check domain in dashboard
├─ "Domain not allowed" → Add to Allowed domains + Valid redirect URIs
├─ "Coexistence not showing" → Use correct featureType + sessionInfoVersion
├─ "Webhook not receiving events" → Subscribe to fields in dashboard
├─ "Token exchange fails" → Check app secret, config id, redirect uri
├─ "Message history not syncing" → Webhook must be subscribed to 'history' field
└─ "Can't send messages" → Check phone number status and message throughput limit
```

---

## Performance Quick Tips

```javascript
// ✓ DO THIS
- Exchange code immediately (30s TTL!)
- Respond to webhooks with 200 immediately
- Process webhooks asynchronously
- Use connection pooling for database
- Add indexes on frequently queried fields
- Cache access tokens with refresh logic
- Rate limit at 20 MPS for coexistence

// ✗ DON'T DO THIS
- Delay code exchange
- Wait for processing before responding to webhook
- Process webhooks synchronously
- Create new DB connection per request
- Make N+1 queries
- Hardcode tokens in code
- Exceed 20 MPS for coexistence mode
```

---

## Security Checklist

```
✓ Use HTTPS everywhere
✓ Verify webhook signatures
✓ Store tokens securely (encrypted)
✓ Use environment variables for secrets
✓ Validate all user input
✓ Rate limit API endpoints
✓ Log security events
✓ Refresh tokens before expiry
✓ Monitor for suspicious activity
✓ Require HTTPS in redirect URIs
✓ Don't expose error details to users
✓ Implement CORS properly
```

---

## Quick Debugging

### In Browser Console
```javascript
// Check if SDK loaded
typeof window.FB !== 'undefined'

// Check initialization
FB.getAppId()

// Test login
FB.login((res) => console.log(res))

// View session storage
sessionStorage.getItem('fb_...')

// Check for errors in console (F12)
```

### In Server Logs
```bash
# Check if webhook is being hit
tail -f logs.txt | grep webhook

# Monitor token exchange
grep -i "exchange\|token" logs.txt

# Find errors
grep -i "error\|failed" logs.txt

# Monitor performance
grep -i "duration\|timing" logs.txt
```

### With Postman
1. Import webhook test collection (JSON provided)
2. Set variables (waba_id, phone_number_id)
3. Send test webhook
4. Verify in logs

---

## Learning Path

**Beginner (1-2 hours)**
1. Understand OAuth flow
2. Read: Core Concepts section
3. Setup Facebook App
4. Get to "SDK loads successfully"

**Intermediate (2-4 hours)**
5. Implement token exchange
6. Implement session listener
7. Test signup flow end-to-end
8. Get to "Signup data received by backend"

**Advanced (4+ hours)**
9. Implement all webhook handlers
10. Implement data synchronization
11. Test coexistence mode
12. Production deployment

**Expert (8+ hours)**
13. Implement error handling/retry logic
14. Setup monitoring/alerting
15. Performance optimization
16. Multi-WABA support

---

## Essential Links

- **Docs**: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup
- **Implementation**: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- **Business App Users**: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- **Webhook Reference**: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks
- **Cloud API Docs**: https://developers.facebook.com/documentation/business-messaging/whatsapp
- **Graph API Explorer**: https://developers.facebook.com/tools/explorer
- **App Dashboard**: https://developers.facebook.com/apps

---

## Getting Help

### Self-Debug First
1. Check error message carefully
2. Review this cheat sheet
3. Search error code in TESTING_TROUBLESHOOTING_GUIDE.md
4. Check browser console (F12)
5. Check server logs

### Getting Support
- **General Issues**: Facebook Developer Community Forum
- **Bug Reports**: https://developers.facebook.com/support/bugs/
- **Escalation**: Use app dashboard > Help > Support Center
- **Business Issues**: Include error_code, session_id, timestamp from webhook

---

**Last Updated:** June 9, 2026  
**Version:** 1.0  

**Pro Tip:** Bookmark this page! You'll come back to it frequently. ⭐
