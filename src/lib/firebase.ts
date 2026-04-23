import admin from "firebase-admin";
import { prisma } from "./prisma.js";

let initialized = false;

export function getFirebaseApp() {
  
  console.log("Firebase env check", {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
  });

  if (!initialized) {

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });

    initialized = true;
  }

  return admin;
}

export async function pushSyncCommandsToDevice(deviceId: string, reason: string) {
  const device = await prisma.device.findUnique({
    where: { deviceId },
    select: {
      deviceId: true,
      fcmToken: true,
    },
  });

  if (!device?.fcmToken) return;


  console.log("Sending FCM push", { deviceId, reason, hasToken: !!device?.fcmToken });

  const admin = getFirebaseApp();

  await admin.messaging().send({
    token: device.fcmToken,
    data: {
      type: "sync_commands",
      reason,
    },
    android: {
      priority: "high",
    },
  });

  await prisma.device.update({
    where: { deviceId },
    data: { lastPushAt: new Date() },
  });
}