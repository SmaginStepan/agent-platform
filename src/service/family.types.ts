export type Role = "PARENT" | "CHILD";

export interface CreateFamilyRequest {
  userName: string;
  deviceName: string;
  deviceId: string;
  familyName?: string;
}

export interface CreateFamilyResponse {
  familyId: string;
  userId: string;
  deviceId: string;
  token: string;
  role: Role;
}

export interface CreateInviteRequest {
  expiresInMinutes?: number;
  role: "PARENT" | "CHILD";
}

export interface CreateInviteResponse {
  code: string;
  expiresAt: string;
}

export interface JoinFamilyRequest {
  code: string;
  userName: string;
  deviceName: string;
  deviceId: string;
}

export interface JoinFamilyResponse {
  familyId: string;
  userId: string;
  deviceId: string;
  token: string;
  role: Role;
  userCreated: boolean;
}