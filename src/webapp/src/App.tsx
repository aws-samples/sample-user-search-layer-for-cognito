import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import { getCurrentUser, signInWithRedirect, signOut, AuthUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import SinglePropertySearch from './pages/SinglePropertySearch';
import MultiPropertySearch from './pages/MultiPropertySearch';
import AutosuggestSearch from './pages/AutosuggestSearch';

Amplify.configure({
  Auth: {
    Cognito: {
        userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_WEB_CLIENT_ID,
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        userAttributes: {
          email: {required: true},
          given_name: {required: true},
          family_name: {required: true},
        },
        loginWith: {
          oauth: {
            domain: import.meta.env.VITE_COGNITO_OAUTH_DOMAIN || '',
            redirectSignIn: (import.meta.env.VITE_COGNITO_REDIRECT_SIGNIN || '').split(','),
            redirectSignOut: (import.meta.env.VITE_COGNITO_REDIRECT_SIGNOUT || '').split(','),
            scopes: ['openid', 'email', 'profile'],
            responseType: 'code',
          }
        }
    }
  }
});

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();

    const hubListener = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') {
        checkUser();
      } else if (payload.event === 'signedOut') {
        setUser(null);
      }
    });

    return () => hubListener();
  }, []);

  async function checkUser() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch {
      signInWithRedirect();
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
  }

  if (loading || !user) {
    return null;
  }

  return (
    <ErrorBoundary>
      <Router>
        <Layout user={{ username: user.username }} signOut={handleSignOut}>
          <Routes>
            <Route path="/single-property-user-search" element={<SinglePropertySearch />} />
            <Route path="/multi-property-user-search" element={<MultiPropertySearch />} />
            <Route path="/autosuggest-user-search" element={<AutosuggestSearch />} />
            <Route path="*" element={<Navigate to="/single-property-user-search" replace />} />
          </Routes>
        </Layout>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
