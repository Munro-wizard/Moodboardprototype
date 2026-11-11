export const CATEGORIES = [
  {
    id: "stone",
    name: "Stone (Shape & Scale)",
    prompt: "Shape and scale of the stone.",
  },
  {
    id: "setting",
    name: "Setting",
    prompt: "How the stone is held.",
  },
  {
    id: "band",
    name: "Band",
    prompt: "Width and profile of the band.",
  },
  {
    id: "texture",
    name: "Texture / Engraving",
    prompt: "Surface, edge, or engraving.",
  },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const METALS = [
  { id: "yellow", label: "Yellow" },
  { id: "white", label: "White" },
  { id: "platinum", label: "Platinum" },
  { id: "rose", label: "Rose" },
  { id: "mixed", label: "Mixed" },
] as const;

export type MetalId = (typeof METALS)[number]["id"];

export type Caps = Record<CategoryId, number>;

export const LEGACY_CAPS: Caps = {
  stone: 3,
  setting: 2,
  band: 2,
  texture: 3,
};

export const DEFAULT_CAPS: Caps = {
  stone: 3,
  setting: 3,
  band: 3,
  texture: 3,
};

export function sameCaps(a: Caps, b: Caps): boolean {
  return (Object.keys(b) as CategoryId[]).every((key) => a[key] === b[key]);
}

export function fitSlots(
  ids: readonly (string | null)[] | undefined,
  cap: number,
): (string | null)[] {
  const next = (ids ?? []).slice(0, cap).map((id) => id || null);
  while (next.length < cap) next.push(null);
  return next;
}

export type ImageRecord = {
  id: string;
  categoryId: CategoryId;
  origin: "library" | "client";
  briefId: string | null;
  name: string;
  mime: string;
  blob: Blob;
  hidden: boolean;
  createdAt: number;
};

export type Brief = {
  id: string;
  clientName: string;
  metal: MetalId | "";
  notes: Record<CategoryId, string>;
  selections: Record<CategoryId, (string | null)[]>;
  status: "draft" | "locked";
  createdAt: number;
  lockedAt: number | null;
};

export function emptyNotes(): Record<CategoryId, string> {
  return { stone: "", setting: "", band: "", texture: "" };
}

export function emptySelections(): Record<CategoryId, (string | null)[]> {
  return { stone: [], setting: [], band: [], texture: [] };
}

export function emptyBrief(): Brief {
  return {
    id: crypto.randomUUID(),
    clientName: "",
    metal: "",
    notes: emptyNotes(),
    selections: emptySelections(),
    status: "draft",
    createdAt: Date.now(),
    lockedAt: null,
  };
}

export function metalLabel(id: MetalId | ""): string {
  return METALS.find((metal) => metal.id === id)?.label ?? "";
}

export function categoryById(id: CategoryId) {
  return CATEGORIES.find((category) => category.id === id)!;
}
