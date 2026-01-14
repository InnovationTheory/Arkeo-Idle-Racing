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
  // Order by round/heat to get the correct one when multiple exist
  const running = await prisma.race.findFirst({
    where: { status: "running" },
    orderBy: [
      { raceDayHeat: { roundNumber: "asc" } },
      { raceDayHeat: { heatNumber: "asc" } },
      { startAt: "desc" }
    ],
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

  // Then picking, then scheduled - order by round/heat to get correct sequence
  return prisma.race.findFirst({
    where: { status: { in: ["picking", "scheduled"] } },
    orderBy: [
      { raceDayHeat: { roundNumber: "asc" } },
      { raceDayHeat: { heatNumber: "asc" } },
      { startAt: "asc" }
    ],
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
