# WhatsApp Business API Embedded Signup
## Complete Implementation Summary (3-4 Pages)

---

## 1. What is Embedded Signup?

**Embedded Signup** is a secure OAuth authentication flow that allows customers to integrate with the WhatsApp Business Cloud API without leaving your application. Instead of redirecting to Facebook, users authenticate within your app and receive an authorization code that's exchanged for access tokens.

**Key Benefits:**
- Seamless user experience (no external redirects)
- Secure token handling
- Support for multiple WhatsApp accounts
- Optional coexistence with WhatsApp Business App

**Coexistence Mode:** Enables businesses to use both WhatsApp Business App (for one-to-one messaging) and Cloud API (for automation) simultaneously with message synchronization.

**Official Documentation:**
- Implementation: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- Business App Users: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ USER BROWSER                                               │
├─────────────────────────────────────────────────────────────┤
│ 1. Click "Sign Up with WhatsApp"                           │
│ 2. Facebook SDK launches login dialog                       │
│ 3. User authorizes (gets code with 30s TTL)               │
│ 4. Code sent to backend immediately                        │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ YOUR BACKEND SERVER                                        │
├─────────────────────────────────────────────────────────────┤
│ 5. Receive auth code ⚠️ URGENT: Must exchange now!        │
│ 6. Exchange code → Access Token + WABA ID                 │
│ 7. Save token securely to database                        │
│ 8. Initiate synchronization (if coexistence)              │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ META WEBHOOKS                                              │
├─────────────────────────────────────────────────────────────┤
│ 9. Receive: messages, account_update, history, etc.       │
│ 10. Process events and sync data                          │
│ 11. Send responses back to customers                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Key Configuration Values

| Parameter | Example | Where to Find |
|-----------|---------|---------------|
| **App ID** | 2140782060178223 | App Dashboard |
| **App Secret** | abc123def456 | App Settings > Basic |
| **Config ID** | 1731129688347511 | Facebook Login > Configurations |
| **WABA ID** | 524126980791429 | Session event listener (after signup) |
| **Phone Number ID** | 106540352242922 | Session event listener (after signup) |

---

## 4. Standard vs Coexistence Configuration

### Standard Mode
```javascript
const config = {
  config_id: "YOUR_CONFIG_ID",
  response_type: "code",
  override_default_response_type: true,
  extras: { setup: {} }
};
```

### Coexistence Mode (With WhatsApp Business App)
```javascript
const config = {
  config_id: "YOUR_CONFIG_ID",
  response_type: "code",
  override_default_response_type: true,
  extras: {
    setup: {},
    featureType: "whatsapp_business_app_onboarding",
    sessionInfoVersion: "3"
  }
};
```

**Key Difference:** Coexistence includes `featureType` + `sessionInfoVersion` to allow using both apps simultaneously with message syncing.

---

## 5. Implementation Checklist

### Frontend (React)
- [ ] Load Facebook SDK asynchronously
- [ ] Initialize FB SDK with App ID
- [ ] Create session event listener for signup completion
- [ ] Implement response callback to capture authorization code
- [ ] Create launch function with correct config (standard or coexistence)
- [ ] Add coexistence toggle (optional)
- [ ] Handle errors gracefully

### Backend (Node.js)
- [ ] Create `/api/auth/exchange-code` endpoint (⚠️ **30-second TTL!**)
- [ ] Exchange code for access token immediately
- [ ] Save token to database securely (encrypted)
- [ ] Create webhook receiver endpoint (`/webhook`)
- [ ] Verify webhook signatures
- [ ] Subscribe to webhook fields in dashboard

### Synchronization (Coexistence Only)
- [ ] Implement contact sync handler
- [ ] Implement message history sync handler
- [ ] Implement message echo handler (messages from WhatsApp Business App)
- [ ] Implement account update handler (connection/disconnection)

### Database (PostgreSQL)
- [ ] Create `businesses` table (stores access tokens)
- [ ] Create `contacts` table (synced contacts)
- [ ] Create `messages` table (message history)
- [ ] Create `sync_requests` table (track sync operations)
- [ ] Add indexes for performance

---

## 6. Critical Code: Immediate Token Exchange

### ⚠️ CRITICAL: 30-Second Authorization Code TTL

```javascript
// Frontend - SEND IMMEDIATELY when code received
const fbLoginCallback = (response) => {
  if (response.authResponse) {
    const code = response.authResponse.code;
    
    // Send WITHOUT delays (max 30 seconds!)
    fetch('/api/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    }).catch(err => console.error('Code exchange failed:', err));
  }
};

// Backend - EXCHANGE IMMEDIATELY
app.post('/api/auth/exchange-code', async (req, res) => {
  const { code } = req.body;

  try {
    const response = await axios.post(
      'https://graph.facebook.com/v25.0/oauth/access_token',
      {
        client_id: process.env.APP_ID,
        client_secret: process.env.APP_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code  // Must use within 30 seconds!
      }
    );

    // Save token encrypted
    await db.saveBusiness({
      wabaId: response.data.user_id,
      accessToken: response.data.access_token
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ 
      error: 'Code exchange failed',
      message: error.message 
    });
  }
});
```

---

## 7. Webhook Integration

### Event Types
| Event | Purpose | Handler Action |
|-------|---------|---|
| `account_update` | Account connected/disconnected | Update business status |
| `messages` | Customer sends message | Save & route message |
| `message_status` | Message delivery updates | Update message status |
| `history` | Chat history sync (coexistence) | Store message history |
| `smb_app_state_sync` | Contact sync (coexistence) | Sync contacts |
| `smb_message_echoes` | Messages from WhatsApp Business App | Mirror to Cloud API |

