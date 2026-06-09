# Embedded Signup Complete Learning Guide
## WhatsApp Business API Integration with Coexistence Mode

**Date Created:** June 9, 2026  
**Version:** 1.0  
**Official References:**
- [Implementation Documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Business App Onboarding Guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)

---

## Table of Contents
1. [Core Concepts](#core-concepts)
2. [Frontend Implementation](#frontend-implementation)
3. [Coexistence Mode Deep Dive](#coexistence-mode-deep-dive)
4. [Webhook Integration](#webhook-integration)
5. [Server-Side Implementation](#server-side-implementation)
6. [Advanced Features](#advanced-features)
7. [Troubleshooting & Best Practices](#troubleshooting--best-practices)
8. [Complete Examples](#complete-examples)

---

## Core Concepts

### What is Embedded Signup?

**Definition:** Embedded Signup (ESB) is a streamlined authentication flow that allows business users to:
- Sign up for WhatsApp Business API access directly within your application
- Authorize your app to manage their WhatsApp Business Account (WABA)
- Grant necessary permissions for WhatsApp messaging operations

**Key Benefits:**
- No external redirects (users stay in your app)
- Seamless user experience
- Automatic asset creation
- Secure authorization code exchange

### Understanding Coexistence Mode

**What is it?**
Coexistence allows businesses to maintain both:
1. **WhatsApp Business App** - Desktop/mobile app for one-to-one messaging
2. **Cloud API** - Your app for automated/bulk messaging

**Why use it?**
- Personal customer interactions via WhatsApp Business App
- Automated notifications via Cloud API
- Synchronized message history between both platforms
- No switching between tools for businesses

**Technical Implications:**
- Message throughput limited to 20 MPS (messages per second)
- Shared conversation windows
- Synchronized contacts and history
- Special webhook requirements

---

## Frontend Implementation

### Step 1: Setup Configuration in Facebook App Dashboard

```javascript
// 1. Go to App Dashboard > Facebook Login for Business > Settings
// 2. Enable these toggles:
// ✓ Client OAuth login
// ✓ Web OAuth login
// ✓ Enforce HTTPS
// ✓ Embedded Browser OAuth Login
// ✓ Use Strict Mode for redirect URIs
// ✓ Login with the JavaScript SDK

// 3. Add your domains to "Allowed domains" and "Valid OAuth redirect URIs"
// Example domains:
// - https://yourdomain.com
// - https://app.yourdomain.com
// - https://localhost:3000 (for development with HTTPS)

// 4. Create Configuration:
// - Navigate to Facebook Login for Business > Configurations
// - Click "Create from template"
// - Use "WhatsApp Embedded Signup Configuration With 60 Expiration Token"
// - Note your CONFIG_ID (you'll need this for implementation)
```

### Step 2: Load Facebook SDK

```html
<!-- SDK loading - Place in <head> or just before </body> -->
<script async defer crossorigin="anonymous" 
  src="https://connect.facebook.net/en_US/sdk.js"></script>
```

### Step 3: Initialize SDK

```javascript
// SDK Initialization - Must happen after SDK loads
window.fbAsyncInit = function() {
  FB.init({
    appId: '2140782060178223',        // Your App ID
    autoLogAppEvents: true,            // Track events automatically
    xfbml: true,                       // Enable XFBML parsing
    version: 'v25.0'                   // Latest API version
  });
};
```

### Step 4: Session Logging (Capture Asset IDs)

```javascript
// Message Event Listener - Captures completion, abandonment, and errors
window.addEventListener('message', (event) => {
  // Security check: Only accept Facebook events
  if (!event.origin.endsWith('facebook.com')) return;
  
  try {
    const data = JSON.parse(event.data);
    
    if (data.type === 'WA_EMBEDDED_SIGNUP') {
      console.log('Session event:', data);
      
      // Handle different event types
      switch(data.event) {
        case 'FINISH':
        case 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING':
          handleSuccessfulCompletion(data.data);
          break;
          
        case 'CANCEL':
          if (data.data.error_code) {
            handleError(data.data);
          } else {
            handleAbandonedFlow(data.data.current_step);
          }
          break;
      }
    }
  } catch (error) {
    console.error('Failed to parse message event:', error);
  }
});

// Handle successful completion
function handleSuccessfulCompletion(sessionData) {
  // sessionData includes:
  // - phone_number_id: Business phone number ID
  // - waba_id: WhatsApp Business Account ID
  // - business_id: Business portfolio ID
  // - (optional) ad_account_ids: Ad accounts
  // - (optional) page_ids: Facebook pages
  // - (optional) dataset_ids: Datasets
  // - (optional) catalog_ids: Product catalogs
  
  console.log('Business Phone ID:', sessionData.phone_number_id);
  console.log('WABA ID:', sessionData.waba_id);
  
  // Send to your server
  fetch('/api/signup/completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionData)
  });
}

// Handle abandoned flow
function handleAbandonedFlow(currentStep) {
  console.log('User abandoned at:', currentStep);
  // Possible steps: PHONE_NUMBER_SETUP, BUSINESS_SETUP, etc.
  
  // Track in analytics
  trackEvent('embedded_signup_abandoned', { step: currentStep });
}

// Handle errors
function handleError(errorData) {
  // errorData includes:
  // - error_message: Human-readable error
  // - error_code: Error code for support
  // - session_id: Session identifier
  // - timestamp: When error occurred
  
  console.error('Signup error:', errorData.error_message);
  console.error('Error code:', errorData.error_code);
  
  // Send to support system
  logToSupport({
    type: 'embedded_signup_error',
    ...errorData
  });
}
```

### Step 5: Response Callback (Get Authorization Code)

```javascript
// Callback function executed when user completes flow
const fbLoginCallback = (response) => {
  if (response.authResponse) {
    // Authorization code (valid for 30 seconds!)
    const code = response.authResponse.code;
    
    console.log('Authorization Code:', code);
    
    // CRITICAL: Send to server immediately (30 second TTL)
    exchangeAuthCode(code);
  } else {
    console.log('User cancelled login or did not fully authorize');
    console.log('Full response:', response);
  }
};

// Exchange code for access token (server-side)
async function exchangeAuthCode(code) {
  try {
    const response = await fetch('/api/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('Token exchange successful');
      // Redirect to onboarding completion
      window.location.href = '/onboarding/success';
    }
  } catch (error) {
    console.error('Failed to exchange code:', error);
  }
}
```

### Step 6: Launch Method

```javascript
// Launch the Embedded Signup flow
const launchWhatsAppSignup = (useCoexistence = true) => {
  // Verify SDK is loaded
  if (!window.FB) {
    alert('Facebook SDK not loaded yet. Please refresh.');
    return;
  }

  // Configuration for standard flow
  const launchConfig = {
    config_id: '1731129688347511',      // Your Configuration ID
    response_type: 'code',               // Always use 'code', not 'token'
    override_default_response_type: true // Ensure code is returned
  };

  // Add extras for coexistence mode
  if (useCoexistence) {
    launchConfig.extras = {
      setup: {},                                      // Required for coexistence
      featureType: 'whatsapp_business_app_onboarding', // Enables coexistence
      sessionInfoVersion: '3'                         // Use latest version
    };
  } else {
    launchConfig.extras = {
      setup: {}  // Standard setup without coexistence
    };
  }

  console.log('Launching signup with config:', launchConfig);
  
  // Launch the flow
  FB.login(fbLoginCallback, launchConfig);
};

// Create a button to launch
// <button onclick="launchWhatsAppSignup(true)">
//   Launch WhatsApp Signup with Coexistence
// </button>
```

### Step 7: Complete Frontend React Component

```javascript
import React, { useEffect, useState } from 'react';

export default function WhatsAppSignup() {
  const [isCoexistence, setIsCoexistence] = useState(true);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [error, setError] = useState(null);

  // SDK Initialization - Runs once
  useEffect(() => {
    if (window.FB) {
      setSdkLoaded(true);
      return;
    }

    window.fbAsyncInit = function() {
      FB.init({
        appId: '2140782060178223',
        autoLogAppEvents: true,
        xfbml: true,
        version: 'v25.0'
      });
      setSdkLoaded(true);
    };

    // Load SDK script
    if (document.getElementById('facebook-jssdk')) return;

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    document.body.appendChild(script);
  }, []);

  // Session logging listener
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.origin.endsWith('facebook.com')) return;
      
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          handleSessionEvent(data);
        }
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSessionEvent = (data) => {
    switch(data.event) {
      case 'FINISH':
      case 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING':
        setSessionInfo(data.data);
        sendToServer('/api/signup/complete', data.data);
        break;
        
      case 'CANCEL':
        if (data.data.error_code) {
          setError(`Error: ${data.data.error_message}`);
        }
        break;
    }
  };

  const fbLoginCallback = (response) => {
    setLoading(false);
    
    if (response.authResponse) {
      const code = response.authResponse.code;
      sendToServer('/api/auth/exchange-code', { code });
    } else {
      setError('Authentication failed');
    }
  };

  const sendToServer = async (endpoint, data) => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!result.success) {
        setError(result.message);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const launchWhatsAppSignup = () => {
    if (!sdkLoaded) {
      setError('Facebook SDK not loaded');
      return;
    }

    setLoading(true);
    setError(null);

    const config = {
      config_id: '1731129688347511',
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        ...(isCoexistence && {
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3'
        })
      }
    };

    FB.login(fbLoginCallback, config);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>WhatsApp Business Signup</h1>

      <label style={{ display: 'block', marginBottom: '16px' }}>
        <input
          type="checkbox"
          checked={isCoexistence}
          onChange={(e) => setIsCoexistence(e.target.checked)}
          style={{ marginRight: '8px' }}
        />
        Enable WhatsApp Business App Coexistence
      </label>

      <button
        onClick={launchWhatsAppSignup}
        disabled={loading || !sdkLoaded}
        style={{
          backgroundColor: loading || !sdkLoaded ? '#ccc' : '#1877f2',
          color: '#fff',
          border: 'none',
          padding: '12px 24px',
          borderRadius: '4px',
          cursor: loading || !sdkLoaded ? 'not-allowed' : 'pointer',
          fontSize: '16px'
        }}
      >
        {loading ? 'Processing...' : 'Login with Facebook'}
      </button>

      {error && <div style={{ color: 'red', marginTop: '16px' }}>{error}</div>}

      {sessionInfo && (
        <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f0f0f0' }}>
          <h3>Signup Complete!</h3>
          <pre>{JSON.stringify(sessionInfo, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

---

## Coexistence Mode Deep Dive

### Understanding the Coexistence Configuration

```javascript
// STANDARD SIGNUP (No Coexistence)
{
  config_id: "1731129688347511",
  response_type: "code",
  override_default_response_type: true,
  extras: {
    setup: {}
  }
}

// COEXISTENCE MODE
{
  config_id: "1731129688347511",
  response_type: "code",
  override_default_response_type: true,
  extras: {
    setup: {},
    featureType: "whatsapp_business_app_onboarding",  // KEY: Enables coexistence
    sessionInfoVersion: "3"                           // Latest session format
  }
}
```

### Key Differences Between Modes

| Feature | Standard | Coexistence |
|---------|----------|------------|
| Business uses Cloud API only | ✓ | ✗ |
| Business uses WhatsApp Business App | ✗ | ✓ |
| Synced message history | N/A | ✓ |
| Synced contacts | N/A | ✓ |
| Message throughput | Unlimited | 20 MPS |
| Cloud API messages pricing | Normal | Normal |
| WhatsApp Business App messages pricing | N/A | FREE |
| Conversation windows | API only | Shared |
| Group chat support | ✓ | ✗ |

### Coexistence Session Event Response

```javascript
{
  data: {
    phone_number_id: "106540352242922",    // Business phone number ID
    waba_id: "524126980791429",             // WhatsApp Business Account ID
    business_id: "2729063490586005"         // Business portfolio ID
  },
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"  // KEY: Different event type
}
```

### Conditional Launch Logic

```javascript
function launchSignup(coexistenceEnabled) {
  const baseConfig = {
    config_id: "1731129688347511",
    response_type: "code",
    override_default_response_type: true
  };

  // Add coexistence features conditionally
  if (coexistenceEnabled) {
    baseConfig.extras = {
      setup: {},
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3"
    };
  } else {
    baseConfig.extras = { setup: {} };
  }

  FB.login(fbLoginCallback, baseConfig);
}
```

---

## Webhook Integration

### Required Webhook Subscriptions

```javascript
// For Coexistence Mode, subscribe to these webhook fields:
// 1. account_update - Business account status changes
// 2. history - Chat history synchronization
// 3. smb_app_state_sync - Contact synchronization
// 4. smb_message_echoes - Messages sent from WhatsApp Business App

// In your App Dashboard:
// WhatsApp > Configuration > Webhook Fields
// ✓ account_update
// ✓ history
// ✓ smb_app_state_sync
// ✓ smb_message_echoes
```

### Webhook Event Handlers

```javascript
// Express.js example
const express = require('express');
const app = express();

app.post('/webhook', express.json(), (req, res) => {
  const { object, entry } = req.body;

  if (object !== 'whatsapp_business_account') {
    return res.status(400).send('Invalid webhook object');
  }

  entry.forEach(event => {
    const waba_id = event.id;
    const changes = event.changes || [];

    changes.forEach(change => {
      const { field, value } = change;

      switch(field) {
        // Account status changes
        case 'account_update':
          handleAccountUpdate(waba_id, value);
          break;

        // Chat history sync
        case 'history':
          handleHistorySync(waba_id, value);
          break;

        // Contact sync
        case 'smb_app_state_sync':
          handleContactSync(waba_id, value);
          break;

        // Messages from WhatsApp Business App
        case 'smb_message_echoes':
          handleMessageEchoes(waba_id, value);
          break;
      }
    });
  });

  // Always respond with 200 to acknowledge receipt
  res.status(200).send('ok');
});

// Handle account status changes
function handleAccountUpdate(wabaId, value) {
  const event = value.event;
  const phoneNumber = value.phone_number;

  console.log(`Account ${event}:`, phoneNumber);

  switch(event) {
    case 'PARTNER_REMOVED':
      // Business disconnected from your API access
      console.log('Disconnection reason:', value.disconnection_info?.reason);
      updateBusinessStatus(wabaId, 'disconnected');
      break;

    case 'ACCOUNT_OFFBOARDED':
      // Business account was offboarded
      updateBusinessStatus(wabaId, 'offboarded');
      break;

    case 'ACCOUNT_RECONNECTED':
      // Business reconnected after offboarding
      updateBusinessStatus(wabaId, 'reconnected');
      break;
  }
}

// Handle chat history synchronization
function handleHistorySync(wabaId, historyData) {
  const history = historyData.history || [];
  const metadata = history[0]?.metadata || {};

  console.log('History sync:', {
    phase: metadata.phase,           // 0: Day 0-1, 1: Day 1-90, 2: Day 90-180
    progress: metadata.progress,     // 0-100
    chunkOrder: metadata.chunk_order // Sequential chunk number
  });

  // Process messages
  history.forEach(chunk => {
    if (chunk.threads) {
      chunk.threads.forEach(thread => {
        // thread.id = WhatsApp user ID
        // thread.messages = Array of messages
        saveChatHistory(wabaId, thread);
      });
    }

    if (chunk.errors) {
      // Business declined to share history
      console.log('History sharing declined:', chunk.errors[0].code);
    }
  });
}

// Handle contact synchronization
function handleContactSync(wabaId, stateSyncData) {
  const stateSyncs = stateSyncData.state_sync || [];

  stateSyncs.forEach(sync => {
    if (sync.type === 'contact') {
      const { contact, action, metadata } = sync;
      const { phone_number, full_name } = contact;

      console.log(`Contact ${action}:`, full_name, phone_number);

      if (action === 'add') {
        // Add or update contact
        saveContact(wabaId, contact);
      } else if (action === 'remove') {
        // Remove contact
        removeContact(wabaId, phone_number);
      }
    }
  });
}

// Handle message echoes (mirror messages from WhatsApp Business App)
function handleMessageEchoes(wabaId, echoData) {
  const messageEchoes = echoData.message_echoes || [];

  messageEchoes.forEach(echo => {
    const {
      from,           // Business phone number
      to,             // Customer phone number
      id,             // Message ID
      timestamp,      // When sent
      type,           // text, image, video, etc.
      text            // Message content
    } = echo;

    console.log(`Message from ${from} to ${to}:`, text);

    // Mirror the message in your app
    saveMessage(wabaId, {
      direction: 'outbound',  // Sent by business
      sender: from,
      recipient: to,
      content: text,
      timestamp: parseInt(timestamp)
    });
  });
}
```

---

## Server-Side Implementation

### Token Exchange (30-second window!)

```javascript
// Node.js/Express backend
const axios = require('axios');

async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post(
      'https://graph.facebook.com/v25.0/oauth/access_token',
      {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: 'https://yourdomain.com/callback',  // Must match Config
        code: code  // Authorization code from client
      }
    );

    return {
      accessToken: response.data.access_token,
      wabaId: response.data.user_id,  // This is the WABA ID
      tokenExpires: response.data.expires_in
    };
  } catch (error) {
    console.error('Token exchange failed:', error);
    throw error;
  }
}

// API Endpoint to handle code exchange
app.post('/api/auth/exchange-code', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'No code provided' });
    }

    // Exchange code for token (MUST happen within 30 seconds!)
    const tokenData = await exchangeCodeForToken(code);

    // Store in database
    await saveBusinessToken({
      wabaId: tokenData.wabaId,
      accessToken: tokenData.accessToken,
      expiresAt: new Date(Date.now() + tokenData.tokenExpires * 1000)
    });

    res.json({ success: true, message: 'Token stored successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
```

### Initiating Data Synchronization

```javascript
// For Coexistence: Start syncing contacts and message history
async function initiateSynchronization(businessPhoneNumberId, accessToken) {
  const apiVersion = 'v25.0';
  const graphUrl = 'https://graph.facebook.com';

  try {
    // Step 1: Sync Contacts
    console.log('Starting contact synchronization...');
    const contactResponse = await axios.post(
      `${graphUrl}/${apiVersion}/${businessPhoneNumberId}/smb_app_data`,
      {
        messaging_product: 'whatsapp',
        sync_type: 'smb_app_state_sync'  // Sync contacts
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    console.log('Contact sync initiated:', contactResponse.data.request_id);

    // Step 2: Sync Message History
    console.log('Starting message history synchronization...');
    const historyResponse = await axios.post(
      `${graphUrl}/${apiVersion}/${businessPhoneNumberId}/smb_app_data`,
      {
        messaging_product: 'whatsapp',
        sync_type: 'history'  // Sync message history
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    console.log('History sync initiated:', historyResponse.data.request_id);

    // Store request IDs for reference
    await saveSync Requests({
      businessPhoneId: businessPhoneNumberId,
      contactRequestId: contactResponse.data.request_id,
      historyRequestId: historyResponse.data.request_id,
      initiatedAt: new Date()
    });

  } catch (error) {
    console.error('Synchronization failed:', error.message);
    throw error;
  }
}

// Call this after onboarding completes
app.post('/api/signup/complete', async (req, res) => {
  try {
    const { phone_number_id, waba_id } = req.body;

    // Get access token for this business
    const business = await getBusinessByWabaId(waba_id);

    // Start synchronization
    await initiateSynchronization(phone_number_id, business.accessToken);

    res.json({
      success: true,
      message: 'Synchronization started'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
```

### Check Onboarding Status

```javascript
// Verify if a business is properly set up for coexistence
async function checkCoexistenceStatus(businessPhoneNumberId, accessToken) {
  const response = await axios.get(
    `https://graph.facebook.com/v25.0/${businessPhoneNumberId}`,
    {
      params: {
        fields: 'is_on_biz_app,platform_type'
      },
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const { is_on_biz_app, platform_type } = response.data;

  return {
    isOnBusinessApp: is_on_biz_app,        // true = can use WhatsApp Business App
    platformType: platform_type,           // 'CLOUD_API' = Cloud API enabled
    supportsCoexistence: is_on_biz_app && platform_type === 'CLOUD_API'
  };
}

// Example usage
app.get('/api/business/:phoneId/status', async (req, res) => {
  try {
    const { phoneId } = req.params;
    const business = await getBusinessByPhoneId(phoneId);

    const status = await checkCoexistenceStatus(phoneId, business.accessToken);

    res.json({
      phoneId,
      ...status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## Advanced Features

### Rate Limiting for Coexistence

```javascript
// Coexistence mode has 20 MPS (messages per second) limit
// Implement rate limiting

class MessageQueue {
  constructor(maxMps = 20) {
    this.queue = [];
    this.maxMps = maxMps;
    this.lastSecond = Date.now();
    this.messagesThisSecond = 0;
  }

  async sendMessage(message) {
    const now = Date.now();

    // Reset counter every second
    if (now - this.lastSecond >= 1000) {
      this.messagesThisSecond = 0;
      this.lastSecond = now;
    }

    // If at limit, wait
    if (this.messagesThisSecond >= this.maxMps) {
      const waitTime = 1000 - (now - this.lastSecond);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.sendMessage(message);
    }

    this.messagesThisSecond++;
    return this._send(message);
  }

  async _send(message) {
    // Send actual message via Cloud API
    const response = await axios.post(
      `https://graph.facebook.com/v25.0/${message.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: message.recipientPhone,
        type: 'text',
        text: { body: message.content }
      },
      {
        headers: {
          Authorization: `Bearer ${message.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  }
}

// Usage
const messageQueue = new MessageQueue(20);  // 20 MPS for coexistence

app.post('/api/send-message', async (req, res) => {
  try {
    const result = await messageQueue.sendMessage(req.body);
    res.json({ success: true, messageId: result.messages[0].id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### Handling Message Edit/Revoke for Coexistence

```javascript
// When business uses WhatsApp Business App to edit/delete messages
// These webhooks are triggered

app.post('/webhook', express.json(), (req, res) => {
  const { entry } = req.body;

  entry.forEach(event => {
    event.changes.forEach(change => {
      if (change.field === 'messages') {
        const messages = change.value.messages || [];

        messages.forEach(msg => {
          if (msg.type === 'text' && msg.text?.edit) {
            // User edited a message from WhatsApp Business App
            handleMessageEdit(msg);
          } else if (msg.type === 'text' && msg.text?.revoke) {
            // User deleted a message from WhatsApp Business App
            handleMessageRevoke(msg);
          }
        });
      }
    });
  });

  res.status(200).send('ok');
});

function handleMessageEdit(message) {
  const {
    id,                              // Message ID
    from,                            // Who sent it
    timestamp,                       // When sent
    context: { message_id }          // Original message ID
  } = message;

  console.log(`Message ${message_id} was edited at ${timestamp}`);

  // Update message in your database
  updateMessage(message_id, {
    edited: true,
    editedAt: new Date(timestamp * 1000),
    editedBy: from
  });
}

function handleMessageRevoke(message) {
  const {
    id,                              // Message ID
    from,                            // Who sent it
    timestamp,                       // When deleted
    context: { message_id }          // Original message ID
  } = message;

  console.log(`Message ${message_id} was revoked`);

  // Mark as deleted or remove from UI
  updateMessage(message_id, {
    deleted: true,
    deletedAt: new Date(timestamp * 1000),
    deletedBy: from
  });
}
```

### Offboarding/Disconnection Handling

```javascript
// When business disconnects from Cloud API via WhatsApp Business App
app.post('/webhook', express.json(), (req, res) => {
  const { entry } = req.body;

  entry.forEach(event => {
    event.changes.forEach(change => {
      if (change.field === 'account_update') {
        const { event: updateEvent, disconnection_info } = change.value;

        if (updateEvent === 'PARTNER_REMOVED') {
          // Business disconnected
          handleDisconnection(event.id, disconnection_info);
        }
      }
    });
  });

  res.status(200).send('ok');
});

function handleDisconnection(wabaId, disconnectionInfo) {
  const { reason, initiated_by } = disconnectionInfo;

  console.log(`Business ${wabaId} disconnected`);
  console.log(`Reason: ${reason}`);
  console.log(`Initiated by: ${initiated_by}`);

  // Handle different disconnection reasons
  const reasons = {
    'ACCOUNT_DISCONNECTED': 'Account enforcement or deletion',
    'BUSINESS_DOWNGRADE': 'Registered with consumer WhatsApp',
    'CHANGE_NUMBER': 'Changed phone number',
    'COMPANION_INACTIVITY': 'Companion device inactive',
    'PRIMARY_INACTIVITY': 'Primary device inactive',
    'USER_RE_REGISTERED': 'Re-registered on new device'
  };

  // Notify business
  notifyBusiness(wabaId, {
    subject: 'WhatsApp API Disconnection',
    message: `Your account was disconnected: ${reasons[reason]}`
  });

  // Update status
  updateBusinessStatus(wabaId, 'disconnected');

  // Stop sending messages to this business
  pauseMessaging(wabaId);
}
```

---

## Troubleshooting & Best Practices

### Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Code expired" | Didn't exchange code within 30s | Always exchange immediately in response callback |
| "Invalid config_id" | Wrong or inactive configuration | Verify config in App Dashboard > Facebook Login > Configurations |
| "Domain not allowed" | Domain not in allowed list | Add domain to App Dashboard > Facebook Login > Settings > Allowed domains |
| "HTTPS required" | Using HTTP instead of HTTPS | Use HTTPS certificate (even for localhost with self-signed cert) |
| "Invalid redirect_uri" | Callback URL mismatch | Ensure redirect_uri matches Configuration settings |
| "Coexistence option not shown" | Not using right extras | Ensure `featureType: "whatsapp_business_app_onboarding"` |
| "131060 error webhook" | First-time message delivery delay | Expected for new conversations, retry after seconds |
| "2593109 error" | History sharing declined | Business declined to share chat history with you |

### Best Practices

```javascript
// 1. ALWAYS use HTTPS
// Even for local development:
// npm install -g local-ssl-proxy
// local-ssl-proxy --source 3001 --target 3000

// 2. Exchange code immediately (30-second window)
const fbLoginCallback = async (response) => {
  if (response.authResponse) {
    const code = response.authResponse.code;
    // Exchange IMMEDIATELY
    await exchangeCode(code);  // Don't delay!
  }
};

// 3. Validate webhook origin (security)
app.post('/webhook', express.json(), (req, res) => {
  // Verify webhook signature
  const signature = req.get('X-Hub-Signature-256');
  const body = req.rawBody;  // Must be raw, not parsed

  if (!verifyWebhookSignature(signature, body)) {
    return res.status(403).send('Invalid signature');
  }

  // Process webhook...
  res.status(200).send('ok');
});

// 4. Handle message history in chunks
async function processChatHistory(historyData) {
  const history = historyData.history || [];
  const { phase, progress, chunk_order } = history[0].metadata;

  console.log(`Phase ${phase}, Progress ${progress}%, Chunk ${chunk_order}`);

  // Process asynchronously for large histories
  history.forEach(chunk => {
    processChunkAsync(chunk);  // Don't block
  });

  // Track progress
  if (progress === 100) {
    console.log('History sync complete!');
  }
}

// 5. Implement retry logic
async function exchangeCodeWithRetry(code, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await exchangeCode(code);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = Math.pow(2, attempt) * 100;  // Exponential backoff
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// 6. Log all important events
function logSignupEvent(eventType, data) {
  console.log({
    timestamp: new Date().toISOString(),
    eventType,
    wabaId: data.waba_id,
    phoneId: data.phone_number_id,
    coexistence: data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
  });

  // Send to monitoring service
  sendToMonitoring({
    metric: `signup.${eventType}`,
    tags: { coexistence: data.coexistence }
  });
}

// 7. Test with different scenarios
const testScenarios = {
  standardSignup: {
    extras: { setup: {} }
  },
  coexistenceSignup: {
    extras: {
      setup: {},
      featureType: 'whatsapp_business_app_onboarding',
      sessionInfoVersion: '3'
    }
  },
  multiWaba: {
    extras: {
      setup: {},
      featureType: 'multi_waba',
      waba_selection: true
    }
  }
};
```

---

## Complete Examples

### Full Coexistence Implementation Example

```javascript
// Complete server setup
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// Middleware to capture raw body for webhook verification
app.use((req, res, next) => {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
});

// Webhook verification
function verifyWebhook(req) {
  const signature = req.get('X-Hub-Signature-256');
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  const hash = crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  return signature === `sha256=${hash}`;
}

// Main webhook endpoint
app.post('/webhook', (req, res) => {
  // Verify signature
  if (!verifyWebhook(req)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const { object, entry } = req.body;

  if (object !== 'whatsapp_business_account') {
    return res.status(400).json({ error: 'Invalid webhook' });
  }

  // Process each webhook event
  entry.forEach(event => {
    const wabaId = event.id;

    (event.changes || []).forEach(change => {
      const { field, value } = change;

      switch (field) {
        case 'account_update':
          handleAccountUpdate(wabaId, value);
          break;
        case 'messages':
          handleIncomingMessages(wabaId, value);
          break;
        case 'message_status':
          handleMessageStatus(wabaId, value);
          break;
        case 'history':
          handleHistory(wabaId, value);
          break;
        case 'smb_app_state_sync':
          handleContactSync(wabaId, value);
          break;
        case 'smb_message_echoes':
          handleMessageEchoes(wabaId, value);
          break;
      }
    });
  });

  res.status(200).send('ok');
});

// Token exchange endpoint
app.post('/api/auth/exchange-code', async (req, res) => {
  try {
    const { code } = req.body;

    const response = await axios.post(
      'https://graph.facebook.com/v25.0/oauth/access_token',
      {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code
      }
    );

    // Save to database
    await saveBusinessAccount({
      wabaId: response.data.user_id,
      accessToken: response.data.access_token,
      expiresAt: new Date(Date.now() + response.data.expires_in * 1000)
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start synchronization
app.post('/api/sync/:phoneId', async (req, res) => {
  try {
    const { phoneId } = req.params;
    const business = await getBusinessByPhoneId(phoneId);

    // Sync contacts
    await axios.post(
      `https://graph.facebook.com/v25.0/${phoneId}/smb_app_data`,
      {
        messaging_product: 'whatsapp',
        sync_type: 'smb_app_state_sync'
      },
      { headers: { Authorization: `Bearer ${business.accessToken}` } }
    );

    // Sync history
    await axios.post(
      `https://graph.facebook.com/v25.0/${phoneId}/smb_app_data`,
      {
        messaging_product: 'whatsapp',
        sync_type: 'history'
      },
      { headers: { Authorization: `Bearer ${business.accessToken}` } }
    );

    res.json({ success: true, message: 'Sync initiated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Event handlers (implement based on your needs)
function handleAccountUpdate(wabaId, value) { /* ... */ }
function handleIncomingMessages(wabaId, value) { /* ... */ }
function handleMessageStatus(wabaId, value) { /* ... */ }
function handleHistory(wabaId, value) { /* ... */ }
function handleContactSync(wabaId, value) { /* ... */ }
function handleMessageEchoes(wabaId, value) { /* ... */ }

// Database helpers (implement with your DB)
async function saveBusinessAccount(data) { /* ... */ }
async function getBusinessByPhoneId(phoneId) { /* ... */ }

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## Quick Reference Checklist

### Before Implementation
- [ ] Create Facebook App
- [ ] Add whatsapp Product
- [ ] Set up app dashboard with HTTPS domains
- [ ] Create Facebook Login Configuration (use template)
- [ ] Copy Configuration ID
- [ ] Add webhook URL
- [ ] Subscribe to webhook fields

### Frontend Setup
- [ ] Load Facebook SDK
- [ ] Initialize SDK with correct App ID
- [ ] Set up message event listener
- [ ] Set up response callback
- [ ] Create launch function with correct extras
- [ ] Add toggle for coexistence mode
- [ ] Test with test user

### Server Setup
- [ ] Implement token exchange (30-second TTL!)
- [ ] Store access tokens securely
- [ ] Implement webhook receiver
- [ ] Verify webhook signatures
- [ ] Handle all 4 event types (account_update, history, smb_app_state_sync, smb_message_echoes)
- [ ] Implement sync initiation after onboarding
- [ ] Add error handling and logging

### For Production
- [ ] Use environment variables for all secrets
- [ ] Implement rate limiting (20 MPS for coexistence)
- [ ] Add monitoring and alerting
- [ ] Implement retry logic for API calls
- [ ] Add comprehensive logging
- [ ] Test with real business accounts
- [ ] Document your implementation
- [ ] Set up support escalation process

---

## References

- **[Implementation Guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)**
- **[Business App Onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)**
- **[Webhook Reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks)**
- **[Cloud API Documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/)**

---

**Last Updated:** June 9, 2026  
**Learning Document Version:** 1.0 Complete
