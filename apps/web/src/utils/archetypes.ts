export type RaceArchetype =
  | "front_runner"
  | "stalker"
  | "stretch_runner"
  | "grinder"
  | "burst"
  | "erratic";

export type Temperament = "calm" | "normal" | "volatile";

export const archetypeLabels: Record<RaceArchetype, string> = {
  front_runner: "Front Runner",
  stalker: "Stalker",
  stretch_runner: "Stretch Runner",
  grinder: "Grinder",
  burst: "Burst Sprinter",
  erratic: "Erratic"
};

export const archetypeTooltips: Record<RaceArchetype, string> = {
  front_runner: "Fast start, fades late",
  stalker: "Steady, always in contention",
  stretch_runner: "Slow early, strong finish",
  grinder: "Relentless pace, outlasts others",
  burst: "One big mid-race surge",
  erratic: "Unpredictable spikes or fades"
};

export const temperamentLabels: Record<Temperament, string> = {
  calm: "Calm",
  normal: "Normal",
  volatile: "Volatile"
};

export type SurfaceAffinity =
  | "dirt_specialist"
  | "turf_specialist"
  | "mud_lover"
  | "all_surface";

export const surfaceAffinityLabels: Record<SurfaceAffinity, string> = {
  dirt_specialist: "Dirt Specialist",
  turf_specialist: "Turf Specialist",
  mud_lover: "Mud Lover",
  all_surface: "All-Surface"
};

export const surfaceAffinityTooltips: Record<SurfaceAffinity, string> = {
  dirt_specialist: "Excels on dirt tracks (+12%)",
  turf_specialist: "Excels on turf tracks (+15%)",
  mud_lover: "Thrives in muddy conditions (+8%)",
  all_surface: "Adapts to any track surface"
};
