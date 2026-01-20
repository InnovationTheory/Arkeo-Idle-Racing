import { prisma } from "../db";
import { broadcastToChat } from "../ws";

const SYSTEM_USER_HANDLE = "system";
const SYSTEM_USER_NICKNAME = "Race Announcer";

async function getOrCreateSystemUser() {
  let user = await prisma.user.findUnique({
    where: { handle: SYSTEM_USER_HANDLE }
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        handle: SYSTEM_USER_HANDLE,
        nickname: SYSTEM_USER_NICKNAME,
        nicknameLower: SYSTEM_USER_NICKNAME.toLowerCase()
      }
    });
  }

  return user;
}

export async function postSystemChatMessage(text: string): Promise<void> {
  const systemUser = await getOrCreateSystemUser();

  const message = await prisma.chatMessage.create({
    data: {
      userId: systemUser.id,
      text
    }
  });

  broadcastToChat({
    type: "chat_message",
    data: {
      id: message.id,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
      user: {
        id: systemUser.id,
        displayName: SYSTEM_USER_NICKNAME
      }
    }
  });
}
