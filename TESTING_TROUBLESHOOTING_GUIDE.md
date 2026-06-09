# Testing, Troubleshooting & Advanced Scenarios
## Embedded Signup Complete Testing & Advanced Implementation Guide

**References:**
- Main Implementation: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- Business App Users: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users

---

## Table of Contents
1. [Testing Strategies](#testing-strategies)
2. [Local Development Setup](#local-development-setup)
3. [Debugging Tools](#debugging-tools)
4. [Common Issues & Solutions](#common-issues--solutions)
5. [Advanced Scenarios](#advanced-scenarios)
6. [Performance Optimization](#performance-optimization)
7. [Monitoring & Analytics](#monitoring--analytics)

---

## Testing Strategies

### Unit Testing

```javascript
// jest test suite for Embedded Signup
const { exchangeCodeForToken, verifyWebhookSignature } = require('../auth');
const crypto = require('crypto');

describe('Embedded Signup Authorization', () => {
  describe('exchangeCodeForToken', () => {
    it('should exchange valid code for token', async () => {
      const mockCode = 'test_code_123';

      const token = await exchangeCodeForToken(mockCode);

      expect(token).toHaveProperty('accessToken');
      expect(token).toHaveProperty('wabaId');
      expect(token.accessToken).toBeTruthy();
    });

    it('should throw on invalid code', async () => {
      const invalidCode = 'invalid_code';

      await expect(
        exchangeCodeForToken(invalidCode)
      ).rejects.toThrow();
    });

    it('should throw on expired code (> 30 seconds)', async () => {
      const expiredCode = 'expired_code';

      await expect(
        exchangeCodeForToken(expiredCode)
      ).rejects.toThrow('Code expired');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const appSecret = 'test_secret';

      const signature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(payload)
        .digest('hex');

      const mockReq = {
        get: (header) => header === 'X-Hub-Signature-256' ? signature : undefined,
        rawBody: payload
      };

      expect(verifyWebhookSignature(mockReq, appSecret)).toBe(true);
    });

    it('should reject invalid signature', () => {
      const mockReq = {
        get: () => 'sha256=invalidsignature',
        rawBody: JSON.stringify({ test: 'data' })
      };

      expect(verifyWebhookSignature(mockReq, 'secret')).toBe(false);
    });
  });
});

// Test coexistence mode configuration
describe('Coexistence Mode', () => {
  it('should generate correct config for coexistence', () => {
    const config = generateSignupConfig({
      coexistenceEnabled: true,
      configId: '1731129688347511'
    });

    expect(config.extras).toEqual({
      setup: {},
      featureType: 'whatsapp_business_app_onboarding',
      sessionInfoVersion: '3'
    });
  });

  it('should generate correct config for standard mode', () => {
    const config = generateSignupConfig({
      coexistenceEnabled: false,
      configId: '1731129688347511'
    });

    expect(config.extras).toEqual({
      setup: {}
    });
  });
});

// Test webhook payload parsing
describe('Webhook Processing', () => {
  it('should parse incoming message webhook', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '102290129340398',
        changes: [{
          field: 'messages',
          value: {
            messages: [{
              id: 'wamid.123',
              from: '16505551234',
              type: 'text',
              text: { body: 'Hello' },
              timestamp: '1738796547'
            }],
            contacts: [{
              profile: { name: 'Test User' },
              wa_id: '16505551234'
            }],
            metadata: {
              phone_number_id: '106540352242922',
              display_phone_number: '15550783881'
            }
          }
        }]
      }]
    };

    const result = await processWebhook(payload);

    expect(result.processed).toBe(true);
    expect(result.messageCount).toBe(1);
  });

  it('should handle coexistence message echoes', async () => {
    const echoPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '102290129340398',
        changes: [{
          field: 'smb_message_echoes',
          value: {
            message_echoes: [{
              from: '15550783881',
              to: '16505551234',
              id: 'wamid.456',
              type: 'text',
              text: { body: 'Message from WhatsApp Business App' },
              timestamp: '1738796547'
            }]
          }
        }]
      }]
    };

    const result = await processWebhook(echoPayload);

    expect(result.messageEchoCount).toBe(1);
  });

  it('should handle account disconnection webhook', async () => {
    const disconnectionPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: '102290129340398',
        changes: [{
          field: 'account_update',
          value: {
            event: 'PARTNER_REMOVED',
            phone_number: '15550783881',
            disconnection_info: {
              reason: 'PRIMARY_INACTIVITY',
              initiated_by: 'SYSTEM'
            }
          }
        }]
      }]
    };

    const result = await processWebhook(disconnectionPayload);

    expect(result.accountDisconnected).toBe(true);
    expect(result.reason).toBe('PRIMARY_INACTIVITY');
  });
});
```

### Integration Testing

```javascript
// Integration test with real Facebook sandbox environment
const axios = require('axios');
const request = require('supertest');
const app = require('../app');

describe('Embedded Signup Integration', () => {
  let testBusinessWabaId;
  let testAccessToken;

  beforeAll(async () => {
    // Setup test business account
    testBusinessWabaId = process.env.TEST_WABA_ID;
    testAccessToken = process.env.TEST_ACCESS_TOKEN;

    if (!testBusinessWabaId || !testAccessToken) {
      console.warn('Skipping integration tests - TEST_WABA_ID and TEST_ACCESS_TOKEN required');
      return;
    }
  });

  it('should complete full signup flow', async () => {
    // 1. Simulate code generation
    const mockCode = 'test_code_' + Date.now();

    // 2. Send code to exchange endpoint
    const exchangeResponse = await request(app)
      .post('/api/auth/exchange-code')
      .send({ code: mockCode })
      .expect(200);

    expect(exchangeResponse.body.success).toBe(true);

    // 3. Verify business was saved
    const business = await db.getBusiness(testBusinessWabaId);
    expect(business).toBeDefined();
    expect(business.accessToken).toBeDefined();
  });

  it('should initiate synchronization', async () => {
    const syncResponse = await request(app)
      .post(`/api/business/${testBusinessWabaId}/sync`)
      .expect(200);

    expect(syncResponse.body.success).toBe(true);
    expect(syncResponse.body.contactsRequestId).toBeDefined();
    expect(syncResponse.body.historyRequestId).toBeDefined();
  });

  it('should check coexistence status', async () => {
    const statusResponse = await request(app)
      .get(`/api/business/${testBusinessWabaId}/status`)
      .expect(200);

    expect(statusResponse.body).toHaveProperty('supportsCoexistence');
    expect(statusResponse.body).toHaveProperty('isOnBusinessApp');
  });

  it('should handle webhook events', async () => {
    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: testBusinessWabaId,
        changes: [{
          field: 'messages',
          value: {
            messages: [{
              id: 'wamid.integration_test_' + Date.now(),
              from: '16505551234',
              type: 'text',
              text: { body: 'Integration test message' },
              timestamp: String(Math.floor(Date.now() / 1000))
            }],
            metadata: {
              phone_number_id: '106540352242922',
              display_phone_number: '15550783881'
            }
          }
        }]
      }]
    };

    const webhookResponse = await request(app)
      .post('/webhook')
      .send(webhookPayload)
      .expect(200);

    // Verify message was processed
    const savedMessage = await db.getMessage('wamid.integration_test_' + Date.now());
    expect(savedMessage).toBeDefined();
  });
});
```

### End-to-End Testing

```javascript
// Puppeteer E2E test for frontend flow
const puppeteer = require('puppeteer');

describe('Embedded Signup E2E', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should complete signup flow end-to-end', async () => {
    // 1. Navigate to signup page
    await page.goto('https://localhost:3000/signup', {
      waitUntil: 'networkidle2'
    });

    // 2. Wait for Facebook SDK to load
    await page.waitForSelector('[onclick*="launchWhatsAppSignup"]');

    // 3. Get initial state
    const initialCoexistenceState = await page.$eval(
      'input[type="checkbox"]',
      el => el.checked
    );
    expect(initialCoexistenceState).toBe(true);  // Default enabled

    // 4. Toggle coexistence
    await page.click('input[type="checkbox"]');

    const toggledState = await page.$eval(
      'input[type="checkbox"]',
      el => el.checked
    );
    expect(toggledState).toBe(false);

    // 5. Toggle back on
    await page.click('input[type="checkbox"]');

    // 6. Click signup button
    await page.click('[onclick*="launchWhatsAppSignup"]');

    // 7. Wait for popup/modal (Facebook SDK)
    const popupWaiting = page.waitForFunction(
      () => window.FB && typeof window.FB.login === 'function'
    );

    // In real scenario, user would login and authorize
    // This test verifies the button triggers correctly
  });

  it('should display error when SDK fails to load', async () => {
    await page.goto('https://localhost:3000/signup');

    // Simulate SDK failure by setting a flag
    await page.evaluate(() => {
      window.FB = null;
    });

    await page.click('[onclick*="launchWhatsAppSignup"]');

    // Should show error message
    const errorMessage = await page.$('.error');
    expect(errorMessage).toBeDefined();
  });

  it('should update UI when coexistence mode changes', async () => {
    await page.goto('https://localhost:3000/signup');

    // Check initial mode display
    let modeText = await page.$eval(
      'p:has-text("Current mode")',
      el => el.textContent
    );
    expect(modeText).toContain('Coexistence');

    // Toggle off
    await page.click('input[type="checkbox"]');

    // Check updated mode display
    modeText = await page.$eval(
      'p:has-text("Current mode")',
      el => el.textContent
    );
    expect(modeText).toContain('Standard');
  });
});
```

---

## Local Development Setup

### Using HTTPS Locally

```bash
# Install local SSL proxy
npm install -g local-ssl-proxy

# In terminal 1: Start your Node.js app on port 3000
npm start

# In terminal 2: Create HTTPS proxy for port 3000
local-ssl-proxy --source 3001 --target 3000

# Now access your app at: https://localhost:3001

# Add to Facebook App Dashboard:
# - Allowed domains: localhost
# - Valid OAuth redirect URIs: https://localhost:3001/callback
```

### Docker Setup

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generate self-signed certificate for HTTPS
RUN openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout key.pem -out cert.pem -days 365 \
  -subj "/C=US/ST=State/L=City/O=Org/CN=localhost"

EXPOSE 3000

CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t whatsapp-esb-dev .
docker run -p 3000:3000 \
  -e FACEBOOK_APP_ID=your_app_id \
  -e FACEBOOK_APP_SECRET=your_secret \
  whatsapp-esb-dev
```

### Environment Variables for Local Dev

```bash
# .env.local
NODE_ENV=development
PORT=3000
HTTPS=true

# Facebook API
FACEBOOK_APP_ID=2140782060178223
FACEBOOK_APP_SECRET=your_app_secret_here
FACEBOOK_CONFIG_ID=1731129688347511
REDIRECT_URI=https://localhost:3001/callback

# Webhook
WEBHOOK_VERIFY_TOKEN=test_webhook_token_12345

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/whatsapp_esb

# Encryption
ENCRYPTION_KEY=your_encryption_key_here

# Logging
LOG_LEVEL=debug
```

---

## Debugging Tools

### Browser DevTools Debugging

```javascript
// Add to WhatsAppSignup.jsx for detailed logging
if (process.env.NODE_ENV === 'development') {
  window.debugESB = {
    logMessages: true,
    logs: [],

    addLog(message, data) {
      const log = {
        timestamp: new Date().toISOString(),
        message,
        data
      };
      this.logs.push(log);
      if (this.logMessages) {
        console.log(message, data);
      }
    },

    // Check SDK status
    checkSDK() {
      return {
        fbLoaded: typeof window.FB !== 'undefined',
        initialized: window.FB?.init ? 'yes' : 'no',
        version: window.__fbAsyncInit ? 'async' : 'sync'
      };
    },

    // Check configuration
    getConfig() {
      return {
        appId: process.env.REACT_APP_FACEBOOK_APP_ID,
        configId: process.env.REACT_APP_CONFIG_ID,
        redirectUri: window.location.origin + '/callback'
      };
    },

    // Simulate response callback
    simulateCallback(response) {
      console.log('Simulating response:', response);
      fbLoginCallback(response);
    },

    // View all logs
    viewLogs() {
      return this.logs;
    },

    // Export logs for support
    exportLogs() {
      const json = JSON.stringify(this.logs, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `esb_logs_${Date.now()}.json`;
      a.click();
    }
  };
}

// Usage in browser console:
// window.debugESB.checkSDK()
// window.debugESB.getConfig()
// window.debugESB.viewLogs()
// window.debugESB.exportLogs()
```

### Server-Side Debugging

```javascript
// Debug middleware
app.use((req, res, next) => {
  if (process.env.DEBUG_MODE === 'true') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);

    const originalJson = res.json;
    res.json = function(data) {
      console.log('Response:', JSON.stringify(data, null, 2).substring(0, 500));
      return originalJson.call(this, data);
    };
  }
  next();
});

// Request logging middleware
app.use(express.json({
  verify: (req, res, buf) => {
    if (process.env.DEBUG_MODE === 'true' && req.path.includes('/webhook')) {
      console.log('Webhook body:', JSON.stringify(JSON.parse(buf), null, 2));
    }
  }
}));

// HTTP request debugging for API calls
const originalAxios = require('axios').default;
if (process.env.DEBUG_API === 'true') {
  originalAxios.interceptors.request.use(config => {
    console.log(`[API] ${config.method.toUpperCase()} ${config.url}`);
    return config;
  });

  originalAxios.interceptors.response.use(
    response => {
      console.log(`[API] Response ${response.status}`, response.data);
      return response;
    },
    error => {
      console.error(`[API] Error:`, error.response?.data || error.message);
      throw error;
    }
  );
}
```

### Postman Testing Collection

```json
{
  "info": {
    "name": "Embedded Signup API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Exchange Authorization Code",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"code\": \"test_code_1234567890\"\n}"
        },
        "url": {
          "raw": "https://localhost:3001/api/auth/exchange-code",
          "protocol": "https",
          "host": ["localhost"],
          "port": "3001",
          "path": ["api", "auth", "exchange-code"]
        }
      }
    },
    {
      "name": "Get Business Status",
      "request": {
        "method": "GET",
        "url": {
          "raw": "https://localhost:3001/api/business/{{waba_id}}/status",
          "protocol": "https",
          "host": ["localhost"],
          "port": "3001",
          "path": ["api", "business", "{{waba_id}}", "status"]
        }
      }
    },
    {
      "name": "Initiate Synchronization",
      "request": {
        "method": "POST",
        "url": {
          "raw": "https://localhost:3001/api/sync/{{phone_number_id}}",
          "protocol": "https",
          "host": ["localhost"],
          "port": "3001",
          "path": ["api", "sync", "{{phone_number_id}}"]
        }
      }
    },
    {
      "name": "Send Test Webhook",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"object\": \"whatsapp_business_account\",\n  \"entry\": [{\n    \"id\": \"{{waba_id}}\",\n    \"changes\": [{\n      \"field\": \"messages\",\n      \"value\": {\n        \"messages\": [{\n          \"id\": \"wamid.test_{{$timestamp}}\",\n          \"from\": \"16505551234\",\n          \"type\": \"text\",\n          \"text\": { \"body\": \"Test message\" },\n          \"timestamp\": \"{{$timestamp}}\"\n        }],\n        \"metadata\": {\n          \"phone_number_id\": \"{{phone_number_id}}\",\n          \"display_phone_number\": \"15550783881\"\n        }\n      }\n    }]\n  }]\n}"
        },
        "url": {
          "raw": "https://localhost:3001/webhook",
          "protocol": "https",
          "host": ["localhost"],
          "port": "3001",
          "path": ["webhook"]
        }
      }
    }
  ],
  "variable": [
    {
      "key": "waba_id",
      "value": "102290129340398"
    },
    {
      "key": "phone_number_id",
      "value": "106540352242922"
    }
  ]
}
```

---

## Common Issues & Solutions

### Issue 1: Authorization Code Expires (Code: 190)

**Problem:**
```
error: {
  code: 190,
  message: "Invalid OAuth access token"
}
```

**Cause:** Not exchanging code within 30 seconds

**Solution:**
```javascript
// ✅ Correct approach
const fbLoginCallback = (response) => {
  if (response.authResponse) {
    const code = response.authResponse.code;
    
    // Send IMMEDIATELY without any delays
    sendCodeToServer(code);
  }
};

// Frontend should send synchronously:
async function sendCodeToServer(code) {
  try {
    const response = await fetch('/api/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    
    if (!response.ok) throw new Error('Code exchange failed');
    return await response.json();
  } catch (error) {
    console.error('Error sending code:', error);
  }
}
```

### Issue 2: SDK Not Loading

**Problem:** Facebook SDK fails to load, `window.FB` is undefined

**Solution:**
```javascript
// Add retry logic
async function waitForFBSDK(maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    if (typeof window.FB !== 'undefined') {
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Facebook SDK failed to load');
}

// Use it
useEffect(() => {
  const checkSDK = async () => {
    try {
      await waitForFBSDK();
      setSdkLoaded(true);
    } catch (error) {
      setError('Facebook SDK failed to load');
    }
  };

  if (!window.FB) {
    checkSDK();
  }
}, []);
```

### Issue 3: Domain Not Allowed

**Problem:**
```
error: "Domain not allowed"
```

**Solution:**
```javascript
// Verify in App Dashboard:
// 1. Facebook Login for Business > Settings > Client OAuth settings
// 2. Check "Allowed domains" includes your domain (with https://)
// 3. Check "Valid OAuth redirect URIs" matches your redirect_uri

// Examples:
// Allowed domains:
//   - https://yourdomain.com
//   - https://app.yourdomain.com
//   - https://localhost (for dev with self-signed cert)

// Valid OAuth redirect URIs:
//   - https://yourdomain.com/callback
//   - https://app.yourdomain.com/callback
```

### Issue 4: Coexistence Mode Not Showing

**Problem:** User doesn't see option to use existing WhatsApp Business App account

**Solution:**
```javascript
// Verify you're using correct extras configuration
const correctConfig = {
  config_id: "1731129688347511",
  response_type: "code",
  override_default_response_type: true,
  extras: {
    setup: {},
    featureType: "whatsapp_business_app_onboarding",  // ← KEY LINE
    sessionInfoVersion: "3"                           // ← USE v3
  }
};

// Test with this endpoint
app.get('/api/config-test', (req, res) => {
  res.json({
    usingCoexistence: true,
    configId: process.env.FACEBOOK_CONFIG_ID,
    extras: {
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3"
    }
  });
});
```

### Issue 5: Webhook Not Receiving Events

**Problem:** Webhook POST endpoint not receiving events from Meta

**Solution:**
```javascript
// 1. Verify webhook is registered
// App Dashboard > WhatsApp > Configuration > Webhooks
// ✓ Callback URL: https://yourdomain.com/webhook
// ✓ Verify token matches your env variable

// 2. Verify subscription fields
// ✓ account_update
// ✓ messages
// ✓ message_status
// ✓ history (for coexistence)
// ✓ smb_app_state_sync (for coexistence)
// ✓ smb_message_echoes (for coexistence)

// 3. Test webhook endpoint
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  
  console.log('Webhook verification:', { mode, token });
  
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// 4. Monitor webhook health
setInterval(async () => {
  const health = await checkWebhookHealth();
  if (!health.ok) {
    alertAdmin('Webhook health check failed');
  }
}, 5 * 60 * 1000);  // Every 5 minutes
```

---

## Advanced Scenarios

### Multi-WABA Support

```javascript
// Handle businesses with multiple WhatsApp Business Accounts
app.post('/api/auth/exchange-code', async (req, res) => {
  const { code } = req.body;

  try {
    const tokenData = await exchangeCodeForToken(code);

    // Check if multi-WABA
    if (Array.isArray(tokenData.waba_ids)) {
      // Multiple WABAs - let user select primary one
      res.json({
        success: true,
        multiWaba: true,
        wabaIds: tokenData.waba_ids,
        message: 'Select which WhatsApp Business Account to use'
      });
    } else {
      // Single WABA - proceed normally
      await saveBusinessToken({
        wabaId: tokenData.user_id,
        accessToken: tokenData.access_token
      });

      res.json({ success: true });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Allow user to select primary WABA
app.post('/api/business/select-waba', async (req, res) => {
  const { primaryWabaId, otherWabaIds } = req.body;

  // Save all WABAs but mark primary
  for (const wabaId of [primaryWabaId, ...otherWabaIds]) {
    await db.upsertWaba({
      wabaId,
      isPrimary: wabaId === primaryWabaId,
      status: 'active'
    });
  }

  res.json({ success: true });
});
```

### Custom Auth Flow Integration

```javascript
// Integrate Embedded Signup with existing auth system
app.post('/api/auth/exchange-code', async (req, res) => {
  const { code, userId } = req.body;

  try {
    const tokenData = await exchangeCodeForToken(code);

    // Link to existing user
    await db.linkBusinessToUser({
      userId,
      wabaId: tokenData.user_id,
      accessToken: tokenData.access_token
    });

    // Create JWT token for user
    const jwtToken = jwt.sign(
      { userId, wabaId: tokenData.user_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token: jwtToken,
      userId,
      wabaId: tokenData.user_id
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Batch Webhook Processing

```javascript
// Process webhooks asynchronously to prevent bottlenecks
const webhookQueue = [];
const maxQueueSize = 1000;

app.post('/webhook', (req, res) => {
  // Always respond 200 immediately
  res.status(200).send('ok');

  // Queue for async processing
  if (webhookQueue.length < maxQueueSize) {
    webhookQueue.push({
      body: req.body,
      receivedAt: Date.now()
    });
  } else {
    console.warn('Webhook queue full - dropping event');
  }
});

// Process queued webhooks in batches
async function processWebhookQueue() {
  while (webhookQueue.length > 0) {
    const batch = webhookQueue.splice(0, 10);  // Process 10 at a time

    await Promise.all(
      batch.map(item => processWebhook(item.body))
    );
  }

  // Schedule next batch
  setTimeout(processWebhookQueue, 1000);
}

// Start queue processor
processWebhookQueue();
```

### Automatic Token Refresh

```javascript
// Implement automatic token refresh before expiry
async function refreshTokenIfNeeded(business) {
  const hoursUntilExpiry = (business.expiresAt - Date.now()) / (1000 * 60 * 60);

  // Refresh if less than 24 hours remaining
  if (hoursUntilExpiry < 24) {
    try {
      const newToken = await requestLongLivedToken(business.accessToken);

      await db.updateBusiness(business.wabaId, {
        accessToken: newToken,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)  // 60 days
      });

      console.log(`Token refreshed for ${business.wabaId}`);
    } catch (error) {
      console.error(`Token refresh failed for ${business.wabaId}:`, error);
    }
  }
}

// Run refresh job every hour
setInterval(async () => {
  const businesses = await db.getAllBusinesses();

  for (const business of businesses) {
    await refreshTokenIfNeeded(business);
  }
}, 60 * 60 * 1000);  // Every hour
```

---

## Performance Optimization

### Database Query Optimization

```javascript
// Add indexes
CREATE INDEX idx_messages_waba_timestamp 
  ON messages(waba_id, timestamp DESC);

CREATE INDEX idx_contacts_waba_updated 
  ON contacts(waba_id, updated_at DESC);

// Use pagination for large datasets
app.get('/api/business/:wabaId/messages', async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const query = `
    SELECT * FROM messages
    WHERE waba_id = $1
    ORDER BY timestamp DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await db.query(query, [req.params.wabaId, limit, offset]);

  res.json({
    messages: result.rows,
    page,
    limit,
    total: result.rowCount
  });
});
```

### Webhook Response Performance

```javascript
// Process webhooks asynchronously
app.post('/webhook', async (req, res) => {
  // Respond immediately
  res.status(200).send('ok');

  // Process in background
  setImmediate(async () => {
    try {
      await processWebhookEvent(req.body);
    } catch (error) {
      console.error('Async webhook processing error:', error);
    }
  });
});

// Or use job queue
const bullQueue = require('bull');
const webhookQueue = new bullQueue('webhooks', process.env.REDIS_URL);

app.post('/webhook', async (req, res) => {
  res.status(200).send('ok');

  // Add to queue
  await webhookQueue.add(req.body, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });
});

// Process queue jobs
webhookQueue.process(async (job) => {
  await processWebhookEvent(job.data);
});
```

### Connection Pooling

```javascript
// PostgreSQL connection pooling
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,  // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Monitor pool
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});
```

---

## Monitoring & Analytics

### Error Tracking

```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0
});

app.use(Sentry.Handlers.requestHandler());

// Capture errors
try {
  // ... code
} catch (error) {
  Sentry.captureException(error);
}

app.use(Sentry.Handlers.errorHandler());
```

### Analytics

```javascript
// Track important events
const analytics = require('universal-analytics');
const ua = analytics(process.env.GA_TRACKING_ID);

function trackSignupEvent(eventType, data) {
  ua.event({
    ec: 'whatsapp-esb',
    ea: eventType,
    el: data.wabaId,
    ev: data.value || 1
  }).send();
}

// Usage
trackSignupEvent('signup_complete', { wabaId: '123', value: 1 });
trackSignupEvent('coexistence_enabled', { wabaId: '123' });
trackSignupEvent('sync_completed', { wabaId: '123' });
```

### Health Checks

```javascript
// Implement health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database
    await db.query('SELECT 1');

    // Check Redis (if using webhooks)
    await redis.ping();

    res.json({
      status: 'ok',
      timestamp: new Date(),
      checks: {
        database: 'ok',
        redis: 'ok'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});
```

---

**Version:** 1.0  
**Last Updated:** June 9, 2026
