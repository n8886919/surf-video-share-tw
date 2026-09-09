// Presentation only: preserve the provider/checklist region and the user's spot order.
export function spotRegion(region: string): string | undefined {
  return ({ North: "north", Northeast: "northeast", East: "east", West: "southwest", South: "southwest" } as Record<string, string>)[region];
}
