# Server-Side Implementation Guide
## WhatsApp Embedded Signup Backend Integration

**Purpose:** Complete guide for backend developers implementing token exchange, webhooks, and data synchronization.

**References:**
- Main Implementation: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- Business App Users: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Token Exchange (Critical 30s Window)](#token-exchange-critical-30s-window)
3. [Webhook Setup](#webhook-setup)
4. [Data Synchronization](#data-synchronization)
5. [Database Schema](#database-schema)
6. [Error Handling](#error-handling)
7. [Security Considerations](#security-considerations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Load Facebook SDK                                 │   │
│  │ 2. Initialize SDK                                    │   │
│  │ 3. Listen for messages                               │   │
│  │ 4. Launch signup                                     │   │
│  │ 5. Receive authorization code                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────┬────────────────────────────────────────────────┘
              │ Authorization Code (30s TTL)
              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Your Backend (Node.js)                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Receive code                                      │   │
│  │ 2. Exchange for access token (IMMEDIATELY!)          │   │
│  │ 3. Store token securely                              │   │
│  │ 4. Respond to client                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────┬────────────────────────────────────────────────┘
              │ Access Token
              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Facebook Graph API                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Store business token                                 │   │
│  │ Manage WhatsApp resources                            │   │
│  │ Send/receive messages                                │   │
│  │ Send webhooks                                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Token Exchange (Critical 30s Window!)

### Understanding the TTL Issue

```javascript
// ❌ WRONG - This will FAIL because token expires!
const fbLoginCallback = (response) => {
  if (response.authResponse) {
    const code = response.authResponse.code;
    
    // DON'T DO THIS - You have 30 seconds!
    setTimeout(() => {
      // This might be 31+ seconds later...
      exchangeCode(code);  // ERROR: Code expired
    }, 5000);
  }
};

// ✅ CORRECT - Exchange immediately
const fbLoginCallback = (response) => {
  if (response.authResponse) {
    const code = response.authResponse.code;
    
    // Send to server IMMEDIATELY
    fetch('/api/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
  }
};
```

### Proper Token Exchange Flow

```javascript
// Backend: Node.js/Express
const axios = require('axios');
const express = require('express');
const app = express();

app.use(express.json());

// Main exchange endpoint
app.post('/api/auth/exchange-code', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { code } = req.body;

    console.log('Code received at:', startTime);
    console.log('Code:', code.substring(0, 20) + '...');

    // Step 1: Exchange code for access token
    const graphResponse = await axios.post(
      'https://graph.facebook.com/v25.0/oauth/access_token',
      {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code: code
      },
      {
        timeout: 5000  // 5 second timeout
      }
    );

    const exchangeTime = Date.now() - startTime;
    console.log(`Token exchanged in ${exchangeTime}ms`);

    const {
      access_token,        // Long-lived access token
      user_id,            // This is the WABA ID
      expires_in          // Seconds until expiry (usually 5184000 = 60 days)
    } = graphResponse.data;

    // Step 2: Save to database immediately
    const business = await saveBusinessToken({
      wabaId: user_id,
      accessToken: access_token,
      expiresAt: new Date(Date.now() + expires_in * 1000),
      receivedAt: new Date(startTime),
      exchangedAt: new Date()
    });

    console.log('Business saved:', business.id);

    // Step 3: Respond to client
    res.json({
      success: true,
      message: 'Token saved successfully',
      businessId: business.id
    });

  } catch (error) {
    console.error('Token exchange error:', {
      message: error.message,
      code: error.response?.status,
      data: error.response?.data,
      elapsedTime: Date.now() - startTime
    });

    // Handle specific errors
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        success: false,
        message: 'Facebook API timeout - please retry'
      });
    }

    if (error.response?.data?.error?.code === 190) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization code (expired?)'
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Database helper
async function saveBusinessToken(data) {
  // Using your database (PostgreSQL, MongoDB, etc.)
  const query = `
    INSERT INTO businesses (waba_id, access_token, expires_at, received_at, exchanged_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (waba_id) DO UPDATE
    SET access_token = EXCLUDED.access_token,
        expires_at = EXCLUDED.expires_at,
        exchanged_at = EXCLUDED.exchanged_at
    RETURNING *;
  `;

  const result = await db.query(query, [
    data.wabaId,
    data.accessToken,
    data.expiresAt,
    data.receivedAt,
    data.exchangedAt
  ]);

  return result.rows[0];
}
```

### Handling the 30-Second TTL

```javascript
// Setup retry logic in case of slow networks
async function exchangeCodeWithRetry(code, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const baseDelay = options.baseDelay || 100;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(
        'https://graph.facebook.com/v25.0/oauth/access_token',
        {
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          redirect_uri: process.env.REDIRECT_URI,
          code: code
        },
        {
          timeout: 5000
        }
      );

      return response.data;

    } catch (error) {
      // Don't retry on auth errors (invalid/expired code)
      if (error.response?.data?.error?.code === 190) {
        throw new Error('Code expired or invalid');
      }

      // Retry on network errors
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`Retry attempt ${attempt + 1} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw error;
    }
  }
}

// Use it
app.post('/api/auth/exchange-code', async (req, res) => {
  try {
    const tokenData = await exchangeCodeWithRetry(req.body.code, {
      maxRetries: 3,
      baseDelay: 200
    });

    // ... save to database
    res.json({ success: true });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
```

---

## Webhook Setup

### Complete Webhook Receiver

```javascript
const crypto = require('crypto');
const express = require('express');

const app = express();

// ⚠️ CRITICAL: Must capture raw body for signature verification
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding);
  }
}));

// Verify webhook signature
function verifyWebhookSignature(req) {
  const signature = req.get('X-Hub-Signature-256');
  if (!signature) return false;

  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Webhook GET for subscription verification
app.get('/webhook', (req, res) => {
  const {
    'hub.mode': mode,
    'hub.verify_token': token,
    'hub.challenge': challenge
  } = req.query;

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Main webhook handler
app.post('/webhook', async (req, res) => {
  // SECURITY: Always verify signature first
  if (!verifyWebhookSignature(req)) {
    console.error('Invalid webhook signature');
    return res.status(403).send('Forbidden');
  }

  try {
    const { object, entry } = req.body;

    // Validate webhook structure
    if (object !== 'whatsapp_business_account') {
      return res.status(400).send('Invalid webhook object');
    }

    // Process each event (Meta sends webhooks asynchronously)
    for (const event of entry) {
      const wabaId = event.id;
      const timestamp = event.time;

      for (const change of event.changes || []) {
        const { field, value } = change;

        try {
          await processWebhookEvent(field, wabaId, value, timestamp);
        } catch (error) {
          console.error(`Error processing ${field}:`, error);
          // Don't throw - continue processing other events
        }
      }
    }

    // CRITICAL: Always respond with 200 immediately
    // Meta will retry if no 200 response
    res.status(200).send('ok');

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('ok');  // Still respond 200 even on error
  }
});

// Route different event types
async function processWebhookEvent(field, wabaId, value, timestamp) {
  switch (field) {
    case 'messages':
      return handleIncomingMessages(wabaId, value, timestamp);

    case 'message_status':
      return handleMessageStatus(wabaId, value, timestamp);

    case 'account_update':
      return handleAccountUpdate(wabaId, value, timestamp);

    case 'history':
      return handleHistory(wabaId, value, timestamp);

    case 'smb_app_state_sync':
      return handleContactSync(wabaId, value, timestamp);

    case 'smb_message_echoes':
      return handleMessageEchoes(wabaId, value, timestamp);

    default:
      console.log(`Unknown field: ${field}`);
  }
}

// Handle incoming customer messages
async function handleIncomingMessages(wabaId, value, timestamp) {
  const messages = value.messages || [];
  const contacts = value.contacts || [];
  const metadata = value.metadata || {};

  for (const message of messages) {
    console.log('New message from:', message.from);

    // Store message
    await db.insertMessage({
      wabaId,
      messageId: message.id,
      sender: message.from,
      type: message.type,
      content: message.text?.body || message.image?.caption || message.document?.filename,
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      receivedAt: new Date()
    });

    // Process based on type
    if (message.type === 'text') {
      // Handle text message
      processTextMessage(message);
    } else if (message.type === 'interactive') {
      // Handle button/list reply
      processInteractiveMessage(message);
    }
  }
}

// Handle message delivery status
async function handleMessageStatus(wabaId, value, timestamp) {
  const statuses = value.statuses || [];

  for (const status of statuses) {
    const { id, status: statusCode, timestamp: deliveryTime } = status;

    // Status codes: sent, delivered, read, failed
    console.log(`Message ${id} is ${statusCode}`);

    await db.updateMessageStatus({
      messageId: id,
      status: statusCode,
      statusAt: new Date(parseInt(deliveryTime) * 1000)
    });
  }
}

// Handle account changes (disconnection, etc.)
async function handleAccountUpdate(wabaId, value, timestamp) {
  const { event, phone_number, disconnection_info } = value;

  console.log(`Account event: ${event} for ${phone_number}`);

  switch (event) {
    case 'PARTNER_REMOVED':
      console.log('Business disconnected. Reason:', disconnection_info?.reason);
      await db.updateBusiness(wabaId, {
        status: 'disconnected',
        disconnectedAt: new Date(),
        disconnectionReason: disconnection_info?.reason
      });
      break;

    case 'ACCOUNT_OFFBOARDED':
      console.log('Business offboarded');
      await db.updateBusiness(wabaId, { status: 'offboarded' });
      break;

    case 'ACCOUNT_RECONNECTED':
      console.log('Business reconnected');
      await db.updateBusiness(wabaId, { status: 'connected' });
      break;
  }
}

// Handle chat history synchronization
async function handleHistory(wabaId, value, timestamp) {
  const history = value.history || [];

  for (const historyChunk of history) {
    // Check for errors (history sharing declined)
    if (historyChunk.errors) {
      console.log('History sharing declined:', historyChunk.errors[0].code);
      await db.updateBusiness(wabaId, { historyShared: false });
      continue;
    }

    const { metadata, threads } = historyChunk;
    const { phase, chunk_order, progress } = metadata;

    console.log(`History Phase ${phase}, Chunk ${chunk_order}, Progress ${progress}%`);

    // Process each conversation
    for (const thread of threads || []) {
      const customerId = thread.id;
      const messages = thread.messages || [];

      for (const message of messages) {
        // Store historical message
        await db.insertHistoricalMessage({
          wabaId,
          customerId,
          ...message
        });
      }
    }

    // Track sync progress
    await db.updateSyncProgress(wabaId, {
      phase,
      progress,
      chunkOrder: chunk_order
    });
  }
}

// Handle contact synchronization
async function handleContactSync(wabaId, value, timestamp) {
  const stateSyncs = value.state_sync || [];

  for (const sync of stateSyncs) {
    if (sync.type === 'contact') {
      const { contact, action, metadata } = sync;

      if (action === 'add') {
        // Add or update contact
        await db.upsertContact({
          wabaId,
          phone: contact.phone_number,
          name: contact.full_name,
          firstName: contact.first_name,
          syncedAt: new Date(parseInt(metadata.timestamp) * 1000)
        });
      } else if (action === 'remove') {
        // Remove contact
        await db.deleteContact(wabaId, contact.phone_number);
      }
    }
  }
}

// Handle message echoes (messages sent from WhatsApp Business App)
async function handleMessageEchoes(wabaId, value, timestamp) {
  const messageEchoes = value.message_echoes || [];

  for (const echo of messageEchoes) {
    const { from, to, id, type, timestamp: sentTime } = echo;

    console.log(`Message echo from ${from} to ${to}`);

    // Mirror the message in your app
    await db.insertMessage({
      wabaId,
      messageId: id,
      sender: from,
      recipient: to,
      type,
      direction: 'outbound',  // Sent by business via WhatsApp Business App
      syncedAt: new Date(),
      originalTimestamp: new Date(parseInt(sentTime) * 1000)
    });
  }
}

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

---

## Data Synchronization

### Initiating Coexistence Sync

```javascript
// After business completes signup, synchronize their data
async function initiateSynchronization(phoneNumberId, wabaId, accessToken) {
  const apiVersion = 'v25.0';
  const graphUrl = 'https://graph.facebook.com';

  try {
    console.log(`Starting sync for WABA ${wabaId}, Phone ${phoneNumberId}`);

    // Step 1: Sync contacts
    console.log('1. Syncing contacts...');
    const contactsResponse = await axios.post(
      `${graphUrl}/${apiVersion}/${phoneNumberId}/smb_app_data`,
      {
        messaging_product: 'whatsapp',
        sync_type: 'smb_app_state_sync'
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('✓ Contacts sync initiated:', contactsResponse.data.request_id);

    // Step 2: Sync message history
    console.log('2. Syncing message history...');
    const historyResponse = await axios.post(
      `${graphUrl}/${apiVersion}/${phoneNumberId}/smb_app_data`,
      {
        messaging_product: 'whatsapp',
        sync_type: 'history'
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('✓ History sync initiated:', historyResponse.data.request_id);

    // Save sync info to database
    await db.insertSyncRequest({
      wabaId,
      phoneNumberId,
      contactsRequestId: contactsResponse.data.request_id,
      historyRequestId: historyResponse.data.request_id,
      initiatedAt: new Date(),
      status: 'in_progress'
    });

    return {
      success: true,
      contactsRequestId: contactsResponse.data.request_id,
      historyRequestId: historyResponse.data.request_id
    };

  } catch (error) {
    console.error('Sync initiation failed:', error);

    if (error.response?.data?.error) {
      const { code, message } = error.response.data.error;
      console.error(`API Error ${code}: ${message}`);
    }

    throw error;
  }
}

// API endpoint to initiate sync
app.post('/api/business/:wabaId/sync', async (req, res) => {
  try {
    const { wabaId } = req.params;

    // Get business from database
    const business = await db.getBusiness(wabaId);

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (!business.accessToken) {
      return res.status(400).json({ error: 'No access token' });
    }

    // Start sync
    const result = await initiateSynchronization(
      business.phoneNumberId,
      business.wabaId,
      business.accessToken
    );

    res.json({
      success: true,
      message: 'Synchronization initiated',
      ...result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Monitor sync progress
app.get('/api/business/:wabaId/sync-status', async (req, res) => {
  try {
    const { wabaId } = req.params;

    const syncRequest = await db.getLatestSyncRequest(wabaId);

    if (!syncRequest) {
      return res.status(404).json({ error: 'No sync found' });
    }

    res.json({
      wabaId,
      status: syncRequest.status,
      initiatedAt: syncRequest.initiatedAt,
      completedAt: syncRequest.completedAt,
      contactsProgress: syncRequest.contactsProgress,
      historyProgress: syncRequest.historyProgress
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## Database Schema

### PostgreSQL Schema Example

```sql
-- Businesses table
CREATE TABLE businesses (
  id SERIAL PRIMARY KEY,
  waba_id VARCHAR(50) UNIQUE NOT NULL,
  phone_number_id VARCHAR(50) UNIQUE,
  business_id VARCHAR(50),
  access_token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'connected',  -- connected, disconnected, offboarded
  coexistence_enabled BOOLEAN DEFAULT FALSE,
  history_shared BOOLEAN,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMP,
  disconnection_reason VARCHAR(100)
);

-- Contacts table
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  waba_id VARCHAR(50) REFERENCES businesses(waba_id),
  phone_number VARCHAR(20) NOT NULL,
  full_name VARCHAR(255),
  first_name VARCHAR(100),
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(waba_id, phone_number)
);

-- Messages table
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  waba_id VARCHAR(50) REFERENCES businesses(waba_id),
  message_id VARCHAR(100) UNIQUE NOT NULL,
  sender VARCHAR(20) NOT NULL,
  recipient VARCHAR(20),
  type VARCHAR(20),  -- text, image, video, document, etc.
  content TEXT,
  status VARCHAR(20),  -- sent, delivered, read, failed
  direction VARCHAR(10),  -- inbound, outbound
  timestamp TIMESTAMP,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status_updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sync requests table
CREATE TABLE sync_requests (
  id SERIAL PRIMARY KEY,
  waba_id VARCHAR(50) REFERENCES businesses(waba_id),
  phone_number_id VARCHAR(50),
  contacts_request_id VARCHAR(100),
  history_request_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'in_progress',  -- in_progress, completed, failed
  contacts_progress INTEGER DEFAULT 0,
  history_progress INTEGER DEFAULT 0,
  initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT
);

-- Webhook events table (for debugging)
CREATE TABLE webhook_events (
  id SERIAL PRIMARY KEY,
  waba_id VARCHAR(50),
  field VARCHAR(50),
  event_data JSONB,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_businesses_waba_id ON businesses(waba_id);
CREATE INDEX idx_businesses_phone_id ON businesses(phone_number_id);
CREATE INDEX idx_contacts_waba_id ON contacts(waba_id);
CREATE INDEX idx_messages_waba_id ON messages(waba_id);
CREATE INDEX idx_messages_sender ON messages(sender);
CREATE INDEX idx_sync_requests_waba_id ON sync_requests(waba_id);
```

---

## Error Handling

### Comprehensive Error Handler

```javascript
// Error handler for different scenarios
function handleWebhookError(error, context) {
  const {
    field,
    wabaId,
    timestamp
  } = context;

  const errorInfo = {
    timestamp: new Date().toISOString(),
    field,
    wabaId,
    error: error.message,
    type: error.constructor.name
  };

  // Log to different services based on severity
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    // Database connection errors
    logToErrorTracking({
      severity: 'high',
      type: 'database_error',
      ...errorInfo
    });
  } else if (error.message.includes('duplicate')) {
    // Duplicate handling - might be webhook retry
    console.log('Duplicate webhook, likely retry:', errorInfo);
  } else {
    // Other errors
    logToErrorTracking({
      severity: 'medium',
      ...errorInfo
    });
  }

  // Always return 200 to prevent webhook re-delivery
  return 200;
}

// Retry logic for failed operations
async function retryOperation(operation, options = {}) {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) throw error;

      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
      console.log(`Retry attempt ${attempt}/${maxAttempts} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Usage
app.post('/webhook', async (req, res) => {
  try {
    // ... process webhook

    res.status(200).send('ok');
  } catch (error) {
    handleWebhookError(error, {
      field: 'messages',
      wabaId: req.body.entry[0]?.id,
      timestamp: Date.now()
    });

    // Always respond 200
    res.status(200).send('ok');
  }
});
```

---

## Security Considerations

### Secure Implementation Checklist

```javascript
// 1. Environment Variables
// .env file (NEVER commit this!)
FACEBOOK_APP_ID=2140782060178223
FACEBOOK_APP_SECRET=your_app_secret_here
WEBHOOK_VERIFY_TOKEN=your_webhook_token_here
REDIRECT_URI=https://yourdomain.com/callback

// 2. Verify webhook signatures
function verifyWebhookSignature(req) {
  const signature = req.get('X-Hub-Signature-256');
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  const hash = crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  return signature === `sha256=${hash}`;
}

// 3. Rate limiting
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 1000  // limit each IP to 1000 requests per windowMs
});

app.use('/webhook', limiter);

// 4. Input validation
app.post('/api/auth/exchange-code', [
  body('code').isLength({ min: 1, max: 1000 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
], async (req, res) => {
  // ... handle request
});

// 5. HTTPS only
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.protocol !== 'https') {
    return res.redirect(`https://${req.get('host')}${req.url}`);
  }
  next();
});

// 6. Secure token storage
async function saveSecureToken(wabaId, accessToken) {
  // NEVER store token as plain text!
  const encrypted = encrypt(accessToken, process.env.ENCRYPTION_KEY);

  await db.query(
    `UPDATE businesses SET access_token = $1 WHERE waba_id = $2`,
    [encrypted, wabaId]
  );
}

// 7. Token refresh handling
async function getValidAccessToken(wabaId) {
  const business = await db.getBusiness(wabaId);

  // Check if token is expiring soon
  const expiresIn = business.expiresAt - Date.now();
  if (expiresIn < 24 * 60 * 60 * 1000) {  // Less than 1 day
    // Refresh token
    const newToken = await refreshAccessToken(business.refreshToken);
    await saveSecureToken(wabaId, newToken);
    return newToken;
  }

  return decrypt(business.accessToken, process.env.ENCRYPTION_KEY);
}
```

---

**Version:** 1.0  
**Last Updated:** June 9, 2026
