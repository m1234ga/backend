import axios, { AxiosInstance } from 'axios';

interface KeycloakUser {
  id?: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
}

interface KeycloakRole {
  id?: string;
  name: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
}

interface CreateUserRequest {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  credentials?: Array<{
    type: string;
    value: string;
    temporary: boolean;
  }>;
}

export class KeycloakAdminHelper {
  private baseUrl: string;
  private realm: string;
  private clientId: string;
  private clientSecret: string;
  private adminClient: AxiosInstance | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.baseUrl = process.env.KEYCLOAK_URL || 'http://localhost:8080';
    this.realm = process.env.KEYCLOAK_REALM || 'chat-app';
    this.clientId = process.env.KEYCLOAK_CLIENT_ID || 'chat-app-backend';
    this.clientSecret = process.env.KEYCLOAK_CLIENT_SECRET||'My8NwQDzxHwsMBmjSIa7hwNIr3JG0mag';
  }

  /**
   * Get admin access token
   */
  private async getAdminToken(): Promise<string> {
    try {
      // Check if we have a valid token
      if (this.adminClient && Date.now() < this.tokenExpiresAt) {
        return this.adminClient.defaults.headers.common['Authorization'] as string;
      }

      // Use the configured realm (chat-app) instead of master
      const tokenUrl = `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`;
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const token = response.data.access_token;
      const expiresIn = response.data.expires_in || 300;
      
      // Set token expiration with 30 second buffer
      this.tokenExpiresAt = Date.now() + (expiresIn - 30) * 1000;

      // Create axios instance with token
      this.adminClient = axios.create({
        baseURL: `${this.baseUrl}/admin/realms/${this.realm}`,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      return `Bearer ${token}`;
    } catch (error: any) {
      console.error('Error getting admin token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Keycloak admin API');
    }
  }

  /**
   * Get all users
   */
  async getUsers(params?: {
    search?: string;
    first?: number;
    max?: number;
  }): Promise<KeycloakUser[]> {
    try {
      await this.getAdminToken();
      
      const response = await this.adminClient!.get('/users', {
        params: {
          search: params?.search,
          first: params?.first || 0,
          max: params?.max || 100,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error('Error fetching users:', error.response?.data || error.message);
      throw new Error('Failed to fetch users from Keycloak');
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<KeycloakUser> {
    try {
      await this.getAdminToken();
      const response = await this.adminClient!.get(`/users/${userId}`);
      return response.data;
    } catch (error: any) {
      console.error('Error fetching user:', error.response?.data || error.message);
      throw new Error('Failed to fetch user from Keycloak');
    }
  }

  /**
   * Create a new user
   */
  async createUser(userData: CreateUserRequest): Promise<string> {
    try {
      await this.getAdminToken();
      
      const response = await this.adminClient!.post('/users', userData);
      
      // Extract user ID from Location header
      const locationHeader = response.headers['location'];
      if (locationHeader) {
        const userId = locationHeader.split('/').pop();
        return userId || '';
      }

      // If no location header, search for the user
      const users = await this.getUsers({ search: userData.username });
      const createdUser = users.find(u => u.username === userData.username);
      
      return createdUser?.id || '';
    } catch (error: any) {
      console.error('Error creating user:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errorMessage || 'Failed to create user in Keycloak');
    }
  }

  /**
   * Update an existing user
   */
  async updateUser(userId: string, userData: Partial<KeycloakUser>): Promise<void> {
    try {
      await this.getAdminToken();
      await this.adminClient!.put(`/users/${userId}`, userData);
    } catch (error: any) {
      console.error('Error updating user:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errorMessage || 'Failed to update user in Keycloak');
    }
  }

  /**
   * Delete a user
   */
  async deleteUser(userId: string): Promise<void> {
    try {
      await this.getAdminToken();
      await this.adminClient!.delete(`/users/${userId}`);
    } catch (error: any) {
      console.error('Error deleting user:', error.response?.data || error.message);
      throw new Error('Failed to delete user from Keycloak');
    }
  }

  /**
   * Reset user password
   */
  async resetPassword(userId: string, newPassword: string, temporary: boolean = false): Promise<void> {
    try {
      await this.getAdminToken();
      
      await this.adminClient!.put(`/users/${userId}/reset-password`, {
        type: 'password',
        value: newPassword,
        temporary: temporary,
      });
    } catch (error: any) {
      console.error('Error resetting password:', error.response?.data || error.message);
      throw new Error('Failed to reset user password in Keycloak');
    }
  }

  /**
   * Get all realm roles
   */
  async getRealmRoles(): Promise<KeycloakRole[]> {
    try {
      await this.getAdminToken();
      const response = await this.adminClient!.get('/roles');
      return response.data;
    } catch (error: any) {
      console.error('Error fetching roles:', error.response?.data || error.message);
      throw new Error('Failed to fetch roles from Keycloak');
    }
  }

  /**
   * Get user's realm roles
   */
  async getUserRealmRoles(userId: string): Promise<KeycloakRole[]> {
    try {
      await this.getAdminToken();
      const response = await this.adminClient!.get(`/users/${userId}/role-mappings/realm`);
      return response.data;
    } catch (error: any) {
      console.error('Error fetching user roles:', error.response?.data || error.message);
      throw new Error('Failed to fetch user roles from Keycloak');
    }
  }

  /**
   * Get available realm roles for user (roles not yet assigned)
   */
  async getAvailableRealmRoles(userId: string): Promise<KeycloakRole[]> {
    try {
      await this.getAdminToken();
      const response = await this.adminClient!.get(`/users/${userId}/role-mappings/realm/available`);
      return response.data;
    } catch (error: any) {
      console.error('Error fetching available roles:', error.response?.data || error.message);
      throw new Error('Failed to fetch available roles from Keycloak');
    }
  }

  /**
   * Add realm roles to user
   */
  async addRealmRolesToUser(userId: string, roles: KeycloakRole[]): Promise<void> {
    try {
      await this.getAdminToken();
      await this.adminClient!.post(`/users/${userId}/role-mappings/realm`, roles);
    } catch (error: any) {
      console.error('Error adding roles to user:', error.response?.data || error.message);
      throw new Error('Failed to add roles to user in Keycloak');
    }
  }

  /**
   * Remove realm roles from user
   */
  async removeRealmRolesFromUser(userId: string, roles: KeycloakRole[]): Promise<void> {
    try {
      await this.getAdminToken();
      await this.adminClient!.delete(`/users/${userId}/role-mappings/realm`, {
        data: roles,
      });
    } catch (error: any) {
      console.error('Error removing roles from user:', error.response?.data || error.message);
      throw new Error('Failed to remove roles from user in Keycloak');
    }
  }

  /**
   * Create a new role
   */
  async createRole(roleName: string, description?: string): Promise<void> {
    try {
      await this.getAdminToken();
      await this.adminClient!.post('/roles', {
        name: roleName,
        description: description || '',
      });
    } catch (error: any) {
      console.error('Error creating role:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errorMessage || 'Failed to create role in Keycloak');
    }
  }

  /**
   * Get user count
   */
  async getUserCount(): Promise<number> {
    try {
      await this.getAdminToken();
      const response = await this.adminClient!.get('/users/count');
      return response.data;
    } catch (error: any) {
      console.error('Error getting user count:', error.response?.data || error.message);
      return 0;
    }
  }
}

// Export singleton instance
export const keycloakAdmin = new KeycloakAdminHelper();