### Webhook Receiver (Express)
```javascript
// Webhook verification (GET request)
app.get('/webhook', (req, res) => {
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (token === process.env.WEBHOOK_VERIFY_TOKEN) {
    res.send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Webhook event handler (POST request)
app.post('/webhook', express.json(), (req, res) => {
  // Always respond 200 immediately
  res.status(200).send('ok');

  // Process asynchronously
  setImmediate(async () => {
    const { entry } = req.body;
    
    entry?.forEach(e => {
      e.changes?.forEach(change => {
        const { field, value } = change;
        
        if (field === 'messages') {
          handleIncomingMessages(value.messages);
        } else if (field === 'account_update') {
          handleAccountUpdate(value);
        } else if (field === 'history') {
          handleHistorySync(value);
        } else if (field === 'smb_app_state_sync') {
          handleContactSync(value);
        } else if (field === 'smb_message_echoes') {
          handleMessageEchoes(value);
        }
      });
    });
  });
});
```

---

## 8. Five Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| **"Code expired" (Error 190)** | Code not exchanged within 30 seconds | Exchange code immediately without delays |
| **"Domain not allowed"** | Domain not added to dashboard | Add domain to "Allowed domains" + "Valid OAuth redirect URIs" in Facebook App Settings |
| **"SDK not loading"** | Network or domain issue | Verify HTTPS, check domain config, add to Facebook app |
| **"Coexistence not showing"** | Wrong configuration parameters | Use `featureType: "whatsapp_business_app_onboarding"` + `sessionInfoVersion: "3"` |
| **"Webhook not receiving events"** | Fields not subscribed in dashboard | Go to WhatsApp > Configuration > Webhooks, subscribe to all required fields |

---

## 9. Environment Variables

```bash
# Facebook API
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_CONFIG_ID=your_config_id
REDIRECT_URI=https://yourdomain.com/callback

# Webhook
WEBHOOK_VERIFY_TOKEN=your_webhook_token

# Database
DATABASE_URL=postgresql://user:password@localhost/whatsapp_esb

# Security
JWT_SECRET=your_secret
ENCRYPTION_KEY=your_encryption_key
```

---

## 10. Implementation Timeline

| Phase | Tasks | Time | Resources |
|-------|-------|------|-----------|
| **Setup** | Create app, get credentials | 1 hr | App Dashboard |
| **Configuration** | Enable OAuth, add domains | 30 min | Facebook Settings |
| **Frontend** | SDK, session listener, launch button | 2 hrs | QUICK_START_CHEATSHEET.md |
| **Backend** | Token exchange, webhook receiver | 2 hrs | SERVER_IMPLEMENTATION_GUIDE.md |
| **Sync** (Coexistence) | Contact/history sync handlers | 1 hr | SERVER_IMPLEMENTATION_GUIDE.md |
| **Testing** | Unit/integration/E2E tests | 2 hrs | TESTING_TROUBLESHOOTING_GUIDE.md |
| **Production** | Env vars, monitoring, security | 1 hr | QUICK_START_CHEATSHEET.md |
| **TOTAL** | Complete implementation | 10 hrs | — |

---

## 11. Security Requirements

✓ HTTPS everywhere (frontend, backend, webhooks)
✓ Encrypt tokens in database
✓ Verify webhook signatures (`X-Hub-Signature-256`)
✓ Use environment variables for secrets
✓ Rate limit: 20 messages/second (coexistence mode)
✓ Implement token refresh before expiry
✓ Validate all user input
✓ Use CSRF protection
✓ Log security events

---

## 12. What's Next?

1. **Start Here:** Read `QUICK_START_CHEATSHEET.md` (5 mins)
2. **Implement:** Follow implementation checklist (10 hours)
3. **Test:** Use provided test cases
4. **Deploy:** Use security checklist
5. **Reference:** Keep `DOCUMENTATION_INDEX.md` bookmarked

---

## Complete Documentation Files

All detailed documentation available in project folder:

1. **QUICK_START_CHEATSHEET.md** - Quick reference & code snippets
2. **COMPLETE_LEARNING_GUIDE.md** - Full concepts & implementation
3. **SERVER_IMPLEMENTATION_GUIDE.md** - Backend deep dive
4. **TESTING_TROUBLESHOOTING_GUIDE.md** - Testing & debugging
5. **DOCUMENTATION_INDEX.md** - Master index & navigation

---

## Key Takeaways

✅ **30-second TTL is critical** - Exchange authorization code immediately  
✅ **Coexistence requires special config** - Different `featureType` & `sessionInfoVersion`  
✅ **Webhooks must be fast** - Respond with 200, process asynchronously  
✅ **Security first** - HTTPS, signatures, encrypted tokens  
✅ **Test thoroughly** - Unit, integration, and E2E tests  

---

**Version:** 1.0  
**Date:** June 9, 2026  
**Status:** Production Ready ✅

---

## PDF Conversion

To convert this to PDF, use one of these methods:

**Option 1: VS Code Extension**
- Install "Markdown PDF" extension
- Right-click file → "Markdown PDF: Export (PDF)"

**Option 2: Online Converter**
- Copy content to https://markdowntopdf.com/

**Option 3: Command Line (Pandoc)**
```bash
pandoc EXECUTIVE_SUMMARY_PDF.md -o WhatsApp_Embedded_Signup_Summary.pdf
```

**Option 4: Print to PDF**
- View in browser/VS Code
- Print (Ctrl+P) → Save as PDF

---
