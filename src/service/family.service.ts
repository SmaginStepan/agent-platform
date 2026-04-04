import { PrismaClient, UserRole } from "@prisma/client";
import {
  CreateFamilyRequest,
  CreateFamilyResponse,
  CreateInviteResponse,
  JoinFamilyRequest,
  JoinFamilyResponse,
} from "./family.types.js";
import { newInviteCode, newToken, sha256 } from "../lib/auth.utils.js";

export class FamilyService {
  constructor(private prisma: PrismaClient) {}

  async createFamily(input: CreateFamilyRequest): Promise<CreateFamilyResponse> {
    const token = newToken();
    const tokenHash = sha256(token);

    const family = await this.prisma.family.create({
      data: {
        name: input.familyName?.trim() || null,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        familyId: family.id,
        role: UserRole.PARENT,
        name: input.userName.trim(),
      },
    });

    const device = await this.prisma.device.upsert({
      where: { deviceId: input.deviceId },
      update: {
        name: input.deviceName.trim(),
        tokenHash,
        userId: user.id,
      },
      create: {
        deviceId: input.deviceId,
        name: input.deviceName.trim(),
        tokenHash,
        userId: user.id,
      },
    });

    return {
      familyId: family.id,
      userId: user.id,
      deviceId: device.deviceId,
      token,
      role: user.role,
    };
  }

  async createInvite(createdByDeviceId: string, inputRole: UserRole, expiresInMinutes = 60): Promise<CreateInviteResponse> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId: createdByDeviceId },
      include: { user: true },
    });

    if (!device) {
      throw new Error("DEVICE_NOT_FOUND");
    }

    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    let code = "";
    for (let i = 0; i < 10; i++) {
      const candidate = newInviteCode(6);
      const existing = await this.prisma.invite.findUnique({
        where: { code: candidate },
      });
      if (!existing) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      throw new Error("INVITE_CODE_GENERATION_FAILED");
    }

    const invite = await this.prisma.invite.create({
      data: {
        familyId: device.user.familyId,
        createdByUserId: device.userId,
        code,
        expiresAt,
        role: inputRole,
      },
    });

    return {
      code: invite.code,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async joinFamilyByCode(input: JoinFamilyRequest): Promise<JoinFamilyResponse> {
    const invite = await this.prisma.invite.findUnique({
      where: { code: input.code.trim().toUpperCase() },
    });

    if (!invite) {
      throw new Error("INVITE_NOT_FOUND");
    }

    if (invite.usedAt) {
      throw new Error("INVITE_ALREADY_USED");
    }

    if (invite.expiresAt.getTime() < Date.now()) {
      throw new Error("INVITE_EXPIRED");
    }

    const normalizedUserName = input.userName.trim();
    const normalizedDeviceName = input.deviceName.trim();

    const existingUser = await this.prisma.user.findFirst({
      where: {
        familyId: invite.familyId,
        name: normalizedUserName,
      },
    });

    const user =
      existingUser ??
      (await this.prisma.user.create({
        data: {
          familyId: invite.familyId,
          role: invite.role,
          name: normalizedUserName,
        },
      }));

    const token = newToken();
    const tokenHash = sha256(token);

    const device = await this.prisma.device.upsert({
      where: { deviceId: input.deviceId },
      update: {
        name: normalizedDeviceName,
        tokenHash,
        userId: user.id,
      },
      create: {
        deviceId: input.deviceId,
        name: normalizedDeviceName,
        tokenHash,
        userId: user.id,
      },
    });

    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    return {
      familyId: invite.familyId,
      userId: user.id,
      deviceId: device.deviceId,
      token,
      role: user.role,
      userCreated: !existingUser,
    };
  }
}