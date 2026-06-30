const PALETTE: Record<string, string> = {
  IfcBeam: '#e29586',
  IfcColumn: '#d4a574',
  IfcCovering: '#88c2a8',
  IfcCurtainWall: '#7ab8d4',
  IfcDoor: '#a07adf',
  IfcFooting: '#c7b89a',
  IfcFurnishingElement: '#bca5e6',
  IfcMember: '#d4a574',
  IfcPile: '#b8a88c',
  IfcPlate: '#a8c4d8',
  IfcRailing: '#c4a8d8',
  IfcRamp: '#d4c488',
  IfcRoof: '#e6745b',
  IfcSlab: '#88aedf',
  IfcSpace: '#c8d8e8',
  IfcStair: '#f4c45b',
  IfcWall: '#7aa9d4',
  IfcWallStandardCase: '#5fa8ff',
  IfcWindow: '#9ed5b5',
  IfcBuildingElementProxy: '#b0b8c4',
  IfcFlowSegment: '#8cc4a8',
  IfcFlowTerminal: '#a8d4b8',
  IfcFlowFitting: '#94c8b0',
  IfcDistributionPort: '#88b8a0',
};

const FALLBACK_HUES = [
  '#6fa8dc', '#93c47d', '#e06666', '#f6b26b', '#8e7cc3',
  '#c27ba0', '#76a5af', '#d5a6bd', '#b6d7a8', '#ffe599',
];

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(31, h) + s.charCodeAt(i);
    h |= 0;  
  }
  return Math.abs(h);
}

export function ifcClassColor(type: string): string {
  const fallback = FALLBACK_HUES[stableHash(type) % FALLBACK_HUES.length] ?? '#999';
  return PALETTE[type] ?? fallback;
}
