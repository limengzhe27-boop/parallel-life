import type { SceneRead } from '../../../contracts/scenes.ts';
import { sceneBusy } from './state.ts';

/** A read-only bridge: a saved scene result invalidates all phone projections together. */
export class SceneWorldSync {
  private completedVersion = -1;
  private pending?: Promise<void>;
  private readonly worldId: string;
  constructor(worldId: string) {
    this.worldId = worldId;
  }

  async sync(
    scene: SceneRead,
    phoneVersion: number,
    refresh: (minimumVersion: number) => Promise<void>,
  ): Promise<void> {
    if (
      scene.experience.worldId !== this.worldId ||
      sceneBusy(scene.task) ||
      scene.worldVersion <= Math.max(phoneVersion, this.completedVersion)
    )
      return;
    if (this.pending) {
      await this.pending;
      return this.sync(scene, phoneVersion, refresh);
    }
    const version = scene.worldVersion;
    const pending = refresh(version).then(() => {
      this.completedVersion = Math.max(this.completedVersion, version);
    });
    this.pending = pending;
    try {
      await pending;
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }
}
