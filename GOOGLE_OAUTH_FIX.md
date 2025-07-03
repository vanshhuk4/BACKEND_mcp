# Fix Google OAuth Redirect URI Mismatch

## The Problem
You're getting `Error 400: redirect_uri_mismatch` because your Google Cloud Console OAuth settings don't match your Render backend URL.

## The Solution

### 1. Go to Google Cloud Console
1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **APIs & Services** → **Credentials**

### 2. Edit Your OAuth 2.0 Client ID
1. Click on your OAuth 2.0 Client ID (the one you're using)
2. In the **Authorized redirect URIs** section, add:
   ```
   https://ai-chatbot-backend-fuzp.onrender.com/auth/google/callback
   ```

### 3. Also Add Authorized JavaScript Origins
In the **Authorized JavaScript origins** section, add:
```
https://ai-chatbot-frontend-9dq0.onrender.com
```

### 4. Save Changes
Click **Save** at the bottom of the form.

## Important Notes

- The redirect URI must match **exactly** (including https://)
- Make sure you're editing the correct OAuth client ID
- Changes may take a few minutes to propagate

## Current Configuration
Based on your Render setup:
- **Backend URL**: `https://ai-chatbot-backend-fuzp.onrender.com`
- **Frontend URL**: `https://ai-chatbot-frontend-9dq0.onrender.com`
- **Redirect URI**: `https://ai-chatbot-backend-fuzp.onrender.com/auth/google/callback`

## Test After Changes
1. Wait 2-3 minutes after saving in Google Cloud Console
2. Try the OAuth flow again
3. You should now be redirected properly to your chat interface

## If You Still Have Issues
1. Double-check the URLs match exactly
2. Make sure you're using the correct Google Cloud project
3. Verify your environment variables in Render match the Google Cloud Console settings