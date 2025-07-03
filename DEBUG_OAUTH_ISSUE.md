# Debug OAuth Redirect URI Mismatch

## Current Issue Analysis

You're getting `Error 400: redirect_uri_mismatch` even after updating Google Cloud Console. Let's debug this systematically.

## Step 1: Verify Your Current Render URLs

From your `render.yaml`, your URLs should be:
- **Backend**: `https://ai-chatbot-backend-fuzp.onrender.com`
- **Frontend**: `https://ai-chatbot-frontend-9dq0.onrender.com`

## Step 2: Check Your Actual Render Service URLs

1. Go to your [Render Dashboard](https://dashboard.render.com)
2. Click on your **backend service** (`ai-chatbot-backend`)
3. Copy the exact URL shown (it might be different from what's in render.yaml)
4. Click on your **frontend service** (`ai-chatbot-frontend`)
5. Copy the exact URL shown

## Step 3: Verify Google Cloud Console Settings

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **Credentials**
3. Click on your OAuth 2.0 Client ID
4. Check that **Authorized redirect URIs** contains EXACTLY:
   ```
   https://YOUR-ACTUAL-BACKEND-URL.onrender.com/auth/google/callback
   ```
5. Check that **Authorized JavaScript origins** contains:
   ```
   https://YOUR-ACTUAL-FRONTEND-URL.onrender.com
   ```

## Step 4: Common Issues to Check

### Issue 1: URL Mismatch
- Your actual Render URLs might be different from what's in render.yaml
- Render sometimes assigns different URLs than expected

### Issue 2: Multiple OAuth Clients
- You might have multiple OAuth clients in Google Cloud Console
- Make sure you're editing the correct one
- Check that your `GOOGLE_CLIENT_ID` environment variable matches the client you're editing

### Issue 3: Environment Variables Not Updated
- Your Render environment variables might still have old URLs
- Check that `GOOGLE_REDIRECT_URI` in Render matches your actual backend URL

## Step 5: Quick Fix Steps

1. **Get your actual Render URLs** from the dashboard
2. **Update Google Cloud Console** with the exact URLs
3. **Update Render environment variables** if needed:
   ```
   GOOGLE_REDIRECT_URI=https://YOUR-ACTUAL-BACKEND-URL.onrender.com/auth/google/callback
   FRONTEND_URL=https://YOUR-ACTUAL-FRONTEND-URL.onrender.com
   ```
4. **Redeploy your backend** to pick up any environment variable changes

## Step 6: Test the OAuth Flow

1. Clear your browser cache/cookies
2. Go to your frontend URL
3. Click "Sign in with Google"
4. Check the URL you're redirected to - it should match what's in Google Cloud Console

## Step 7: Debug Information

If it still doesn't work, check these:

1. **Browser Network Tab**: Look at the OAuth redirect request to see what URL is being used
2. **Render Logs**: Check your backend logs for any OAuth-related errors
3. **Google Cloud Console Logs**: Check if there are any API usage logs

## Most Likely Solution

The issue is probably that your actual Render URLs are different from what's in your render.yaml file. Here's what to do:

1. Get the EXACT URLs from your Render dashboard
2. Update Google Cloud Console with those exact URLs
3. Update your Render environment variables to match
4. Redeploy your backend service

## Environment Variables to Double-Check

In your Render backend service, make sure these match your actual URLs:
```
GOOGLE_REDIRECT_URI=https://your-actual-backend-url.onrender.com/auth/google/callback
FRONTEND_URL=https://your-actual-frontend-url.onrender.com
```

## If You're Still Stuck

1. Share the exact URLs from your Render dashboard
2. Share a screenshot of your Google Cloud Console OAuth settings
3. Check if you have multiple Google Cloud projects or OAuth clients