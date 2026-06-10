import { PrismaClient, UserRole } from "@prisma/client";
import { pushSyncCommandsToDevice } from "../lib/firebase.js";
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
      },
      create: {
        deviceId: input.deviceId,
        name: input.deviceName.trim(),
        tokenHash,
      },
    });

    await this.prisma.deviceUser.upsert({
      where: { deviceId_userId: { deviceId: device.deviceId, userId: user.id } },
      create: { deviceId: device.deviceId, userId: user.id },
      update: {},
    });

    return {
      familyId: family.id,
      userId: user.id,
      deviceId: device.deviceId,
      token,
      role: user.role,
    };
  }

  async createInvite(familyId: string, createdByUserId: string, inputRole: UserRole, expiresInMinutes = 60): Promise<CreateInviteResponse> {
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
        familyId,
        createdByUserId,
        code,
        expiresAt,
        role: inputRole,
      },
    });

    return {
      inviteId: invite.id,
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

    if (invite.expiresAt.getTime() < Date.now()) {
      throw new Error("INVITE_EXPIRED");
    }

    // Fix 1: idempotent retry — if invite was already used, check whether THIS device
    // already joined via it. If so, issue a fresh token and return success instead of error.
    if (invite.usedAt) {
      const existingMembership = await this.prisma.deviceUser.findFirst({
        where: {
          deviceId: input.deviceId,
          user: { familyId: invite.familyId },
        },
        include: { user: true },
      });

      if (!existingMembership) {
        throw new Error("INVITE_ALREADY_USED");
      }

      const token = newToken();
      const tokenHash = sha256(token);
      await this.prisma.device.update({
        where: { deviceId: input.deviceId },
        data: { tokenHash },
      });

      return {
        familyId: invite.familyId,
        userId: existingMembership.userId,
        deviceId: input.deviceId,
        token,
        role: existingMembership.user.role,
        userCreated: false,
      };
    }

    const normalizedUserName = input.userName.trim();
    const normalizedDeviceName = input.deviceName.trim();

    // Fix 2: only reuse an existing family member if THIS device was previously attached
    // to them — prevents name-collision identity theft.
    const existingMembership = await this.prisma.deviceUser.findFirst({
      where: {
        deviceId: input.deviceId,
        user: { familyId: invite.familyId },
      },
      include: { user: true },
    });

    const existingUser = existingMembership?.user ?? null;

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
      update: { name: normalizedDeviceName, tokenHash },
      create: { deviceId: input.deviceId, name: normalizedDeviceName, tokenHash },
    });

    await this.prisma.deviceUser.upsert({
      where: { deviceId_userId: { deviceId: device.deviceId, userId: user.id } },
      create: { deviceId: device.deviceId, userId: user.id },
      update: {},
    });

    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    const parentDevices = await this.prisma.device.findMany({
      where: {
        users: { some: { user: { familyId: invite.familyId, role: UserRole.PARENT } } },
      },
      select: { deviceId: true },
    });

    await this.prisma.command.createMany({
      data: parentDevices.map((parentDevice) => ({
        deviceId: parentDevice.deviceId,
        type: "invite_used",
        payload: { inviteId: invite.id, code: invite.code },
        status: "queued",
      })),
    });

    for (const parentDevice of parentDevices) {
      try {
        await pushSyncCommandsToDevice(parentDevice.deviceId, "invite_used");
      } catch (e) {
        console.error("Failed to send FCM push for invite_used", e);
      }
    }

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