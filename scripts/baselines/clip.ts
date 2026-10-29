export interface ClipNotRun { status: "not run"; reason: string; observations: [] }
export function clipBaseline(): ClipNotRun {
  return { status: "not run", reason: "CLIP adapter and package licence await activation; no predictions or zero scores invented.", observations: [] };
}
