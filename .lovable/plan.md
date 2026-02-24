

## Fix: Race Condition on Login Redirecting to "Waiting Approval"

### Problem
When logging in, there's a timing issue:
1. The login handler calls `navigate('/pipeline')` immediately after auth succeeds
2. The `onAuthStateChange` listener sets the session but loads membership data asynchronously (via `setTimeout`)
3. Between these two events, the app sees a valid session with no membership, so it redirects to `/waiting`

### Solution

**File: `src/contexts/AuthContext.tsx`**
- Set `loading = true` immediately when `onAuthStateChange` detects a new sign-in event, BEFORE the `setTimeout` that loads user data
- This ensures the app shows the loading spinner instead of rendering routes with incomplete state

**File: `src/pages/Login.tsx`**
- Remove the manual `navigate('/pipeline')` after login. The `AuthContext` + router logic in `App.tsx` already handles redirection based on the user's role and membership. Navigating manually creates a race with the context loading.

### Technical Details

In `AuthContext.tsx`, the `onAuthStateChange` callback will be updated to:
```
(_event, sess) => {
  setSession(sess);
  setUser(sess?.user ?? null);
  if (sess?.user) {
    setLoading(true);  // <-- Block rendering until data loads
    setTimeout(async () => {
      await loadUserData(sess.user.id);
      setLoading(false);
    }, 0);
  } else {
    // clear state...
    setLoading(false);
  }
}
```

In `Login.tsx`, the `handleLogin` success path will simply let the auth state change propagate naturally -- the `App.tsx` routing already redirects authenticated users with memberships to `/pipeline`.

### Impact
- No database changes needed
- Only 2 files modified
- Fixes the redirect to `/waiting` for users who already have a tenant membership

