import type { ReactNode } from 'react';

export interface AuthUser {
  admin_name?: string;
  email?: string;
  organization_id?: number | null;
  website_id?: number;
  website_url?: string;
  site_type?: string;
  features?: { product_analytics?: boolean; conversions?: boolean };
  websites?: unknown[];
}

export interface AuthLoginPayload {
  token: string;
  admin_name?: string;
  email?: string;
  organization_id?: number | null;
  website_id?: number;
  website_url?: string;
  site_type?: string;
  features?: { product_analytics?: boolean; conversions?: boolean };
  websites?: unknown[];
}

export interface AuthContextValue {
  user: AuthUser | null;
  login: (data: AuthLoginPayload) => void;
  logout: () => void;
  selectWebsite: (websiteId: number) => Promise<AuthLoginPayload>;
  isAuthenticated: boolean;
}

export declare function AuthProvider(props: { children: ReactNode }): JSX.Element;
export declare function useAuth(): AuthContextValue;
export declare function ProtectedRoute(props: { children: ReactNode }): JSX.Element | null;
