export interface FactionMember {
  factionId: string;
}

export const isSameFaction = (
  source: FactionMember,
  target: FactionMember,
): boolean => {
  return source.factionId !== "" && source.factionId === target.factionId;
};

export const areAllies = (
  source: FactionMember,
  target: FactionMember,
): boolean => {
  return isSameFaction(source, target);
};

export const areEnemies = (
  source: FactionMember,
  target: FactionMember,
): boolean => {
  return !isSameFaction(source, target);
};
