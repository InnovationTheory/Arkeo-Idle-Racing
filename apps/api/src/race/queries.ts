import { prisma } from "../db";

export async function getRaceWithRelations(raceId: string) {
  return prisma.race.findUnique({
    where: { id: raceId },
    include: {
      track: true,
      weather: true,
      raceDayHeat: {
        select: {
          roundNumber: true,
          heatNumber: true,
          round: { select: { heatsCount: true } },
          raceDay: { select: { status: true } }
        }
      },
      raceHorses: {
        include: {
          horse: true,
          serviceType: true,
          assignedProvider: true
        }
      }
    }
  });
}

export async function getCurrentOrNextRace() {
  // First try to find a running race (highest priority)
  const running = await prisma.race.findFirst({
    where: { status: "running" },
    orderBy: { startAt: "desc" },
    include: {
      track: true,
      weather: true,
      raceDayHeat: {
        select: {
          roundNumber: true,
          heatNumber: true,
          round: { select: { heatsCount: true } },
          raceDay: { select: { status: true } }
        }
      },
      raceHorses: {
        include: {
          horse: true,
          serviceType: true,
          assignedProvider: true
        }
      }
    }
  });
  if (running) return running;

  // Then picking, then scheduled
  return prisma.race.findFirst({
    where: { status: { in: ["picking", "scheduled"] } },
    orderBy: { startAt: "asc" },
    include: {
      track: true,
      weather: true,
      raceDayHeat: {
        select: {
          roundNumber: true,
          heatNumber: true,
          round: { select: { heatsCount: true } },
          raceDay: { select: { status: true } }
        }
      },
      raceHorses: {
        include: {
          horse: true,
          serviceType: true,
          assignedProvider: true
        }
      }
    }
  });
}
