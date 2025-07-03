import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { authAPI } from '../../services/api';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, user, setUser, setLoading } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log('🔍 Checking authentication status...');
        setIsChecking(true);
        setAuthError(null);
        
        const response = await authAPI.checkAuth();
        console.log('Auth check response:', response.data);
        
        if (response.data.authenticated && response.data.user) {
          console.log('✅ User authenticated:', response.data.user.email);
          setUser(response.data.user);
        } else {
          console.log('❌ User not authenticated');
          setUser(null);
        }
      } catch (error: any) {
        console.error('❌ Auth check failed:', error);
        setUser(null);
        
        // Check if it's a network error vs auth error
        if (error.code === 'NETWORK_ERROR' || error.message?.includes('Network Error')) {
          setAuthError('Unable to connect to server. Please check your connection.');
        } else if (error.response?.status === 401) {
          setAuthError('Session expired. Please log in again.');
        } else {
          setAuthError('Authentication check failed. Please try again.');
        }
      } finally {
        setIsChecking(false);
        setLoading(false);
      }
    };

    // Always check auth status when component mounts
    checkAuth();
  }, [setUser, setLoading]);

  // Show loading spinner while checking authentication
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Show error if there was an auth check error
  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Authentication Error</h2>
            <p className="text-red-600 mb-4">{authError}</p>
            <button
              onClick={() => window.location.href = '/login'}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    console.log('🔄 Redirecting to login - not authenticated');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Render the protected content
  console.log('✅ Rendering protected content for:', user.email);
  return <>{children}</>;
};