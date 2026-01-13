export function buildRaceDaySlotLabel(
  level: number,
  raceNumber: number,
  slotNumber: number
) {
  return `R${level}\nH${raceNumber}\n${slotNumber}`;
}
